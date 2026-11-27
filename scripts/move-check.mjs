// Headless Edge check of moving a family from a home-base phone to a home hub, so messages arrive
// without syncing by hand and nothing leaves the home. A family is set up on a phone (static files,
// IndexedDB), Mom writes to Sam, and the Family page explains the move. Its backup is downloaded and
// chosen on a new hub's first screen. Everyone and the message are there, and Mom's PIN, made on the
// phone, still works. Writes dark-above-light boards of both screens at three sizes.
//   npm run test:move -- [outputDir]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/move');
mkdirSync(outDir, { recursive: true });
const PUBLIC = resolve('public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// The home-base phone: the app as plain files, like GitHub Pages (no /api, so it runs on the device).
const statics = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    const file = join(PUBLIC, path === '/' ? 'index.html' : decodeURIComponent(path.slice(1)));
    if (!file.startsWith(PUBLIC) || path.startsWith('/api/')) throw new Error();
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
  }
});
const PHONE_URL = await new Promise((r) => statics.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${statics.address().port}/`)));
const hub = createApp({ dataPath: ':memory:' });
const HUB_URL = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}/`)));

const SIZES = {
  phone: { width: 390, height: 844 },
  fold: { width: 744, height: 900 },
  desk: { width: 1440, height: 1000 },
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  // The phone's look for a hub gets a 404 from /api/, as on GitHub Pages.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
};
// One screen at each size, dark and light. `place` runs after each resize (scroll to what matters).
async function shoot(page, key, place = async () => {}) {
  for (const [size, viewport] of Object.entries(SIZES)) {
    await page.setViewportSize(viewport);
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(120);
      await place();
      await page.mouse.move(0, 0);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${key} fits the ${size} width (${scheme})`);
      shots[`${key}-${size}-${scheme}`] = await page.screenshot();
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
const toastWith = (page, text) => page.locator('#toast.show', { hasText: text }).waitFor({ timeout: 10_000 }).then(() => true, () => false);

// 1. The home-base phone: a family, a message, the move explained, and the backup.
const phoneCtx = await browser.newContext({ viewport: SIZES.phone, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
const phone = await phoneCtx.newPage();
watch(phone, 'phone');
await phone.goto(PHONE_URL);
await phone.locator('form[data-form="setup"]').waitFor();
await phone.fill('#familyName', 'The Riveras');
await phone.fill('#name', 'Mom');
await phone.fill('#pin', '2468');
// Family must be drawn once after setup: a second draw (from hashchange) wiped what the parent had
// started typing in Add someone.
await phone.evaluate(() => {
  window.addFormDraws = 0;
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('form[data-form="add-member"]') || n.querySelector('form[data-form="add-member"]'))) window.addFormDraws += 1;
  }).observe(document.getElementById('app'), { childList: true, subtree: true });
});
await phone.click('form[data-form="setup"] button[type="submit"]');
const add = phone.locator('form[data-form="add-member"]');
await add.waitFor();
await phone.waitForTimeout(800);
check((await phone.evaluate(() => window.addFormDraws)) === 1, `after setup Family is drawn once, so typing isn’t wiped (${await phone.evaluate(() => window.addFormDraws)} draws)`);
await add.locator('input[name="name"]').fill('Sam');
await add.locator('select[name="role"]').selectOption('kid');
await add.locator('button[type="submit"]').click();
await phone.locator('.people li', { hasText: 'Sam' }).waitFor();
await phone.locator('#nav a', { hasText: 'Give' }).click();
await phone.locator('.tile', { hasText: 'Sam' }).first().click();
await phone.locator('[data-action="pick-model"][data-id="kids"]').click();
await phone.locator('[data-action="pick-choice"][data-value="happy"]').click();
await phone.fill('textarea[data-field="happened"]', 'You fed the cat without being asked.');
await phone.click('form[data-form="send"] button[type="submit"]');
check(await toastWith(phone, 'Sent to Sam'), 'Mom writes to Sam on the home-base phone');
await phone.locator('#nav a', { hasText: 'Family' }).click();
const move = phone.locator('details.move-out');
await move.waitFor();
await move.locator('summary').click();
const steps = await move.innerText();
check(/iPhones don’t let web apps find each other or run in the background/.test(steps) && /home hub/.test(steps) && /Download backup/.test(steps) && /PINs stay the same/.test(steps),
  'the home base explains why phones can’t sync themselves, and how to move to a home hub');
await phone.waitForFunction(() => !document.getElementById('toast')?.classList.contains('show'), null, { timeout: 8000 }).catch(() => {});
await shoot(phone, 'move-out', async () => { await move.scrollIntoViewIfNeeded(); });
await phone.setViewportSize(SIZES.phone);
const [download] = await Promise.all([phone.waitForEvent('download'), phone.locator('[data-action="backup"]').click()]);
const backupPath = join(outDir, 'home-base-backup.json');
await download.saveAs(backupPath);
check(/^echoes-backup-.*\.json$/.test(download.suggestedFilename()), `Download backup saves a file (${download.suggestedFilename()})`);

// 2. A new hub: its first screen offers to bring the family in.
const hubCtx = await browser.newContext({ viewport: SIZES.desk });
const desk = await hubCtx.newPage();
watch(desk, 'hub');
await desk.goto(HUB_URL);
const moveIn = desk.locator('.move-in');
await moveIn.waitFor();
check(/Moving from a home-base phone\?/i.test(await moveIn.innerText()) && (await desk.locator('form[data-form="setup"]').count()) === 1,
  'a new hub offers to bring a home-base family in, beside setting up a new one');
await shoot(desk, 'move-in', async () => { await moveIn.scrollIntoViewIfNeeded(); });
await desk.setViewportSize(SIZES.desk);
const picker = desk.locator('input[data-action="setup-restore"]');
await picker.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
check(await toastWith(desk, 'not an Echoes backup'), 'a file that isn’t a backup is refused, and setup stays');
await picker.setInputFiles(backupPath);
check(await toastWith(desk, 'The Riveras moved here: 2 people and 1 message'), 'the family moves to the hub');
await desk.getByRole('heading', { name: 'Who’s here?' }).waitFor();
check((await desk.locator('.tile').allInnerTexts()).join(' ').includes('Sam') && /Mom/.test(await desk.locator('.tile', { hasText: 'Mom' }).innerText()), 'everyone is on the hub');

// Mom's PIN, made on the phone, signs her in on the hub.
await desk.getByText('Keep me signed in on this device').click();
await desk.locator('.tile', { hasText: 'Mom' }).click();
await desk.fill('#signin-pin', '0000');
await desk.click('form[data-form="signin"] button[type="submit"]');
await desk.locator('#signin-error .error, #signin-error .notice').first().waitFor({ timeout: 5000 }).catch(() => {});
check((await desk.locator('#nav a').count()) === 0, 'a wrong PIN doesn’t sign Mom in');
await desk.fill('#signin-pin', '2468');
await desk.click('form[data-form="signin"] button[type="submit"]');
await desk.locator('#nav a').first().waitFor();
check(true, 'Mom’s PIN from the phone works on the hub');
await desk.locator('#nav a', { hasText: 'Sent' }).click();
check(/You fed the cat without being asked/.test(await desk.locator('main').innerText()), 'Mom’s Sent has her message to Sam');
await desk.locator('#me').getByRole('button', { name: 'Switch' }).click();
await desk.locator('.tile', { hasText: 'Sam' }).click();
// Sam never opened Echoes on the phone, so the hub welcomes him first, as it would anyone new.
await desk.locator('form[data-form="welcome"]').waitFor();
check(true, 'Sam, new to Echoes, gets the welcome first');
await desk.click('form[data-form="welcome"] button[type="submit"]');
await desk.locator('.fb-head', { hasText: 'Mom' }).first().waitFor();
check(true, 'Sam’s Inbox on the hub has Mom’s message');

// ---------- boards ----------
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BOARDS = [
  ['move-out', 'The home base · Family · Messages without syncing by hand'],
  ['move-in', 'A new home hub · Moving from a home-base phone?'],
];
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
const boardPaths = [];
for (const [key, title] of BOARDS) {
  const label = { phone: 'phone', fold: 'foldable / iPad', desk: 'desktop' };
  const row = (s) => `<div class="row">${Object.keys(SIZES).map((z) => `<figure><img class="${z}" src="${img(shots[`${key}-${z}-${s}`])}"><figcaption>${s} · ${label[z]}</figcaption></figure>`).join('')}</div>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 14px; } .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
    .phone { width: 260px; } .fold { width: 372px; } .desk { width: 720px; }
  </style><h1>Moving to a home hub · ${title}</h1>${row('dark')}${row('light')}`);
  const path = join(outDir, `board-${key}.png`);
  await page.screenshot({ path, fullPage: true });
  boardPaths.push(path);
}

await browser.close();
hub.closeAllConnections?.();
hub.close();
statics.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} moving checks passed. Boards:\n${boardPaths.join('\n')}`);
