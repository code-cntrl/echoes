// Template for an Echoes browser check. Copy to scripts/<name>-check.mjs, rename the
// journey, and register "test:<name>" in package.json (see ../SKILL.md).
// Headless Edge, a throwaway in-memory hub, checks that don't stop the run, and one
// dark-above-light board per state at phone, foldable and desktop sizes.
//   npm run test:<name> -- [outputDir]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const NAME = 'example';
const outDir = resolve(process.argv[2] || `screenshots/${NAME}`);
mkdirSync(outDir, { recursive: true });

// The hub's clock starts at 10:00 today, so moving it on never crosses midnight by accident.
const tenAm = new Date();
tenAm.setHours(10, 0, 0, 0);
let skew = tenAm.getTime() - Date.now();
const now = () => Date.now() + skew;
const hub = createApp({ dataPath: ':memory:', now: () => new Date(now()) });
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));

// One cookie per person, for setting things up through the API.
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
// Each person keeps at most 20 sign-ins; a client whose sign-in was let go signs in again.
const as = async (id) => {
  const c = client();
  const login = () => c('POST', '/api/login', { memberId: id });
  await login();
  await c('POST', '/api/welcome');
  return (...args) => c(...args).catch(async (e) => {
    if (!/sign in/.test(e.message)) throw e;
    await login();
    return c(...args);
  });
};
const mom = client();
const { me } = await mom('POST', '/api/setup', { familyName: 'The Lees', name: 'Mom', emoji: '👩' });
await mom('POST', '/api/welcome');
const sam = await mom('POST', '/api/members', { name: 'Sam', emoji: '👦', role: 'kid' });
const samC = await as(sam.id);

// ---------- browser ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  fold: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desk: { viewport: { width: 1440, height: 1000 } },
};

async function open(name, { scheme = 'light', size = 'phone', hash = '#/inbox' } = {}) {
  const ctx = await browser.newContext({ colorScheme: scheme, ...SIZES[size] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}/${scheme}/${size}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}/${scheme}/${size}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date(now()) });
  await page.goto(base);
  // A tap on a person is a family-computer sign-in; keep it, as on someone's own phone.
  await page.getByText('Keep me signed in on this device').click();
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  if (hash !== '#/inbox') await page.evaluate((h) => { location.hash = h; }, hash);
  return { ctx, page };
}
// Move the hub and a page forward together (breaks, plan days).
async function advance(page, ms) {
  skew += ms;
  if (page) await page.clock.fastForward(ms);
}

// ---------- the journey: replace with your feature ----------
await samC('POST', '/api/feedback', { toIds: [me.id], model: 'thanks', fields: { what: 'You made pancakes.' } });
{
  const { ctx, page } = await open('Mom');
  await page.locator('.fb-head', { hasText: 'Sam' }).click();
  await page.getByText('You made pancakes.').waitFor();
  check(/30 min/.test(await page.locator('.calm').innerText()), 'opening a message starts a 30-minute break');
  await advance(page, 31 * 60_000);
  await page.locator('[data-form="reply"]').waitFor();
  check(true, 'the reply box appears when the break is over');
  await ctx.close();
}

// ---------- boards: phone, foldable and desktop, dark above light ----------
async function board(key, name, hash, setup) {
  for (const size of Object.keys(SIZES)) {
    for (const scheme of ['dark', 'light']) {
      const { ctx, page } = await open(name, { scheme, size, hash });
      await setup(page, size);
      await page.mouse.move(0, 0);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${key} fits the ${size} width (${scheme})`);
      shots[`${key}-${size}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
  }
}
await board('inbox', 'Mom', '#/inbox', async (page) => { await page.locator('.fb-head').first().waitFor(); });

const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BOARDS = [['inbox', 'Inbox']];
const boardPage = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
const boardPaths = [];
for (const [key, title] of BOARDS) {
  const row = (scheme) => `<div class="row">${['phone', 'fold', 'desk'].map((size) => `<figure><img class="${size}" src="${img(shots[`${key}-${size}-${scheme}`])}"><figcaption>${scheme} · ${{ phone: 'phone', fold: 'foldable', desk: 'desktop' }[size]}</figcaption></figure>`).join('')}</div>`;
  await boardPage.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 14px; } .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
    .phone { width: 260px; } .fold { width: 372px; } .desk { width: 720px; }
  </style><h1>${title}</h1>${row('dark')}${row('light')}`);
  const path = join(outDir, `board-${key}.png`);
  await boardPage.screenshot({ path, fullPage: true });
  boardPaths.push(path);
}
for (const [k, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), buf);

await browser.close();
hub.closeAllConnections?.();
hub.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} ${NAME} checks passed. Boards:\n${boardPaths.join('\n')}`);
