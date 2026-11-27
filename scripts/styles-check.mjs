// Headless Edge check of the feedback styles: kids can use every style (kid-friendly ones first, a
// gentle hint on grown-up ones), and every style shows worked examples as grey ghost text, a kid's or
// a grown-up's, with Show another. The ghost text is never sent. Fails on any check or console error.
//   npm run test:styles -- [outputDir]   (dark-above-light boards go there)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.js';
import { MODELS, exampleFor } from '../public/shared/models.js';

const outDir = resolve(process.argv[2] || 'screenshots/styles');
mkdirSync(outDir, { recursive: true });
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
for (const [name, emoji, role] of [['Dad', '👨', 'adult'], ['Sam', '👦', 'kid']]) {
  const m = await mom('POST', '/api/members', { name, emoji, role });
  const c = client();
  await c('POST', '/api/login', { memberId: m.id });
  await c('POST', '/api/welcome');
}
await mom('POST', '/api/welcome');

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
async function open(name, { scheme = 'light', size = 'phone', hash = '#/give' } = {}) {
  const ctx = await browser.newContext({ colorScheme: scheme, ...SIZES[size] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}/${scheme}/${size}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}/${scheme}/${size}: ${e.message}`));
  await page.goto(base);
  await page.getByText('Keep me signed in on this device').click();
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  await page.evaluate((h) => { location.hash = h; }, hash);
  return { ctx, page };
}
const ghost = (page, key) => page.locator(`#field-${key}`).getAttribute('placeholder');
const kidDearMan = exampleFor(MODELS.find((m) => m.id === 'dearman'), 'kid');
const adultGlow = MODELS.find((m) => m.id === 'glow-grow');

// 1. Sam, a kid: every style, kid-friendly first; a grown-up style with a hint and kid examples; sending it.
{
  const { ctx, page } = await open('Sam');
  await page.locator('.tile', { hasText: 'Mom' }).click();
  const tiles = await page.locator('.model-tile').allInnerTexts();
  check(tiles.length === MODELS.length, 'a kid sees every style');
  check(/Kind Words/.test(tiles[0]) && /Grown-up/.test(tiles.at(-1)), 'kid-friendly styles first, grown-up ones last');
  await page.locator('.model-tile', { hasText: 'DEAR MAN' }).click();
  check(/more steps than the others/.test(await page.locator('[data-form="send"]').innerText()), 'a gentle hint on a grown-up style');
  check((await ghost(page, 'describe')) === kidDearMan.fields.describe, 'a kid’s example as ghost text');
  check((await page.locator('#field-describe').inputValue()) === '', 'the example is not filled in');
  await page.getByRole('button', { name: /Show another \(1 of 2\)/ }).click();
  check((await ghost(page, 'describe')) === exampleFor(MODELS.find((m) => m.id === 'dearman'), 'kid', 1).fields.describe, 'Show another shows the next example');
  await page.reload();
  await page.locator('#field-describe').waitFor();
  check(/2 of 2/.test(await page.locator('.example-bar').innerText()), 'the example shown is kept on reload');
  await page.getByRole('button', { name: /Show another/ }).click();
  check(/1 of 2/.test(await page.locator('.example-bar').innerText()), 'and wraps around');
  await page.fill('#field-describe', 'You came into my room without knocking.');
  await page.fill('#field-express', 'I felt embarrassed.');
  await page.fill('#field-assert', 'Please knock first.');
  await page.getByRole('button', { name: /^Send$/ }).click();
  await page.locator('#toast.show').waitFor();
  check(true, 'a kid sends DEAR MAN');
  await page.evaluate(() => { location.hash = '#/guide'; });
  await page.getByRole('heading', { name: 'Guide' }).waitFor();
  check(/DEAR MAN/.test(await page.locator('main').innerText()) && /Nonviolent Communication/.test(await page.locator('main').innerText()), 'the Guide shows a kid every style');
  await ctx.close();
}
const inbox = await mom('GET', '/api/inbox');
const sent = inbox.find((f) => f.model === 'dearman');
check(sent && sent.from.name === 'Sam' && !sent.fields.reinforce && !sent.fields.negotiate, 'Mom gets it, without the ghost text of the fields Sam left empty');

// 2. Dad, a grown-up: grown-up examples.
{
  const { ctx, page } = await open('Dad');
  await page.locator('.tile', { hasText: 'Mom' }).click();
  await page.locator('.model-tile', { hasText: 'Glow & Grow' }).click();
  check((await ghost(page, 'glow')) === exampleFor(adultGlow, 'adult').fields.glow, 'a grown-up sees a grown-up’s example');
  check((await page.locator('.hint', { hasText: 'more steps' }).count()) === 0, 'no kid hint for grown-ups');
  await ctx.close();
}

// ---------- boards: phone, foldable and desktop, dark above light ----------
async function board(key, name, setup) {
  for (const size of Object.keys(SIZES)) {
    for (const scheme of ['dark', 'light']) {
      const { ctx, page } = await open(name, { scheme, size });
      await setup(page, size);
      await page.mouse.move(0, 0);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${key} fits the ${size} width (${scheme})`);
      shots[`${key}-${size}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
  }
}
const writeView = async (page, size) => {
  if (size === 'desk') await page.evaluate(() => window.scrollTo(0, 0));
  else await page.locator('[data-form="send"]').scrollIntoViewIfNeeded();
};
await board('kid', 'Sam', async (page, size) => {
  await page.locator('.tile', { hasText: 'Mom' }).click();
  await page.locator('.model-tile', { hasText: 'DEAR MAN' }).click();
  await writeView(page, size);
});
await board('grown-up', 'Dad', async (page, size) => {
  await page.locator('.tile', { hasText: 'Mom' }).click();
  await page.locator('.model-tile', { hasText: 'Nonviolent' }).click();
  await writeView(page, size);
});

const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BOARDS = [['kid', 'Sam (a kid) writes DEAR MAN, with a kid’s example'], ['grown-up', 'Dad writes Nonviolent Communication, with a grown-up’s example']];
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
const boardPaths = [];
for (const [key, title] of BOARDS) {
  const row = (scheme) => `<div class="row">${['phone', 'fold', 'desk'].map((size) => `<figure><img class="${size}" src="${img(shots[`${key}-${size}-${scheme}`])}"><figcaption>${scheme} · ${{ phone: 'phone', fold: 'foldable', desk: 'desktop' }[size]}</figcaption></figure>`).join('')}</div>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 14px; } .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
    .phone { width: 260px; } .fold { width: 372px; } .desk { width: 720px; }
  </style><h1>Feedback styles · ${title}</h1>${row('dark')}${row('light')}`);
  const path = join(outDir, `board-${key}.png`);
  await page.screenshot({ path, fullPage: true });
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
console.log(`${passed} style checks passed. Boards:\n${boardPaths.join('\n')}`);
