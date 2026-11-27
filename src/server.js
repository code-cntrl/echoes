import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import { createCore, HttpError } from '../public/shared/core.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';
import { createPusher } from './push.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const COOKIE = 'ff_session';
const MAX_BODY = 512 * 1024;
const INVITE_DAYS = 7;
const SESSION_DAYS = 365;
const MAX_SESSIONS = 20; // per person: phones, a laptop, a few browsers

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

// ---------- PINs (scrypt) ----------
const pins = {
  async hash(pin) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`;
  },
  async verify(pin, stored) {
    const [kind, saltHex, hashHex] = String(stored).split('$');
    if (kind !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    return timingSafeEqual(scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length), expected);
  },
};

// ---------- JSON file persistence (atomic replace) ----------
// The file is written off the main thread's way (async), one write at a time, each a full,
// consistent copy taken when it was asked for.
function fileStore(path) {
  if (path === ':memory:') return createDocStore(emptyDoc());
  mkdirSync(dirname(path), { recursive: true });
  const initial = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : emptyDoc();
  const tmp = `${path}.tmp`;
  let last = Promise.resolve();
  return createDocStore(initial, (doc) => {
    const text = JSON.stringify(doc);
    last = last.catch(() => {}).then(async () => {
      await writeFile(tmp, text);
      await rename(tmp, path);
    });
    return last;
  });
}

// ---------- helpers ----------
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  // Requiring JSON blocks simple cross-site form posts (together with SameSite=Strict cookies).
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Expected application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

const VIRTUAL_NIC = /(vethernet|hyper-v|wsl|vmware|virtualbox|vboxnet|docker|^br-|^veth|^virbr|^utun|^tun|^tap|loopback)/i;

// Real home-network addresses first; virtual adapters (Hyper-V, WSL, Docker, VMs) are skipped.
function lanAddresses() {
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL_NIC.test(name))
    .flatMap(([, addrs]) => addrs || [])
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address)
    .sort((a, b) => rank(a) - rank(b));
}
const lanAddress = () => lanAddresses()[0] || null;

const isLoopbackHost = (host) => /^(localhost|127\.|\[::1\]|::1)/.test(host || '');
const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
};

// ---------- app ----------
export function createApp({
  dataPath = process.env.DATA_PATH || join(ROOT, 'data', 'family.json'),
  publicUrl = process.env.PUBLIC_URL || '',
  now, // tests pass a clock; otherwise the real time
  tls = null, // { key, cert }: serve https (npm run start:https), needed for notifications on phones
  push = {}, // tests pass { fetch, coalesceMs }
  anonymousHoldMs, // how long anonymous messages wait before they show (default 1 to 3 h); [0, 0] shows them at once
} = {}) {
  const store = fileStore(dataPath);
  const scheme = tls ? 'https' : 'http';
  const clock = now || (() => new Date());
  // Notifications: a content-free push through the phone's push service (see push.js).
  const pusher = createPusher({
    store, ...push,
    subject: push.subject || process.env.PUSH_CONTACT || 'mailto:echoes@example.com',
    isActive: (m) => core.isActive(m),
    log: (msg) => console.warn(msg),
  });
  const core = createCore({
    store, pins, mode: 'hub', now, anonymousHoldMs,
    onActivity: (ids) => pusher.notify(ids),
    onHold: () => scheduleRelease(),
  });
  const sessions = () => store.raw().hub.sessions;
  const invites = () => store.raw().hub.invites;

  // DNS rebinding: a web page can point its own domain name at this computer's address and then
  // talk to the hub from the internet. That needs a public name, so the API answers only to an IP
  // address, a local name (my-pc, my-pc.local) or a name you set (PUBLIC_URL, ALLOWED_HOSTS).
  const extraHosts = new Set([
    ...(publicUrl ? [hostOf(publicUrl)] : []),
    ...String(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  ]);
  function allowedHost(header) {
    const name = String(header || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!name) return false;
    if (/^[\d.]+$/.test(name) || name.includes(':')) return true; // an IP address (v4 or v6)
    if (!name.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(name)) return true;
    return extraHosts.has(name);
  }

  // Sign-ins don't pile up: each person keeps their newest few, and none outlives its cookie (a year).
  function pruneSessions(memberId) {
    const cutoff = new Date(Date.now() - SESSION_DAYS * 864e5).toISOString();
    const mine = [];
    for (const [t, s] of Object.entries(sessions())) {
      if (!(s.createdAt >= cutoff)) delete sessions()[t];
      else if (s.memberId === memberId) mine.push([t, s.createdAt]);
    }
    mine.sort((a, b) => b[1].localeCompare(a[1]));
    for (const [t] of mine.slice(MAX_SESSIONS)) delete sessions()[t];
  }

  // Anonymous messages are held until their time (see core); then they show and their people get a
  // push, together. The times live in the messages themselves, so a restart picks them up again.
  let releaseTimer = null;
  function scheduleRelease() {
    clearTimeout(releaseTimer);
    const next = core.nextHeld();
    if (!next) return;
    releaseTimer = setTimeout(async () => {
      try {
        const ids = await core.releaseHeld();
        if (ids.length) pusher.notify(ids);
      } catch (e) {
        console.warn(`Couldn’t show held messages: ${e.message}`);
      }
      scheduleRelease();
    }, Math.min(Math.max(0, Date.parse(next) - clock().getTime()), 2 ** 31 - 1));
    releaseTimer.unref?.();
  }
  scheduleRelease();

  // Where phones on the home network can reach this hub.
  function hubInfo(req) {
    if (publicUrl) return { url: publicUrl.replace(/\/$/, ''), reachable: true };
    const addr = server.address();
    const port = addr?.port;
    const host = req.headers.host || '';
    if (!isLoopbackHost(host)) return { url: `${scheme}://${host}`, reachable: true };
    const boundToAll = addr && (addr.address === '0.0.0.0' || addr.address === '::');
    const ip = boundToAll ? lanAddress() : null;
    return ip ? { url: `${scheme}://${ip}:${port}`, reachable: true } : { url: `${scheme}://${host}`, reachable: false };
  }

  function contextFor(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const found = token && Object.hasOwn(sessions(), token) ? sessions()[token] : null;
    const session = found && found.createdAt >= new Date(Date.now() - SESSION_DAYS * 864e5).toISOString() ? found : null;
    const me = session ? store.getMember(session.memberId) : null;
    return {
      me,
      shared: !!session?.shared,
      // `shared`: a family computer. The cookie ends with the browser, and the app signs the person
      // out when it's left alone (see shouldAutoSignOut in app.js). Invites and setup are kept.
      async signIn(memberId, { shared = false } = {}) {
        const t = randomBytes(32).toString('hex');
        sessions()[t] = { memberId, createdAt: new Date().toISOString(), ...(shared && { shared: true }) };
        pruneSessions(memberId);
        await store.save();
        res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/${shared ? '' : `; Max-Age=${SESSION_DAYS * 86400}`}${tls ? '; Secure' : ''}`);
      },
      async signOut() {
        if (token && sessions()[token]) {
          delete sessions()[token];
          await store.save();
        }
        res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${tls ? '; Secure' : ''}`);
      },
      // Someone's PIN changed: sign them out everywhere else (this device stays if it was them) and
      // drop their notification devices, except this one's when it was them.
      async pinChanged(memberId, { self, keepEndpoint }) {
        for (const [t, s] of Object.entries(sessions())) if (s.memberId === memberId && !(self && t === token)) delete sessions()[t];
        await store.save();
        await pusher.forgetMember(memberId, self && typeof keepEndpoint === 'string' ? keepEndpoint : null);
      },
    };
  }

  async function hubRoute(method, path, body, ctx, req) {
    if (method === 'GET' && path === '/api/state') {
      return { ...(await core.handle(method, path, body, ctx)), hub: hubInfo(req), push: true, sharedDevice: ctx.shared };
    }
    // ---------- notifications (Web Push) ----------
    if (path.startsWith('/api/push/')) {
      const me = ctx.me && core.isActive(ctx.me) ? ctx.me : null;
      if (!me) throw new HttpError(401, 'Please sign in.');
      if (method === 'GET' && path === '/api/push/key') return { publicKey: await pusher.publicKey() };
      if (method === 'POST' && path === '/api/push/subscribe') {
        if (!(await pusher.subscribe(me.id, body.subscription))) throw new HttpError(400, 'This browser’s push service isn’t supported.');
        return { ok: true };
      }
      if (method === 'POST' && path === '/api/push/status') return { on: pusher.isOn(body.endpoint, me.id) };
      if (method === 'POST' && path === '/api/push/unsubscribe') {
        await pusher.unsubscribe(body.endpoint, me.id);
        return { ok: true };
      }
      if (method === 'POST' && path === '/api/push/test') {
        const results = await pusher.test(me.id);
        return { devices: results.length, sent: results.filter((r) => r === 'sent').length };
      }
      throw new HttpError(404, 'Not found.');
    }
    if (method === 'POST' && path === '/api/invites') {
      core.requireParent(ctx);
      const member = store.getMember(body.memberId);
      if (!member) throw new HttpError(404, 'Member not found.');
      for (const [k, inv] of Object.entries(invites())) if (inv.memberId === member.id || inv.expiresAt < Date.now()) delete invites()[k];
      const token = randomBytes(18).toString('base64url');
      const expiresAt = Date.now() + INVITE_DAYS * 864e5;
      invites()[token] = { memberId: member.id, expiresAt };
      await store.save();
      const hub = hubInfo(req);
      const url = `${hub.url}/#/join/${token}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
      return { url, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, expiresAt: new Date(expiresAt).toISOString(), reachable: hub.reachable };
    }
    if (method === 'POST' && path === '/api/join') {
      const inv = typeof body.token === 'string' && Object.hasOwn(invites(), body.token) && invites()[body.token];
      const member = inv && store.getMember(inv.memberId);
      if (!inv || inv.expiresAt < Date.now() || !member || !core.isActive(member)) {
        throw new HttpError(410, 'This invite has expired or was already used. Ask a parent for a new one.');
      }
      // Someone with a PIN types it to finish: an invite alone mustn't let anyone else (a parent
      // included) into their inbox. The invite stays usable until it's done.
      if (member.pinHash) {
        if (typeof body.pin !== 'string' || !body.pin) throw new HttpError(401, `${member.name} has a PIN. Type it to add this phone.`, { needPin: true, name: member.name });
        await core.verifyPin(member, body.pin);
      }
      delete invites()[body.token];
      await ctx.signIn(inv.memberId);
      return { ok: true };
    }
    return core.handle(method, path, body, ctx);
  }

  async function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 404, 'Not found');
    try {
      const data = await readFile(file);
      send(res, 200, data, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch {
      send(res, 404, 'Not found');
    }
  }

  const handler = async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) {
        if (!allowedHost(req.headers.host)) throw new HttpError(421, 'This hub only answers on its home-network address.');
        const body = await readJson(req);
        return send(res, 200, await hubRoute(req.method, pathname, body, contextFor(req, res), req));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      return await serveStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
      console.error(err);
      return send(res, 500, { error: 'Something went wrong.' });
    }
  };
  const server = tls ? createHttpsServer(tls, handler) : createServer(handler);
  server.on('close', () => {
    clearTimeout(releaseTimer);
    pusher.close();
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`Echoes hub is running at http://localhost:${port}`);
    if (host === '0.0.0.0' || host === '::') {
      const ips = lanAddresses();
      if (ips.length) {
        console.log(`Phones on your Wi-Fi can open http://${ips[0]}:${port}`);
        if (ips.length > 1) console.log(`Other addresses: ${ips.slice(1).map((ip) => `http://${ip}:${port}`).join(', ')} (set PUBLIC_URL to pick one for invites)`);
      } else {
        console.log('Listening on your network, but no Wi-Fi/Ethernet address was found. Set PUBLIC_URL for invite links.');
      }
    } else {
      console.log('Only this computer can reach it. Start with HOST=0.0.0.0 to let phones on your Wi-Fi join.');
    }
  });
}
