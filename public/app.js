// The app's start-up: listeners, timers and the first render. The screens and helpers live in
// public/ui/ (see README, "Development").
import { actions, changeActions, runAction } from './ui/actions.js';
import { pickBackend } from './ui/backend.js';
import { app, banner, meArea, nav, toast } from './ui/dom.js';
import { forms } from './ui/forms.js';
import { toneHtml } from './ui/give.js';
import { minutesLabel, renderInbox, wideQuery } from './ui/inbox.js';
import { currentView, refresh, renderChrome, renderError, route } from './ui/router.js';
import { S, api, compose, isDevice, isHub, saveDraft, setS, ui } from './ui/state.js';
import { endSync } from './ui/sync.js';
import { appearanceEl, applyTheme, showAppearance, themeToggle } from './ui/theme.js';
import { signOut } from './ui/welcome.js';

applyTheme();
themeToggle.addEventListener('click', () => showAppearance(appearanceEl.hidden));
appearanceEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  localStorage.setItem(el.dataset.action === 'theme-family' ? 'ff-theme-family' : 'ff-theme', el.dataset.id);
  applyTheme();
  appearanceEl.querySelector(`[data-action="${el.dataset.action}"][data-id="${el.dataset.id}"]`)?.focus();
});
document.addEventListener('click', (e) => {
  // composedPath, not contains: picking an option re-renders the panel and detaches e.target.
  if (!appearanceEl.hidden && !e.composedPath().some((n) => n === appearanceEl || n === themeToggle)) showAppearance(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !appearanceEl.hidden) {
    showAppearance(false);
    themeToggle.focus();
  }
});

window.addEventListener('hashchange', () => {
  if (ui.sync && currentView() !== 'sync') endSync();
  route();
  app.focus({ preventScroll: true });
  catchUp({ badgesOnly: true });
});

// Catching up. A phone hears of something new from a notification, when they're on. Without one
// (turned off, or Safari on an iPhone outside the Home Screen) the app catches up when it's picked
// up again, and on the hub its tab badges stay current while it's open. Someone typing keeps their
// screen as it is: only the badges change.
const typing = () => document.activeElement?.matches?.('textarea, input[type="text"]');
let catchingUp = null;
function catchUp({ badgesOnly = false } = {}) {
  if (!S?.me || catchingUp) return catchingUp;
  catchingUp = (async () => {
    if (!badgesOnly && !typing() && !ui.sync && !['sync', 'join'].includes(currentView())) {
      ui.quiet = true; // a background catch-up: nothing counts as seen until someone looks
      try { return await refresh(); } finally { ui.quiet = false; }
    }
    const next = await api('GET', '/api/state');
    if (next.me?.id !== S?.me?.id) return refresh(); // signed out, or someone else, elsewhere
    setS(next);
    renderChrome();
  })().catch(() => {}).finally(() => { catchingUp = null; });
  return catchingUp;
}
setInterval(() => { if (!document.hidden && isHub()) catchUp({ badgesOnly: true }); }, 30_000);
addEventListener('pageshow', (e) => { if (e.persisted) catchUp(); });
wideQuery.addEventListener('change', () => {
  if (S?.me?.welcomed && currentView() === 'inbox') renderInbox().catch(renderError);
});

for (const root of [app, nav, meArea, banner]) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.type === 'checkbox' || el.type === 'file' || !actions[el.dataset.action]) return;
    runAction(actions[el.dataset.action], el, e);
  });
}
app.addEventListener('change', (e) => {
  const el = e.target.closest('input[data-action], select[data-action]');
  if (el && changeActions[el.dataset.action]) runAction(changeActions[el.dataset.action], el, e);
});
app.addEventListener('input', (e) => {
  // Reply text is kept outside the DOM so re-rendering the inbox (e.g. after a reaction) never wipes it.
  if (e.target.dataset?.reply) {
    ui.replyDrafts[e.target.dataset.reply] = e.target.value;
    return;
  }
  // What you did, in a question you're asking (Give, Ask).
  if (e.target.dataset?.ask === 'what') {
    compose.askWhat = e.target.value;
    saveDraft();
    return;
  }
  const key = e.target.dataset?.field;
  if (!key) return;
  compose.fields[key] = e.target.value;
  saveDraft();
  const tone = document.getElementById(`tone-${key}`);
  if (tone) tone.innerHTML = toneHtml(e.target.value);
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const handler = forms[form.dataset.form];
  if (!handler) return;
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try { await handler(form); } catch (err) { toast(err.message); } finally { if (btn?.isConnected) btn.disabled = false; }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.installPrompt = e;
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // From the service worker: a notification was tapped, or a push arrived while the app is open.
  navigator.serviceWorker.addEventListener('message', (e) => {
    // A tapped notification opens the Inbox; one arriving while the app is open only catches it up.
    if (e.data?.type === 'open-inbox') location.hash = '#/inbox';
    if (!S?.me) return;
    if (e.data?.type === 'open-inbox') refresh().catch(() => {});
    else catchUp();
  });
}

// The break before replying counts down on open messages. When it ends, the card shows the reply
// box and "Make a plan" (unless someone is typing, so their words aren't disturbed).
setInterval(() => {
  const panels = app.querySelectorAll('[data-calm-until]');
  if (!panels.length) return;
  let over = false;
  for (const el of panels) {
    const left = Date.parse(el.dataset.calmUntil) - Date.now();
    if (left <= 0) over = true;
    else el.querySelector('[data-calm-left]').textContent = minutesLabel(left);
  }
  const typing = document.activeElement?.matches?.('textarea, input[type="text"]');
  if (over && currentView() === 'inbox' && !typing) renderInbox().catch(() => {});
}, 15_000);

// Shared device (one shared device, or a hub sign-in that wasn't kept): sign the person out when
// it's put down, so the next person can't read their inbox.
const IDLE_MS = 3 * 60_000;
const AWAY_MS = 60_000;
let lastActive = Date.now();
let hiddenAt = null;
for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
  addEventListener(type, () => { lastActive = Date.now(); }, { passive: true, capture: true });
}
// Only while a phone is actually connecting or talking to this home base is sign-out held off;
// a finished, failed or waiting Sync screen must not keep the last person signed in.
const shouldAutoSignOut = () => (isDevice() || (isHub() && S?.sharedDevice)) && S?.me && !['connecting', 'confirming', 'connected'].includes(ui.sync?.step);
setInterval(() => {
  if (shouldAutoSignOut() && Date.now() - lastActive > IDLE_MS) signOut({ privacy: true }).catch(() => {});
}, 10_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else {
    if (hiddenAt && shouldAutoSignOut() && Date.now() - hiddenAt > AWAY_MS) signOut({ privacy: true }).catch(() => {});
    else catchUp();
    hiddenAt = null;
    lastActive = Date.now();
  }
});

(async () => {
  try {
    await pickBackend();
    await refresh();
  } catch (err) {
    renderError(err);
  }
})();
