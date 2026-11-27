// Two phones, no server: a home base phone and a linked phone sync in headless Microsoft Edge.
// The app is served as plain static files from a sub-path (like GitHub Pages), with no /api.
// Each phone has its own browser profile. Codes are read from the on-screen QR codes and pasted
// into the other phone (headless browsers have no camera).
//   npm run test:peer -- [screenshotDir]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const SHOTS = process.argv[2] ? resolve(process.argv[2]) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PREFIX = '/echoes/';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

// A static file server like GitHub Pages: everything outside the sub-path, including /api, is a 404 page.
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(PREFIX)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
  const file = normalize(join(PUBLIC, path.slice(PREFIX.length) || 'index.html'));
  if (!file.startsWith(PUBLIC.replace(/[\\/]$/, '') + sep) && file !== join(PUBLIC, 'index.html')) { res.writeHead(404); return res.end(); }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>404</h1>');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}${PREFIX}`;

let checks = 0;
const failures = [];
function check(ok, what) {
  checks += 1;
  if (!ok) failures.push(what);
  console.log(`${ok ? '✔' : '✘'} ${what}`);
}

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  // Real phones expose their Wi-Fi address once the camera is allowed; headless has no camera.
  // PEER_MDNS=1 keeps Chromium's private .local names instead, which is closer to Safari.
  args: process.env.PEER_MDNS ? [] : ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const errors = [];
// `homeScreen`: the app opened from the iPhone Home Screen (its own storage, as on iOS), not Safari.
async function phone(name, { clock = false, homeScreen = false, url = URL_ } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  if (homeScreen) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    // Static hosting has no hub, so the app's first /api/state probe is an expected 404.
    if (m.type() === 'error' && !m.location()?.url?.endsWith('/api/state')) errors.push(`${name} console: ${m.text()}`);
  });
  page.on('dialog', (d) => d.accept());
  if (clock) await page.clock.install(); // lets the test skip ahead to the idle sign-out
  await page.goto(url);
  return page;
}

const status = (page) => page.locator('#sync-status').textContent();

// Reads the code shown as a QR image by decoding the picture itself, as the other phone's camera would.
async function shownCode(page, box = '#sync-qr') {
  await page.waitForFunction((sel) => {
    const img = document.querySelector(`${sel}:not([hidden]) img`);
    return img && img.src.startsWith('data:') && img.complete && img.naturalWidth > 0;
  }, box, { timeout: 15_000 });
  return page.evaluate(async (sel) => {
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
}

async function paste(page, code) {
  await page.locator('#sync-paste:not([hidden])').waitFor();
  await page.evaluate(() => { document.getElementById('sync-paste').open = true; });
  await page.fill('#sync-code', code);
  await page.click('#sync-paste button[type="submit"]');
}

async function shot(page, name) {
  if (!SHOTS) return;
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

// Connects the two phones: home base shows a code, the phone scans it and shows a reply.
async function connect(home, other) {
  const offer = await shownCode(home);
  check(offer?.startsWith('FF1.'), `home base QR decodes to a sync code (${offer?.length} chars)`);
  await paste(other, offer);
  const answer = await shownCode(other);
  check(answer?.startsWith('FF1.'), `linked phone QR decodes to a reply code (${answer?.length} chars)`);
  return answer;
}

try {
  // ---------- home base: a new family on this phone ----------
  const home = await phone('home', { clock: true });
  await home.waitForSelector('form[data-form="setup"]');
  check(await home.getByText('home base').first().isVisible(), 'static hosting falls back to this-device mode and calls it the home base');
  await home.fill('#familyName', 'The Riveras');
  await home.fill('#name', 'Mom');
  await home.click('form[data-form="setup"] button[type="submit"]');
  await home.waitForSelector('form[data-form="add-member"]');
  const add = home.locator('form[data-form="add-member"]');
  await add.locator('input[name="name"]').fill('Sam');
  await add.locator('select[name="role"]').selectOption('kid');
  await add.locator('button[type="submit"]').click();
  await home.getByRole('button', { name: 'Link phone', exact: true }).nth(1).waitFor();

  // ---------- linking Sam's phone ----------
  await home.getByRole('button', { name: 'Link phone', exact: true }).nth(1).click();
  await home.waitForURL(/#\/sync$/);
  check((await home.locator('h1').textContent()).includes('Link Sam’s phone'), 'parent starts linking from Family → Link phone');
  // First, Get Echoes: a QR code of the app's own address, before any camera or connection.
  const getUrl = await shownCode(home, '#sync-get');
  check(getUrl === `${URL_}#/link`, `the Get Echoes QR opens the app at #/link (${getUrl})`);
  check(await home.locator('#sync-camera').isHidden() && await home.locator('#sync-qr').isHidden(), 'no camera or sync code until Next');
  await shot(home, 'link-home-get');
  // Sam scans it with the Camera: Safari opens it and says to add Echoes to the Home Screen first.
  const samSafari = await phone('sam-safari', { url: getUrl });
  await samSafari.getByRole('heading', { name: 'Get Echoes' }).waitFor();
  check(/Add to Home Screen/.test(await samSafari.locator('main').innerText()) && !(await samSafari.locator('form[data-form="setup"]').count()),
    'in Safari, the link says to add Echoes to the Home Screen first (and offers no setup there)');
  await shot(samSafari, 'link-phone-get');
  await samSafari.context().close();
  // The Home Screen app has its own storage and opens at the start address: Link this phone comes first.
  const sam = await phone('sam', { homeScreen: true });
  await sam.waitForSelector('form[data-form="setup"]');
  const order = await sam.evaluate(() => {
    const join = document.querySelector('[data-action="start-join"]');
    const form = document.querySelector('form[data-form="setup"]');
    return join && form ? join.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
  });
  check(order > 0, 'a new Home Screen app on an iPhone offers Link this phone before starting a family');
  await sam.getByRole('button', { name: 'Link this phone' }).click();
  await sam.waitForURL(/#\/sync$/);
  await home.getByRole('button', { name: 'Next', exact: true }).click();
  await shot(home, 'link-home-offer');
  const answer = await connect(home, sam);
  await shot(sam, 'link-phone-answer');
  await paste(home, answer);
  await home.waitForFunction(() => document.getElementById('sync-status')?.textContent.includes('Connected to'), null, { timeout: 30_000 });
  check((await status(home)).includes('Sam'), 'home base shows it is connected to Sam’s phone');
  await sam.waitForSelector('form[data-form="welcome"]', { timeout: 30_000 });
  check(!(await sam.locator('#w-pin').count()), 'linked phone welcome skips the shared-device PIN');
  await sam.click('form[data-form="welcome"] button[type="submit"]');
  await sam.waitForSelector('h1:has-text("No feedback yet")');
  check(await sam.locator('.sync-chip').textContent().then((t) => t.includes('Live')), 'linked phone shows it is live with the home base');
  check(!(await sam.locator('[data-action="logout"]').count()), 'linked phone has no Switch person');

  // ---------- live: Sam sends to Mom while connected ----------
  // Navigate with the hash, not page.goto: a reload would drop the live connection.
  async function go(page, hash) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(200);
  }
  await go(sam, '#/give');
  await sam.locator('.tile', { hasText: 'Mom' }).first().click();
  await sam.locator('[data-action="pick-model"][data-id="kids"]').click();
  await sam.locator('[data-action="pick-choice"][data-value="happy"]').click();
  await sam.fill('textarea[data-field="happened"]', 'Pancakes this morning were great');
  await sam.click('form[data-form="send"] button[type="submit"]');
  await sam.waitForFunction(() => document.getElementById('toast').textContent.includes('Sent to Mom'));
  check(true, 'while connected, a message is sent straight away');

  await home.click('[data-action="sync-done"]');
  await home.waitForFunction(() => document.getElementById('sync-status')?.textContent.includes('Synced with'));
  await sam.waitForFunction(() => document.querySelector('.sync-chip')?.dataset.state === 'idle');
  check(true, 'Done on the home base ends the connection; the phone notices');
  await go(home, '#/inbox');
  await home.waitForSelector('.fb');
  check((await home.locator('.fb').first().textContent()).includes('Sam'), 'Mom’s inbox on the home base has Sam’s message');

  // ---------- apart: Sam queues a message; Mom writes to Sam ----------
  await go(sam, '#/give');
  await sam.locator('.tile', { hasText: 'Mom' }).first().click();
  await sam.locator('[data-action="pick-model"][data-id="kids"]').click();
  await sam.locator('[data-action="pick-choice"][data-value="happy"]').click();
  await sam.fill('textarea[data-field="happened"]', 'Thanks for the bike ride');
  await sam.click('form[data-form="send"] button[type="submit"]');
  await sam.waitForFunction(() => document.getElementById('toast').textContent.includes('next time you sync'));
  check(true, 'apart, a message is saved to send at the next sync');
  await sam.waitForURL(/#\/sent$/);
  await sam.waitForSelector('.pill:has-text("Waiting")');
  check((await sam.locator('.sync-chip').getAttribute('data-pending')) === '1', 'the sync chip shows one waiting');
  await shot(sam, 'phone-sent-waiting');

  await go(home, '#/give');
  await home.locator('.tile', { hasText: 'Sam' }).first().click();
  await home.locator('[data-action="pick-model"][data-id="kids"]').click();
  await home.locator('[data-action="pick-choice"][data-value="happy"]').click();
  await home.fill('textarea[data-field="happened"]', 'You fed the cat without being asked');
  await home.click('form[data-form="send"] button[type="submit"]');
  await home.waitForFunction(() => document.getElementById('toast').textContent.includes('Sent to Sam'));

  // ---------- reload: the phone keeps its link, copy and queue ----------
  await sam.reload();
  await sam.waitForSelector('.sync-chip');
  check((await sam.locator('.sync-chip').getAttribute('data-pending')) === '1', 'after a reload the phone is still linked with its queue');

  // ---------- sync again ----------
  await go(home, '#/family');
  await home.getByRole('link', { name: 'Sync a linked phone' }).click();
  await home.waitForURL(/#\/sync$/);
  await sam.click('.sync-chip');
  await sam.waitForURL(/#\/sync$/);
  check((await sam.locator('h1').textContent()).includes('Sync with the home base'), 'the chip opens Sync on the phone');
  await paste(home, await connect(home, sam));
  await sam.waitForFunction(() => document.getElementById('sync-status')?.textContent.includes('Synced'), null, { timeout: 30_000 });
  check((await status(sam)).includes('1 change sent'), 'sync sends the queued message');
  await shot(sam, 'phone-synced');
  await go(sam, '#/inbox');
  await sam.waitForSelector('.fb');
  check((await sam.locator('.fb').first().textContent()).includes('Mom'), 'Sam’s phone now has Mom’s message');
  await home.click('[data-action="sync-done"]');
  await go(home, '#/inbox');
  await home.waitForFunction(() => document.querySelectorAll('.fb').length === 2);
  check(true, 'Mom’s inbox has both of Sam’s messages');

  // ---------- read offline, then unlink ----------
  await sam.waitForFunction(() => document.querySelector('.sync-chip')?.dataset.state === 'idle');
  await sam.locator('.fb .fb-head').first().click();
  await sam.waitForSelector('[data-action="react"]');
  await sam.locator('[data-action="react"][data-reaction="thanks"]').click();
  await sam.waitForFunction(() => Number(document.querySelector('.sync-chip')?.dataset.pending) > 0);
  check(true, 'reading and reacting apart are queued too');

  await go(home, '#/family');
  await home.getByRole('button', { name: 'Unlink 1 phone' }).click();
  await home.waitForFunction(() => document.getElementById('toast').textContent.includes('unlinked'));
  await home.getByRole('link', { name: 'Sync a linked phone' }).click();
  await home.waitForURL(/#\/sync$/);
  await go(sam, '#/sync');
  await paste(home, await connect(home, sam));
  await sam.waitForFunction(() => document.getElementById('sync-status')?.textContent.includes('isn’t linked'), null, { timeout: 30_000 });
  check(true, 'an unlinked phone is refused by the home base');

  // A Sync screen left open after it finished must not keep the parent signed in.
  await home.waitForFunction(() => document.getElementById('sync-status')?.className.includes('error'));
  await home.clock.fastForward('04:00');
  await home.waitForSelector('h1:has-text("Who’s here?")', { timeout: 15_000 });
  check(true, 'the home base still signs out when left idle on a finished Sync screen');

  // Linking a phone to someone with a PIN: they type it on the home base first.
  await home.locator('.tile', { hasText: 'Mom' }).first().click();
  await go(home, '#/family');
  const addDad = home.locator('form[data-form="add-member"]');
  await addDad.locator('input[name="name"]').fill('Dad');
  await addDad.locator('input[name="pin"]').fill('8642');
  await addDad.locator('button[type="submit"]').click();
  await home.locator('li', { hasText: 'Dad' }).getByRole('button', { name: 'Link phone', exact: true }).click();
  await home.locator('#link-pin').fill('1111');
  await home.locator('form[data-form="link-pin"] button[type="submit"]').click();
  await home.locator('#link-pin-panel .notice.error').waitFor();
  check(home.url().endsWith('#/family'), 'a wrong PIN doesn’t start linking Dad’s phone');
  await home.locator('#link-pin').fill('8642');
  await home.locator('form[data-form="link-pin"] button[type="submit"]').click();
  await home.waitForURL(/#\/sync$/);
  check((await home.locator('h1').textContent()).includes('Link Dad’s phone'), 'with Dad’s PIN, linking his phone starts');
  await go(home, '#/family');

  // Two windows on one device must not both write the family.
  const second = await home.context().newPage();
  second.on('pageerror', (e) => errors.push(`second: ${e.message}`));
  await second.goto(URL_);
  await second.waitForSelector('h1:has-text("Open in another window")');
  check(true, 'a second window on the home base is told the app is open elsewhere');
  await second.click('[data-action="use-here"]');
  await second.waitForSelector('h1:has-text("Who’s here?")');
  await home.waitForSelector('h1:has-text("Open in another window")');
  check(true, '"Use it here" moves the family to the new window and stops the old one');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  failures.push(err.stack || String(err));
  console.error(err);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
