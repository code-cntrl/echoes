// Headless Edge checks for the theme picker: every family x mode on a light and a dark system,
// a live system change in System mode, the choice surviving a reload and going offline, the
// keyboard focus ring, and the picker's selected state. The theme is set only inside each
// isolated browser context.
//   npm run test:browser
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

const tmp = mkdtempSync(join(tmpdir(), 'echoes-themes-'));
const hub = createApp({ dataPath: join(tmp, 'demo.json') });
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));
const post = async (path, body, cookie) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
};
const cookie = await post('/api/setup', { familyName: 'The Riveras', name: 'Mom', emoji: '👩' });
await post('/api/members', { name: 'Ava', emoji: '👧', role: 'adult' }, cookie);

// Each palette's --bg in public/styles.css; theme-init.js uses it for the browser bar.
const BG = { 'messages light': '#f2f2f7', 'messages dark': '#000000', 'graphite light': '#eef1f6', 'graphite dark': '#171b21', 'paper light': '#eee9dd', 'paper dark': '#16150f' };
const toHex = (rgb) => '#' + rgb.match(/[\d.]+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
const failures = [];
let passed = 0;
const check = (label, got, want) => {
  if (got === want) passed++;
  else failures.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function open(system) {
  const ctx = await browser.newContext({ colorScheme: system, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => failures.push(`${system} system: page error ${e.message}`));
  await page.goto(base);
  return { ctx, page };
}
const state = (page) => page.evaluate(() => ({
  family: document.documentElement.dataset.themeFamily,
  mode: document.documentElement.dataset.theme ?? 'auto',
  bars: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
  bg: getComputedStyle(document.body).backgroundColor,
}));
const expectTheme = async (page, label, family, mode, resolved) => {
  const s = await state(page);
  check(`${label}: family`, s.family, family);
  check(`${label}: mode`, s.mode, mode);
  check(`${label}: one bar colour`, s.bars.length, 1);
  check(`${label}: bar colour`, s.bars[0], BG[`${family} ${resolved}`]);
  check(`${label}: page background`, toHex(s.bg), BG[`${family} ${resolved}`]);
};

try {
  for (const system of ['light', 'dark']) {
    const { ctx, page } = await open(system);

    // Nothing saved yet: Messages, following the system.
    await expectTheme(page, `${system} system, first visit`, 'messages', 'auto', system);

    // Every saved family x mode, applied before the app runs.
    for (const family of ['messages', 'graphite', 'paper']) {
      for (const mode of ['auto', 'light', 'dark']) {
        await page.evaluate(([f, m]) => { localStorage.setItem('ff-theme-family', f); localStorage.setItem('ff-theme', m); }, [family, mode]);
        await page.reload();
        await expectTheme(page, `${system} system, saved ${family}/${mode}`, family, mode, mode === 'auto' ? system : mode);
      }
    }

    // System mode follows a live change of the system setting.
    const other = system === 'light' ? 'dark' : 'light';
    await page.evaluate(() => { localStorage.setItem('ff-theme-family', 'paper'); localStorage.setItem('ff-theme', 'auto'); });
    await page.reload();
    await page.emulateMedia({ colorScheme: other });
    // The change event reaches the page asynchronously; a missing update still fails below.
    await page.waitForFunction((want) => document.querySelector('meta[name="theme-color"]').content === want,
      BG[`paper ${other}`], { timeout: 3000 }).catch(() => {});
    await expectTheme(page, `${system} system changed to ${other}`, 'paper', 'auto', other);
    await page.emulateMedia({ colorScheme: system });

    // The picker: choices apply at once, show as selected, and survive a reload.
    await page.locator('#theme-toggle').click();
    check(`${system} system: picker opens`, await page.locator('#appearance').isVisible(), true);
    await page.locator('[data-action="theme-family"][data-id="graphite"]').click();
    await page.locator('[data-action="theme-mode"][data-id="dark"]').click();
    await expectTheme(page, `${system} system, picked graphite/dark`, 'graphite', 'dark', 'dark');
    const selected = await page.evaluate(() => [...document.querySelectorAll('#appearance [role="radio"]')]
      .filter((b) => b.getAttribute('aria-checked') === 'true')
      .map((b) => ({ id: b.dataset.id, cls: b.classList.contains('selected'), edge: getComputedStyle(b).borderTopColor })));
    check(`${system} system: selected options`, selected.map((s) => s.id).join(), 'graphite,dark');
    check(`${system} system: selected class`, selected.every((s) => s.cls), true);
    const edge = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-edge').trim());
    check(`${system} system: selected option outlined`, selected.map((s) => toHex(s.edge)).join(), `${edge},${edge}`);
    check(`${system} system: focus stays on the picked option`, await page.evaluate(() => document.activeElement.dataset.id), 'dark');
    await page.keyboard.press('Escape');
    check(`${system} system: Escape closes the picker`, await page.locator('#appearance').isVisible(), false);
    check(`${system} system: focus returns to the button`, await page.evaluate(() => document.activeElement.id), 'theme-toggle');
    await page.reload();
    await expectTheme(page, `${system} system, picked choice after reload`, 'graphite', 'dark', 'dark');

    // Keyboard focus ring: solid accent on a tile reached with Tab.
    const tiles = page.locator('.tile');
    await tiles.first().focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { tile: el.classList.contains('tile'), visible: el.matches(':focus-visible'), style: s.outlineStyle, width: s.outlineWidth,
        color: s.outlineColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
    });
    check(`${system} system: Tab reaches the next tile`, ring.tile && ring.visible, true);
    check(`${system} system: focus ring style`, `${ring.style} ${ring.width}`, 'solid 3px');
    check(`${system} system: focus ring is opaque`, /rgba\(.*,\s*0?\.\d+\)$/.test(ring.color), false);
    check(`${system} system: focus ring colour`, toHex(ring.color), ring.accent);

    // Offline: the service worker's cached shell keeps the saved theme.
    await page.evaluate(() => { localStorage.setItem('ff-theme-family', 'paper'); localStorage.setItem('ff-theme', 'light'); });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // served once under the worker so it caches the shell
    await ctx.setOffline(true);
    await page.reload();
    await expectTheme(page, `${system} system, offline`, 'paper', 'light', 'light');
    check(`${system} system, offline: page served by the worker`, await page.evaluate(() => !!navigator.serviceWorker.controller), true);
    await ctx.close();
  }
} finally {
  await browser.close();
  hub.closeAllConnections?.();
  await new Promise((r) => hub.close(r));
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`${failures.length} theme check(s) failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Theme checks passed: ${passed} checks in headless Edge.`);
