// Headless UI walkthrough + screenshots (Microsoft Edge, headless).
// Covers the home hub on iPhone- and Chromebook-sized screens, invites, the welcome promise,
// audiences, device-only mode with IndexedDB persistence, and the hub-offline screen.
// Fails on any unexpected browser console error.
//   npm run screenshots -- [outputDir]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots');
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'echoes-'));
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROMEBOOK_UA = 'Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const stop = (srv) => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); };

// ---------- hub with a demo family ----------
// PUBLIC_URL makes invites look like a real home-network hub; the walkthrough opens them on the local port.
const hub = createApp({ dataPath: join(tmp, 'demo.json'), publicUrl: 'http://192.168.1.20:3000', anonymousHoldMs: [0, 0] });
const base = await listen(hub);

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
    return data;
  };
}
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const mom = client();
const { me } = await mom('POST', '/api/setup', { familyName: 'The Riveras', name: 'Mom', emoji: '👩' });
const dad = await mom('POST', '/api/members', { name: 'Dad', emoji: '👨', role: 'adult', isParent: true });
const ava = await mom('POST', '/api/members', { name: 'Ava', emoji: '👧', role: 'adult' });
const sam = await mom('POST', '/api/members', { name: 'Sam', emoji: '👦', role: 'kid' });
await mom('POST', '/api/members', { name: 'Nana', emoji: '👵', role: 'adult', guest: true, guestUntil: inDays(10) });
const as = async (id) => { const c = client(); await c('POST', '/api/login', { memberId: id }); await c('POST', '/api/welcome'); return c; };
const samC = await as(sam.id);
const avaC = await as(ava.id);
const dadC = await as(dad.id);
await samC('POST', '/api/feedback', { to: 'everyone', model: 'kids', anonymous: true,
  fields: { feeling: 'happy', happened: 'Movie night with everyone on the couch was the best!', like: 'You make the best popcorn.' } });
await avaC('POST', '/api/feedback', { toIds: [me.id], model: 'dearman',
  fields: { describe: 'Yesterday you read my messages over my shoulder.', express: 'I felt embarrassed.', assert: 'Could you ask me first?' } });
await dadC('POST', '/api/feedback', { toIds: [me.id, ava.id], model: 'thanks',
  fields: { what: 'You two cleaned the garage on Saturday.', impact: 'I can finally park inside. Thank you!' } });

// ---------- browser ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const shots = {};
const allowed = [/401/, /410/, /Failed to load resource/]; // deliberate wrong-PIN / used-invite / offline checks

async function newPage(colorScheme, kind = 'phone') {
  const opts = kind === 'phone'
    ? { colorScheme, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }
    : { colorScheme, viewport: { width: 1366, height: 768 }, userAgent: CHROMEBOOK_UA };
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !allowed.some((re) => re.test(m.text()))) errors.push(`${colorScheme}/${kind}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${colorScheme}/${kind}: ${e.message}`));
  return { ctx, page };
}

async function signInAs(page, url, name) {
  await page.goto(url);
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
}
const top = (page) => page.evaluate(() => window.scrollTo(0, 0));

let joinUrl;
for (const scheme of ['dark', 'light']) {
  // 1. Inbox on iPhone, with the whole-family anonymous message open.
  {
    const { ctx, page } = await newPage(scheme);
    await signInAs(page, base, 'Mom');
    await page.locator('.fb-head', { hasText: 'whole family' }).click();
    await page.locator('.fb-body').waitFor();
    await top(page);
    shots[`${scheme}-inbox`] = await page.screenshot();
    await ctx.close();
  }
  // 2. Choosing an audience: a few people.
  {
    const { ctx, page } = await newPage(scheme);
    await signInAs(page, base, 'Mom');
    await page.locator('#nav a', { hasText: 'Give' }).click();
    await page.getByRole('radio', { name: /A few people/ }).click();
    await page.locator('.tile', { hasText: 'Ava' }).click();
    await page.locator('.tile', { hasText: 'Sam' }).click();
    await page.locator('.model-tile').first().waitFor();
    await top(page);
    shots[`${scheme}-audience`] = await page.screenshot();
    await ctx.close();
  }
  // 3. Inviting Nana (a visiting guest): QR + share.
  {
    const { ctx, page } = await newPage(scheme);
    await signInAs(page, base, 'Mom');
    await page.locator('#nav a', { hasText: 'Family' }).click();
    await page.locator('.people li', { hasText: 'Nana' }).getByRole('button', { name: /Invite/ }).click();
    await page.locator('#invite-panel img.qr').waitFor();
    joinUrl = (await page.locator('.invite-url').inputValue()).replace('http://192.168.1.20:3000', base);
    await page.locator('#invite-panel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    shots[`${scheme}-invite`] = await page.screenshot();
    await ctx.close();
  }
  // 4. Nana opens the invite on her phone and sees the welcome promise.
  {
    const { ctx, page } = await newPage(scheme);
    await page.goto(joinUrl);
    await page.getByRole('heading', { name: 'Welcome, Nana!' }).waitFor();
    shots[`${scheme}-welcome`] = await page.screenshot();
    if (scheme === 'light') {
      await page.getByRole('button', { name: /We’re in/ }).click();
      await page.locator('#nav a', { hasText: 'Inbox' }).waitFor();
    }
    await ctx.close();
  }
  // 5. Chromebook: send to a few people, then see per-person status in Sent.
  {
    const { ctx, page } = await newPage(scheme, 'laptop');
    await signInAs(page, base, 'Mom');
    await page.locator('#nav a', { hasText: 'Give' }).click();
    await page.getByRole('radio', { name: /A few people/ }).click();
    await page.locator('.tile', { hasText: 'Ava' }).click();
    await page.locator('.tile', { hasText: 'Sam' }).click();
    await page.locator('.model-tile', { hasText: 'Glow & Grow' }).click();
    await page.fill('#field-glow', `You two made breakfast together without a single argument (${scheme} test).`);
    await page.fill('#field-grow', 'Maybe rinse the pan right away next time.');
    await page.getByRole('button', { name: /^Send$/ }).click();
    await page.getByRole('heading', { name: 'Sent' }).waitFor();
    await top(page);
    shots[`${scheme}-sent`] = await page.screenshot();
    await ctx.close();
  }
}
// Invites are single use.
{
  const { ctx, page } = await newPage('light');
  await page.goto(joinUrl);
  await page.getByRole('heading', { name: /didn’t work/ }).waitFor();
  await ctx.close();
}

// ---------- device-only mode: static files, no hub ----------
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
const staticUrl = await listen(staticHost);
{
  const { ctx, page } = await newPage('light');
  await page.goto(staticUrl);
  await page.locator('.notice', { hasText: 'home base' }).waitFor();
  await page.fill('#familyName', 'iPad Family');
  await page.fill('#name', 'Papa');
  await page.getByRole('button', { name: 'Create our family space' }).click();
  await page.getByRole('heading', { name: 'Family', exact: true }).waitFor();
  await page.locator('[data-form="add-member"] input[name="name"]').fill('Lily');
  await page.locator('[data-form="add-member"] select[name="role"]').selectOption('kid');
  await page.locator('[data-form="add-member"] button[type="submit"]').click();
  await page.locator('.people li', { hasText: 'Lily' }).waitFor();
  await page.getByRole('button', { name: 'Download backup' }).waitFor();
  await page.locator('#me').getByRole('button', { name: 'Switch' }).click();
  await page.locator('.tile', { hasText: 'Lily' }).click();
  await page.getByRole('button', { name: /I promise/ }).click();
  await page.locator('#nav a', { hasText: 'Say it' }).click();
  await page.getByRole('radio', { name: /Everyone/ }).click();
  await page.locator('.model-tile', { hasText: 'Thank-You Note' }).click();
  await page.fill('#field-what', 'You read me three bedtime stories.');
  await page.getByRole('button', { name: /^Send$/ }).click();
  await page.getByRole('heading', { name: 'Sent' }).waitFor();
  // Reload: data must come back from IndexedDB.
  await page.reload();
  await page.locator('#me').getByRole('button', { name: 'Switch' }).click();
  await page.locator('.tile', { hasText: 'Papa' }).click();
  await page.locator('.fb-head', { hasText: 'Lily' }).waitFor();
  const mode = await page.evaluate(() => localStorage.getItem('ff-mode'));
  if (mode !== 'device') errors.push(`device mode not remembered (${mode})`);
  await ctx.close();
}
await stop(staticHost);

// ---------- a phone that used the hub never falls back to an empty device family ----------
{
  const spare = createApp({ dataPath: join(tmp, 'spare.json') });
  const spareUrl = await listen(spare);
  const { ctx, page } = await newPage('light');
  await page.goto(spareUrl);
  await page.getByRole('button', { name: 'Create our family space' }).waitFor();
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.reload(); // let the service worker cache the app shell
  await page.getByRole('button', { name: 'Create our family space' }).waitFor();
  await stop(spare);
  await page.reload();
  await page.getByRole('heading', { name: /Can’t reach the family hub/ }).waitFor();
  await ctx.close();
}

// ---------- board: dark row above light row ----------
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const cols = [['inbox', 'iPhone · Inbox (1:n and whole-family)'], ['audience', 'iPhone · Choose audience'], ['invite', 'iPhone · Invite with QR / AirDrop'], ['welcome', 'iPhone · Welcome promise']];
const row = (s, label) => `
  <div class="label">${label}</div>
  <div class="row">
    ${cols.map(([k, cap]) => `<figure><img class="phone" src="${img(shots[`${s}-${k}`])}"><figcaption>${cap}</figcaption></figure>`).join('')}
    <figure><img class="laptop" src="${img(shots[`${s}-sent`])}"><figcaption>Chromebook · Sent to a few people</figcaption></figure>
  </div>`;
const boardHtml = `<!doctype html><html><head><style>
  body { margin: 0; padding: 24px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
  .row { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
  .label { font-size: 18px; margin: 4px 0 10px; }
  figure { margin: 0; } figcaption { margin-top: 6px; max-width: 260px; }
  img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
  .phone { width: 260px; } .laptop { width: 640px; }
</style></head><body>${row('dark', '🌙 Dark')}${row('light', '☀️ Light')}</body></html>`;
const boardPage = await (await browser.newContext({ deviceScaleFactor: 1.5 })).newPage();
await boardPage.setContent(boardHtml);
const boardPath = join(outDir, 'echoes-board.png');
await boardPage.screenshot({ path: boardPath, fullPage: true });
for (const [name, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${name}.png`), buf);

await browser.close();
await stop(hub);
rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`UI flows passed (hub on iPhone/Chromebook, invites, device-only + IndexedDB, offline hub). Board: ${boardPath}`);
