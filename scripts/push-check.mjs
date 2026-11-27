// Headless Edge check of notifications through the home hub: turning them on from Family, the hub
// sending a content-free push when a message arrives (to a fake push service), the service worker
// showing "You have something new." when a push is delivered (through the DevTools protocol),
// Send a test, Switch detaching the device, and Turn off. Then boards of the Notifications section
// at phone, foldable and desktop sizes, dark above light, off and on.
//   npm run test:push -- [outputDir]
// Headless browsers can't subscribe to a real push service, so this stands in for the browser's
// subscription with a test key pair; everything after that (hub, encryption, service worker) is real.
import { chromium } from 'playwright-core';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/push');
mkdirSync(outDir, { recursive: true });

// The "phone": a test key pair, and decryption as the phone's browser would do it (RFC 8291).
const ua = createECDH('prime256v1');
ua.generateKeys();
const authSecret = randomBytes(16);
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device';
const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const asPublic = body.subarray(21, 21 + body[20]);
  const ikm = hmac(hmac(authSecret, ua.computeSecret(asPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const d = createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
  const record = body.subarray(21 + body[20]);
  d.setAuthTag(record.subarray(-16));
  return Buffer.concat([d.update(record.subarray(0, -16)), d.final()]).subarray(0, -1).toString();
}

const pushes = [];
let reply = 201; // what the fake push service answers
const hub = createApp({
  dataPath: ':memory:',
  push: { coalesceMs: 0, fetch: async (url, init) => { pushes.push({ url, body: Buffer.from(init.body) }); return { status: reply, ok: reply < 300 }; } },
});
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));
// "Away from home": while set, the hub never answers /api/state (a phone can't reach it off the Wi-Fi).
let away = false;
const [handle] = hub.listeners('request');
hub.removeAllListeners('request');
hub.on('request', (req, res) => { if (!(away && req.url.startsWith('/api/state'))) handle(req, res); });
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
    return data;
  };
}
const mom = client();
const momId = (await mom('POST', '/api/setup', { familyName: 'The Lees', name: 'Mom', emoji: '🧑' })).me.id;
const dad = await mom('POST', '/api/members', { name: 'Dad', emoji: '🧔', role: 'adult', isParent: true });
const dadC = client();
await dadC('POST', '/api/login', { memberId: dad.id });
await dadC('POST', '/api/welcome');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  foldable: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 1.5, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 },
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };

async function open(device = 'phone', scheme = 'light') {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: scheme });
  await ctx.grantPermissions(['notifications'], { origin: base });
  // Stand in for the browser's push service subscription (see the top of this file).
  await ctx.addInitScript(({ endpoint, p256dh, auth }) => {
    if (!window.PushManager) return;
    const KEY = 'test-push-subscription';
    const bump = (k) => localStorage.setItem(k, String(Number(localStorage.getItem(k) || 0) + 1));
    const make = (key) => ({
      endpoint, options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(key).buffer },
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
      unsubscribe: async () => { localStorage.removeItem(KEY); bump('test-push-unsubscribes'); return true; },
    });
    PushManager.prototype.subscribe = async function (o) {
      const key = Array.from(new Uint8Array(o.applicationServerKey));
      localStorage.setItem(KEY, JSON.stringify(key));
      bump('test-push-subscribes');
      return make(key);
    };
    PushManager.prototype.getSubscription = async function () {
      const key = localStorage.getItem(KEY);
      return key ? make(JSON.parse(key)) : null;
    };
  }, { endpoint: ENDPOINT, ...keys });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`${device}/${scheme}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
async function signIn(page, name, hash = '#/family') {
  await page.goto(base);
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  await page.evaluate((h) => { location.hash = h; }, hash);
}
const card = (page) => page.locator('#notify-card');
// Hand a push to the page's real service worker, as the browser does when one arrives.
async function deliverPush(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (let i = 0; i < 20 && !regs.some((r) => !r.isDeleted); i++) await wait(100);
  const reg = regs.find((r) => !r.isDeleted);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(base).origin, registrationId: reg.registrationId, data: '{"t":"new"}' });
}
// Poll from here: waitForFunction would take an async predicate's Promise as "true" at once.
async function shownWithin(page, ms) {
  const end = Date.now() + ms;
  do {
    if (await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length > 0)) return true;
    await wait(100);
  } while (Date.now() < end);
  return false;
}
// Bring the card into view with as little scrolling as possible (above the phone's tab bar).
const showCard = (page) => card(page).evaluate((el) => {
  const tabs = document.getElementById('nav').getBoundingClientRect();
  const bottom = tabs.top > innerHeight / 2 ? tabs.top : innerHeight;
  const r = el.getBoundingClientRect();
  if (r.bottom + 24 > bottom) scrollBy(0, r.bottom + 24 - bottom);
});

// ---------- the journey ----------
{
  const { ctx, page } = await open();
  await signIn(page, 'Mom');
  await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await card(page).getByText('On for this device').waitFor();
  check(true, 'turned on from Family');

  await dadC('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'You fixed the bikes.', impact: 'We could ride to the park.' } });
  await wait(300);
  check(pushes.length === 1 && pushes[0].url === ENDPOINT, `the hub pushed to Mom’s device (${pushes.length})`);
  check(pushes[0] && decrypt(pushes[0].body) === '{"t":"new"}', 'the push holds only {"t":"new"}: no text, no names');

  // Deliver a push to the real service worker and look at what it shows.
  await deliverPush(ctx, page);
  check(await shownWithin(page, 10_000), 'a delivered push shows a notification');
  const shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body })));
  check(shown[0]?.title === 'Echoes' && shown[0]?.body === 'You have something new.', `the notification says only that something is new (${JSON.stringify(shown)})`);
  await page.locator('#nav a', { hasText: 'Inbox' }).locator('.badge').waitFor();
  check(true, 'the open app refreshes when a push arrives (Inbox badge)');

  await card(page).getByRole('button', { name: 'Send a test' }).click();
  await page.getByText('Sent. It should arrive').waitFor();
  check(pushes.length === 2, 'Send a test reaches the hub’s push');

  await page.reload();
  await card(page).getByText('On for this device').waitFor();
  check(true, 'still on after a reload');

  // Switch: this device stops getting Mom's notifications until she turns them on again.
  await page.locator('#me').getByRole('button', { name: 'Switch' }).click();
  await page.locator('.tile', { hasText: 'Mom' }).waitFor();
  await dadC('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'Pancakes!', impact: 'Best Sunday.' } });
  await wait(300);
  check(pushes.length === 2, 'after Switch, no push to this device');
  check(await page.evaluate(() => localStorage.getItem('test-push-subscription') === null), 'Switch also unsubscribes the browser, not just the hub');
  await page.locator('.tile', { hasText: 'Mom' }).click();
  await page.locator('#nav a').first().waitFor();
  await page.evaluate(() => { location.hash = '#/family'; });
  await card(page).getByRole('button', { name: 'Turn on notifications' }).waitFor();
  check(true, 'signed in again: off until turned on');
  await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await card(page).getByText('On for this device').waitFor();

  // The push service ends the subscription (as iPhones' can, with no way to renew it by themselves):
  // the hub lets the device go, the card says so, and Turn on makes a fresh one.
  reply = 410;
  await card(page).getByRole('button', { name: 'Send a test' }).click();
  await page.getByText('The push service didn’t take it').waitFor();
  reply = 201;
  await page.reload();
  await card(page).getByText('Notifications stopped on this device').waitFor();
  check(true, 'a device the hub let go says notifications stopped');
  const counts = () => page.evaluate(() => [Number(localStorage.getItem('test-push-subscribes')), Number(localStorage.getItem('test-push-unsubscribes'))]);
  const [subs0, unsubs0] = await counts();
  await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await card(page).getByText('On for this device').waitFor();
  const [subs1, unsubs1] = await counts();
  check(subs1 === subs0 + 1 && unsubs1 === unsubs0 + 1, `Turn on replaces the dead subscription with a fresh one (${subs0}/${unsubs0} -> ${subs1}/${unsubs1})`);

  // A new PIN signs Mom out elsewhere and drops her other devices, but this one keeps its notifications.
  await page.locator('#p-pin').fill('2468');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await page.getByText('Your other devices are signed out').waitFor();
  await page.reload();
  await card(page).getByRole('button').first().waitFor();
  check(await card(page).getByText('On for this device').isVisible(), 'after her own PIN change, this device is still on');
  let before = pushes.length;
  await dadC('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'Soup.', impact: 'So warm.' } });
  await wait(300);
  check(pushes.length === before + 1, 'after her own PIN change, this device still gets her notifications');
  await page.locator('#p-pin').fill('none');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await page.getByText('Profile saved').waitFor();

  await card(page).getByRole('button', { name: 'Turn off' }).click();
  await card(page).getByRole('button', { name: 'Turn on notifications' }).waitFor();
  before = pushes.length;
  await dadC('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'Tea.', impact: 'Just what I needed.' } });
  await wait(300);
  check(pushes.length === before, 'turned off: no push');
  await ctx.close();
}

// ---------- away from home: the hub can't be reached, and the notification still shows at once ----------
{
  const { ctx, page } = await open();
  await signIn(page, 'Mom');
  await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await card(page).getByText('On for this device').waitFor();
  away = true;
  await deliverPush(ctx, page);
  check(await shownWithin(page, 3000), 'away from home (the hub doesn’t answer): the notification still shows straight away');
  away = false;
  await ctx.close();
}

// ---------- when it can't be turned on, it says why ----------
{
  const ctx = await browser.newContext({ ...DEVICES.phone, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  await signIn(page, 'Mom');
  await card(page).getByText('add the app to your Home Screen').waitFor();
  check(await card(page).getByRole('button').count() === 0, 'iPhone in a Safari tab: asks to add it to the Home Screen first');
  await ctx.close();
}
{
  const ctx = await browser.newContext(DEVICES.phone);
  await ctx.addInitScript(() => { if (window.Notification) Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); });
  const page = await ctx.newPage();
  await signIn(page, 'Mom');
  await card(page).getByText('Notifications are blocked for this app').waitFor();
  check(true, 'blocked in settings: says where to allow them');
  await ctx.close();
}

// ---------- boards ----------
const shots = {};
for (const device of Object.keys(DEVICES)) {
  for (const scheme of ['dark', 'light']) {
    const { ctx, page } = await open(device, scheme);
    await signIn(page, 'Mom');
    await card(page).getByRole('button', { name: 'Turn on notifications' }).waitFor();
    await showCard(page);
    shots[`off-${device}-${scheme}`] = await page.screenshot();
    await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
    await card(page).getByText('On for this device').waitFor();
    await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 10_000 });
    await showCard(page);
    shots[`on-${device}-${scheme}`] = await page.screenshot();
    await card(page).getByRole('button', { name: 'Turn off' }).click();
    await card(page).getByRole('button', { name: 'Turn on notifications' }).waitFor();
    await ctx.close();
  }
}
const img = (b) => `data:image/png;base64,${b.toString('base64')}`;
const board = await (await browser.newContext()).newPage();
for (const [state, title] of [['off', 'Family · Notifications, off'], ['on', 'Family · Notifications, on']]) {
  const col = (device, label) => `<div class="col"><div class="cap">${label}</div>${['dark', 'light'].map((s) => `<img src="${img(shots[`${state}-${device}-${s}`])}">`).join('')}</div>`;
  await board.setContent(`<!doctype html><style>body{margin:0;padding:20px;background:#8a8580;font:600 16px system-ui;color:#fff;width:max-content}
    h1{font-size:20px;margin:0 0 12px}.row{display:flex;gap:18px;align-items:flex-start}.col{display:flex;flex-direction:column;gap:12px}
    img{display:block;height:560px;width:auto;border-radius:12px;box-shadow:0 6px 18px rgb(0 0 0/35%)}</style>
    <h1>${title} · dark above light</h1><div class="row">${col('phone', 'Phone 390 × 844')}${col('foldable', 'Foldable / tablet 744 × 900')}${col('desktop', 'Desktop 1440 × 1000')}</div>`);
  await board.screenshot({ path: join(outDir, `notifications-${state}.png`), fullPage: true });
}
for (const [k, b] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), b);

await browser.close();
hub.closeAllConnections?.();
hub.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} notification checks passed. Boards: ${outDir}`);
