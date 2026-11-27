// Notifications through the home hub (Web Push; see src/push.js).
import { esc, icon } from './dom.js';
import { S, api, isHub, isStandalone, platform, ui } from './state.js';

export const pushReady = () => Promise.race([navigator.serviceWorker.ready,
  new Promise((_, reject) => setTimeout(() => reject(new Error('The app’s background helper isn’t running. Reload and try again.')), 5000))]);
export const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// Why notifications can't work here, if they can't.
export function pushSupport() {
  if (!S?.push) return { why: 'Notifications need the home hub (a computer that stays on). With a phone as home base or one shared device, new messages show up when you open the app or sync.' };
  if (!window.isSecureContext) return { why: 'Notifications need the hub on a secure address. Start it with npm run start:https and open its https link (see the README).' };
  if (platform() === 'ios' && !isStandalone()) return { why: 'On iPhone, add the app to your Home Screen (Share, then Add to Home Screen), open it from there, and come back here.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { why: 'This browser can’t show notifications from the app.' };
  if (Notification.permission === 'denied') return { why: 'Notifications are blocked for this app. Allow them in your phone’s or browser’s settings, then come back.' };
  return { ok: true };
}

export async function currentPushSub() {
  if (!pushSupport().ok) return null;
  return (await pushReady()).pushManager.getSubscription();
}
export const myPushEndpoint = async () => (isHub() ? (await currentPushSub().catch(() => null))?.endpoint : undefined);

export function notifyCardInner() {
  const sup = pushSupport();
  if (!sup.ok) return `<p class="small muted m-0">${esc(sup.why)}</p>`;
  if (ui.push?.on === undefined) return '<p class="small muted m-0">Checking this device…</p>';
  if (ui.push.on) {
    return `<div class="row align-start"><span class="icon-sq green">${icon('check')}</span>
        <span class="grow"><strong>On for this device</strong><span class="small muted d-block">You’ll get “You have something new.” Nothing about the message is sent.</span></span></div>
      <div class="row"><button type="button" data-action="push-test">Send a test</button><button type="button" class="link" data-action="push-off">Turn off</button></div>`;
  }
  // This device was set up, but the hub has let it go (the push service ended it, or a PIN changed).
  const stopped = ui.push.stale ? '<p class="m-0"><strong>Notifications stopped on this device.</strong> Turn them on again to keep getting them.</p>' : '';
  return `${stopped || '<p class="m-0">Get a notification on this device when something new arrives for you.</p>'}
    <p class="small muted m-0">It only ever says “You have something new.” It reaches you through Apple’s or Google’s push service, so the hub computer needs to be online. Nothing about the message is sent.</p>
    <div><button type="button" class="primary" data-action="push-on">Turn on notifications</button></div>`;
}
export const notificationsSection = () => `<span class="label">Notifications</span><div class="card stack" id="notify-card">${notifyCardInner()}</div>`;

export function updateNotifyCard() {
  const card = document.getElementById('notify-card');
  if (card) card.innerHTML = notifyCardInner();
}

// Is this device on the hub's list for the person signed in now? (A shared laptop may have been
// turned on by someone else.)
export async function checkPush() {
  if (!pushSupport().ok) return;
  try {
    const sub = await currentPushSub();
    const on = !!sub && (await api('POST', '/api/push/status', { endpoint: sub.endpoint })).on;
    // Switch and Turn off unsubscribe the browser too, so a subscription the hub doesn't know means
    // it was let go: the push service ended it (iPhones can't renew one by themselves) or a PIN changed.
    ui.push = { on, stale: !!sub && !on };
  } catch {
    ui.push = { on: false };
  }
  updateNotifyCard();
}

// The app icon shows how many new things are waiting, where the system allows it.
export function setAppBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}
