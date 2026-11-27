import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { MODELS, exampleFor, validateFields, modelsFor } from '../public/shared/models.js';
import { checkTone } from '../public/shared/tone.js';

let server;
let base;
let skew = 0; // moves the hub's clock forward, e.g. past the break before replying

before(async () => {
  server = createApp({ dataPath: ':memory:', now: () => new Date(Date.now() + skew) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    if (body === undefined && method !== 'GET') body = {};
    const headers = cookie ? { cookie } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const mom = client();
const kid = client();
const teen = client();
const ids = {};

test('first run requires setup and serves the app', async () => {
  const { data } = await mom('GET', '/api/state');
  assert.equal(data.setupDone, false);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/..%2Fsrc%2Fserver.js')).status, 404);
});

test('setup creates a signed-in parent and cannot run twice', async () => {
  const r = await mom('POST', '/api/setup', { familyName: 'Tests', name: 'Mom', emoji: '👩', pin: '1234' });
  assert.equal(r.status, 200);
  assert.equal(r.data.me.name, 'Mom');
  assert.equal(r.data.me.isParent, true);
  ids.mom = r.data.me.id;
  assert.equal((await client()('POST', '/api/setup', { name: 'Intruder' })).status, 409);
});

test('parents add members; non-JSON posts are rejected', async () => {
  const k = await mom('POST', '/api/members', { name: 'Sam', emoji: '👦', role: 'kid', pin: '4321' });
  assert.equal(k.status, 200);
  ids.kid = k.data.id;
  const t = await mom('POST', '/api/members', { name: 'Ava', emoji: '👧', role: 'adult' });
  ids.teen = t.data.id;
  assert.equal((await mom('POST', '/api/members', { name: 'Bad', role: 'kid', isParent: true })).status, 400);
  const form = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `memberId=${ids.teen}` });
  assert.equal(form.status, 415);
});

test('PIN sign-in, wrong PIN, and lockout', async () => {
  assert.equal((await kid('POST', '/api/login', { memberId: ids.kid, pin: '0000' })).status, 401);
  assert.equal((await kid('POST', '/api/login', { memberId: ids.kid, pin: '4321' })).status, 200);
  const { data } = await kid('GET', '/api/state');
  assert.equal(data.me.name, 'Sam');
  assert.equal(data.models.length, MODELS.length, 'kids can use every style');
  assert.equal(data.models[0].audience, 'kid', 'kid-friendly styles first');

  const attacker = client();
  for (let i = 0; i < 5; i++) await attacker('POST', '/api/login', { memberId: ids.mom, pin: '9999' });
  assert.equal((await attacker('POST', '/api/login', { memberId: ids.mom, pin: '1234' })).status, 429);

  assert.equal((await teen('POST', '/api/login', { memberId: ids.teen })).status, 200);
});

test('kids cannot manage the family', async () => {
  assert.equal((await kid('POST', '/api/members', { name: 'X', role: 'adult' })).status, 403);
  assert.equal((await kid('PATCH', `/api/members/${ids.kid}`, { isParent: true })).status, 403);
  assert.equal((await kid('PATCH', '/api/settings', { allowAnonymous: false })).status, 403);
});

test('named DEAR MAN feedback reaches the inbox and sender sees replies', async () => {
  const send = await mom('POST', '/api/feedback', {
    toId: ids.teen, model: 'dearman',
    fields: { describe: 'You came home at 11.', express: 'I felt worried.', assert: 'Please text me.', ignored: 'x' },
  });
  assert.equal(send.status, 200);
  const inbox = await teen('GET', '/api/inbox');
  assert.equal(inbox.data.length, 1);
  const f = inbox.data[0];
  assert.equal(f.from.name, 'Mom');
  assert.equal(f.fields.ignored, undefined);
  assert.equal(f.read, false);

  // A written reply waits for a short break after opening (30 minutes for grown-ups); a thank-you doesn't.
  const early = await teen('POST', `/api/feedback/${f.id}/respond`, { reaction: 'thanks', reply: 'Will do!' });
  assert.equal(early.status, 409);
  assert.match(early.data.error, /break/);
  assert.equal((await teen('POST', `/api/feedback/${f.id}/respond`, { reaction: 'thanks' })).status, 200);
  const disagree = await teen('POST', `/api/feedback/${f.id}/respond`, { reaction: 'disagree' });
  assert.equal(disagree.status, 409, '"I see it differently" waits too');
  const [opened] = (await teen('GET', '/api/inbox')).data;
  assert.ok(Date.parse(opened.replyAfter) - Date.now() > 29 * 60e3);
  skew += 31 * 60e3;
  assert.equal((await teen('POST', `/api/feedback/${f.id}/respond`, { reply: 'Will do!' })).status, 200);
  const sent = await mom('GET', '/api/sent');
  assert.equal(sent.data[0].audience, 'one');
  assert.equal(sent.data[0].recipients[0].reaction, 'thanks');
  assert.equal(sent.data[0].recipients[0].reply, 'Will do!');
  assert.equal(sent.data[0].recipients[0].read, true);

  // Others cannot touch someone else's feedback.
  assert.equal((await kid('POST', `/api/feedback/${f.id}/respond`, { reaction: 'talk' })).status, 404);
});

test('required fields and model access are enforced', async () => {
  const r = await mom('POST', '/api/feedback', { toId: ids.teen, model: 'dearman', fields: { describe: 'x' } });
  assert.equal(r.status, 400);
  assert.ok(r.data.errors.length >= 2);
  assert.equal((await kid('POST', '/api/feedback', { toId: ids.mom, model: 'dearman', fields: { describe: 'a' } })).status, 400, 'a kid’s grown-up style needs its fields too');
  assert.equal((await mom('POST', '/api/feedback', { toId: ids.mom, model: 'thanks', fields: { what: 'x' } })).status, 400);
});

test('anonymous feedback stores no sender and only the date, and is held 1 to 3 hours', async () => {
  const r = await kid('POST', '/api/feedback', {
    toId: ids.mom, model: 'kids', anonymous: true, fields: { feeling: 'left-out', happened: 'You were on your phone at dinner.' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.held, true);
  // Only the family's local calendar date is kept (noon UTC, shown in UTC), never the time.
  const d = new Date(Date.now() + skew);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Held, so it doesn't show up (or ping anyone) just as the sender puts their phone down.
  assert.equal((await mom('GET', '/api/inbox')).data.some((x) => x.anonymous), false, 'not shown yet');
  skew += 59 * 60e3;
  assert.equal((await mom('GET', '/api/inbox')).data.some((x) => x.anonymous), false, 'still held under an hour later');
  skew += 2 * 3600e3 + 2 * 60e3;
  const inbox = await mom('GET', '/api/inbox');
  const f = inbox.data.find((x) => x.anonymous);
  assert.equal(f.from, null);
  assert.equal(f.createdAt, `${today}T12:00:00.000Z`);
  assert.equal((await kid('GET', '/api/sent')).data.length, 0, 'anonymous feedback is not linked to the sender');
  assert.equal((await mom('POST', `/api/feedback/${f.id}/respond`, { reply: 'Who is this?' })).status, 400);
  assert.equal((await mom('POST', `/api/feedback/${f.id}/respond`, { reaction: 'got-it' })).status, 200);
});

test('hurtful words: blocked when anonymous or to kids, confirmable otherwise', async () => {
  const hurtful = { glow: 'Nice job', grow: 'Stop being stupid' };
  const anon = await teen('POST', '/api/feedback', { toId: ids.mom, model: 'glow-grow', anonymous: true, fields: hurtful });
  assert.equal(anon.status, 422);
  assert.equal(anon.data.canConfirm, undefined);
  const toKid = await teen('POST', '/api/feedback', { toId: ids.kid, model: 'glow-grow', fields: hurtful, confirmTone: true });
  assert.equal(toKid.status, 422);
  const named = await teen('POST', '/api/feedback', { toId: ids.mom, model: 'glow-grow', fields: hurtful });
  assert.equal(named.status, 422);
  assert.equal(named.data.canConfirm, true);
  assert.equal((await teen('POST', '/api/feedback', { toId: ids.mom, model: 'glow-grow', fields: hurtful, confirmTone: true })).status, 200);
});

test('parents can turn anonymous feedback off', async () => {
  assert.equal((await mom('PATCH', '/api/settings', { allowAnonymous: false })).status, 200);
  const r = await kid('POST', '/api/feedback', { toId: ids.mom, model: 'thanks', anonymous: true, fields: { what: 'Lunch' } });
  assert.equal(r.status, 400);
  await mom('PATCH', '/api/settings', { allowAnonymous: true });
});

test('self-service PIN change requires the current PIN for non-parents', async () => {
  assert.equal((await kid('PATCH', `/api/members/${ids.kid}`, { pin: '5555' })).status, 401);
  assert.equal((await kid('PATCH', `/api/members/${ids.kid}`, { pin: '5555', currentPin: '4321' })).status, 200);
});

test('audiences: one, some and everyone', async () => {
  const dad = await mom('POST', '/api/members', { name: 'Dad', emoji: '👨', role: 'adult', isParent: true });
  ids.dad = dad.data.id;
  const some = await teen('POST', '/api/feedback', { toIds: [ids.mom, ids.dad, ids.dad], model: 'thanks', fields: { what: 'Pancakes' } });
  assert.equal(some.data.audience, 'some');
  assert.equal(some.data.count, 2, 'duplicate recipients collapse');
  const item = (await mom('GET', '/api/inbox')).data.find((f) => f.fields.what === 'Pancakes');
  assert.equal(item.audience, 'some');
  assert.deepEqual(item.others.map((o) => o.name), ['Dad']);

  const all = await teen('POST', '/api/feedback', { to: 'everyone', model: 'glow-grow', fields: { glow: 'Great game night' } });
  assert.equal(all.data.audience, 'everyone');
  assert.equal(all.data.count, 3);
  const sent = (await teen('GET', '/api/sent')).data;
  assert.equal(sent.find((g) => g.audience === 'everyone').recipients.length, 3);
  assert.equal(sent.find((g) => g.audience === 'some').recipients.length, 2);
  assert.equal((await teen('POST', '/api/feedback', { toIds: [ids.mom, ids.teen], model: 'thanks', fields: { what: 'x' } })).status, 400);
  assert.equal((await teen('POST', '/api/feedback', { toIds: [], model: 'thanks', fields: { what: 'x' } })).status, 400);
});

test('anonymous group messages never list recipients; a kid in the audience blocks hurtful words', async () => {
  await teen('POST', '/api/feedback', { toIds: [ids.mom, ids.dad], anonymous: true, model: 'thanks', fields: { what: 'Secret thanks' } });
  skew += 3 * 3600e3 + 60e3; // past the hold
  const item = (await mom('GET', '/api/inbox')).data.find((f) => f.fields.what === 'Secret thanks');
  assert.equal(item.from, null);
  assert.equal(item.others, null);
  assert.equal(item.audience, 'some');
  const hurt = await mom('POST', '/api/feedback', { to: 'everyone', model: 'glow-grow', fields: { glow: 'ok', grow: 'shut up at dinner' }, confirmTone: true });
  assert.equal(hurt.status, 422);
  assert.equal(hurt.data.canConfirm, undefined);
});

test('invites sign in a new phone once; first sign-in needs the welcome', async () => {
  assert.equal((await kid('POST', '/api/invites', { memberId: ids.dad })).status, 403);
  const inv = await mom('POST', '/api/invites', { memberId: ids.dad });
  assert.equal(inv.status, 200);
  assert.match(inv.data.url, /#\/join\/[\w-]+$/);
  assert.match(inv.data.qr, /^data:image\/svg\+xml;base64,/);
  assert.equal(inv.data.reachable, false, 'loopback-only hub is flagged as unreachable for phones');
  const token = inv.data.url.split('/').pop();
  const phone = client();
  assert.equal((await phone('POST', '/api/join', { token })).status, 200);
  let st = (await phone('GET', '/api/state')).data;
  assert.equal(st.mode, 'hub');
  assert.equal(st.me.name, 'Dad');
  assert.equal(st.me.welcomed, false);
  await phone('POST', '/api/welcome', {});
  st = (await phone('GET', '/api/state')).data;
  assert.equal(st.me.welcomed, true);
  assert.equal((await client()('POST', '/api/join', { token })).status, 410, 'invites are single use');
  assert.equal((await mom('GET', '/api/backup')).status, 404, 'hub has no bulk export of everyone\u2019s messages');
});

test('family keeps at least one parent; removing members cleans up', async () => {
  assert.equal((await mom('DELETE', `/api/members/${ids.dad}`)).status, 200);
  assert.equal((await mom('PATCH', `/api/members/${ids.mom}`, { isParent: false })).status, 400);
  assert.equal((await mom('DELETE', `/api/members/${ids.mom}`)).status, 400);
  assert.equal((await mom('DELETE', `/api/members/${ids.teen}`)).status, 200);
  const inbox = await mom('GET', '/api/inbox');
  const fromTeen = inbox.data.find((f) => f.model === 'glow-grow');
  assert.equal(fromTeen.from.name, 'Former member');
  assert.equal((await teen('GET', '/api/inbox')).status, 401, 'removed member session ends');
});

test('logout ends the session', async () => {
  await kid('POST', '/api/logout', {});
  assert.equal((await kid('GET', '/api/inbox')).status, 401);
});

test('hub data persists to a JSON file across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-test-'));
  const dataPath = join(dir, 'family.json');
  const start = async () => {
    const s = createApp({ dataPath });
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    return s;
  };
  let s = await start();
  await fetch(`http://127.0.0.1:${s.address().port}/api/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Persisted', pin: '1234' }),
  });
  await new Promise((r) => s.close(r));
  s = await start();
  const st = await (await fetch(`http://127.0.0.1:${s.address().port}/api/state`)).json();
  assert.equal(st.members[0].name, 'Persisted');
  assert.equal(st.members[0].hasPin, true);
  assert.ok(!readFileSync(dataPath, 'utf8').includes('"1234"'), 'PIN is not stored in plain text');
  await new Promise((r) => s.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test('models and tone helpers', () => {
  const ids = MODELS.map((m) => m.id);
  assert.ok(ids.includes('dearman') && ids.includes('kids'));
  assert.equal(new Set(ids).size, ids.length);
  const forKid = modelsFor('kid');
  assert.deepEqual(forKid.map((m) => m.id).sort(), [...ids].sort(), 'kids get every style');
  assert.deepEqual(forKid.map((m) => m.audience), [...forKid.map((m) => m.audience)].sort((a, b) => ({ kid: 0, all: 1, adult: 2 })[a] - ({ kid: 0, all: 1, adult: 2 })[b]));
  // Worked examples (ghost text): at least two for kids and two for grown-ups, covering every text field.
  for (const m of MODELS) {
    const text = m.fields.filter((f) => f.type === 'text').map((f) => f.key).sort();
    for (const role of ['kid', 'adult']) {
      const first = exampleFor(m, role, 0);
      assert.ok(first.count >= 2, `${m.id}: ${role} examples`);
      for (let i = 0; i < first.count; i++) assert.deepEqual(Object.keys(exampleFor(m, role, i).fields).sort(), text, `${m.id} ${role} example ${i}`);
      assert.equal(exampleFor(m, role, first.count).index, 0, 'Show another wraps around');
    }
    assert.notDeepEqual(exampleFor(m, 'kid').fields, exampleFor(m, 'adult').fields, `${m.id}: kids get their own examples`);
    assert.equal(validateFields(m, {}).clean && Object.keys(validateFields(m, {}).clean).length, 0, 'examples are never filled in');
  }
  const nvc = MODELS.find((m) => m.id === 'nvc');
  assert.equal(validateFields(nvc, { observation: 'a', feeling: 'nope', need: 'b', request: 'c' }).ok, false);
  assert.deepEqual(checkTone('Thanks for helping'), []);
  assert.equal(checkTone('You never listen').at(0).level, 'hint');
  assert.ok(checkTone('you are so lazy').some((t) => /behavior/.test(t.tip)));
  assert.equal(checkTone('shut up').at(0).level, 'hurtful');
});

test('a sign-in from the tiles is for a shared computer unless the person keeps it', async () => {
  const who = (await mom('POST', '/api/members', { name: 'Laptop user', emoji: '🙂', role: 'adult' })).data.id;
  const login = async (keep) => {
    const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: who, keep }) });
    const cookie = res.headers.get('set-cookie');
    const state = await (await fetch(base + '/api/state', { headers: { cookie: cookie.split(';')[0] } })).json();
    return { cookie, state };
  };
  const shared = await login(undefined);
  assert.doesNotMatch(shared.cookie, /Max-Age/, 'ends with the browser');
  assert.equal(shared.state.sharedDevice, true, 'the app signs them out when it’s left alone');
  const kept = await login(true);
  assert.match(kept.cookie, /Max-Age=31536000/);
  assert.equal(kept.state.sharedDevice, false);
});

test('an invite to someone with a PIN needs their PIN, so nobody else (a parent included) can use it', async () => {
  const ana = (await mom('POST', '/api/members', { name: 'Ana', emoji: '🙂', role: 'adult', pin: '4826' })).data.id;
  const token = (await mom('POST', '/api/invites', { memberId: ana })).data.url.split('/').pop();
  const phone = client();
  const ask = await phone('POST', '/api/join', { token });
  assert.equal(ask.status, 401);
  assert.equal(ask.data.needPin, true);
  assert.equal((await phone('POST', '/api/join', { token, pin: '0000' })).status, 401, 'a wrong PIN doesn’t join');
  assert.equal((await phone('GET', '/api/inbox')).status, 401, 'not signed in');
  assert.equal((await phone('POST', '/api/join', { token, pin: '4826' })).status, 200);
  assert.equal((await phone('GET', '/api/inbox')).status, 200);
  assert.equal((await client()('POST', '/api/join', { token, pin: '4826' })).status, 410, 'used once');
});

test('the API answers only to an address or a local name, not a web domain pointed at the hub', async () => {
  const { request } = await import('node:http');
  const port = server.address().port;
  const ask = (host) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/api/state', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject).end();
  });
  assert.equal(await ask('evil.example.com'), 421, 'a public name (DNS rebinding) is refused');
  assert.equal(await ask('attacker.example.com:3000'), 421);
  for (const ok of [`127.0.0.1:${port}`, 'localhost', '192.168.1.20:3000', '[::1]:3000', 'family-pc', 'family-pc.local']) {
    assert.equal(await ask(ok), 200, ok);
  }
});

test('a kid can send every style, grown-up ones included', async () => {
  assert.equal((await kid('POST', '/api/login', { memberId: ids.kid, pin: '5555' })).status, 200);
  const r = await kid('POST', '/api/feedback', { toId: ids.mom, model: 'dearman', fields: {
    describe: 'You came into my room without knocking.', express: 'I felt embarrassed.', assert: 'Please knock first.',
  } });
  assert.equal(r.status, 200);
  const got = (await mom('GET', '/api/inbox')).data.find((f) => f.id === r.data.ids[0]);
  assert.deepEqual([got.model, got.from.name], ['dearman', 'Sam']);
});

test('one person on two devices: an invite for each, one inbox, and signing out of one leaves the other', async () => {
  const lee = (await mom('POST', '/api/members', { name: 'Lee', emoji: '🙂', role: 'adult' })).data.id;
  const phone = client();
  const laptop = client();
  for (const device of [phone, laptop]) {
    const token = (await mom('POST', '/api/invites', { memberId: lee })).data.url.split('/').pop();
    assert.equal((await device('POST', '/api/join', { token })).status, 200);
  }
  await phone('POST', '/api/welcome', {});
  assert.equal((await laptop('GET', '/api/state')).data.me.welcomed, true, 'welcomed once, on either device');

  await mom('POST', '/api/feedback', { toId: lee, model: 'glow-grow', fields: { glow: 'You fixed the gate.', grow: 'Please put the tools back.' } });
  const [onPhone] = (await phone('GET', '/api/inbox')).data;
  const [onLaptop] = (await laptop('GET', '/api/inbox')).data;
  assert.equal(onPhone.id, onLaptop.id, 'the same inbox on both');
  assert.equal((await phone('POST', `/api/feedback/${onPhone.id}/respond`, { reaction: 'thanks' })).status, 200);
  const [after] = (await laptop('GET', '/api/inbox')).data;
  assert.deepEqual([after.read, after.reaction], [true, 'thanks'], 'opened and thanked on the phone shows on the laptop');
  assert.equal((await laptop('GET', '/api/state')).data.me.unread, 0);

  assert.equal((await laptop('POST', '/api/feedback', { toId: ids.mom, model: 'glow-grow', fields: { glow: 'Dinner was great.', grow: 'Can we eat earlier?' } })).status, 200);
  assert.equal((await phone('GET', '/api/sent')).data[0].fields.glow, 'Dinner was great.', 'sent from the laptop, listed on the phone');

  await laptop('POST', '/api/logout', {});
  assert.equal((await laptop('GET', '/api/inbox')).status, 401);
  assert.equal((await phone('GET', '/api/inbox')).status, 200, 'still signed in on the phone');
});
