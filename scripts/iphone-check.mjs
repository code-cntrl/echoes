// The app on an iPhone, as near as this PC gets: Safari's engine (Playwright WebKit) with iPhone 15
// settings (screen size, 3x pixels, touch, an iPhone user agent), light and dark. It drives the home
// hub (sign-in, giving, a kid writing a grown-up style with a kid's example, asking and answering,
// notifications on an iPhone outside the Home Screen) and one shared device (IndexedDB across a
// reload). Fails on any check or unexpected console error, and writes a dark-above-light board.
// Not a real iPhone: see "Trying it like an iPhone on this PC" in the README for what it can't show.
//   npm run test:iphone -- [outputDir]     (needs: node node_modules/playwright-core/cli.js install webkit)
import { devices, webkit } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/iphone');
mkdirSync(outDir, { recursive: true });
const IPHONE = devices['iPhone 15'];
const hub = createApp({ dataPath: ':memory:' });
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));

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
await mom('POST', '/api/setup', { familyName: 'The Lees', name: 'Mom', emoji: '👩' });
await mom('POST', '/api/welcome');
const ids = {};
for (const [name, emoji, role] of [['Dad', '👨', 'adult'], ['Ava', '🦊', 'adult'], ['Sam', '👦', 'kid']]) {
  ids[name] = (await mom('POST', '/api/members', { name, emoji, role })).id;
  const c = client();
  await c('POST', '/api/login', { memberId: ids[name] });
  await c('POST', '/api/welcome');
}

let browser;
try {
  browser = await webkit.launch({ headless: true });
} catch (err) {
  console.error(`WebKit isn't installed. Run: node node_modules/playwright-core/cli.js install webkit\n${err.message.split('\n')[0]}`);
  process.exit(1);
}
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};
// Playwright adds a stylesheet of its own while taking a screenshot; WebKit reports the app's CSP
// refusing it. Only that message, and only while a screenshot is taken, is ignored.
const shooting = new WeakSet();
const shoot = async (page) => {
  shooting.add(page);
  const buf = await page.screenshot();
  await page.waitForTimeout(100);
  shooting.delete(page);
  return buf;
};
const watch = (page, label, allow = () => false) => {
  page.on('console', (m) => {
    if (m.type() !== 'error' || allow(m.text())) return;
    if (shooting.has(page) && /^Refused to apply a stylesheet/.test(m.text())) return;
    errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
};
async function open(name, { scheme = 'light', hash = '#/inbox' } = {}) {
  const ctx = await browser.newContext({ ...IPHONE, colorScheme: scheme });
  const page = await ctx.newPage();
  watch(page, `${name}/${scheme}`);
  await page.goto(base);
  await page.getByText('Keep me signed in on this device').click();
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  if (hash !== '#/inbox') await page.evaluate((h) => { location.hash = h; }, hash);
  return { ctx, page };
}
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// 1. It looks like an iPhone to the app, and the tab bar sits at the bottom.
{
  const { ctx, page } = await open('Mom');
  const env = await page.evaluate(() => ({
    ua: /iPhone/.test(navigator.userAgent), width: innerWidth, touch: 'ontouchstart' in window,
    nav: getComputedStyle(document.querySelector('#nav')).position, navTop: document.querySelector('#nav').getBoundingClientRect().top,
  }));
  check(env.ua && env.width === IPHONE.viewport.width && env.touch, `an iPhone 15 screen with touch (${env.width}px)`);
  check(env.navTop > IPHONE.viewport.height / 2, 'the tab bar is at the bottom, as on a phone');
  check(await fits(page), 'no sideways scrolling');
  // 2. Mom writes to Sam: kid-friendly styles listed first, a grown-up's example as ghost text.
  await page.locator('#nav a', { hasText: 'Give' }).click();
  await page.locator('.tile', { hasText: 'Sam' }).click();
  check(/Kind Words/.test(await page.locator('.model-tile').first().innerText()), 'writing to a kid lists kid-friendly styles first');
  await page.locator('.model-tile', { hasText: 'Glow & Grow' }).click();
  check((await page.locator('#field-glow').getAttribute('placeholder')) === 'You were really patient helping Grandma with her phone.', 'a grown-up’s example as ghost text');
  await page.locator('#field-glow').tap();
  await page.keyboard.type('You fed the cat every day this week.');
  await page.getByRole('button', { name: /^Send$/ }).tap();
  await page.locator('#toast.show').waitFor();
  check(true, 'Mom sends with taps and the on-screen keyboard’s typing');
  // 3. Notifications on an iPhone outside the Home Screen: the app says how to turn them on.
  await page.locator('#nav a', { hasText: 'Family' }).click();
  await page.getByText(/add the app to your Home Screen/).waitFor();
  check(true, 'notifications explain Add to Home Screen, as Safari on an iPhone needs');
  await ctx.close();
}

// 4. Sam (a kid) reads it, and writes DEAR MAN with a kid's example.
{
  const { ctx, page } = await open('Sam');
  await page.locator('.fb-head', { hasText: 'Mom' }).tap();
  await page.getByText('You fed the cat every day this week.').waitFor();
  check(true, 'Sam reads Mom’s message');
  await page.locator('#nav a', { hasText: 'Say it' }).click();
  await page.locator('.tile', { hasText: 'Mom' }).tap();
  check((await page.locator('.model-tile').count()) === 6, 'Sam can pick every style');
  await page.locator('.model-tile', { hasText: 'DEAR MAN' }).tap();
  check((await page.locator('#field-describe').getAttribute('placeholder')) === 'Yesterday you came into my room without knocking.', 'a kid’s DEAR MAN example');
  await page.fill('#field-describe', 'You read my diary.');
  await page.fill('#field-express', 'I felt upset.');
  await page.fill('#field-assert', 'Please ask me first.');
  await page.getByRole('button', { name: /^Send$/ }).tap();
  await page.locator('#toast.show').waitFor();
  check(true, 'Sam sends DEAR MAN');
  check(await fits(page), 'no sideways scrolling on Say it');
  await ctx.close();
}

// 5. Ava asks Dad and Sam; Dad answers from his Inbox.
{
  const { ctx, page } = await open('Ava', { hash: '#/give' });
  await page.getByRole('radio', { name: 'Ask', exact: true }).tap();
  await page.getByRole('radio', { name: /A few people/ }).tap();
  await page.locator('.tile', { hasText: 'Dad' }).tap();
  await page.locator('.tile', { hasText: 'Sam' }).tap();
  await page.fill('#ask-what', 'I planned the trip to the lake.');
  await page.getByRole('button', { name: 'Ask 2 people' }).tap();
  await page.getByRole('heading', { name: 'Sent' }).waitFor();
  check(true, 'Ava asks for feedback');
  await ctx.close();
}
{
  const { ctx, page } = await open('Dad');
  await page.locator('.asks .item', { hasText: 'Ava' }).tap();
  await page.getByRole('button', { name: 'Answer with Glow & Grow' }).tap();
  await page.locator('#field-glow').fill('Everyone loved the picnic.');
  await page.getByRole('button', { name: /^Send$/ }).tap();
  await page.locator('#toast.show').waitFor();
  check((await mom('GET', '/api/inbox')).length === 1, 'nothing extra reaches Mom');
  check(true, 'Dad answers Ava’s question');
  await ctx.close();
}

// 6. One shared device (no hub): the family is kept in IndexedDB across a reload, in Safari's engine.
{
  const PUBLIC = resolve('public');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const staticHost = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const file = join(PUBLIC, path === '/' ? 'index.html' : decodeURIComponent(path.slice(1)));
      if (!file.startsWith(PUBLIC)) throw new Error();
      const data = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    }
  });
  const staticUrl = await new Promise((r) => staticHost.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${staticHost.address().port}`)));
  const ctx = await browser.newContext({ ...IPHONE, colorScheme: 'light' });
  const page = await ctx.newPage();
  // No hub here: the app's look for one gets 404s from /api/. Any other missing file is a failure.
  watch(page, 'device', (t) => /Failed to load resource/.test(t));
  page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`device: ${r.status()} ${r.url()}`); });
  await page.goto(staticUrl);
  await page.fill('#familyName', 'iPhone Family');
  await page.fill('#name', 'Papa');
  await page.getByRole('button', { name: 'Create our family space' }).tap();
  await page.getByRole('heading', { name: 'Family', exact: true }).waitFor();
  await page.locator('[data-form="add-member"] input[name="name"]').fill('Lily');
  await page.locator('[data-form="add-member"] select[name="role"]').selectOption('kid');
  await page.locator('[data-form="add-member"] button[type="submit"]').tap();
  await page.locator('.people li', { hasText: 'Lily' }).waitFor();
  await page.reload();
  await page.locator('#me').getByRole('button', { name: 'Switch' }).waitFor();
  await page.evaluate(() => { location.hash = '#/family'; });
  await page.locator('.people li', { hasText: 'Lily' }).waitFor();
  check(true, 'one shared device keeps the family in IndexedDB across a reload');
  await ctx.close();
  await new Promise((r) => staticHost.close(r));
}

// ---------- board: dark row above light row, at the iPhone 15's size ----------
const SCREENS = [
  ['inbox', 'Sam', '#/inbox', 'Inbox', async (p) => { await p.locator('.fb-head').first().waitFor(); }],
  ['write', 'Sam', '#/give', 'Say it · DEAR MAN', async (p) => {
    await p.locator('.tile', { hasText: 'Mom' }).tap();
    await p.locator('.model-tile', { hasText: 'DEAR MAN' }).tap();
    await p.locator('[data-form="send"]').scrollIntoViewIfNeeded();
  }],
  ['ask', 'Ava', '#/sent', 'Sent · your questions', async (p) => { await p.locator('.asks-mine').waitFor(); }],
  ['family', 'Mom', '#/family', 'Family · notifications', async (p) => { await p.getByText(/add the app to your Home Screen/).scrollIntoViewIfNeeded(); }],
];
for (const scheme of ['dark', 'light']) {
  for (const [key, name, hash, , setup] of SCREENS) {
    const { ctx, page } = await open(name, { scheme, hash });
    await setup(page);
    check(await fits(page), `${key} fits the iPhone width (${scheme})`);
    shots[`${scheme}-${key}`] = await shoot(page);
    await ctx.close();
  }
}
await browser.close();

// Lay the board out in Edge if it's there (WebKit on Windows draws the same page too).
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const row = (scheme) => `<div class="label">${scheme === 'dark' ? 'Dark' : 'Light'}</div><div class="row">${SCREENS.map(([key, , , cap]) => `<figure><img src="${img(shots[`${scheme}-${key}`])}"><figcaption>${cap}</figcaption></figure>`).join('')}</div>`;
const boardBrowser = await webkit.launch({ headless: true });
const boardPage = await (await boardBrowser.newContext({ deviceScaleFactor: 1 })).newPage();
await boardPage.setContent(`<!doctype html><style>
  body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
  h1 { font-size: 20px; margin: 0 0 10px; } .label { font-size: 17px; margin: 4px 0 10px; }
  .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
  figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; width: 262px; border-radius: 22px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
</style><h1>Echoes in Safari’s engine (WebKit) · iPhone 15</h1>${row('dark')}${row('light')}`);
const boardPath = join(outDir, 'iphone-board.png');
await boardPage.screenshot({ path: boardPath, fullPage: true });
await boardBrowser.close();
for (const [k, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), buf);

hub.closeAllConnections?.();
hub.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} iPhone (WebKit) checks passed. Board: ${boardPath}`);
