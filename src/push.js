// Web Push from the home hub, without a third-party library: VAPID (RFC 8292) identifies the hub
// to the push service, and aes128gcm encryption (RFC 8291) keeps the push service from reading what
// it carries. A push never holds message text or names: it says only that something is new, and
// the phone shows "You have something new." (see public/sw.js).
import {
  createCipheriv, createECDH, createHash, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign,
} from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s ?? ''), 'base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const PAYLOAD = JSON.stringify({ t: 'new' });

// Only real push services: the hub must never be made to send requests anywhere else.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, // Chrome, Edge on Android, ChromeOS
  /(^|\.)push\.apple\.com$/, // Safari, iPhone Home Screen apps
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)notify\.windows\.com$/, // Edge on Windows
];

/** A browser's PushSubscription (as JSON) if it is usable and goes to a known push service, else null. */
export function checkSubscription(sub) {
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || endpoint.length > 1024 || url.username || url.password || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  const p256dh = fromB64u(sub.keys?.p256dh);
  const auth = fromB64u(sub.keys?.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  // A real point on the curve, or pings to it could never be encrypted.
  try {
    const probe = createECDH('prime256v1');
    probe.generateKeys();
    probe.computeSecret(p256dh);
  } catch {
    return null;
  }
  return { endpoint, p256dh: b64u(p256dh), auth: b64u(auth) };
}

/**
 * Encrypts `plaintext` for one subscription (RFC 8291, one aes128gcm record). `asPrivate` and
 * `salt` are only passed by tests, to reproduce the RFC's example; normally both are random.
 */
export function encrypt(plaintext, { p256dh, auth }, { asPrivate, salt = randomBytes(16) } = {}) {
  const uaPublic = fromB64u(p256dh);
  const ecdh = createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(fromB64u(asPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const prkKey = hmac(fromB64u(auth), ecdh.computeSecret(uaPublic));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, record]);
}

/** The hub's VAPID signing key: made once, kept in the hub's private data (never in backups). */
export function makeVapidKeys() {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  return { jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])) };
}

/**
 * A VAPID token for one push service. Apple's is the strictest: `aud` must be exactly the push
 * service's origin, `exp` at most a day ahead, and `sub` a real mailto: or https: address.
 */
export function vapidToken({ jwk }, audience, subject, now = Date.now()) {
  const part = (o) => b64u(JSON.stringify(o));
  const data = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = sign('sha256', Buffer.from(data), { key: createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}

/**
 * Subscriptions and sending for the hub. Subscriptions live in the hub's private data, keyed by a
 * hash of their address, each for one person.
 * @param {object} o
 * @param {ReturnType<import('../public/shared/store.js').createDocStore>} o.store
 * @param {typeof fetch} [o.fetch]
 * @param {string} [o.subject] contact address for the push services (PUSH_CONTACT)
 * @param {number} [o.coalesceMs] at most one push per person in this window
 * @param {number} [o.retryBaseMs] first wait before trying a failed push again (doubles each time)
 * @param {(member: object) => boolean} [o.isActive]
 */
export function createPusher({
  store, fetch = globalThis.fetch, subject = 'mailto:echoes@example.com',
  coalesceMs = 30_000, retryBaseMs = 30_000, isActive = () => true, log = () => {},
}) {
  const subs = () => store.raw().hub.push;
  const due = () => store.raw().hub.pushDue;
  const keyOf = (endpoint) => createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
  const hostOf = (sub) => new URL(sub.endpoint).host;
  const timers = new Map(); // memberId -> timer
  const retryTimers = new Map(); // subscription key -> timer
  const lastSent = new Map(); // memberId -> time
  const tokens = new Map(); // push service origin -> { token, madeAt }
  const saveQuietly = () => store.save().catch((e) => log(`Couldn’t save the push schedule: ${e.message}`));
  const later = (fn, at) => {
    const t = setTimeout(fn, Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1));
    t.unref?.();
    return t;
  };

  async function keys() {
    const hub = store.raw().hub;
    if (!hub.vapid) {
      hub.vapid = makeVapidKeys();
      await store.save();
    }
    return hub.vapid;
  }

  // Apple asks for one token to be reused rather than a new one per push: make one per push
  // service and refresh it hourly (each is good for 12 hours).
  async function authorization(origin) {
    const vapid = await keys();
    let t = tokens.get(origin);
    if (!t || Date.now() - t.madeAt >= 3600e3) {
      t = { token: vapidToken(vapid, origin, subject), madeAt: Date.now() };
      tokens.set(origin, t);
    }
    return `vapid t=${t.token}, k=${vapid.publicKey}`;
  }

  const mine = (memberId) => Object.entries(subs()).filter(([, s]) => s.memberId === memberId);

  function forget(key) {
    clearTimeout(retryTimers.get(key));
    retryTimers.delete(key);
    delete subs()[key];
  }

  // ---------- trying again ----------
  // A push that fails for a passing reason (no internet, the push service busy) is tried again
  // with growing waits, for as long as the push service would have kept it (a day). The state is
  // saved with the device, so a restart carries on.
  const GIVE_UP_MS = 24 * 3600e3;
  const retryAfterMs = (v) => {
    if (!v) return 0;
    const secs = Number(v);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const when = Date.parse(v);
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
  };
  function retryLater(key, retryAfter, why) {
    const stored = subs()[key];
    if (!stored) return 'error';
    const r = stored.retry || { tries: 0, since: Date.now() };
    r.tries += 1;
    const wait = Math.max(retryBaseMs * 2 ** (r.tries - 1), retryAfterMs(retryAfter));
    if (Date.now() + wait - r.since > GIVE_UP_MS) {
      delete stored.retry;
      saveQuietly();
      log(`Gave up on a push to ${hostOf(stored)} after a day of trying (${why}).`);
      return 'error';
    }
    r.at = Date.now() + wait;
    stored.retry = r;
    saveQuietly();
    scheduleRetry(key, r.at);
    log(`Push to ${hostOf(stored)} not sent (${why}); trying again in ${Math.round(wait / 1000)} s.`);
    return 'retry';
  }
  function scheduleRetry(key, at) {
    clearTimeout(retryTimers.get(key));
    retryTimers.set(key, later(() => {
      retryTimers.delete(key);
      const sub = subs()[key];
      if (!sub?.retry) return;
      const member = store.getMember(sub.memberId);
      if (!member || !isActive(member)) {
        delete sub.retry;
        saveQuietly();
        return;
      }
      sendOne(key, sub).catch((e) => log(e.message));
    }, at));
  }
  function clearRetry(key) {
    clearTimeout(retryTimers.get(key));
    retryTimers.delete(key);
    if (subs()[key]?.retry) {
      delete subs()[key].retry;
      saveQuietly();
    }
  }

  /** One device: 'sent', 'gone' (forgotten), 'retry' (tried again later), 'refused' or 'error'. */
  async function sendOne(key, sub) {
    let body;
    try {
      body = encrypt(PAYLOAD, sub);
    } catch (e) {
      // A device key that can't be used (saved before keys were checked): trying again won't help.
      log(`Forgot a device whose key can’t be used (${e.message}).`);
      forget(key);
      await store.save();
      return 'gone';
    }
    let res;
    try {
      res = await fetch(sub.endpoint, {
        method: 'POST',
        redirect: 'error', // only ever the push service itself
        headers: {
          // Topic: while a phone is offline, the push service keeps only the latest of these pings.
          TTL: '86400', Urgency: 'normal', Topic: 'echoes', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          Authorization: await authorization(new URL(sub.endpoint).origin),
        },
        body,
      });
    } catch (e) {
      return retryLater(key, null, `${e.message}; is this computer online?`);
    }
    // Gone: the phone unsubscribed or the app was removed. Forget it.
    if (res.status === 404 || res.status === 410) {
      forget(key);
      await store.save();
      return 'gone';
    }
    if (res.status === 429 || res.status >= 500) return retryLater(key, res.headers?.get?.('retry-after'), `the push service said ${res.status}`);
    clearRetry(key);
    if (!res.ok) {
      log(`Push refused by ${hostOf(sub)} (${res.status}).`);
      return 'refused';
    }
    return 'sent';
  }

  async function sendNow(memberId) {
    lastSent.set(memberId, Date.now());
    const member = store.getMember(memberId);
    if (!member || !isActive(member)) return [];
    return Promise.all(mine(memberId).map(([k, s]) => sendOne(k, s)));
  }

  // A push held for the 30-second window is saved with the hub's private data, so it still goes out
  // if the hub restarts in between. (Anonymous messages wait in the messages themselves; see core.)
  function schedule(id, at) {
    timers.set(id, later(() => {
      timers.delete(id);
      if (id in due()) {
        delete due()[id];
        saveQuietly();
      }
      sendNow(id).catch((e) => log(e.message));
    }, at));
  }
  for (const [id, at] of Object.entries(due())) {
    if (Number.isFinite(at)) schedule(Number(id), at);
    else delete due()[id];
  }
  for (const [key, sub] of Object.entries(subs())) if (Number.isFinite(sub.retry?.at)) scheduleRetry(key, sub.retry.at);

  return {
    publicKey: async () => (await keys()).publicKey,
    async subscribe(memberId, raw) {
      const sub = checkSubscription(raw);
      if (!sub) return false;
      // One device, one person: subscribing again (say after Switch) moves it to whoever is signed in.
      const key = keyOf(sub.endpoint);
      forget(key);
      subs()[key] = { ...sub, memberId, createdAt: new Date().toISOString() };
      await store.save();
      return true;
    },
    async unsubscribe(endpoint, memberId) {
      const key = keyOf(endpoint);
      if (subs()[key]?.memberId === memberId) {
        forget(key);
        await store.save();
      }
    },
    /** Drops all of this person's devices except `keepEndpoint` (after a PIN change). */
    async forgetMember(memberId, keepEndpoint) {
      const keep = keepEndpoint ? keyOf(keepEndpoint) : null;
      const drop = mine(memberId).filter(([k]) => k !== keep);
      for (const [k] of drop) forget(k);
      if (drop.length) await store.save();
      return drop.length;
    },
    isOn: (endpoint, memberId) => subs()[keyOf(endpoint)]?.memberId === memberId,
    /** Something new for these people: one push per person per window. */
    notify(memberIds) {
      for (const id of new Set(memberIds)) {
        if (!mine(id).length || timers.has(id)) continue; // a push already on its way covers this
        const at = Math.max(Date.now(), (lastSent.get(id) ?? -Infinity) + coalesceMs);
        schedule(id, at);
        if (at - Date.now() > 1000) {
          due()[id] = at;
          saveQuietly();
        }
      }
    },
    /** "Send a test": straight away, to every device of this person. */
    test: (memberId) => sendNow(memberId),
    /** Stop the timers. What's waiting stays saved, so the next start picks it up. */
    close() {
      for (const t of [...timers.values(), ...retryTimers.values()]) clearTimeout(t);
      timers.clear();
      retryTimers.clear();
    },
  };
}
