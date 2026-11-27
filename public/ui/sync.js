// Sync: a phone as the family’s home base, and phones linked to it.
import { actions } from './actions.js';
import { loadPeer, peerApi } from './backend.js';
import { app, emptyState, esc, icon, plural } from './dom.js';
import { currentView, refresh, renderChrome } from './router.js';
import { S, api, isDevice, isPeer, memberById, setApi, setS, ui } from './state.js';
import { syncUnsupported } from '../shared/signal.js';

export let peerLink = null; // open connection from this linked phone to the home base

//
// Home base ("host"): shows an offer QR code and scans the other phone's reply.
// Other phone ("join"): scans the home base's code and shows a reply. Then they talk directly.

export let syncLib = null;
export const loadSyncLib = async () => (syncLib ??= await import('../peer-link.js'));

export function endSync() {
  const s = ui.sync;
  if (!s) return;
  ui.sync = null;
  ui.linkFor = null;
  s.stopScan?.();
  s.host?.close();
  s.link?.close(); // the home base stops serving when it leaves Sync; a linked phone keeps peerLink
  if (s.pending && !s.joined) s.pending.close();
}

// The address that opens Echoes on another phone and heads for Link this phone (see #/link).
export const getEchoesUrl = () => `${new URL('.', location.href).href}#/link`;

export function syncTitle(s) {
  if (s.role === 'join') return S.setupDone && isPeer() ? 'Sync with the home base' : 'Link this phone';
  const m = s.mode === 'link' ? memberById(s.memberId) : null;
  return m ? `Link ${esc(m.name)}’s phone` : 'Sync a phone';
}

export async function renderSync() {
  const role = isPeer() || (isDevice() && !S.setupDone) ? 'join' : isDevice() ? 'host' : null;
  if (!role) {
    app.innerHTML = emptyState('home', 'Nothing to sync', 'With a home hub, every phone is always up to date.', '<a class="btn primary" href="#/inbox">Back</a>');
    return;
  }
  if (!ui.sync || ui.sync.role !== role) {
    endSync();
    const mode = role === 'host' && ui.linkFor && S.me?.isParent ? 'link' : 'sync';
    ui.sync = { role, mode, memberId: mode === 'link' ? ui.linkFor : null, step: 'starting', pastGet: !!ui.linkSkipGet };
    ui.linkSkipGet = false;
    drawSyncSkeleton();
    (role === 'host' ? hostFlow : joinFlow)(ui.sync).catch((err) => syncFailed(ui.sync, err));
    return;
  }
  drawSyncSkeleton();
}

// The camera <video> must survive updates, so the screen is built once and its parts updated.
export function drawSyncSkeleton() {
  const s = ui.sync;
  app.innerHTML = `
    <section class="stack narrow sync">
      <h1>${syncTitle(s)}</h1>
      <div id="sync-status" role="status" aria-live="polite"></div>
      <div id="sync-get" class="stack center" hidden>
        <img class="qr big-qr" alt="Code that opens Echoes on the other phone">
        <p class="small muted get-url" id="sync-get-url"></p>
      </div>
      <div id="sync-qr" class="stack center" hidden>
        <img class="qr big-qr" alt="Sync code for the other phone">
        <div><button type="button" class="link small" data-action="sync-copy">Copy this code instead</button></div>
      </div>
      <div id="sync-camera" class="card stack" hidden>
        <video id="sync-video" class="sync-video" playsinline muted aria-label="Camera"></video>
        <p class="small muted center" id="sync-camera-hint"></p>
      </div>
      <details id="sync-paste" class="card" hidden>
        <summary>Can’t use the camera? Paste the code</summary>
        <form data-form="sync-paste" class="stack">
          <label for="sync-code" class="small">Code from the other phone</label>
          <textarea id="sync-code" name="code" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="FF1.…"></textarea>
          <div><button type="submit">Connect</button></div>
        </form>
      </details>
      <div id="sync-actions" class="row"></div>
      <div id="sync-away" class="card away small" hidden>${icon('wifi')}<div><strong>Not on the same Wi-Fi?</strong>
        Turn on Personal Hotspot on the home base phone (on iPhone: Settings › Personal Hotspot › Allow Others to Join).
        On the other phone, join that hotspot in Settings › Wi-Fi, then sync again. The two phones talk to each other directly; nothing goes over the internet.</div></div>
      <details id="sync-diag" class="small muted" hidden>
        <summary>Connection details</summary>
        <p id="sync-diag-text"></p>
      </details>
    </section>`;
  drawSync();
}

export function diagText(d) {
  const side = (c) => (c ? `${c.lan} Wi-Fi IP, ${c.mdns} private name, ${c.public} public${c.relay ? `, ${c.relay} relay` : ''}` : 'not yet');
  return `This phone: ${side(d.local)}. Other phone: ${side(d.remote)}. Link check: ${d.ice}. Connection: ${d.connection}.`;
}

export function drawSync() {
  const s = ui.sync;
  if (!s || currentView() !== 'sync') return;
  const $ = (id) => document.getElementById(id);
  if (!$('sync-status')) return;
  const who = s.who ? `${esc(s.who.emoji)} ${esc(s.who.name)}` : 'the other phone';
  const host = s.role === 'host';
  const otherOpens = s.mode === 'link'
    ? 'open Echoes and tap <strong>Link this phone</strong>'
    : 'open Echoes and tap the sync status at the top';
  const linking = s.mode === 'link' && memberById(s.memberId);
  const theirs = linking ? `${esc(linking.name)}’s phone` : 'the other phone';
  const steps = {
    starting: ['', host ? 'Getting ready…' : 'Starting the camera…'],
    // Linking someone new: first their phone needs Echoes on its Home Screen (iPhone keeps a Home
    // Screen app's data apart from Safari's, so the link must be made in the Home Screen app).
    get: ['', `<p class="m-0"><strong>First, put Echoes on ${theirs}.</strong></p>
      <ol class="tips"><li>On ${theirs}, open the Camera, point it at this code and tap the link.</li>
        <li>In Safari, tap <strong>Share</strong> ${icon('upload')}, then <strong>Add to Home Screen</strong>. Open Echoes from the Home Screen.</li>
        <li>There, tap <strong>Link this phone</strong>. Then tap <strong>Next</strong> here.</li></ol>
      <p class="small muted m-0">Echoes already on ${theirs}? Tap Next.</p>`],
    offer: ['', `<ol class="tips"><li>On ${s.mode === 'link' && memberById(s.memberId) ? `${esc(memberById(s.memberId).name)}’s phone` : 'the other phone'}, ${otherOpens}.</li>
      <li>Let it scan this code.</li><li>Then point this phone’s camera at the code it shows.</li></ol>`],
    scan: ['', `On the home base phone, a parent opens <strong>Family → Link phone</strong> (first time) or <strong>Sync a linked phone</strong>. Scan the code it shows.`],
    answering: ['', 'Making your reply code…'],
    answer: ['', 'Now let the home base phone scan this code. Keep both screens open.'],
    connecting: ['', 'Connecting…'],
    confirming: ['', `Connected. Waiting for the other phone to confirm it is ${who}’s phone…`],
    syncing: ['', 'Connected. Syncing…'],
    connected: ['good', `Connected to ${who}’s phone. Keep this screen open until it says “Synced”, then tap Done.`],
    done: ['good', host ? `Synced with ${who}.` : syncDoneText(s.result)],
    error: ['error', esc(s.error || 'Something went wrong.')],
  };
  const [tone, html] = steps[s.step] || steps.starting;
  $('sync-status').className = tone ? `notice ${tone}` : 'notice';
  $('sync-status').innerHTML = html;

  const showGet = host && s.step === 'get' && s.getQr;
  $('sync-get').hidden = !showGet;
  if (showGet) {
    $('sync-get').querySelector('img').src = s.getQr;
    $('sync-get-url').textContent = s.getUrl;
  }
  const showQr = (host && s.step === 'offer' && s.qr) || (!host && s.step === 'answer');
  $('sync-qr').hidden = !showQr;
  if (showQr) $('sync-qr').querySelector('img').src = s.qr;

  const scanning = (host && s.step === 'offer') || (!host && s.step === 'scan');
  $('sync-camera').hidden = !scanning || s.camera === false;
  $('sync-camera-hint').textContent = host ? 'Point the camera at the other phone’s code.' : 'Point the camera at the code on the home base phone.';
  $('sync-paste').hidden = !scanning;
  if (scanning && s.camera === false) $('sync-paste').open = true;
  if (scanning && s.cameraError) $('sync-status').innerHTML += `<p class="small muted">${esc(s.cameraError)}</p>`;

  const actions = [];
  if (s.step === 'get') {
    actions.push('<button type="button" class="primary" data-action="sync-get-next">Next</button>',
      `<button type="button" data-action="sync-share-link">${navigator.share ? 'Send the link' : 'Copy the link'}</button>`);
  }
  if (s.step === 'connected') actions.push('<button type="button" class="primary" data-action="sync-done">Done</button>');
  if (s.step === 'done' && host) {
    // After linking someone, the next step is usually linking the next person, from Family.
    actions.push(s.mode === 'link'
      ? '<a class="btn primary" href="#/family">Link another phone</a>'
      : '<button type="button" class="primary" data-action="sync-again">Sync another phone</button>', '<a class="btn" href="#/family">Back</a>');
  }
  if (s.step === 'done' && !host) actions.push('<a class="btn primary" href="#/inbox">Go to my inbox</a>', '<button type="button" data-action="sync-again">Sync again</button>');
  if (s.step === 'error') {
    actions.push(s.unsupported
      ? `<a class="btn primary" href="#/${S.setupDone ? (host ? 'family' : 'inbox') : ''}">Back</a>`
      : '<button type="button" class="primary" data-action="sync-again">Try again</button>');
  }
  if (!['done', 'connected', 'error'].includes(s.step)) actions.push(`<a class="btn link" href="#/${S.setupDone ? (host ? 'family' : 'inbox') : ''}">Cancel</a>`);
  $('sync-actions').innerHTML = actions.join('');
  // Away from home Wi-Fi, the phones can still meet on the home base's hotspot.
  $('sync-away').hidden = s.unsupported || !['offer', 'scan', 'answer', 'connecting', 'error'].includes(s.step);
  const diag = s.host?.diag || s.pending?.diag;
  $('sync-diag').hidden = !diag;
  if (diag) $('sync-diag-text').textContent = diagText(diag);
}

export function syncDoneText(r) {
  if (!r) return 'Synced.';
  const parts = ['Synced. Your inbox is up to date.'];
  if (r.sent) parts.push(`${plural(r.sent, 'change')} sent.`);
  if (r.failed.length) parts.push(`${plural(r.failed.length, 'message')} couldn’t be sent; see Sent.`);
  if (r.dropped) parts.push(`This phone is now linked to someone else, so ${plural(r.dropped, 'unsent change')} from before were removed.`);
  parts.push('Until the home base taps Done, what you do here goes straight to it.');
  return parts.join(' ');
}

export function syncFailed(s, err) {
  if (!s || ui.sync !== s) return;
  s.stopScan?.();
  s.step = 'error';
  s.error = err?.message || String(err);
  s.unsupported = !!err?.unsupported;
  drawSync();
}

// Safari only lets a page use the phone's Wi-Fi address for a direct connection once it may use
// the camera, so the camera starts before the connection code is made.
export async function startCamera(s, onCode) {
  const lib = await loadSyncLib();
  const video = document.getElementById('sync-video');
  if (!video || ui.sync !== s) return;
  try {
    s.stopScan = await lib.startScanner(video, (code) => onCode(code).catch((err) => syncFailed(s, err)));
    s.camera = true;
  } catch (err) {
    s.camera = false;
    const why = {
      NotAllowedError: 'Camera permission is turned off. Allow it in Settings, or paste the code below.',
      NotFoundError: 'No camera found. Paste the code below instead.',
      OverconstrainedError: 'No back camera found. Paste the code below instead.',
      NotReadableError: 'Another app is using the camera. Close it and try again, or paste the code below.',
    }[err?.name];
    s.cameraError = why || (window.isSecureContext ? 'The camera isn’t available. Paste the code below instead.' : 'The camera needs a secure (https) address. Paste the code below instead.');
  }
  if (ui.sync !== s) s.stopScan?.();
}

// Too old a system to sync: say so before anyone scans or installs anything.
function needSync() {
  const why = syncUnsupported();
  if (why) throw Object.assign(new Error(why), { unsupported: true });
}

export async function hostFlow(s) {
  needSync();
  const lib = await loadSyncLib();
  if (s.mode === 'link' && !s.pastGet) {
    // The camera and the connection wait for Next, so nothing starts while the other phone installs.
    s.step = 'get';
    s.getUrl = getEchoesUrl();
    s.getQr = lib.qrDataUrl(s.getUrl);
    drawSync();
    return;
  }
  s.step = 'offer';
  drawSync();
  await startCamera(s, (code) => hostAccept(s, code));
  if (ui.sync !== s) return;
  s.host = await lib.startHost({ onState: () => { if (ui.sync === s) drawSync(); } });
  if (ui.sync !== s) return s.host.close();
  s.qr = lib.qrDataUrl(s.host.code);
  drawSync();
}

export async function hostAccept(s, code) {
  if (ui.sync !== s || s.step !== 'offer' || !s.host) return;
  s.stopScan?.();
  s.step = 'connecting';
  drawSync();
  const lib = await loadSyncLib();
  const session = api.peerHost.session({ mode: s.mode, memberId: s.memberId, by: S.me?.id ?? null, pin: s.mode === 'link' ? ui.linkPin : null });
  ui.linkPin = null;
  const link = await s.host.accept(code);
  s.link = link;
  lib.serve(link, {
    async handle(msg) {
      const reply = await session.handle(msg);
      if (reply?.t === 'confirm' && ui.sync === s) {
        s.who = reply.member;
        s.step = 'confirming';
        drawSync();
      } else if (reply?.t === 'ready' && ui.sync === s) {
        s.who = reply.member;
        s.step = 'connected';
        drawSync();
      } else if (reply?.t === 'denied') {
        syncFailed(s, new Error(reply.error));
      }
      return reply;
    },
  }, (err) => console.error(err));
  link.onClose(async () => {
    if (ui.sync === s && s.step === 'connected') {
      s.step = 'done';
      drawSync();
    } else if (ui.sync === s && ['connecting', 'confirming'].includes(s.step)) {
      syncFailed(s, new Error(s.step === 'confirming'
        ? `The other phone said it isn’t ${s.who?.name ?? 'theirs'}’s phone. Check you tapped Link phone next to the right person.`
        : 'The other phone closed the connection before syncing.'));
    }
    // The linked phone may have changed things here: show them.
    setS(await api('GET', '/api/state'));
    renderChrome();
  });
}

export async function joinFlow(s) {
  needSync();
  s.step = 'scan';
  drawSync();
  await startCamera(s, (code) => joinAnswer(s, code));
}

export async function joinAnswer(s, code) {
  if (ui.sync !== s || s.step !== 'scan') return;
  s.stopScan?.();
  s.step = 'answering';
  drawSync();
  const lib = await loadSyncLib();
  s.pending = await lib.joinHost(code, { onState: () => { if (ui.sync === s) drawSync(); } });
  if (ui.sync !== s) return s.pending.close();
  s.qr = lib.qrDataUrl(s.pending.code);
  s.step = 'answer';
  drawSync();
  const link = await s.pending.link;
  if (ui.sync !== s) return link.close();
  s.step = 'syncing';
  drawSync();
  const { client } = await loadPeer();
  let ready;
  try {
    ready = await lib.hello(link, client.link?.key);
    if (ready.t === 'confirm') {
      // The home base wants to link this phone to someone: check it's the right person first.
      const who = `${ready.member.emoji} ${ready.member.name}`;
      const current = client.link?.member;
      const question = current && current.id !== ready.member.id
        ? `This phone belongs to ${current.name}. Link it to ${who} instead? It will show ${ready.member.name}’s messages from now on, and anything ${current.name} hasn’t synced yet is removed.`
        : `Link this phone to ${who} in ${ready.family.name}?`;
      if (!confirm(question)) {
        link.close();
        throw new Error('Linking cancelled. Ask a parent to tap Link phone next to the right person.');
      }
      ready = await lib.hello(link, client.link?.key, { accept: true });
    }
  } catch (err) {
    link.close();
    // Unlinked, removed or guest pass ended: remember it so the phone stops queuing.
    if (err.status === 401 || err.status === 403) {
      await client.refused(err.message);
      if (S?.mode === 'peer') {
        setS(await api('GET', '/api/state'));
        renderChrome();
      }
    }
    throw err;
  }
  s.joined = true;
  peerLink?.close();
  peerLink = link;
  link.onClose(async () => {
    client.disconnected();
    if (peerLink === link) peerLink = null;
    if (S?.mode === 'peer') {
      setS(await api('GET', '/api/state'));
      renderChrome();
    }
  });
  s.result = await client.connected(lib.rpcClient(link), ready);
  if (api !== peerApi) {
    // This phone was empty until now: from here on it is a linked phone.
    setApi(peerApi);
    localStorage.setItem('ff-mode', 'peer');
    localStorage.removeItem('ff-was-linked');
  }
  setS(await api('GET', '/api/state'));
  renderChrome();
  if (ui.sync !== s) return;
  s.step = 'done';
  if (!S.me?.welcomed) {
    ui.sync = null;
    location.hash = '#/inbox';
    return refresh();
  }
  drawSync();
}
