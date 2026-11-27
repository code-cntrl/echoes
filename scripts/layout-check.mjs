// Headless Edge layout check at the design contract's three form factors (docs/design.md):
// phone 390x844, unfolded foldable/tablet 744x900 and desktop 1440x1000, in light and dark.
// It measures the real page: no sideways scrolling, the page width, columns side by side on
// desktop and stacked below it, the Inbox reading pane, button and row heights, and that the
// open message and drafts survive a resize. Then it makes one board per screen with every
// device, each dark view above its light view.
//   npm run test:layout -- [outputDir]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/layout');
mkdirSync(outDir, { recursive: true });
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  foldable: { viewport: { width: 744, height: 900 }, deviceScaleFactor: 1.5, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 },
};

// ---------- a demo family with something on every screen ----------
const hub = createApp({ dataPath: ':memory:', anonymousHoldMs: [0, 0] });
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
const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
const mom = client();
const { me: momMe } = await mom('POST', '/api/setup', { familyName: 'The Lees', name: 'Mom', emoji: '👩' });
const dad = await mom('POST', '/api/members', { name: 'Dad', emoji: '👨', role: 'adult', isParent: true });
const ava = await mom('POST', '/api/members', { name: 'Ava', emoji: '👧', role: 'adult' });
const sam = await mom('POST', '/api/members', { name: 'Sam', emoji: '👦', role: 'kid' });
await mom('POST', '/api/members', { name: 'Nana', emoji: '👵', role: 'adult', guest: true, guestUntil: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10) });
const as = async (id) => { const c = client(); await c('POST', '/api/login', { memberId: id }); await c('POST', '/api/welcome'); return c; };
const dadC = await as(dad.id);
const avaC = await as(ava.id);
const samC = await as(sam.id);
await dadC('POST', '/api/feedback', { toIds: [ava.id], model: 'dearman', fields: {
  describe: 'At breakfast you raised your voice when we were running late.', express: 'I felt tense for the rest of the morning.', assert: 'Could you tell me calmly when we need to hurry?',
} });
await mom('POST', '/api/feedback', { toIds: [ava.id], model: 'glow-grow', fields: { glow: 'You helped Sam with his reading every night this week.', grow: 'Let him try a word before you say it.' } });
await samC('POST', '/api/feedback', { to: 'everyone', model: 'kids', anonymous: true, fields: { feeling: 'happy', happened: 'Movie night on the couch was the best!' } });
await dadC('POST', '/api/feedback', { toIds: [ava.id], model: 'thanks', fields: { what: 'You drove Sam to football in the rain.', impact: 'I could finish work. Thank you!' } });
const inbox = await avaC('GET', '/api/inbox');
const msg = (text) => inbox.find((f) => JSON.stringify(f.fields).includes(text));
for (const f of [msg('raised your voice'), msg('reading')]) await avaC('POST', `/api/feedback/${f.id}/read`, { at: ago(45) });
const p1 = await avaC('POST', '/api/plans', { feedbackId: msg('raised your voice').id, heard: 'Shouting when we’re late makes the whole morning tense.', promise: 'Keep my voice calm when we’re late', when: 'feel rushed in the morning', then: 'take a breath and say “five minutes”', days: 30, share: 'giver' });
await avaC('POST', `/api/plans/${p1.ref}/tick`, { date: p1.startDate, value: 'kept' });
await avaC('POST', '/api/plans', { feedbackId: msg('reading').id, heard: 'Sam needs room to try the word himself.', promise: 'Give Sam time to read', when: 'he gets stuck on a word', then: 'count to five before helping', days: 14, share: 'family' });
await dadC('POST', `/api/plans/${p1.ref}/cheer`, { cheer: 'noticed' });
await avaC('POST', '/api/feedback', { toIds: [dad.id, sam.id], model: 'glow-grow', fields: { glow: 'You two made breakfast together without a single argument.', grow: 'Maybe rinse the pan right away next time.' } });
await avaC('POST', '/api/feedback', { toIds: [momMe.id], model: 'thanks', fields: { what: 'You fixed my bike.', impact: 'I could ride to school.' } });
// Replies and reactions to Ava's message, for the top of her Inbox; and a kid's break for Sam.
const fromAva = async (c) => (await c('GET', '/api/inbox')).find((f) => f.from?.name === 'Ava');
const dadsCopy = await fromAva(dadC);
await dadC('POST', `/api/feedback/${dadsCopy.id}/read`, { at: ago(45) });
await dadC('POST', `/api/feedback/${dadsCopy.id}/respond`, { reaction: 'thanks', reply: 'Thanks, Ava! Breakfast together was fun.' });
await samC('POST', `/api/feedback/${(await fromAva(samC)).id}/respond`, { reaction: 'got-it' });
await mom('POST', '/api/feedback', { toIds: [sam.id], model: 'kids', fields: { feeling: 'sad', happened: 'You shouted at your sister when she took your blocks.', wish: 'Use your calm voice.' } });

// ---------- browser ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};

async function open(device, scheme, name) {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${device}/${scheme}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${device}/${scheme}: ${e.message}`));
  await page.goto(base);
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  return { ctx, page };
}
const go = async (page, hash, ready) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.locator(ready).first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
};
// Geometry of the page as rendered.
const measure = (page) => page.evaluate(() => {
  const box = (el) => el && el.getBoundingClientRect();
  const main = box(document.querySelector('main'));
  const cols = [...document.querySelectorAll('.cols')].map((c) => [...c.children].map((col) => { const r = box(col); return { left: r.left, top: r.top, bottom: r.bottom, h: r.height }; }));
  const grids = [...document.querySelectorAll('.card-grid')].map((g) => [...g.children].slice(0, 2).map((c) => box(c).left));
  const short = [...document.querySelectorAll('main button.primary, main .btn, main a.item, main button.item, #nav a')]
    .filter((el) => el.offsetParent).map((el) => ({ t: (el.textContent || '').trim().slice(0, 30), h: box(el).height })).filter((x) => x.h < 43.5);
  return { overflow: document.documentElement.scrollWidth - window.innerWidth, mainWidth: main.width, cols, grids, short, vw: window.innerWidth };
});

const SCREENS = [
  ['inbox', 'Ava', '#/inbox', 'main .msgs'],
  ['kid-break', 'Sam', '#/inbox', 'main .msgs'],
  ['give', 'Ava', '#/give', 'main .segmented'],
  ['plans', 'Ava', '#/plans', 'main .plan'],
  ['plan-form', 'Ava', `#/plan/${msg('raised your voice').id}`, 'main .plan-form'],
  ['sent', 'Ava', '#/sent', 'main article.card'],
  ['family', 'Mom', '#/family', 'main .people'],
  ['guide', 'Ava', '#/guide', 'main .tips'],
];

// Every size of one screen before the next, so Ava's replies are still new for every Inbox capture
// (visiting Sent marks them seen).
for (const [screen, who, hash, ready] of SCREENS) {
  for (const device of Object.keys(DEVICES)) {
    for (const scheme of ['dark', 'light']) {
      const { ctx, page } = await open(device, scheme, who);
      await go(page, hash, ready);
      if (screen === 'give') {
        await page.locator('.tile', { hasText: 'Dad' }).click();
        await page.locator('.model-tile', { hasText: 'Glow & Grow' }).click();
        await page.locator('#field-glow').fill('You read Sam three bedtime stories.');
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (screen === 'inbox') {
        check(/Dad replied/.test(await page.locator('main .responses').innerText()), `inbox on ${device} (${scheme}): replies to Ava's message are listed`);
        await page.locator('.fb-head', { hasText: 'raised your voice' }).click();
        await page.locator('.fb-body').waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (screen === 'kid-break') {
        await page.locator('.fb-head', { hasText: 'Mom' }).click();
        await page.locator('.calm .bubble').waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      const m = await measure(page);
      const tag = `${screen} on ${device} (${scheme})`;
      check(m.overflow <= 1, `${tag}: no sideways scrolling (${m.overflow}px)`);
      // 44px touch targets on touch screens; a desktop's mouse-sized top navigation is exempt.
      if (device !== 'desktop') check(m.short.length === 0, `${tag}: buttons and rows at least 44px (${JSON.stringify(m.short.slice(0, 3))})`);
      if (device === 'desktop') {
        check(m.mainWidth >= 1100, `${tag}: the page uses the width (${Math.round(m.mainWidth)}px)`);
        for (const c of m.cols) check(c.length === 2 && c[1].left > c[0].left + 300 && Math.abs(c[1].top - c[0].top) < 2, `${tag}: two columns side by side`);
        for (const g of m.grids) if (g.length === 2) check(g[1] > g[0] + 300, `${tag}: cards in two columns`);
      } else {
        check(m.mainWidth <= 760, `${tag}: one column (${Math.round(m.mainWidth)}px)`);
        for (const c of m.cols) check(c.length < 2 || c[1].h === 0 || c[1].top >= c[0].bottom - 1, `${tag}: columns stack in reading order`);
        for (const g of m.grids) if (g.length === 2) check(Math.abs(g[1] - g[0]) < 2, `${tag}: cards stack`);
      }
      shots[`${screen}-${device}-${scheme}`] = await page.screenshot();
      await ctx.close();
    }
  }
}

// ---------- the Inbox reading pane, and keeping your place across a resize ----------
{
  const { ctx, page } = await open('desktop', 'light', 'Ava');
  await page.locator('.split .reader').waitFor();
  check((await page.locator('.reader .fb-body').count()) === 0, 'desktop: no message opens by itself (opening starts its break)');
  const unreadBefore = await page.locator('.fb.unread').count();
  check(unreadBefore >= 1, 'desktop: an unread message stays unread until chosen');
  const list = await page.locator('.split > .split-list').boundingBox();
  const reader = await page.locator('.split .reader').boundingBox();
  check(reader.x > list.x + list.width - 1 && Math.abs(reader.y - list.y) < 2, 'desktop: the reading pane sits beside the list');
  await page.locator('.fb-head', { hasText: 'raised your voice' }).click();
  await page.locator('.reader .fb-body').waitFor();
  check((await page.locator('.fb.selected .fb-head[aria-current="true"]').count()) === 1, 'desktop: the chosen row is marked as current');
  check((await page.locator('.msgs .fb-body').count()) === 0, 'desktop: the message opens in the pane, not in the list');
  await page.locator('.reader textarea[name="reply"]').fill('Thank you for telling me. I’m working on it.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.msgs .fb-body').waitFor();
  check((await page.locator('.split').count()) === 0, 'resized to a phone: back to one list');
  check((await page.inputValue('.msgs textarea[name="reply"]')) === 'Thank you for telling me. I’m working on it.', 'resized to a phone: the open message and the reply draft are kept');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.reader .fb-body').waitFor();
  check((await page.inputValue('.reader textarea[name="reply"]')) === 'Thank you for telling me. I’m working on it.', 'back to desktop: the same message and draft in the pane');
  // Give: the composer sits to the right and keeps what was typed across a resize.
  await page.locator('#nav a', { hasText: 'Give' }).click();
  await page.locator('.tile', { hasText: 'Sam' }).click();
  await page.locator('.model-tile', { hasText: 'Kind Words' }).click();
  const pick = await page.locator('.give-layout > .col').first().boundingBox();
  const write = await page.locator('.give-write').boundingBox();
  check(write.x > pick.x + pick.width, 'desktop Give: writing sits to the right of choosing');
  await page.locator('#field-happened').fill('You shared your blocks with your sister.');
  await page.setViewportSize({ width: 744, height: 900 });
  await page.waitForTimeout(100);
  check((await page.inputValue('#field-happened')) === 'You shared your blocks with your sister.', 'resized to a tablet: the message being written is kept');
  await ctx.close();
}

// ---------- boards: one per screen, phone | foldable | desktop, dark above light ----------
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const board = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
const H = 560;
const names = { inbox: 'Inbox (replies at the top, a message open)', 'kid-break': 'A kid’s break (breathing bubble)', give: 'Give', plans: 'Plans', 'plan-form': 'Make a plan', sent: 'Sent', family: 'Family (a parent)', guide: 'Guide' };
for (const [screen] of SCREENS) {
  const col = (device, label) => `<div class="col"><div class="cap">${label}</div>
    ${['dark', 'light'].map((s) => `<img style="height:${H}px" src="${img(shots[`${screen}-${device}-${s}`])}">`).join('')}</div>`;
  await board.setContent(`<!doctype html><style>
    body { margin: 0; padding: 20px 22px; background: #8a8580; font: 600 16px system-ui, sans-serif; color: #fff; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 12px; } .row { display: flex; gap: 18px; align-items: flex-start; }
    .col { display: flex; flex-direction: column; gap: 12px; } .cap { font-size: 15px; }
    img { display: block; border-radius: 12px; box-shadow: 0 6px 18px rgb(0 0 0 / 35%); }
  </style><h1>${names[screen]} · dark above light</h1><div class="row">
    ${col('phone', 'Phone 390 × 844')}${col('foldable', 'Foldable / tablet 744 × 900')}${col('desktop', 'Desktop 1440 × 1000')}</div>`);
  await board.screenshot({ path: join(outDir, `layout-${screen}.png`), fullPage: true });
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
console.log(`${passed} layout checks passed. Boards: ${outDir}`);
