// Headless Edge check of what happens after feedback arrives: the break before replying, a
// grown-up's plan, a kid's picture promise, ticks, cheers, the halfway check-in and the wrap-up.
// The hub's clock and each page's clock are moved forward together, so a 30-minute break or a
// 30-day plan takes seconds. Fails on any check or unexpected console error.
//   npm run test:plans -- [outputDir]   (screenshots and a dark-above-light board go there)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.js';

const outDir = resolve(process.argv[2] || 'screenshots/plans');
mkdirSync(outDir, { recursive: true });
const MIN = 60_000;
const DAY = 864e5;
// Start the hub's day at 10:00 local time, so the minutes and days this moves forward never cross
// midnight by accident (day counts would be off by one when run late in the evening).
const tenAm = new Date();
tenAm.setHours(10, 0, 0, 0);
let skew = tenAm.getTime() - Date.now();
const now = () => Date.now() + skew;
const hub = createApp({ dataPath: ':memory:', now: () => new Date(now()) });
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
const dad = await mom('POST', '/api/members', { name: 'Dad', emoji: '👨', role: 'adult', isParent: true });
const ava = await mom('POST', '/api/members', { name: 'Ava', emoji: '👧', role: 'adult' });
const sam = await mom('POST', '/api/members', { name: 'Sam', emoji: '👦', role: 'kid' });
const as = async (id) => { const c = client(); await c('POST', '/api/login', { memberId: id }); await c('POST', '/api/welcome'); return c; };
const dadC = await as(dad.id);
await as(ava.id);
await as(sam.id);
await dadC('POST', '/api/feedback', { toIds: [ava.id], model: 'dearman', fields: {
  describe: 'At breakfast you raised your voice when we were running late.', express: 'I felt tense for the rest of the morning.', assert: 'Could you tell me calmly when we need to hurry?',
} });
await mom('POST', '/api/feedback', { toIds: [sam.id], model: 'kids', fields: { feeling: 'sad', happened: 'You shouted at your sister when she took your blocks.', wish: 'Use your calm voice and tell me.' } });

// ---------- browser ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const failures = [];
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else failures.push(what); };
const shots = {};

async function open(name, { scheme = 'light', kind = 'phone', hash = '#/inbox' } = {}) {
  const opts = kind === 'phone'
    ? { colorScheme: scheme, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { colorScheme: scheme, viewport: { width: 1280, height: 860 } };
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}/${scheme}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}/${scheme}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date(now()) });
  await page.goto(base);
  // Each page is someone's own phone: kept signed in while days go by.
  await page.getByText('Keep me signed in on this device').click();
  await page.locator('.tile', { hasText: name }).first().click();
  await page.locator('#nav a').first().waitFor();
  if (hash !== '#/inbox') await page.evaluate((h) => { location.hash = h; }, hash);
  return { ctx, page };
}
// Move the hub and an open page forward together; the page's timers (the countdown) run once.
async function advance(page, ms) {
  skew += ms;
  if (page) await page.clock.fastForward(ms);
}
const top = (page) => page.evaluate(() => window.scrollTo(0, 0));
async function shoot(key, page, scheme, locator) {
  if (locator) await locator.scrollIntoViewIfNeeded();
  shots[`${scheme}-${key}`] = await page.screenshot();
}
// The same screen in dark and light, for the board.
async function both(key, name, hash, setup, kind = 'phone') {
  for (const scheme of ['dark', 'light']) {
    const { ctx, page } = await open(name, { scheme, kind, hash });
    await setup(page);
    shots[`${scheme}-${key}`] = await page.screenshot();
    await ctx.close();
  }
}

// 1. Ava opens Dad's message: a short break, then she can write back or make a plan.
{
  const { ctx, page } = await open('Ava');
  await page.locator('.fb-head', { hasText: 'Dad' }).click();
  await page.locator('.calm').waitFor();
  check(/30 min/.test(await page.locator('.calm').innerText()), 'the break shows 30 minutes for a grown-up');
  check(await page.locator('[data-reaction="disagree"]').isDisabled(), '“I see it differently” waits for the break');
  check(!(await page.locator('[data-reaction="thanks"]').isDisabled()), '“Thank you” works during the break');
  check((await page.locator('[data-form="reply"]').count()) === 0, 'no reply box during the break');
  check((await page.getByRole('link', { name: /Make a plan/ }).count()) === 0, 'no Make a plan during the break');
  await page.locator('[data-reaction="thanks"]').click();
  await page.locator('[data-reaction="thanks"][aria-pressed="true"]').waitFor();
  check(true, 'a thank-you is sent during the break');
  await advance(page, 12 * MIN);
  await page.waitForFunction(() => /18 min/.test(document.querySelector('.calm')?.textContent || ''));
  check(true, 'the countdown updates (18 min left)');
  await advance(page, 19 * MIN);
  await page.locator('[data-form="reply"]').waitFor();
  check((await page.locator('.calm').count()) === 0, 'the break panel goes when it ends');
  check(!(await page.locator('[data-reaction="disagree"]').isDisabled()), '“I see it differently” is available after the break');
  await page.getByRole('link', { name: 'Make a plan from this' }).click();
  await page.getByRole('heading', { name: 'Make a plan' }).waitFor();
  check(/raised your voice/.test(await page.locator('main .card').first().innerText()), 'the form quotes the message');
  check((await page.getByRole('radio', { name: /Me and Dad/ }).count()) === 1, 'the plan can be shared with Dad, who sent it');
  await page.getByRole('button', { name: 'Start my plan' }).click();
  check(await page.locator('#plan-heard:invalid').count() === 1, '“What I heard” is required');
  await page.fill('#plan-heard', 'When I shout because we’re late, the whole morning feels tense.');
  await page.fill('#plan-promise', 'Keep my voice calm when we’re late');
  await page.fill('#plan-when', 'feel rushed in the morning');
  await page.fill('#plan-then', 'take a breath and say “we need to go in five minutes”');
  await page.getByRole('radio', { name: /Me and Dad/ }).check();
  await page.getByRole('button', { name: 'Start my plan' }).click();
  await page.getByRole('heading', { name: 'Plans' }).waitFor();
  const card = page.locator('.plan', { hasText: 'Keep my voice calm' });
  check(/Day 1 of 30/.test(await card.innerText()), 'the plan starts on day 1 of 30');
  check(/You and Dad/.test(await card.locator('.pill').innerText()), 'the plan says Dad can see it');
  check((await page.locator('#nav a', { hasText: 'Plans' }).locator('.badge').innerText()) === '1', 'the Plans tab shows today is not ticked yet');
  await card.getByRole('button', { name: 'Kept it' }).click();
  await page.locator('.plan [data-value="kept"][aria-pressed="true"]').waitFor();
  check((await page.locator('#nav a', { hasText: 'Plans' }).locator('.badge').count()) === 0, 'ticking today clears the badge');
  check((await page.locator('.days li.kept').count()) === 1, 'the day strip marks today kept');
  await page.goto(`${base}/#/inbox`);
  await page.locator('.fb-head', { hasText: 'Dad' }).click();
  await page.getByText('You made a plan from this').waitFor();
  check(true, 'the message links to its plan');
  await ctx.close();
}
await dadC('POST', '/api/feedback', { toIds: [ava.id], model: 'thanks', fields: { what: 'You drove Sam to football in the rain.', impact: 'I could finish work. Thank you!' } });
await both('calm', 'Ava', '#/inbox', async (page) => {
  await page.locator('.fb-head', { hasText: 'football' }).click();
  await page.locator('.calm').waitFor();
  await top(page);
});

// 2. Dad is told in his Inbox that Ava said thank you; opening it shows his message in Sent.
{
  const { ctx, page } = await open('Dad');
  const row = page.locator('main .responses .item', { hasText: 'Ava' });
  await row.waitFor();
  check(/Thank you/.test(await row.innerText()) && /DEAR MAN/.test(await row.innerText()), 'Dad’s Inbox lists Ava’s reaction and the message it answers');
  check((await page.locator('#nav a', { hasText: 'Inbox' }).locator('.badge').innerText()) === '1', 'the Inbox badge counts the new reaction');
  await row.click();
  await page.locator('main article.card.highlight').waitFor();
  check(/raised your voice/.test(await page.locator('main article.card.highlight').innerText()), 'opening it shows that message in Sent');
  check((await page.locator('#nav a', { hasText: 'Inbox' }).locator('.badge').count()) === 0, 'seen: the badge clears');
  await page.locator('#nav a', { hasText: 'Inbox' }).click();
  await page.getByRole('heading', { name: 'No feedback yet' }).waitFor();
  check((await page.locator('main .responses').count()) === 0, 'seen replies leave the Inbox');
  await ctx.close();
}

// 3. Dad sees Ava's plan, without her days, and cheers her on.
{
  const { ctx, page } = await open('Dad', { hash: '#/plans' });
  const card = page.locator('.plan', { hasText: 'Keep my voice calm' });
  await card.waitFor();
  check(/Ava’s plan · from your message/.test(await card.innerText()), 'Dad sees it was made from his message');
  check((await card.locator('.days').count()) === 0, 'Dad never sees Ava’s day strip');
  check(/1 good day/.test(await card.innerText()), 'Dad sees how many days went well');
  await card.getByRole('button', { name: /I noticed/ }).click();
  await page.getByText('You cheered today').waitFor();
  check(await card.getByRole('button', { name: /Proud of you/ }).isDisabled(), 'one cheer a day');
  await page.locator('#nav a', { hasText: 'Sent' }).click();
  await page.getByText('made a plan from it').waitFor();
  check(true, 'Sent shows that Ava made a plan from Dad’s message');
  check((await page.locator('#me a[aria-label="Guide"]').count()) === 1, 'the Guide is a button in the top bar');
  await ctx.close();
}
await both('shared', 'Dad', '#/plans', async (page) => { await page.locator('.plan').first().waitFor(); await top(page); });
await both('form', 'Ava', '#/plans', async (page) => {
  await page.evaluate(() => { location.hash = '#/plan/1'; });
  await page.getByRole('heading', { name: 'Make a plan' }).waitFor();
  await top(page);
});

// 3. Sam (a kid) waits 10 minutes, then makes a picture promise with a helper.
{
  const { ctx, page } = await open('Sam');
  await page.locator('.fb-head', { hasText: 'Mom' }).click();
  await page.locator('.calm .bubble').waitFor();
  check(/10 min/.test(await page.locator('.calm').innerText()), 'a kid’s break is 10 minutes, with a breathing bubble');
  // The bubble breathes: it grows and shrinks, or, when the device asks for less motion, fades.
  const sample = () => page.locator('.calm .bubble').evaluate((el) => { const c = getComputedStyle(el); return { name: c.animationName, transform: c.transform, opacity: c.opacity }; });
  for (const motion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: motion });
    const a = await sample();
    await page.waitForTimeout(1500);
    const b = await sample();
    const moving = motion === 'reduce' ? a.name === 'breathe-fade' && a.opacity !== b.opacity && a.transform === 'none' : a.name === 'breathe' && a.transform !== b.transform;
    check(moving, `the bubble breathes (${motion} motion: ${JSON.stringify([a, b])})`);
  }
  check(/Breathe in/.test(await page.locator('.calm .breath-words').textContent()), 'breathing words show with the bubble');
  await advance(page, 11 * MIN);
  await page.getByRole('link', { name: 'Make a promise' }).click();
  await page.getByRole('heading', { name: 'Make a promise' }).waitFor();
  check((await page.getByRole('radio', { name: /30 days/ }).count()) === 0, 'kids pick 7 or 14 days');
  await page.locator('.ptile', { hasText: 'Use my calm voice' }).click();
  check((await page.inputValue('#plan-when')) === 'feel cross', 'the picture promise fills in “When I…”');
  check((await page.locator('.tile:has(input:checked)').innerText()).includes('Dad'), 'a grown-up helper is picked');
  await shoot('kidform', page, 'light');
  await page.getByRole('button', { name: 'Start my promise' }).click();
  await page.getByRole('heading', { name: 'Promises' }).waitFor();
  await page.getByRole('button', { name: /I did it/ }).click();
  await page.locator('.days.stickers li.kept').waitFor();
  check((await page.locator('.days.stickers li.kept').innerText()).includes('⭐'), 'a kept day earns a star sticker');
  await ctx.close();
}
await both('kid', 'Sam', '#/plans', async (page) => { await page.locator('.plan').first().waitFor(); await top(page); });
await both('kidform', 'Sam', '#/plan/2', async (page) => {
  // Sam already has a promise from this message; show the form fresh for the board.
  await page.getByRole('heading', { name: 'Make a promise' }).waitFor();
  await page.locator('.ptile', { hasText: 'Use my calm voice' }).click();
  await top(page);
});

// 4. Halfway: a private check-in; at the end, a wrap-up that asks Dad if he has noticed.
{
  skew += 14 * DAY;
  const { ctx, page } = await open('Ava', { hash: '#/plans' });
  const card = page.locator('.plan', { hasText: 'Keep my voice calm' });
  await card.locator('[data-form="checkin"]').waitFor();
  check(/Day 15 of 30/.test(await card.innerText()), 'day 15 of 30');
  check((await page.locator('#nav a', { hasText: 'Plans' }).locator('.badge').innerText()) === '1', 'the check-in is due');
  await card.locator('label.chip', { hasText: 'Okay' }).click();
  await card.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByText('Halfway check-in: 😐 Okay').waitFor();
  check(true, 'the check-in is saved');
  await card.locator('.days li:not(.future) button').nth(3).click();
  await page.waitForFunction(() => document.querySelectorAll('.days li.kept').length === 2);
  check(true, 'a past day can be marked later');
  await ctx.close();
}
await both('mine', 'Ava', '#/plans', async (page) => { await page.locator('.plan').first().waitFor(); await top(page); });
await both('mine-wide', 'Ava', '#/plans', async (page) => { await page.locator('.plan').first().waitFor(); await top(page); }, 'laptop');
{
  skew += 15 * DAY;
  const { ctx, page } = await open('Ava', { hash: '#/plans' });
  const card = page.locator('.plan', { hasText: 'Keep my voice calm' });
  await card.locator('[data-form="wrap"]').waitFor();
  check(/Your 30 days are up/.test(await card.innerText()), 'the wrap-up opens on day 30');
  check(await card.getByRole('checkbox', { name: /Ask Dad/ }).isChecked(), 'Dad can be asked if he has noticed a difference');
  await card.getByRole('button', { name: 'Save' }).click();
  await page.locator('.list li', { hasText: 'Keep my voice calm' }).waitFor();
  check(true, 'the finished plan moves to Finished');
  await ctx.close();
}
{
  const { ctx, page } = await open('Dad', { hash: '#/plans' });
  await page.getByText('Ava asks: have you noticed a difference?').waitFor();
  await page.getByRole('button', { name: /Yes, a lot/ }).click();
  await page.locator('.list li', { hasText: 'Keep my voice calm' }).waitFor();
  check(true, 'Dad answers and the plan moves to Finished for him too');
  await ctx.close();
}
{
  const { ctx, page } = await open('Ava', { hash: '#/plans' });
  await page.locator('.list li', { hasText: 'Yes, a lot' }).waitFor();
  check(true, 'Ava sees that Dad has noticed a difference');
  await ctx.close();
}

// ---------- board: dark row above light row ----------
const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const cols = [['calm', 'Inbox · the break'], ['form', 'Make a plan'], ['mine', 'Plans · mine (day 15)'], ['shared', 'Plans · Dad sees Ava’s'], ['kidform', 'Kid · pick a promise'], ['kid', 'Kid · star days']];
const row = (s, label) => `<div class="label">${label}</div><div class="row">
  ${cols.map(([k, cap]) => (shots[`${s}-${k}`] ? `<figure><img class="phone" src="${img(shots[`${s}-${k}`])}"><figcaption>${cap}</figcaption></figure>` : '')).join('')}
  <figure><img class="laptop" src="${img(shots[`${s}-mine-wide`])}"><figcaption>Laptop · Plans</figcaption></figure></div>`;
const board = await (await browser.newContext({ deviceScaleFactor: 1.25 })).newPage();
await board.setContent(`<!doctype html><style>
  body { margin: 0; padding: 22px; background: #8a8580; font: 600 15px system-ui, sans-serif; color: #fff; width: max-content; }
  .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; } .label { font-size: 18px; margin: 4px 0 10px; }
  figure { margin: 0; } figcaption { margin-top: 6px; } img { display: block; border-radius: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 35%); }
  .phone { width: 250px; } .laptop { width: 620px; }
</style>${row('dark', 'Dark')}${row('light', 'Light')}`);
const boardPath = join(outDir, 'plans-board.png');
await board.screenshot({ path: boardPath, fullPage: true });
for (const [k, buf] of Object.entries(shots)) writeFileSync(join(outDir, `${k}.png`), buf);

await browser.close();
hub.closeAllConnections?.();
hub.close();
if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
if (failures.length) {
  console.error(`${passed} passed, ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${passed} plan checks passed. Board: ${boardPath}`);
