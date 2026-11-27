// Device-only mode: the same core rules as the hub, stored in this browser's IndexedDB.
// Used on one shared device (a family iPad or Chromebook) or when the app is hosted as static files.
import { createCore } from './shared/core.js';
import { createDocStore, emptyDoc } from './shared/store.js';
import { createPeerHost } from './shared/peer-host.js';

const DB_NAME = 'family-feedback';
const STORE = 'kv';
const KEY = 'doc';
const SESSION_KEY = 'ff-device-member';
const PBKDF2_ITERATIONS = 210_000;

// Safari 14 could leave a page's first IndexedDB request unanswered, so the app sat at Loading….
// Asking for the list of databases wakes it up: ask every 100 ms (for up to 2 s) before opening.
function storageAwake() {
  if (typeof indexedDB.databases !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearInterval(again); clearTimeout(enough); resolve(); };
    const poke = () => {
      try { indexedDB.databases().then(done, done); } catch { done(); } // not allowed here: just open
    };
    const again = setInterval(poke, 100);
    const enough = setTimeout(done, 2000);
    poke();
  });
}

export async function openDb() {
  await storageAwake();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    const stuck = setTimeout(() => reject(new Error('This device’s storage isn’t answering. Close the browser completely (swipe it away), then open Echoes again.')), 10_000);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { clearTimeout(stuck); resolve(req.result); };
    req.onerror = () => { clearTimeout(stuck); reject(req.error); };
  });
}

export function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

// Exported for the test that moves a family from a home-base phone to a hub (test/move.test.js).
export const pins = {
  async hash(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${await derive(pin, salt, PBKDF2_ITERATIONS)}`;
  },
  async verify(pin, stored) {
    const [kind, iter, salt, hash] = String(stored).split('$');
    if (kind !== 'pbkdf2') return false;
    const actual = await derive(pin, fromHex(salt), Number(iter));
    let diff = actual.length ^ hash.length;
    for (let i = 0; i < Math.min(actual.length, hash.length); i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
    return diff === 0;
  },
};

export async function createLocalApi() {
  const db = await openDb();
  const saved = await tx(db, 'readonly', (s) => s.get(KEY));
  const store = createDocStore(saved || emptyDoc(), (doc) => tx(db, 'readwrite', (s) => s.put(structuredClone(doc), KEY)));
  const core = createCore({ store, pins, mode: 'device' });
  // Ask the browser not to evict our data (iOS Safari can clear storage of sites you rarely visit).
  navigator.storage?.persist?.().catch(() => {});

  // The signed-in person lasts until the app or tab is closed, which suits a shared device.
  const ctx = () => ({
    me: store.getMember(sessionStorage.getItem(SESSION_KEY)),
    signIn: (id) => sessionStorage.setItem(SESSION_KEY, String(id)),
    signOut: () => sessionStorage.removeItem(SESSION_KEY),
  });

  async function api(method, path, body) {
    try {
      return structuredClone(await core.handle(method, path, body ?? {}, ctx()));
    } catch (e) {
      if (!e.status) throw e;
      const err = new Error(e.message);
      err.status = e.status;
      err.data = { error: e.message, ...e.extra };
      throw err;
    }
  }
  // This device can be the family's home base: linked phones sync with it when they're together.
  api.peerHost = createPeerHost({ core, store });
  return api;
}
