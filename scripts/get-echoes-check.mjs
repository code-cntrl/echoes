// Headless Edge check of Get Echoes: the home base's Link phone starts with a QR code of the app's
// own address (#/link), and #/link sends each kind of phone the right way: iPhone Safari to "add it
// to your Home Screen first", the iPhone Home Screen app and other devices straight to Link this
// phone, and a phone that already has a family to its Inbox. Served from a sub-path, like GitHub
// Pages. Writes dark-above-light boards. (The full link over WebRTC is in npm run test:peer.)
//   npm run test:get-echoes -- [outputDir]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] || 'screenshots/get-echoes');
mkdirSync(outDir, { recursive: true });
const PUBLIC = resolve('public');
const PREFIX = '/echoes/';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (!path.startsWith(PREFIX)) throw new Error();
    const rel = decodeURIComponent(path.slice(PREFIX.length)) || 'index.html';
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) throw new Error();
    const data = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${server.address().port}${PREFIX}`;

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROMEBOOK = 'Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE },
  fold: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD },
  desk: { viewport: { width: 1440, height: 1000 }, userAgent: CHROMEBOOK },
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};

async function open({ size = 'phone', scheme = 'light', homeScreen = false, url = APP } = {}) {
  const ctx = await browser.newContext({ ...SIZES[size], colorScheme: scheme });
  if (homeScreen) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${size}/${scheme}: ${e.message}`));
  // No hub on static hosting: the app's look for one gets a 404 from api/.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${size}/${scheme}: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/')) errors.push(`${size}/${scheme}: ${r.status()} ${r.url()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  return { ctx, page };
}
// A home base with Sam added, on the Get Echoes step of Link Sam's phone.
async function homeBaseAtGet(page) {
  await page.locator('form[data-form="setup"]').waitFor();
  await page.fill('#familyName', 'The Riveras');
  await page.fill('#name', 'Mom');
  await page.click('form[data-form="setup"] button[type="submit"]');
  const add = page.locator('form[data-form="add-member"]');
  await add.waitFor();
  await add.locator('input[name="name"]').fill('Sam');
  await add.locator('select[name="role"]').selectOption('kid');
  await add.locator('button[type="submit"]').click();
  await page.locator('.people li', { hasText: 'Sam' }).getByRole('button', { name: 'Link phone', exact: true }).click();
  await page.waitForURL(/#\/sync$/);
  await page.locator('#sync-get:not([hidden]) img').waitFor();
  await page.waitForFunction(() => document.querySelector('#sync-get img')?.complete);
}
const decodeShownQr = (page, box) => page.evaluate(async (sel) => {
  const img = document.querySelector(`${sel} img`);
  const c = document.createElement('canvas');
  c.width = c.height = 900;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 900, 900);
  g.drawImage(img, 0, 0, 900, 900);
  const { readQr } = await import(new URL('peer-link.js', document.baseURI).href);
  return readQr(g.getImageData(0, 0, 900, 900));
}, box);

// 1. The home base: Get Echoes first, then Next shows the sync code.
{
  const { ctx, page } = await open();
  await homeBaseAtGet(page);
  check((await page.locator('h1').innerText()).includes('Link Sam’s phone'), 'Link phone opens for Sam');
  const text = await page.locator('#sync-status').innerText();
  check(/First, put Echoes on Sam’s phone/.test(text) && /Add to Home Screen/.test(text) && /Link this phone/.test(text), 'the steps: Camera, Add to Home Screen, Link this phone');
  const url = await decodeShownQr(page, '#sync-get');
  check(url === `${APP}#/link`, `the QR code is the app's address with #/link (${url})`);
  check((await page.locator('#sync-get-url').innerText()) === url, 'the address is written under the QR code');
  check(await page.locator('#sync-camera').isHidden() && await page.locator('#sync-qr').isHidden(), 'no camera and no sync code yet');
  check(await page.getByRole('button', { name: /Copy the link|Send the link/ }).isVisible(), 'the link can be sent or copied instead');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('#sync-qr:not([hidden]) img').waitFor({ timeout: 20_000 });
  check(/^FF1\./.test(await decodeShownQr(page, '#sync-qr')), 'Next shows the sync code, as before');
  check(await page.locator('#sync-get').isHidden(), 'and the Get Echoes code goes away');
  // A phone that already has a family: #/link just opens the app.
  await page.goto(`${APP}#/link`);
  await page.locator('#nav a').first().or(page.locator('.tile').first()).waitFor();
  check(!/#\/link$/.test(page.url()) && (await page.getByRole('heading', { name: 'Get Echoes' }).count()) === 0, 'on a phone that already has a family, #/link opens the app as usual');
  await ctx.close();
}

// 2. #/link on a new phone, each way it can be opened.
{
  const { ctx, page } = await open({ url: `${APP}#/link` });
  await page.getByRole('heading', { name: 'Get Echoes' }).waitFor();
  check((await page.locator('ol.steps li').count()) === 3 && !(await page.locator('form[data-form="setup"]').count()), 'iPhone Safari: three steps to add it to the Home Screen, and no setup');
  await ctx.close();
}
{
  const { ctx, page } = await open({ url: `${APP}#/link`, homeScreen: true });
  await page.waitForURL(/#\/sync$/);
  check((await page.locator('h1').innerText()) === 'Link this phone', 'iPhone Home Screen app opened at #/link: straight to Link this phone');
  await ctx.close();
}
{
  const { ctx, page } = await open({ homeScreen: true });
  await page.locator('form[data-form="setup"]').waitFor();
  const first = await page.evaluate(() => {
    const join = document.querySelector('[data-action="start-join"]');
    return !!join && !!(join.compareDocumentPosition(document.querySelector('form[data-form="setup"]')) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(first, 'iPhone Home Screen app opened at its start address: Link this phone comes first');
  await ctx.close();
}
{
  const { ctx, page } = await open({ size: 'desk', url: `${APP}#/link` });
  await page.waitForURL(/#\/sync$/);
  check((await page.locator('h1').innerText()) === 'Link this phone', 'Chromebook: straight to Link this phone');
  await ctx.close();
}
{
  const { ctx, page } = await open({ size: 'desk' });
  await page.locator('form[data-form="setup"]').waitFor();
  const first = await page.evaluate(() => !!(document.querySelector('form[data-form="setup"]').compareDocumentPosition(document.querySelector('[data-action="start-join"]')) & Node.DOCUMENT_POSITION_FOLLOWING));
  check(first, 'elsewhere, a new device still offers starting a family first');
  await ctx.close();
}

// ---------- boards ----------
for (const scheme of ['dark', 'light']) {
  for (const size of ['phone', 'fold', 'desk']) {
    const { ctx, page } = await open({ size, scheme });
    await homeBaseAtGet(page);
    await page.locator('#toast.show').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'), null, { timeout: 5000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Get Echoes step fits the ${size} width (${scheme})`);
    shots[`get-${size}-${scheme}`] = await page.screenshot();
    await ctx.close();
  }
  for (const size of ['phone', 'fold']) {
    const { ctx, page } = await open({ size, scheme, url: `${APP}#/link` });
    await page.getByRole('heading', { name: 'Get Echoes' }).waitFor();
    await page.mouse.move(0, 0);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Safari landing fits the ${size} width (${scheme})`);
    shots[`landing-${size}-${scheme}`] = await page.screenshot();
    await ctx.close();
  }
}
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BOARDS = [
  ['get', 'Home base · Link Sam’s phone · Get Echoes first', ['phone', 'fold', 'desk']],
  ['landing', 'The link opened in Safari on an iPhone or iPad', ['phone', 'fold']],
];
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
const boardPaths = [];
for (const [key, title, sizes] of BOARDS) {
  const label = { phone: 'phone', fold: 'foldable / iPad', desk: 'desktop' };
  const row = (s) => `<div class="row">${sizes.map((z) => `<figure><img class="${z}" src="${img(shots[`${key}-${z}-${s}`])}"><figcaption>${s} · ${label[z]}</figcaption></figure>`).join('')}</div>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 14px; } .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
    .phone { width: 260px; } .fold { width: 372px; } .desk { width: 720px; }
  </style><h1>Get Echoes · ${title}</h1>${row('dark')}${row('light')}`);
  const path = join(outDir, `board-${key}.png`);
  await page.screenshot({ path, fullPage: true });
  boardPaths.push(path);
}
for (const [k, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), buf);

await browser.close();
server.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} Get Echoes checks passed. Boards:\n${boardPaths.join('\n')}`);
