// Measures how a rendered Echoes view lines up, so layout is judged on the real page:
// - the left and right edges its text and boxes start and end on (a tidy view uses few);
// - near misses: two edges a few pixels apart, which usually should be one;
// - sideways scrolling;
// - tap targets smaller than docs/design.md allows (44px; chips 36px; segmented controls 32px).
// It also draws the edges over a screenshot: blue for shared edges, red for near misses.
// A report to look at, not a verdict: fix each near miss or say why it's right.
//
// Command line, from the project folder:
//   node .agents/skills/measure-layout/scripts/edges.mjs <url-or-html-file>
//     [--size phone|fold|desk|<width>x<height>] [--theme light|dark] [--scope main]
//     [--tolerance 6] [--wait <selector>] [--name <label>] [--out <folder>] [--strict]
// In a script that has already set up the view:
//   import { measureEdges, drawEdges } from './edges.mjs';
//   const report = await measureEdges(page, { scope: 'main' });
//   await drawEdges(page, report, 'view.edges.png');
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  fold: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desk: { viewport: { width: 1440, height: 1000 } },
};

// Runs in the page: every visible text line start and box in the scope, and every tap target.
function collect({ scope }) {
  const root = document.querySelector(scope) || document.body;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
  const items = [];
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 2) });
  for (let n = texts.nextNode(); n; n = texts.nextNode()) {
    const el = n.parentElement;
    if (!el || !shown(el)) continue;
    // Glyphs centred in a circle, pill or chip line up by their box, not their text.
    if (el.closest('.avatar, .icon-sq, .pill, .chip, .badge') || getComputedStyle(el).textAlign === 'center') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const lines = [...range.getClientRects()].filter((r) => r.width > 1);
    if (!lines.length) continue;
    const right = Math.max(...lines.map((r) => r.right));
    // A right edge counts only when the text ends its box (a date, a label pushed to the end),
    // not the ragged end of a wrapped paragraph.
    const ends = lines.length === 1 && Math.abs(el.getBoundingClientRect().right - right) < 1;
    items.push({ kind: 'text', left: lines[0].left, right: ends ? right : null, top: lines[0].top, bottom: lines.at(-1).bottom, what: `${name(el)} “${n.textContent.trim().slice(0, 24)}”` });
  }
  const BOXES = '.card, .list, li, .item, .tile, .chip, .pill, .avatar, .icon-sq, .segmented, .notice, button, input, select, textarea, img';
  for (const el of root.querySelectorAll(BOXES)) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    items.push({ kind: 'box', left: r.left, right: r.right, top: r.top, bottom: r.bottom, what: name(el) });
  }
  const TAPS = 'a[href], button, select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), label:has(input[type="checkbox"]), label:has(input[type="radio"]), [role="button"], [role="radio"], [role="tab"]';
  const targets = [];
  for (const el of document.querySelectorAll(TAPS)) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const min = el.classList.contains('chip') ? 36 : el.closest('.segmented') ? 32 : 44;
    // Links inside running text are read, not tapped as controls.
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li');
    if (!inline && r.height < min - 0.5) targets.push({ what: name(el), height: Math.round(r.height * 10) / 10, min, text: el.textContent.trim().slice(0, 24) });
  }
  return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, items, targets };
}

// Edges: positions shared within half a pixel, with how many things use each.
function edgesOf(items, side) {
  const groups = new Map();
  for (const it of items) {
    if (it[side] == null) continue;
    const x = Math.round(it[side] * 2) / 2;
    if (!groups.has(x)) groups.set(x, []);
    groups.get(x).push(it);
  }
  return [...groups].map(([x, list]) => ({ x, count: list.length, examples: list.slice(0, 3).map((i) => i.what) })).sort((a, b) => a.x - b.x);
}

// Near misses: two edges on the same side, between 1px and `tolerance` apart, whose things
// overlap vertically somewhere (things far apart up and down rarely need the same edge).
function nearMisses(items, edges, side, tolerance) {
  const at = (x) => items.filter((i) => i[side] != null && Math.round(i[side] * 2) / 2 === x);
  const out = [];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length && edges[j].x - edges[i].x <= tolerance; j++) {
      if (edges[j].x - edges[i].x < 1) continue;
      const a = at(edges[i].x);
      const b = at(edges[j].x);
      const top = Math.min(...a.map((t) => t.top), ...b.map((t) => t.top));
      const bottom = Math.max(...a.map((t) => t.bottom), ...b.map((t) => t.bottom));
      if (bottom - top > 600) continue;
      out.push({ side, a: edges[i], b: edges[j], gap: Math.round((edges[j].x - edges[i].x) * 10) / 10 });
    }
  }
  return out;
}

/** Measures the view in `page`. */
export async function measureEdges(page, { scope = 'main', tolerance = 6 } = {}) {
  const raw = await page.evaluate(collect, { scope });
  const left = edgesOf(raw.items, 'left');
  const right = edgesOf(raw.items, 'right');
  return {
    viewport: { width: raw.width, height: raw.height },
    scope,
    sidewaysScroll: raw.scrollWidth > raw.width,
    leftEdges: left.filter((e) => e.count > 1),
    rightEdges: right.filter((e) => e.count > 1),
    nearMisses: [...nearMisses(raw.items, left, 'left', tolerance), ...nearMisses(raw.items, right, 'right', tolerance)],
    smallTargets: raw.targets,
  };
}

/** Saves a screenshot of the visible view with the report's edges drawn on it. */
export async function drawEdges(page, report, path) {
  await page.evaluate((r) => {
    // Built with the style object (not style attributes), so the app's CSP allows it.
    const layer = document.createElement('div');
    layer.id = 'edges-overlay';
    Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
    const line = (x, color, width) => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'absolute', top: '0', bottom: '0', left: `${x}px`, width: `${width}px`, background: color });
      layer.append(d);
    };
    for (const e of [...r.leftEdges, ...r.rightEdges]) line(e.x, 'rgb(37 99 235 / 45%)', 1);
    for (const m of r.nearMisses) for (const e of [m.a, m.b]) line(e.x, 'rgb(220 38 38 / 85%)', 2);
    document.body.append(layer);
  }, report);
  await page.screenshot({ path });
  await page.evaluate(() => document.getElementById('edges-overlay')?.remove());
}

/** One paragraph a person can read. */
export function summarize(report, label = '') {
  const lines = [`${label ? `${label}: ` : ''}${report.leftEdges.length} left edges, ${report.rightEdges.length} right edges, `
    + `${report.nearMisses.length} near miss${report.nearMisses.length === 1 ? '' : 'es'}, `
    + `${report.sidewaysScroll ? 'SCROLLS SIDEWAYS' : 'no sideways scroll'}, ${report.smallTargets.length} small tap target${report.smallTargets.length === 1 ? '' : 's'}.`];
  lines.push(`Left edges: ${report.leftEdges.map((e) => `x=${e.x}×${e.count}`).join(', ') || 'none shared'}`);
  for (const m of report.nearMisses) {
    lines.push(`Near miss (${m.side}, ${m.gap}px): x=${m.a.x} [${m.a.examples.join('; ')}] vs x=${m.b.x} [${m.b.examples.join('; ')}]`);
  }
  for (const t of report.smallTargets.slice(0, 8)) lines.push(`Small target: ${t.what} “${t.text}” is ${t.height}px tall (at least ${t.min}px)`);
  return lines.join('\n');
}

// ---------- command line ----------
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const target = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!target) {
    console.error('Usage: node edges.mjs <url-or-html-file> [--size phone|fold|desk|WxH] [--theme light|dark] [--scope main] [--tolerance 6] [--wait <selector>] [--name <label>] [--out <folder>] [--strict]');
    process.exit(2);
  }
  const sizeArg = opt('size', 'phone');
  const custom = /^(\d+)x(\d+)$/.exec(sizeArg);
  const size = custom ? { viewport: { width: Number(custom[1]), height: Number(custom[2]) } } : SIZES[sizeArg];
  if (!size) { console.error(`Unknown size ${sizeArg}`); process.exit(2); }
  const theme = opt('theme', 'light');
  const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
  const outDir = resolve(opt('out', join(tmpdir(), 'echoes-edges')));
  const label = opt('name', `${new URL(url).hostname || 'file'}-${sizeArg}-${theme}`).replace(/[^\w.-]+/g, '-');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await (await browser.newContext({ ...size, colorScheme: theme })).newPage();
    // The app keeps talking to its hub, so wait for the page and its content, not for quiet.
    await page.goto(url, { waitUntil: 'load' });
    await page.locator(opt('wait') || opt('scope', 'main')).first().waitFor();
    await page.waitForTimeout(600);
    const report = await measureEdges(page, { scope: opt('scope', 'main'), tolerance: Number(opt('tolerance', 6)) });
    mkdirSync(outDir, { recursive: true });
    const json = join(outDir, `${label}.edges.json`);
    const png = join(outDir, `${label}.edges.png`);
    writeFileSync(json, JSON.stringify(report, null, 2));
    await drawEdges(page, report, png);
    console.log(`${summarize(report, `${url} at ${sizeArg}, ${theme}, scope ${report.scope}`)}\nReport: ${json}\nPicture: ${png}`);
    if (args.includes('--strict') && (report.nearMisses.length || report.sidewaysScroll)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
