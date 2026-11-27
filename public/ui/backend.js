// Which backend answers: the home hub, this device (or home base), or a linked phone.
import { meArea, nav } from './dom.js';
import { renderChrome, renderError } from './router.js';
import { S, api, setApi } from './state.js';
import { endSync, peerLink } from './sync.js';

export let peer = null; // linked-phone backend, when this phone syncs with a home base

export async function remoteApi(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    const err = new Error('Can’t reach the family hub. Is it running, and are you on the home Wi-Fi?');
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Only one tab or window at a time may use this device's family data. Each keeps the whole family
// in memory and saves all of it, so two at once would overwrite each other's changes.
export let haveDataLock = false;
export const elsewhereError = () => Object.assign(new Error('Echoes is open in another tab or window.'), { elsewhere: true });

export function claimData({ take = false } = {}) {
  if (haveDataLock || !navigator.locks?.request) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request('family-feedback-data', take ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) return resolve(false);
      haveDataLock = true;
      resolve(true);
      return new Promise(() => {}); // held until this page closes, or another one takes over
    }).catch((err) => {
      if (err?.name === 'AbortError' && haveDataLock) lostData();
    });
  });
}

// Another window took over: stop using the data here at once.
export function lostData() {
  haveDataLock = false;
  endSync();
  peerLink?.close();
  setApi(async () => { throw elsewhereError(); });
  nav.innerHTML = '';
  meArea.innerHTML = '';
  renderError(elsewhereError());
}

export async function useDevice() {
  if (!(await claimData())) throw elsewhereError();
  const { createLocalApi } = await import('../local-backend.js');
  setApi(await createLocalApi());
  localStorage.setItem('ff-mode', 'device');
}

export async function loadPeer() {
  if (!peer) {
    if (!(await claimData())) throw elsewhereError();
    const { createPeerBackend } = await import('../peer-backend.js');
    peer = await createPeerBackend();
  }
  return peer;
}

// A linked phone: its person's copy and queue, synced with the home base phone when together.
// Queued changes update the sync chip straight away.
export async function peerApi(method, path, body) {
  const res = await peer.api(method, path, body);
  if (res?.queued && S) {
    S.peer = peer.client.status();
    renderChrome();
  }
  return res;
}

export async function usePeer() {
  await loadPeer();
  if (!peer.client.link) return useDevice();
  setApi(peerApi);
  localStorage.setItem('ff-mode', 'peer');
}

// A phone that has used the hub never silently switches to an empty on-device family.
export async function pickBackend() {
  const saved = localStorage.getItem('ff-mode');
  if (saved === 'device') return useDevice();
  if (saved === 'peer') return usePeer();
  try {
    const res = await fetch('/api/state', { credentials: 'same-origin' });
    if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
      setApi(remoteApi);
      localStorage.setItem('ff-mode', 'hub');
      return;
    }
  } catch { /* fall through */ }
  if (saved === 'hub') {
    setApi(remoteApi);
    return;
  }
  return useDevice();
}
