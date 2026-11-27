// Headless Edge and WebKit check of how Echoes starts on older or broken browsers (public/boot.js).
//  - A normal start shows no message and marks itself started.
//  - With structuredClone, Object.hasOwn, .at(), navigator.locks, Intl.Segmenter and the compression
//    streams taken away (as on iOS 14.0 to 15.3), the app still starts and keeps a family across a
//    reload, and Link phone says linking needs iOS 16.4 instead of failing oddly.
//  - A script error, a module that won't load and a start that never finishes each replace the
//    endless Loading… with a message; a late start still takes over. An iPad on iOS 12 or 13 is
//    told it's too old, with its version.
// Old Safari itself can't run here, so its failures are made on purpose. Served from a sub-path,
// like GitHub Pages. Writes dark-above-light boards.
//   npm run test:boot -- [outputDir]
import { chromium, webkit } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] || 'screenshots/boot');
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
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${server.address().port}${PREFIX}`;

const ua = (os, version, device = 'iPhone') => `Mozilla/5.0 (${device}; CPU ${device === 'iPhone' ? 'iPhone ' : ''}OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;
const IPHONE = ua('18_0', '18.0');
const OLD_IPAD = ua('12_5_7', '12.1.2', 'iPad');
const IPAD_13_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Safari/605.1.15';
const IPHONE_15_2 = ua('15_2', '15.2');
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true },
  fold: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 2, hasTouch: true },
  desk: { viewport: { width: 1440, height: 1000 } },
};

// What iOS 14.0 to 15.3 lacks (and Intl.Segmenter before 14.5), taken away before any script runs.
const OLD_APIS = () => {
  delete window.structuredClone;
  delete Object.hasOwn;
  delete Array.prototype.at;
  delete String.prototype.at;
  delete window.CompressionStream;
  delete window.DecompressionStream;
  delete Navigator.prototype.locks;
  if (window.Intl) delete Intl.Segmenter;
};
const SYNTAX_ERROR = 'const broken = ;\n';
const NEVER_STARTS = 'await new Promise(() => {});\n';
const javascript = (body) => (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body });

const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};

async function open(browser, { size = 'phone', scheme = 'light', userAgent = IPHONE, init = [], routes = {}, clock = false, waitUntil = 'load', errors = null } = {}) {
  const ctx = await browser.newContext({ ...SIZES[size], userAgent, colorScheme: scheme });
  for (const fn of init) await ctx.addInitScript(fn);
  for (const [path, handler] of Object.entries(routes)) await ctx.route(`${APP}${path}`, handler);
  const page = await ctx.newPage();
  if (errors) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      // No hub on static hosting: the app's look for one gets a 404 from api/.
      if (m.type() === 'error' && !/Failed to load resource|Refused to apply a stylesheet/.test(m.text())) errors.push(m.text());
    });
  }
  page.on('dialog', (d) => d.accept());
  if (clock) await page.clock.install();
  await page.goto(APP, { waitUntil });
  return { ctx, page };
}
const bootMessage = (page) => page.evaluate(() => {
  const box = document.querySelector('#app [data-boot]');
  return box && { kind: box.dataset.boot, title: box.querySelector('h1').textContent, text: box.textContent, why: box.querySelector('.boot-why').textContent, reload: !!box.querySelector('button') };
});
const waitBoot = (page, kind, timeout = 5000) => page.locator(`#app [data-boot="${kind}"]`).waitFor({ timeout }).then(() => true, () => false);

async function setUpFamily(page) {
  await page.locator('form[data-form="setup"]').waitFor();
  await page.fill('#familyName', 'The Riveras');
  await page.fill('#name', 'Mom');
  await page.click('form[data-form="setup"] button[type="submit"]');
  const add = page.locator('form[data-form="add-member"]');
  await add.waitFor();
  await add.locator('input[name="name"]').fill('Sam');
  await add.locator('select[name="role"]').selectOption('kid');
  await add.locator('button[type="submit"]').click();
  await page.locator('.people li', { hasText: 'Sam' }).getByRole('button', { name: 'Link phone', exact: true }).waitFor();
}
async function linkSam(page) {
  await page.locator('.people li', { hasText: 'Sam' }).getByRole('button', { name: 'Link phone', exact: true }).click();
  await page.waitForURL(/#\/sync$/);
  await page.locator('#sync-status.error').waitFor();
}

for (const [engine, type, launch] of [['Edge', chromium, { channel: 'msedge' }], ['WebKit', webkit, {}]]) {
  const browser = await type.launch({ headless: true, ...launch });

  // 1. A normal start: no message, and boot.js hears that it started.
  {
    const errors = [];
    const { ctx, page } = await open(browser, { errors });
    await page.locator('form[data-form="setup"]').waitFor();
    check(await page.evaluate(() => window.echoesBoot?.ready === true && window.echoesBoot.shown === null), `${engine}: a normal start tells boot.js it started`);
    check(await page.evaluate(() => /native code/.test(Function.prototype.toString.call(structuredClone))), `${engine}: the browser’s own structuredClone is kept`);
    check((await bootMessage(page)) === null, `${engine}: no start-up message on a normal start`);
    check(errors.length === 0, `${engine}: a normal start logs no errors (${errors.join('; ')})`);
    await ctx.close();
  }

  // 2. As on iOS 14.0 to 15.3: the fallbacks let it start, keep a family, and explain Link phone.
  {
    const errors = [];
    const { ctx, page } = await open(browser, { init: [OLD_APIS], errors });
    check(await page.evaluate(() => typeof structuredClone === 'function' && !/native code/.test(Function.prototype.toString.call(structuredClone))
      && typeof Object.hasOwn === 'function' && [1, 2].at(-1) === 2 && !navigator.locks && !window.CompressionStream), `${engine}: old-Safari APIs are gone and boot.js filled in the ones start-up needs`);
    await setUpFamily(page);
    check(await page.evaluate(() => document.documentElement.dataset.themeFamily === 'messages'), `${engine}: the theme still applies`);
    await page.reload();
    await page.locator('.people li', { hasText: 'Sam' }).or(page.locator('.tile', { hasText: 'Sam' })).or(page.locator('#nav a')).first().waitFor();
    check(await page.locator('form[data-form="setup"]').count() === 0 && (await page.locator('#family-name').innerText()) === 'The Riveras', `${engine}: without them the family is saved and still there after a reload`);
    await page.goto(`${APP}#/family`);
    await linkSam(page);
    const status = await page.locator('#sync-status').innerText();
    check(/needs iOS or iPadOS 16\.4 or later/.test(status) && /works here on its own/.test(status), `${engine}: Link phone says linking needs iOS 16.4 (${status})`);
    check(await page.getByRole('link', { name: 'Back', exact: true }).isVisible() && await page.getByRole('button', { name: 'Try again' }).count() === 0, `${engine}: with a Back button, not Try again`);
    check(await page.locator('#sync-away').isHidden() && await page.locator('#sync-camera').isHidden(), `${engine}: and no camera or hotspot tip`);
    check(errors.length === 0, `${engine}: no errors with the old APIs taken away (${errors.join('; ')})`);
    await ctx.close();
  }

  // 3. A script error while starting.
  {
    const { ctx, page } = await open(browser, { routes: { 'app.js': javascript(SYNTAX_ERROR) } });
    check(await waitBoot(page, 'error'), `${engine}: a syntax error in app.js replaces Loading… within seconds`);
    const m = await bootMessage(page);
    check(m?.title === 'Echoes couldn’t start' && /Reload to try again/.test(m.text) && m.reload, `${engine}: it says it couldn’t start and offers Reload (${m?.title})`);
    check(/^iOS 18\.0 · .*SyntaxError/i.test(m?.why || ''), `${engine}: it names the system and the error (${m?.why})`);
    check(!(await page.locator('#app').innerText()).includes('Loading…'), `${engine}: Loading… is gone`);
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload' }).click()]);
    check(await waitBoot(page, 'error'), `${engine}: Reload loads the page again`);
    await ctx.close();
  }

  // 4. A module that won't load.
  {
    const { ctx, page } = await open(browser, { routes: { 'ui/dom.js': (route) => route.fulfill({ status: 404, body: 'Not found' }) } });
    check(await waitBoot(page, 'error'), `${engine}: a module that won’t load replaces Loading… within seconds`);
    check(/app\.js/.test((await bootMessage(page))?.why || ''), `${engine}: and says which script didn’t load (${(await bootMessage(page))?.why})`);
    await ctx.close();
  }

  // 5. A start that never finishes, then (6) one that finishes late.
  {
    const { ctx, page } = await open(browser, { routes: { 'app.js': javascript(NEVER_STARTS) }, clock: true });
    await page.clock.fastForward(10_000);
    check((await bootMessage(page)) === null, `${engine}: a slow start isn’t called stuck too soon`);
    await page.clock.fastForward(6000);
    check(await waitBoot(page, 'slow'), `${engine}: a start that never finishes gets a message after 15 seconds`);
    const m = await bootMessage(page);
    check(m?.title === 'Echoes is taking too long to start' && /Check the Wi-Fi/.test(m.text) && m.reload, `${engine}: it says it’s taking too long and offers Reload`);
    await ctx.close();
  }
  {
    let release;
    const held = new Promise((r) => { release = r; });
    const { ctx, page } = await open(browser, { routes: { 'app.js': async (route) => { await held; await route.continue(); } }, clock: true, waitUntil: 'commit' });
    await page.locator('#app').waitFor({ state: 'attached' });
    await page.clock.fastForward(16_000);
    check(await waitBoot(page, 'slow'), `${engine}: a held-up app.js gets the slow message`);
    release();
    await page.locator('form[data-form="setup"]').waitFor({ timeout: 15_000 }).catch(() => {});
    check((await bootMessage(page)) === null && await page.locator('form[data-form="setup"]').count() === 1, `${engine}: when it does start, the app replaces the message`);
    await ctx.close();
  }

  // 7. Too old: an iPad on iOS 12 and one on iPadOS 13 (which asks for desktop sites). Their Safari
  // can't read the app's modules. An app.js that never starts, with no error to hear of, stands in
  // for that (as when a very old Safari skips modules); the message mustn't wait for a timeout.
  for (const [userAgent, label, init] of [[OLD_IPAD, 'iOS 12.5', []], [IPAD_13_DESKTOP, 'iPadOS 13.1', [() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 })]]]) {
    const { ctx, page } = await open(browser, { userAgent, init, routes: { 'app.js': javascript('export {};\n') } });
    check(await waitBoot(page, 'old', 1000), `${engine}: ${label} is told at once that it’s too old`);
    const m = await bootMessage(page);
    check(m?.title === 'Echoes can’t run on this iPad' && m.text.includes(`It has ${label}, and Echoes needs iPadOS 14 or later.`), `${engine}: ${label}: names the version and what it needs (${m?.text})`);
    check(/Software Update/.test(m?.text) && /newer iPhone, iPad, Chromebook or computer/.test(m?.text) && !m.reload, `${engine}: ${label}: says to update or use another device, with no Reload`);
    await ctx.close();
  }

  // On iOS 12 the modules do fail to parse: that error still gets the too-old message, not "couldn’t start".
  {
    const { ctx, page } = await open(browser, { userAgent: OLD_IPAD, routes: { 'app.js': javascript(SYNTAX_ERROR) } });
    await page.waitForTimeout(2000); // past the error's grace period
    check((await bootMessage(page))?.kind === 'old', `${engine}: iOS 12 with the modules failing still says too old`);
    await ctx.close();
  }

  // 8. New enough to run, but older than 15.4: a start-up error suggests updating.
  {
    const { ctx, page } = await open(browser, { userAgent: IPHONE_15_2, routes: { 'app.js': javascript(SYNTAX_ERROR) } });
    check(await waitBoot(page, 'error'), `${engine}: iOS 15.2 with a start-up error gets the message`);
    check(/update this iPhone to iOS 15\.4 or later/.test((await bootMessage(page))?.text || ''), `${engine}: and is told updating to iOS 15.4 may fix it`);
    await ctx.close();
  }
  await browser.close();
}

// ---------- boards (Edge) ----------
const edge = await chromium.launch({ channel: 'msedge', headless: true });
for (const scheme of ['dark', 'light']) {
  for (const size of ['phone', 'fold', 'desk']) {
    {
      const { ctx, page } = await open(edge, { size, scheme, userAgent: OLD_IPAD, routes: { 'app.js': javascript(SYNTAX_ERROR) } });
      await waitBoot(page, 'old');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `too-old message fits the ${size} width (${scheme})`);
      shots[`old-${size}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
    {
      const { ctx, page } = await open(edge, { size, scheme, routes: { 'app.js': javascript(SYNTAX_ERROR) } });
      await waitBoot(page, 'error');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `couldn’t-start message fits the ${size} width (${scheme})`);
      shots[`error-${size}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
    {
      const { ctx, page } = await open(edge, { size, scheme, init: [OLD_APIS] });
      await setUpFamily(page);
      await linkSam(page);
      await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'), null, { timeout: 8000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(0, 0);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Link phone (needs 16.4) fits the ${size} width (${scheme})`);
      shots[`sync-${size}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
  }
}
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BOARDS = [
  ['old', 'An iPad on iOS 12: too old'],
  ['error', 'Something stopped the start'],
  ['sync', 'Link phone on a system without compression streams (before iOS 16.4)'],
];
const page = await (await edge.newContext({ deviceScaleFactor: 1 })).newPage();
const boardPaths = [];
for (const [key, title] of BOARDS) {
  const sizes = ['phone', 'fold', 'desk'];
  const label = { phone: 'phone', fold: 'foldable / iPad', desk: 'desktop' };
  const row = (s) => `<div class="row">${sizes.map((z) => `<figure><img class="${z}" src="${img(shots[`${key}-${z}-${s}`])}"><figcaption>${s} · ${label[z]}</figcaption></figure>`).join('')}</div>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 14px; } .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
    .phone { width: 260px; } .fold { width: 372px; } .desk { width: 720px; }
  </style><h1>Start-up on older iPads · ${title}</h1>${row('dark')}${row('light')}`);
  const path = join(outDir, `board-${key}.png`);
  await page.screenshot({ path, fullPage: true });
  boardPaths.push(path);
}
for (const [k, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), buf);
await edge.close();
server.close();

if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} start-up checks passed. Boards:\n${boardPaths.join('\n')}`);
