// Stress test for the home hub: a big family, thousands of messages sent at once, many readers,
// parallel PIN guessing, hostile request bodies, lots of sign-ins and notification devices, and a
// long inbox in headless Edge. It checks that nothing is lost or corrupted, that limits hold, and
// that the hub stays responsive.
//   npm run test:stress            (add --report to print the numbers without failing)
// Uses a throwaway data file in the temp folder, never data/family.json.
import { chromium } from 'playwright-core';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createApp } from '../src/server.js';

const REPORT_ONLY = process.argv.includes('--report');
const MEMBERS = 30;
const MESSAGES = 2000;
const CONCURRENCY = 100;
const LIMITS = {
  sendP95: 1500, // ms, while 100 sends are in flight at once
  readP95: 1500, // ms, while 100 reads are in flight at once
  loopDelay: 1000, // ms, the longest the hub may stop answering everyone
  inboxRender: 4000, // ms, a 1,000-message inbox in headless Edge
  sessionsPerMember: 20,
};

const dir = mkdtempSync(join(tmpdir(), 'ff-stress-'));
const dataPath = join(dir, 'family.json');
const pushes = [];
const hub = createApp({
  dataPath,
  anonymousHoldMs: [0, 0],
  push: { coalesceMs: 0, fetch: async (url) => { pushes.push(url); return { status: 201, ok: true }; } },
});
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

const results = [];
const failures = [];
const check = (ok, what, detail = '') => { results.push({ ok, what, detail }); if (!ok) failures.push(`${what}${detail ? ` (${detail})` : ''}`); };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const ms = (n) => `${Math.round(n)} ms`;

function client() {
  let cookie = '';
  return async (method, path, body, { raw, type = 'application/json' } = {}) => {
    const t0 = performance.now();
    const res = await fetch(base + path, {
      method,
      headers: { ...(type && { 'content-type': type }), ...(cookie && { cookie }) },
      body: method === 'GET' ? undefined : raw ?? JSON.stringify(body ?? {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, ms: performance.now() - t0 };
  };
}
async function inBatches(n, size, fn) {
  const out = [];
  for (let i = 0; i < n; i += size) out.push(...(await Promise.all(Array.from({ length: Math.min(size, n - i) }, (_, j) => fn(i + j)))));
  return out;
}

// ---------- a big family ----------
const mom = client();
const momId = (await mom('POST', '/api/setup', { familyName: 'The Big Family', name: 'Mom', emoji: '🧑' })).data.me.id;
const members = [{ id: momId, c: mom }];
for (let i = 1; i < MEMBERS; i++) {
  const role = i % 4 === 0 ? 'kid' : 'adult';
  const m = (await mom('POST', '/api/members', { name: `Person ${i}`, emoji: '🙂', role, isParent: i === 1 })).data;
  const c = client();
  await c('POST', '/api/login', { memberId: m.id });
  await c('POST', '/api/welcome');
  members.push({ id: m.id, c, kid: role === 'kid' });
}
check(members.length === MEMBERS, `${MEMBERS} people in the family`);

// ---------- thousands of messages at once ----------
const pick = (n) => Math.floor(Math.random() * n);
let expectedRows = 0;
const expectedTo = new Map();
const sendTimes = [];
const sendStatus = new Map();
await inBatches(MESSAGES, CONCURRENCY, async (i) => {
  const from = members[pick(MEMBERS)];
  const others = members.filter((m) => m.id !== from.id);
  const kind = i % 10;
  const body = kind === 0
    ? { to: 'everyone', model: 'thanks', fields: { what: `Thanks to everyone, note ${i}` } }
    : { toIds: kind < 3 ? [others[pick(others.length)].id, others[pick(others.length)].id] : [others[pick(others.length)].id], model: 'thanks', fields: { what: `Note ${i}: you helped a lot today.` } };
  if (i % 7 === 0) body.anonymous = true;
  const r = await from.c('POST', '/api/feedback', body);
  sendTimes.push(r.ms);
  sendStatus.set(r.status, (sendStatus.get(r.status) || 0) + 1);
  if (r.status === 200) {
    const ids = body.to === 'everyone' ? others.map((m) => m.id) : [...new Set(body.toIds)];
    expectedRows += ids.length;
    for (const id of ids) expectedTo.set(id, (expectedTo.get(id) || 0) + 1);
  }
});
check(sendStatus.get(200) === MESSAGES, `${MESSAGES} sends, ${CONCURRENCY} at a time, all accepted`, JSON.stringify(Object.fromEntries(sendStatus)));
check(pct(sendTimes, 95) <= LIMITS.sendP95, 'sends stay quick under load', `p50 ${ms(pct(sendTimes, 50))}, p95 ${ms(pct(sendTimes, 95))}, max ${ms(Math.max(...sendTimes))}`);

const saved = JSON.parse(readFileSync(dataPath, 'utf8'));
check(saved.feedback.length === expectedRows, 'nothing lost: every message is in the saved file', `${saved.feedback.length} of ${expectedRows}`);
check(new Set(saved.feedback.map((f) => f.id)).size === saved.feedback.length, 'every message has its own id');
check(saved.feedback.filter((f) => f.anonymous).every((f) => f.fromId === null && f.createdAt.endsWith('T12:00:00.000Z')), 'anonymous messages kept no sender and no time, even under load');
const fileSize = statSync(dataPath).size;

// ---------- one very busy inbox ----------
await inBatches(1000, CONCURRENCY, (i) => members[1 + (i % (MEMBERS - 1))].c('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: `For Mom, note ${i}` } }));
expectedTo.set(momId, (expectedTo.get(momId) || 0) + 1000);
expectedRows += 1000;

// ---------- many readers at once ----------
const readTimes = [];
let inboxOk = true;
await inBatches(500, CONCURRENCY, async (i) => {
  const m = members[i % MEMBERS];
  const r = await m.c('GET', i % 2 ? '/api/inbox' : '/api/state');
  readTimes.push(r.ms);
  if (r.status !== 200) inboxOk = false;
  if (i % 2 && Array.isArray(r.data) && r.data.length !== (expectedTo.get(m.id) || 0)) inboxOk = false;
});
check(inboxOk, 'every inbox holds exactly what was sent to that person');
check(pct(readTimes, 95) <= LIMITS.readP95, 'reads stay quick under load', `p50 ${ms(pct(readTimes, 50))}, p95 ${ms(pct(readTimes, 95))}`);

// ---------- parallel PIN guessing ----------
const target = members[2];
await target.c('PATCH', `/api/members/${target.id}`, { pin: '7391' });
const guessers = Array.from({ length: 60 }, () => client());
const guesses = await Promise.all(guessers.map((g, i) => g('POST', '/api/login', { memberId: target.id, pin: String(1000 + i) })));
const counted = guesses.filter((g) => g.status === 401).length;
check(counted <= 5, '60 wrong PINs at once: only 5 are tried before the lock', `${counted} tried, ${guesses.filter((g) => g.status === 429).length} refused`);
check((await client()('POST', '/api/login', { memberId: target.id, pin: '7391' })).status === 429, 'even the right PIN waits out the lock');

// ---------- hostile bodies ----------
const anon = client();
check((await anon('POST', '/api/login', null, { raw: `{"memberId":1,"pad":"${'x'.repeat(600 * 1024)}"}` })).status === 413, 'a 600 KB body is refused');
check((await anon('POST', '/api/login', null, { raw: '{"memberId":' })).status === 400, 'broken JSON is refused');
check((await anon('POST', '/api/login', null, { raw: 'memberId=1', type: 'application/x-www-form-urlencoded' })).status === 415, 'a form post (cross-site style) is refused');
const kid = members.find((m) => m.kid);
await kid.c('POST', '/api/feedback', JSON.parse('{"toIds":[1],"model":"thanks","fields":{"what":"hi","__proto__":{"polluted":true}},"__proto__":{"isParent":true}}'));
check(({}).polluted === undefined && ({}).isParent === undefined, '__proto__ in a body pollutes nothing');
check((await kid.c('POST', '/api/members', { name: 'Sneaky', role: 'adult', isParent: true })).status === 403, 'a kid can’t add a parent, even with __proto__ tricks');
check((await kid.c('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'x'.repeat(2001) } })).status === 400, 'a field over 2,000 characters is refused');
check((await kid.c('POST', '/api/feedback', { toIds: Array.from({ length: 5000 }, (_, i) => i + 1), model: 'thanks', fields: { what: 'hi' } })).status < 500, 'a huge recipient list doesn’t break the hub');

// ---------- lots of sign-ins ----------
const signins = Array.from({ length: 300 }, () => client());
await inBatches(300, 50, (i) => signins[i]('POST', '/api/login', { memberId: members[5].id }));
const sessionsFor = Object.values(JSON.parse(readFileSync(dataPath, 'utf8')).hub.sessions).filter((s) => s.memberId === members[5].id).length;
check(sessionsFor <= LIMITS.sessionsPerMember, '300 sign-ins as one person don’t pile up sessions forever', `${sessionsFor} kept`);
check((await signins[299]('GET', '/api/inbox')).status === 200, 'the newest sign-in still works');
check((await members[5].c('GET', '/api/inbox')).status === 401, 'the oldest one was let go');
await members[5].c('POST', '/api/login', { memberId: members[5].id });

// ---------- many notification devices ----------
const keysFor = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }; };
const bogus = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') };
check((await members[4].c('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/bogus', keys: bogus } })).status === 400, 'a device key that isn’t a real P-256 point is refused');
await inBatches(MEMBERS * 3, 30, (i) => members[i % MEMBERS].c('POST', '/api/push/subscribe', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`, keys: keysFor(i) } }));
pushes.length = 0;
const t0 = performance.now();
await members[3].c('POST', '/api/feedback', { to: 'everyone', model: 'thanks', fields: { what: 'Pizza night!' } });
while (pushes.length < (MEMBERS - 1) * 3 && performance.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 20));
check(pushes.length === (MEMBERS - 1) * 3, `a message to everyone reaches all ${(MEMBERS - 1) * 3} other devices`, `${pushes.length} in ${ms(performance.now() - t0)}`);

loop.disable();
const loopMax = loop.max / 1e6;
check(loopMax <= LIMITS.loopDelay, 'the hub never stops answering for long', `longest stall ${ms(loopMax)}, file ${(fileSize / 1e6).toFixed(1)} MB`);

// ---------- a long inbox in the browser ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const busiest = members.reduce((a, b) => ((expectedTo.get(b.id) || 0) > (expectedTo.get(a.id) || 0) ? b : a));
  const count = expectedTo.get(busiest.id);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const name = busiest.id === momId ? 'Mom' : `Person ${members.indexOf(busiest)}`;
  const started = performance.now();
  await page.locator('.tile', { hasText: name }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll('#app [data-id]').length >= n || document.querySelectorAll('#app li').length >= n, count, { timeout: 30_000 }).catch(() => {});
  const took = performance.now() - started;
  const shown = await page.evaluate(() => document.querySelectorAll('#app li').length);
  check(shown >= count && took <= LIMITS.inboxRender, `an inbox of ${count} messages opens in time`, `${shown} shown in ${ms(took)}`);
  const t = performance.now();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('#nav a', { hasText: 'Give' }).click();
  await page.locator('#nav a', { hasText: 'Inbox' }).click();
  await page.locator('#app li').nth(count - 1).waitFor({ state: 'attached' });
  check(performance.now() - t <= LIMITS.inboxRender, 'switching tabs with a long inbox stays quick', ms(performance.now() - t));
  check(!errors.length, 'no page errors', errors.join('; '));
  await ctx.close();
} finally {
  await browser.close();
}

hub.closeAllConnections?.();
hub.close();
rmSync(dir, { recursive: true, force: true });
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.what}${r.detail ? `: ${r.detail}` : ''}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} stress checks passed`);
if (failures.length && !REPORT_ONLY) process.exit(1);
