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

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

const pins = {
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
