// Privacy play-test, repeatable: what one person can learn about another, and what a shared device
// leaves behind for the next person. Runs a real hub (in memory) and headless Edge.
//   npm run test:privacy
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';

const hub = createApp({ dataPath: ':memory:', anonymousHoldMs: [0, 0] });
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));
const results = [];
const check = (ok, what, detail = '') => results.push({ ok, what, detail });

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
const as = async (id) => { const c = client(); await c('POST', '/api/login', { memberId: id }); await c('POST', '/api/welcome'); return c; };

const mom = client();
const momId = (await mom('POST', '/api/setup', { familyName: 'The Lees', name: 'Mom', emoji: '🧑' })).data.me.id;
const dad = (await mom('POST', '/api/members', { name: 'Dad', emoji: '🧔', role: 'adult', isParent: true })).data;
const sam = (await mom('POST', '/api/members', { name: 'Sam', emoji: '🧒', role: 'kid' })).data;
const ava = (await mom('POST', '/api/members', { name: 'Ava', emoji: '👧', role: 'adult' })).data;
const dadC = await as(dad.id);
const samC = await as(sam.id);
const avaC = await as(ava.id);
await mom('POST', '/api/welcome');
const note = (what) => ({ model: 'thanks', fields: { what } });

// ---------- anonymity ----------
// Named messages carry their exact time; an anonymous one written in between must not be datable by
// its id or its place in the hub's file.
const order = [];
for (let i = 0; i < 12; i++) {
  await samC('POST', '/api/feedback', { toIds: [momId], ...note(`Named from Sam ${i}`) });
  await samC('POST', '/api/feedback', { toIds: [momId], anonymous: true, ...note(`Anonymous ${i}`) });
  await dadC('POST', '/api/feedback', { toIds: [momId], ...note(`Named from Dad ${i}`) });
  order.push(`Named from Sam ${i}`, `Anonymous ${i}`, `Named from Dad ${i}`);
}
const inbox = (await mom('GET', '/api/inbox')).data;
const byText = new Map(inbox.map((f) => [f.fields.what, f]));
const between = order.filter((t) => t.startsWith('Anonymous')).filter((t) => {
  const i = Number(t.split(' ')[1]);
  const lo = byText.get(`Named from Sam ${i}`).id;
  const hi = byText.get(`Named from Dad ${i}`).id;
  return byText.get(t).id > lo && byText.get(t).id < hi;
}).length;
check(between === 0, 'an anonymous message’s id doesn’t sit between the named messages sent around it', `${between} of 12 do`);
const anonItem = inbox.find((f) => f.anonymous);
check(anonItem.from === null && anonItem.others === null && /T12:00:00\.000Z$/.test(anonItem.createdAt), 'the recipient sees no sender, no other recipients and only the date');
const sorted = inbox.map((f) => f.fields.what);
const anonPositions = sorted.map((t, i) => (t.startsWith('Anonymous') ? i : -1)).filter((i) => i >= 0);
check(anonPositions.every((p, k) => k === 0 || p === anonPositions[k - 1] + 1), 'the inbox lists anonymous messages together, not in the order they were written among the others');
check(!(await samC('GET', '/api/sent')).data.some((g) => g.fields.what.startsWith('Anonymous')), 'the sender’s Sent list has no anonymous messages');
const rx = await mom('POST', `/api/feedback/${anonItem.id}/respond`, { reaction: 'thanks' });
check(rx.status === 200 && !JSON.stringify((await samC('GET', '/api/responses')).data).includes('Anonymous'), 'a reaction to an anonymous message reaches nobody');

// ---------- who can read what ----------
const samsInbox = async () => { await mom('POST', '/api/feedback', { toIds: [sam.id], ...note('Private to Sam') }); return (await samC('GET', '/api/inbox')).data.find((f) => f.fields.what === 'Private to Sam'); };
const samMsg = await samsInbox();
const momTries = await Promise.all([
  dadC('POST', `/api/feedback/${samMsg.id}/read`),
  dadC('POST', `/api/feedback/${samMsg.id}/respond`, { reaction: 'thanks' }),
  avaC('POST', `/api/feedback/${samMsg.id}/read`),
]);
check(momTries.every((r) => r.status === 404), 'nobody else (not even a parent) can open or answer someone’s message', momTries.map((r) => r.status).join(','));
check(!JSON.stringify((await dadC('GET', '/api/inbox')).data).includes('Private to Sam'), 'a parent’s inbox shows only their own messages');
check((await samC('GET', '/api/backup')).status !== 200 && (await mom('GET', '/api/backup')).status !== 200, 'the hub has no backup download (its file stays on the hub computer)');

// ---------- plans ----------
await avaC('POST', '/api/feedback', { toIds: [sam.id], ...note('Please knock first') });
await mom('POST', '/api/feedback', { toIds: [ava.id], model: 'glow-grow', fields: { glow: 'You cooked.', grow: 'Please don’t shout when we’re late.' } });
const avaItem = (await avaC('GET', '/api/inbox')).data.find((f) => f.fields.grow);
await avaC('POST', `/api/feedback/${avaItem.id}/read`);
const plansSeen = async (c) => JSON.stringify((await c('GET', '/api/plans')).data.shared);
// The break before planning is 30 minutes; plans are checked in their own suite. Here: private by default.
check(!(await plansSeen(dadC)).includes('shout') && !(await plansSeen(samC)).includes('shout'), 'nobody sees someone’s plans unless they share them');

// ---------- shared device: what's left for the next person ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const leftovers = async (page) => page.evaluate(async () => {
  const dump = [JSON.stringify(localStorage), JSON.stringify(sessionStorage), document.body.innerText, document.title];
  for (const key of await caches.keys()) {
    for (const req of await (await caches.open(key)).keys()) {
      dump.push(req.url);
      if (req.url.includes('/api/')) dump.push(await (await (await caches.open(key)).match(req)).text());
    }
  }
  for (const info of (await indexedDB.databases?.()) || []) dump.push(`idb:${info.name}`);
  return dump.join('\n');
});
try {
  await dadC('POST', '/api/feedback', { toIds: [momId], ...note('SECRET-FOR-MOM') });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.locator('.tile', { hasText: 'Mom' }).first().click();
  await page.locator('#nav a').first().waitFor();
  await page.getByText('SECRET-FOR-MOM').first().click();
  await page.locator('#nav a', { hasText: 'Give' }).click();
  await page.locator('#app .tile', { hasText: 'Dad' }).first().click();
  await page.locator('[data-action="pick-model"][data-id="thanks"]').click();
  await page.locator('textarea[data-field="what"]').fill('DRAFT-BY-MOM');
  await page.waitForTimeout(400);
  await page.locator('#me').getByRole('button', { name: 'Switch' }).click();
  await page.locator('.tile', { hasText: 'Sam' }).waitFor();
  const after = await leftovers(page);
  check(!after.includes('SECRET-FOR-MOM') && !after.includes('DRAFT-BY-MOM'), 'after Switch, nothing of Mom’s is left on screen, in storage or in caches');
  await page.goBack();
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => document.body.innerText);
  check(!back.includes('SECRET-FOR-MOM') && !back.includes('DRAFT-BY-MOM'), 'Back after Switch doesn’t bring Mom’s inbox back');
  await page.goForward().catch(() => {});
  await page.reload();
  await page.locator('.tile', { hasText: 'Sam' }).first().click();
  await page.locator('#nav a').first().waitFor();
  const samScreen = await leftovers(page);
  check(!samScreen.includes('SECRET-FOR-MOM') && !samScreen.includes('DRAFT-BY-MOM'), 'the next person (Sam) sees nothing of Mom’s');
  await ctx.close();

  // A family computer: signing in with the tiles is a shared sign-in unless it's kept.
  for (const keep of [false, true]) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p = await c.newPage();
    await p.clock.install();
    await p.goto(base);
    if (keep) await p.getByText('Keep me signed in on this device').click();
    await p.locator('.tile', { hasText: 'Mom' }).first().click();
    await p.locator('#nav a').first().waitFor();
    const cookie = (await c.cookies()).find((k) => k.name === 'ff_session');
    await p.clock.fastForward('04:00');
    await p.waitForTimeout(300);
    const signedOut = await p.getByText('The last person was signed out').isVisible();
    if (keep) {
      check(cookie.expires > Date.now() / 1000 + 300 * 86400 && !signedOut, 'kept on your own device: stays signed in');
    } else {
      check(cookie.expires === -1, 'on a family computer the sign-in ends when the browser closes');
      check(signedOut, 'and the person is signed out after 3 minutes without a tap');
    }
    await c.close();
  }

      // An invite to someone with a PIN: the new phone asks for it before showing anything.
      await mom('PATCH', `/api/members/${ava.id}`, { pin: '5791' });
      const url = (await mom('POST', '/api/invites', { memberId: ava.id })).data.url;
      const jc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const jp = await jc.newPage();
      await jp.goto(`${base}/${url.slice(url.indexOf('#'))}`);
      await jp.locator('#join-pin').fill('0000');
      await jp.locator('form[data-form="join-pin"] button[type="submit"]').click();
      await jp.locator('form[data-form="join-pin"] .notice.error').waitFor();
      check(!(await jp.locator('#nav a').count()), 'an invite with a wrong PIN shows nothing of Ava’s');
      await jp.locator('#join-pin').fill('5791');
      await jp.locator('form[data-form="join-pin"] button[type="submit"]').click();
      await jp.locator('#nav a, form[data-form="welcome"]').first().waitFor();
      check(true, 'with Ava’s PIN, the invite adds her phone');
      await jc.close();
} finally {
  await browser.close();
}

hub.closeAllConnections?.();
hub.close();
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.what}${r.detail ? `: ${r.detail}` : ''}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} privacy checks passed`);
if (results.some((r) => !r.ok)) process.exit(1);
