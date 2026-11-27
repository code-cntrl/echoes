// Connection codes for phone-to-phone sync. A WebRTC offer or answer is squeezed into one short
// text (shown as a QR code), so two phones can connect with no server in between.
const PREFIX = 'FF1.';
const MAX_CODE = 4000; // a real code is about 600 characters
const MAX_SDP = 64 * 1024;

const toB64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (text) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Decompresses at most `limit` bytes, so a crafted code can't expand into gigabytes.
async function inflate(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error('too big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** @param {'offer'|'answer'} kind */
export async function encodeSignal(kind, sdp) {
  const json = JSON.stringify({ k: kind === 'offer' ? 'o' : 'a', s: sdp });
  return PREFIX + toB64url(await through(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

export const looksLikeSignal = (text) => typeof text === 'string' && text.trim().startsWith(PREFIX);

/** Returns the SDP text, or throws an Error with a message a person can act on. */
export async function decodeSignal(text, kind) {
  const code = String(text || '').trim();
  if (!looksLikeSignal(code)) throw new Error('That isn’t an Echoes sync code.');
  if (code.length > MAX_CODE) throw new Error('That code is too long to be a sync code.');
  let msg;
  try {
    const bytes = await inflate(fromB64url(code.slice(PREFIX.length)), MAX_SDP);
    msg = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That code didn’t come through whole. Try scanning it again.');
  }
  const want = kind === 'offer' ? 'o' : 'a';
  if (msg?.k !== want || typeof msg.s !== 'string') {
    throw new Error(kind === 'offer' ? 'Scan the code on the home base phone first.' : 'Scan the reply code from the other phone.');
  }
  // Only a data-channel description is expected: no audio or video.
  if (!msg.s.startsWith('v=0') || !/\r?\nm=application /.test(msg.s) || /\r?\nm=(audio|video) /.test(msg.s)) {
    throw new Error('That isn’t an Echoes sync code.');
  }
  return msg.s;
}
