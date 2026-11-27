// Phone-to-phone connection for "sync when together". The home base makes an offer code, the
// other phone scans it and shows an answer code, the home base scans that, and the two phones
// talk directly over the home Wi-Fi (WebRTC data channel, encrypted). No server is involved.
import qrcode from './vendor/qrcode.mjs';
import { decodeSignal, encodeSignal, looksLikeSignal } from './shared/signal.js';
import { hashKey, linkId, linkProof, randomKey } from './shared/peer-host.js';

// No STUN/TURN servers: phones syncing are together on the same Wi-Fi, and nothing leaves the home.
const RTC_CONFIG = { iceServers: [] };
const CHUNK = 15_000;
const MAX_PARTS = 200; // 3 MB per message: far more than one person's inbox
const MAX_OPEN = 4; // messages being put back together at once
const REQUEST_MS = 20_000;

function iceGathered(pc, ms = 5000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    const timer = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', done);
  });
}

/** Counts the network addresses a description offers: Wi-Fi IP, private .local name, public, relay. */
export function candidateSummary(sdp) {
  const out = { lan: 0, mdns: 0, public: 0, relay: 0, total: 0 };
  for (const line of String(sdp || '').split(/\r?\n/)) {
    const m = line.match(/^a=candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/);
    if (!m) continue;
    out.total += 1;
    if (m[2] === 'host') out[m[1].endsWith('.local') ? 'mdns' : 'lan'] += 1;
    else if (m[2] === 'srflx' || m[2] === 'prflx') out.public += 1;
    else if (m[2] === 'relay') out.relay += 1;
  }
  return out;
}

const NO_ADDRESS = 'This phone didn’t find a Wi-Fi address to connect with. Check that Wi-Fi is on (not just mobile data), allow the camera, and try again.';

// What the Sync screen shows under "Connection details", to help when phones won't connect.
function tracker(pc, onState) {
  const diag = { local: null, remote: null, ice: pc.iceConnectionState, connection: pc.connectionState };
  const update = () => {
    diag.ice = pc.iceConnectionState;
    diag.connection = pc.connectionState;
    onState?.(diag);
  };
  pc.addEventListener('iceconnectionstatechange', update);
  pc.addEventListener('connectionstatechange', update);
  return { diag, update };
}

function withTimeout(promise, ms, message, onTimeout) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)); }, ms); }),
  ]);
}

function opened(dc, pc, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The phones couldn’t connect. Are both on the same Wi-Fi?')), ms);
    const ok = () => { clearTimeout(timer); resolve(wrap(dc, pc)); };
    if (dc.readyState === 'open') return ok();
    dc.addEventListener('open', ok, { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error('The phones couldn’t connect. Are both on the same Wi-Fi?'));
      }
    });
  });
}

// Messages are JSON; big ones (a long inbox) are sent in parts and put back together.
// The other phone isn't trusted yet when parts arrive, so anything out of bounds ends the link.
export function wrap(dc, pc) {
  const listeners = new Set();
  const closers = new Set();
  const parts = new Map();
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    parts.clear();
    for (const fn of closers) fn();
  };
  const hangUp = () => {
    try { dc.close(); } catch { /* already closed */ }
    pc.close();
    fireClose();
  };
  const validPart = (m) => Number.isInteger(m.id) && Number.isInteger(m.n) && Number.isInteger(m.i)
    && m.n > 1 && m.n <= MAX_PARTS && m.i >= 0 && m.i < m.n && typeof m.d === 'string' && m.d.length <= CHUNK;
  dc.addEventListener('message', (e) => {
    // A part's text is at most CHUNK characters, but JSON escaping can make the frame up to 6x longer.
    if (typeof e.data !== 'string' || e.data.length > CHUNK * 6 + 200) return hangUp();
    let msg;
    try { msg = JSON.parse(e.data); } catch { return hangUp(); }
    if (msg?.t === 'part') {
      if (!validPart(msg)) return hangUp();
      let entry = parts.get(msg.id);
      if (!entry) {
        if (parts.size >= MAX_OPEN) return hangUp();
        entry = { n: msg.n, got: 0, list: new Array(msg.n) };
        parts.set(msg.id, entry);
      }
      if (entry.n !== msg.n) return hangUp();
      if (entry.list[msg.i] === undefined) entry.got += 1;
      entry.list[msg.i] = msg.d;
      if (entry.got < entry.n) return;
      parts.delete(msg.id);
      try { msg = JSON.parse(entry.list.join('')); } catch { return hangUp(); }
    }
    if (!msg || typeof msg !== 'object') return;
    for (const fn of listeners) fn(msg);
  });
  dc.addEventListener('close', fireClose);
  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed'].includes(pc.connectionState)) fireClose();
  });
  let partId = 0;
  return {
    send(obj) {
      if (closed) return;
      const text = JSON.stringify(obj);
      if (text.length <= CHUNK) return dc.send(text);
      const id = ++partId;
      const n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) dc.send(JSON.stringify({ t: 'part', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
    },
    onMessage: (fn) => listeners.add(fn),
    onClose: (fn) => (closed ? fn() : closers.add(fn)),
    get closed() { return closed; },
    close: hangUp,
  };
}

/** Home base: returns the offer code to show, and accept(answerCode) to finish connecting. */
export async function startHost({ onState } = {}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const t = tracker(pc, onState);
  const dc = pc.createDataChannel('family-feedback', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await iceGathered(pc);
  t.diag.local = candidateSummary(pc.localDescription.sdp);
  if (!t.diag.local.total) {
    pc.close();
    throw new Error(NO_ADDRESS);
  }
  return {
    code: await encodeSignal('offer', pc.localDescription.sdp),
    diag: t.diag,
    async accept(answerCode) {
      const sdp = await decodeSignal(answerCode, 'answer');
      t.diag.remote = candidateSummary(sdp);
      t.update();
      await pc.setRemoteDescription({ type: 'answer', sdp });
      return opened(dc, pc, 30_000);
    },
    close: () => pc.close(),
  };
}

/** Other phone: takes the home base's offer code, returns the answer code to show and the link. */
export async function joinHost(offerCode, { onState } = {}) {
  const sdp = await decodeSignal(offerCode, 'offer');
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const t = tracker(pc, onState);
  t.diag.remote = candidateSummary(sdp);
  const channel = new Promise((resolve) => pc.addEventListener('datachannel', (e) => resolve(e.channel), { once: true }));
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await iceGathered(pc);
  t.diag.local = candidateSummary(pc.localDescription.sdp);
  if (!t.diag.local.total) {
    pc.close();
    throw new Error(NO_ADDRESS);
  }
  return {
    code: await encodeSignal('answer', pc.localDescription.sdp),
    diag: t.diag,
    // The home base still has to scan our code: give it five minutes in all, then stop.
    link: withTimeout(channel, 5 * 60_000, 'The home base didn’t scan this code in time. Start again.', () => pc.close())
      .then((dc) => opened(dc, pc, 30_000)),
    close: () => pc.close(),
  };
}

/**
 * Other phone: say hello (with our key if linked) and wait for "ready", "confirm" or "denied".
 * A linked phone first has the home base prove it knows our link; a phone that can't prove it
 * (a different family's home base, or a look-alike) never gets the key.
 */
export async function hello(link, key, { accept = false } = {}) {
  let sendKey = null;
  if (key) {
    const nonce = randomKey();
    const { proof } = await ask(link, { t: 'challenge', id: await linkId(key), nonce }, 'proof', 10_000)
      .catch(() => ({ proof: null }));
    if (proof && proof === await linkProof(await hashKey(key), nonce)) sendKey = key;
  }
  const reply = await ask(link, { t: 'hello', key: sendKey, accept, v: 2 }, ['ready', 'denied', 'confirm'], REQUEST_MS);
  if (reply.t === 'denied') throw Object.assign(new Error(reply.error || 'The home base said no.'), { status: reply.status || 403 });
  return reply;
}

function ask(link, msg, kinds, ms) {
  const want = [].concat(kinds);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The home base didn’t answer. Try again.')), ms);
    link.onMessage((m) => {
      if (!want.includes(m.t)) return;
      clearTimeout(timer);
      resolve(m);
    });
    link.onClose(() => reject(new Error('The connection closed.')));
    link.send(msg);
  });
}

/** Other phone: requests over the link, answered by the home base like the hub's /api. */
export function rpcClient(link) {
  let n = 0;
  const waiting = new Map();
  link.onMessage((m) => {
    if (m.t !== 'res' || !waiting.has(m.id)) return;
    const { resolve, reject, timer } = waiting.get(m.id);
    clearTimeout(timer);
    waiting.delete(m.id);
    if (m.ok) return resolve(m.data);
    const err = new Error(m.error || 'Something went wrong.');
    err.status = m.status;
    err.data = { error: m.error, ...(m.extra || {}) };
    reject(err);
  });
  link.onClose(() => {
    for (const w of waiting.values()) {
      clearTimeout(w.timer);
      w.reject(new Error('The connection to the home base closed.'));
    }
    waiting.clear();
  });
  return {
    request(method, path, body, op) {
      if (link.closed) return Promise.reject(new Error('Not connected to the home base.'));
      return new Promise((resolve, reject) => {
        const id = ++n;
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error('The home base didn’t answer.'));
        }, REQUEST_MS);
        waiting.set(id, { resolve, reject, timer });
        link.send({ t: 'req', id, method, path, body, op });
      });
    },
  };
}

/** Home base: answer every message on the link with the peer-host session. */
export function serve(link, session, onError = () => {}) {
  let queue = Promise.resolve();
  link.onMessage((m) => {
    // One at a time, in arrival order, so a phone's queued changes are applied in the order made.
    queue = queue.then(async () => {
      const reply = await session.handle(m);
      if (reply) link.send(reply);
    }).catch(onError);
  });
}

// ---------- QR codes ----------

export function qrDataUrl(text) {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

let jsqrLoading = null;
function loadJsQr() {
  jsqrLoading ??= new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => { jsqrLoading = null; reject(new Error('Couldn’t load the QR reader.')); };
    document.head.append(s);
  });
  return jsqrLoading;
}

/** Reads a QR code from an image (used by tests and by the camera loop). */
export async function readQr(imageData) {
  const jsQR = await loadJsQr();
  const hit = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  return hit?.data || null;
}

/**
 * Starts the back camera in `video` and calls onCode(text) once for the first sync code seen.
 * Returns stop(). Needs https:// (or localhost) and camera permission.
 */
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera here. Paste the code instead.');
  const jsQR = await loadJsQr();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
  // About 8 reads a second of the middle of the picture: plenty for a QR held up to the camera,
  // and much lighter on the battery than reading every full frame.
  let last = 0;
  const tick = (t) => {
    if (stopped) return;
    if (t - last >= 120 && video.readyState >= 2 && video.videoWidth) {
      last = t;
      const side = Math.min(video.videoWidth, video.videoHeight) * 0.85;
      const size = Math.round(Math.min(640, side));
      canvas.width = canvas.height = size;
      ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
      const img = ctx.getImageData(0, 0, size, size);
      const hit = jsQR(img.data, size, size, { inversionAttempts: 'dontInvert' });
      if (hit?.data && looksLikeSignal(hit.data)) {
        stop();
        onCode(hit.data);
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return stop;
}
