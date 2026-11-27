// Phone-to-phone sync without WebRTC: the home-base host and the linked-phone client are wired
// together with plain function calls, so every rule is checked quickly in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../public/shared/core.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';
import { createPeerHost, hashKey } from '../public/shared/peer-host.js';
import { createPeerClient } from '../public/shared/peer-client.js';
import { decodeSignal, encodeSignal } from '../public/shared/signal.js';
import { hello } from '../public/peer-link.js';

const pins = { hash: async (p) => `test$${p}`, verify: async (p, s) => s === `test$${p}` };
const kidNote = (happened) => ({ model: 'kids', fields: { feeling: 'happy', happened } });

async function homeBase(now = () => new Date()) {
  const store = createDocStore(emptyDoc());
  const core = createCore({ store, pins, mode: 'device', now });
  let meId = null;
  const ctx = () => ({ me: store.getMember(meId), signIn: (id) => { meId = id; }, signOut: () => { meId = null; } });
  const call = (method, path, body) => core.handle(method, path, body, ctx());
  const mom = (await call('POST', '/api/setup', { familyName: 'Garcias', name: 'Mom' })).me;
  const sam = await call('POST', '/api/members', { name: 'Sam', role: 'kid' });
  const dad = await call('POST', '/api/members', { name: 'Dad', role: 'adult' });
  const host = createPeerHost({ core, store });
  return { store, core, call, host, mom, sam, dad, as: (id) => { meId = id; } };
}

// A connection object like peer-link's rpcClient, backed by a host session.
function connect(session) {
  return {
    async request(method, path, body, op) {
      const r = await session.handle({ t: 'req', id: 1, method, path, body, op });
      if (r.ok) return structuredClone(r.data);
      throw Object.assign(new Error(r.error), { status: r.status, data: { error: r.error, ...r.extra } });
    },
  };
}

function memoryStorage() {
  let saved = null;
  return { load: async () => structuredClone(saved), save: async (rec) => { saved = structuredClone(rec); }, peek: () => saved };
}

async function linkPhone(hb, member, storage = memoryStorage(), { now } = {}) {
  const session = hb.host.session({ mode: 'link', memberId: member.id, by: hb.mom.id });
  const ready = await session.handle({ t: 'hello', key: null, accept: true });
  assert.equal(ready.t, 'ready');
  const client = await createPeerClient({ storage, ...(now && { now }) });
  await client.connected(connect(session), ready);
  return { client, storage, key: ready.key };
}

async function sync(hb, phone) {
  const session = hb.host.session({ mode: 'sync' });
  const ready = await session.handle({ t: 'hello', key: phone.client.link.key, accept: true });
  if (ready.t !== 'ready') return ready;
  return phone.client.connected(connect(session), ready);
}

test('linking stores only a hash of a 256-bit key, and only parents can start it', async () => {
  const hb = await homeBase();
  assert.throws(() => hb.host.session({ mode: 'link', memberId: hb.sam.id, by: hb.dad.id }), { status: 403 });
  const { key } = await linkPhone(hb, hb.sam);
  assert.ok(key.length >= 43);
  const peers = hb.store.raw().hub.peers;
  assert.deepEqual(Object.keys(peers), [await hashKey(key)]);
  assert.equal(peers[await hashKey(key)].memberId, hb.sam.id);
  assert.ok(!JSON.stringify(hb.store.raw()).includes(key), 'the key itself is never stored');
  hb.as(hb.mom.id);
  const backup = await hb.call('GET', '/api/backup');
  assert.equal(backup.doc.hub, undefined, 'linked phones are not in backups');
  const st = await hb.call('GET', '/api/state');
  assert.equal(st.members.find((m) => m.id === hb.sam.id).linkedPhones, 1);
});

test('a sync session needs a valid key; one hello per connection', async () => {
  const hb = await homeBase();
  const s = hb.host.session({ mode: 'sync' });
  assert.equal((await s.handle({ t: 'hello', key: 'x'.repeat(43) })).t, 'denied');
  assert.equal((await s.handle({ t: 'hello', key: 'y'.repeat(43) })).error, 'Already connected.');
  const before = await hb.host.session({ mode: 'sync' }).handle({ t: 'req', id: 5, method: 'GET', path: '/api/inbox' });
  assert.deepEqual([before.ok, before.status], [false, 401]);
});

test('a linked phone acts only as its person and cannot sign in, set up or back up', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  const session = hb.host.session({ mode: 'sync' });
  await session.handle({ t: 'hello', key: phone.key });
  const ask = (method, path, body) => session.handle({ t: 'req', id: 9, method, path, body });
  for (const [m, p] of [['POST', '/api/login'], ['POST', '/api/logout'], ['POST', '/api/setup'], ['GET', '/api/backup'], ['POST', '/api/restore']]) {
    assert.equal((await ask(m, p, { memberId: hb.mom.id })).status, 403, `${m} ${p}`);
  }
  assert.equal((await ask('GET', '/api/state')).data.me.id, hb.sam.id);
  assert.equal((await ask('POST', '/api/members', { name: 'Eve', role: 'adult' })).status, 403, 'a kid is still not a parent');
  hb.as(hb.dad.id);
  await hb.call('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Dinner') });
  assert.deepEqual((await ask('GET', '/api/inbox')).data, [], "Sam can't see Mom's inbox");
});

test('removed members, unlinked phones and ended guests are refused', async () => {
  const hb = await homeBase();
  const sam = await linkPhone(hb, hb.sam);
  const dad = await linkPhone(hb, hb.dad);
  hb.as(hb.mom.id);
  await hb.call('DELETE', `/api/members/${hb.dad.id}/phones`);
  assert.equal((await sync(hb, dad)).status, 401);
  assert.equal(Object.keys(hb.store.raw().hub.peers).length, 1);

  await hb.call('PATCH', `/api/members/${hb.sam.id}`, { guest: true, guestUntil: '2000-01-01' });
  assert.equal((await sync(hb, sam)).status, 403);
  await hb.call('DELETE', `/api/members/${hb.sam.id}`);
  assert.equal((await sync(hb, sam)).status, 401);
  assert.equal(Object.keys(hb.store.raw().hub.peers).length, 0, 'removing a member forgets their phones');
});

test('apart: the phone reads its copy, queues changes, and checks messages like the home base', async () => {
  const hb = await homeBase();
  hb.as(hb.mom.id);
  await hb.call('POST', '/api/feedback', { toIds: [hb.sam.id], ...kidNote('You tidied up') });
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  const { client } = phone;

  const st = await client.api('GET', '/api/state');
  assert.equal(st.mode, 'peer');
  assert.equal(st.me.id, hb.sam.id);
  assert.equal(st.me.unread, 1);
  const [item] = await client.api('GET', '/api/inbox');
  await client.api('POST', `/api/feedback/${item.id}/respond`, { reaction: 'thanks' });
  assert.equal((await client.api('GET', '/api/state')).me.unread, 0);

  await assert.rejects(client.api('POST', '/api/feedback', { toIds: [hb.sam.id], ...kidNote('Me') }), { status: 400 });
  await assert.rejects(client.api('POST', '/api/feedback', { toIds: [hb.mom.id], model: 'kids', fields: { feeling: 'happy', happened: 'you are stupid' } }), { status: 422 });
  await assert.rejects(client.api('PATCH', '/api/settings', { familyName: 'X' }), { status: 409 });
  const res = await client.api('POST', '/api/feedback', { toIds: [hb.mom.id, hb.dad.id], ...kidNote('Thanks for the park') });
  assert.deepEqual([res.queued, res.audience, res.count], [true, 'some', 2]);
  const [pending] = await client.api('GET', '/api/sent');
  assert.equal(pending.pending, true);
  assert.deepEqual(pending.recipients.map((r) => r.name), ['Mom', 'Dad']);
  // Three changes: when the message was opened (so the break counts from then), the reaction, the message.
  assert.equal(client.status().pending, 3);

  // Nothing reached the home base yet.
  hb.as(hb.mom.id);
  assert.equal((await hb.call('GET', '/api/inbox')).length, 0);
  assert.equal((await hb.call('GET', '/api/sent'))[0].recipients[0].reaction, null);

  const result = await sync(hb, phone);
  assert.deepEqual([result.sent, result.failed.length], [3, 0]);
  assert.equal((await hb.call('GET', '/api/inbox'))[0].fields.happened, 'Thanks for the park');
  assert.equal((await hb.call('GET', '/api/sent'))[0].recipients[0].reaction, 'thanks');
  assert.equal(client.status().pending, 0);
  assert.equal((await client.api('GET', '/api/sent'))[0].pending, undefined);
});

test('a queued message the home base refuses is kept with its reason; order is kept', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.dad.id], ...kidNote('First') });
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Second') });
  hb.as(hb.mom.id);
  await hb.call('DELETE', `/api/members/${hb.dad.id}`); // Dad left before the phone synced

  const result = await sync(hb, phone);
  assert.deepEqual([result.sent, result.failed.length], [1, 1]);
  const sent = await phone.client.api('GET', '/api/sent');
  assert.equal(sent[0].failed, true);
  assert.match(sent[0].error, /Choose who/);
  assert.equal(sent[1].fields.happened, 'Second');
  await phone.client.discardFailed(sent[0].groupId);
  assert.equal((await phone.client.api('GET', '/api/sent')).length, 1);
});

test('a dropped connection keeps the rest of the queue for next time', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('One') });
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Two') });
  const session = hb.host.session({ mode: 'sync' });
  const ready = await session.handle({ t: 'hello', key: phone.key });
  let calls = 0;
  const flaky = {
    async request(m, p, b) {
      if (++calls >= 2) throw new Error('connection closed'); // dropped for good after the first send
      return connect(session).request(m, p, b);
    },
  };
  await assert.rejects(phone.client.connected(flaky, ready));
  assert.equal(phone.client.status().pending, 1);
  assert.equal((await sync(hb, phone)).sent, 1);
  hb.as(hb.mom.id);
  assert.deepEqual((await hb.call('GET', '/api/inbox')).map((f) => f.fields.happened).sort(), ['One', 'Two']);
});

test('the phone remembers its link and queue across restarts', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Saved') });
  const reopened = await createPeerClient({ storage: phone.storage });
  assert.equal(reopened.status().pending, 1);
  assert.equal(reopened.link.member.id, hb.sam.id);
  assert.equal((await sync(hb, { client: reopened })).sent, 1);
  await reopened.forget();
  assert.equal(phone.storage.peek().link, null);
});

test('sync codes survive a round trip and reject the wrong kind', async () => {
  const sdp = `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n${'a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host\r\n'.repeat(3)}`;
  const code = await encodeSignal('offer', sdp);
  assert.match(code, /^FF1\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < sdp.length, 'compressed');
  assert.equal(await decodeSignal(code, 'offer'), sdp);
  await assert.rejects(decodeSignal(code, 'answer'), /reply code/);
  await assert.rejects(decodeSignal('https://example.com', 'offer'), /isn’t an Echoes sync code/);
  await assert.rejects(decodeSignal(`${code.slice(0, -6)}`, 'offer'), /didn’t come through whole/);
});

// ---------- fixes from the code review ----------

test('linking the same person again keeps the queue; someone else starts fresh and the old link goes', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Kept') });
  hb.as(hb.mom.id);
  await hb.call('DELETE', `/api/members/${hb.sam.id}/phones`);
  assert.equal((await sync(hb, phone)).status, 401);

  const again = hb.host.session({ mode: 'link', memberId: hb.sam.id, by: hb.mom.id });
  const r1 = await phone.client.connected(connect(again), await again.handle({ t: 'hello', key: phone.client.link.key, accept: true }));
  assert.deepEqual([r1.sent, r1.dropped], [1, 0]);
  assert.equal((await hb.call('GET', '/api/inbox'))[0].fields.happened, 'Kept');

  phone.client.disconnected();
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Sam only') });
  const toDad = hb.host.session({ mode: 'link', memberId: hb.dad.id, by: hb.mom.id });
  const r2 = await phone.client.connected(connect(toDad), await toDad.handle({ t: 'hello', key: phone.client.link.key, accept: true }));
  assert.deepEqual([r2.sent, r2.dropped], [0, 1], "Sam's queued message is not sent as Dad");
  assert.equal(phone.client.link.member.id, hb.dad.id);
  const peers = Object.values(hb.store.raw().hub.peers);
  assert.deepEqual(peers.map((p) => p.memberId), [hb.dad.id], 'the replaced link is removed, not left on Sam');
});

test('anonymous messages from a synced phone are held back 1 to 6 hours', async () => {
  let t = new Date('2026-11-25T10:00:00Z').getTime();
  const hb = await homeBase(() => new Date(t));
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], anonymous: true, ...kidNote('Guess who') });
  await sync(hb, phone);
  hb.as(hb.mom.id);
  assert.equal((await hb.call('GET', '/api/inbox')).length, 0, 'not shown right after the sync');
  assert.equal((await hb.call('GET', '/api/state')).me.unread, 0);
  const row = hb.store.raw().feedback[0];
  const wait = new Date(row.visibleAfter).getTime() - t;
  assert.ok(wait >= 3600e3 && wait <= 6 * 3600e3, `held ${wait / 3600e3} h`);
  await assert.rejects(hb.call('POST', `/api/feedback/${row.id}/read`), { status: 404 });
  t += 6 * 3600e3 + 1;
  assert.equal((await hb.call('GET', '/api/inbox'))[0].fields.happened, 'Guess who');
  // Named messages, and anonymous ones written on the home base itself, are not held back.
  hb.as(hb.dad.id);
  await hb.call('POST', '/api/feedback', { toIds: [hb.mom.id], anonymous: true, ...kidNote('Right away') });
  hb.as(hb.mom.id);
  assert.equal((await hb.call('GET', '/api/inbox')).length, 2);
});

test('a refused reaction is dropped, not stuck; only refused messages are kept', async () => {
  const hb = await homeBase();
  hb.as(hb.mom.id);
  await hb.call('POST', '/api/feedback', { toIds: [hb.sam.id], ...kidNote('Hi') });
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  const [item] = await phone.client.api('GET', '/api/inbox');
  await phone.client.api('POST', `/api/feedback/${item.id}/respond`, { reaction: 'thanks' });
  hb.as(hb.sam.id);
  await hb.call('DELETE', `/api/feedback/${item.id}`); // removed on the home base meanwhile
  const result = await sync(hb, phone);
  assert.deepEqual([result.sent, result.failed.length], [0, 0]);
  assert.deepEqual([phone.client.status().pending, phone.client.status().failed], [0, 0]);
  assert.equal((await phone.client.api('GET', '/api/inbox')).length, 0);
});

test('a link that closes mid-sync gives a message a person can act on', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  const session = hb.host.session({ mode: 'sync' });
  const ready = await session.handle({ t: 'hello', key: phone.key });
  const dropping = {
    async request(m, p, b) {
      phone.client.disconnected(); // the link closes while the first request is under way
      throw new Error('closed');
    },
  };
  await assert.rejects(phone.client.connected(dropping, ready), /closed before the sync finished/);
});

test('a peer cannot stall the home base with bad message parts', async () => {
  const { wrap } = await import('../public/peer-link.js');
  const fake = () => {
    const dc = new EventTarget();
    const pc = new EventTarget();
    let closed = false;
    dc.close = () => { closed = true; };
    pc.close = () => { closed = true; };
    const got = [];
    const link = wrap(dc, pc);
    link.onMessage((m) => got.push(m));
    const send = (obj) => dc.dispatchEvent(new MessageEvent('message', { data: typeof obj === 'string' ? obj : JSON.stringify(obj) }));
    return { send, got, isClosed: () => closed };
  };

  const ok = fake();
  const text = JSON.stringify({ t: 'res', id: 1, ok: true, data: 'x'.repeat(40_000) });
  const n = Math.ceil(text.length / 15_000);
  for (let i = n - 1; i >= 0; i--) ok.send({ t: 'part', id: 7, i, n, d: text.slice(i * 15_000, (i + 1) * 15_000) });
  assert.equal(ok.got[0].data.length, 40_000, 'parts in any order are put back together');
  assert.equal(ok.isClosed(), false);

  const started = Date.now();
  for (const bad of [
    { t: 'part', id: 1, i: 4294967294, n: 1, d: 'x' },
    { t: 'part', id: 1, i: 0, n: 1e9, d: 'x' },
    { t: 'part', id: 1, i: -1, n: 2, d: 'x' },
    { t: 'part', id: 1, i: 0, n: 2, d: 5 },
    'not json',
  ]) {
    const f = fake();
    f.send(bad);
    assert.equal(f.isClosed(), true, `hangs up on ${JSON.stringify(bad)}`);
  }
  const many = fake();
  for (let id = 1; id <= 5; id++) many.send({ t: 'part', id, i: 0, n: 2, d: 'x' });
  assert.equal(many.isClosed(), true, 'too many half-sent messages ends the link');
  assert.ok(Date.now() - started < 1000, 'and it is quick');
});

// ---------- fixes from the second rubber-duck review ----------

test('a change whose reply was lost is not applied twice when sent again', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  const session = hb.host.session({ mode: 'sync' });
  const ready = await session.handle({ t: 'hello', key: phone.key });
  // The home base stores the message, but the reply never reaches the phone.
  const lossy = {
    async request(m, p, b, op) {
      const r = await session.handle({ t: 'req', id: 1, method: m, path: p, body: b, op });
      if (m === 'POST') { phone.client.disconnected(); throw new Error('connection closed'); }
      return structuredClone(r.data);
    },
  };
  await phone.client.connected(lossy, ready);
  const res = await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Only once') });
  assert.equal(res.queued, true, 'the phone thinks it still has to send it');
  hb.as(hb.mom.id);
  assert.equal((await hb.call('GET', '/api/inbox')).length, 1);
  const result = await sync(hb, phone);
  assert.equal(result.sent, 1);
  assert.equal((await hb.call('GET', '/api/inbox')).length, 1, 'the retry was recognised, not stored again');
  const ops = hb.store.raw().hub.ops;
  assert.equal(Object.keys(ops).length, 1);
  assert.deepEqual(Object.values(ops), [1], 'only the random id is kept: no person, time or result');
});

test('sync codes are size-limited and must be a data-channel description', async () => {
  // A code short enough to pass the length check that would inflate to 2.5 MB.
  const huge = JSON.stringify({ k: 'o', s: `v=0\r\nm=application ${'x'.repeat(2.5 * 1024 * 1024)}` });
  const deflated = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(huge)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let s = '';
  for (const b of deflated) s += String.fromCharCode(b);
  const bomb = `FF1.${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  assert.ok(bomb.length < 4000, `bomb is only ${bomb.length} chars`);
  const started = Date.now();
  await assert.rejects(decodeSignal(bomb, 'offer'), /didn’t come through whole/);
  assert.ok(Date.now() - started < 2000, 'and gives up quickly');
  await assert.rejects(decodeSignal(`FF1.${'A'.repeat(5000)}`, 'offer'), /too long/);
  const audio = await encodeSignal('offer', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n');
  await assert.rejects(decodeSignal(audio, 'offer'), /isn’t an Echoes sync code/);
});

test('connection details count each kind of network address', async () => {
  const { candidateSummary } = await import('../public/peer-link.js');
  const sdp = [
    'a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0',
    'a=candidate:2 1 udp 2122260223 4d1a2b3c-1111-2222-3333-444455556666.local 54322 typ host',
    'a=candidate:3 1 udp 1686052607 203.0.113.9 6000 typ srflx raddr 192.168.1.20 rport 54321',
    'a=candidate:4 1 udp 41885439 198.51.100.2 3478 typ relay',
  ].join('\r\n');
  assert.deepEqual(candidateSummary(sdp), { lan: 1, mdns: 1, public: 1, relay: 1, total: 4 });
  assert.equal(candidateSummary('v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n').total, 0);
});

// ---------- fixes from the second play-test ----------

test('a phone the home base refused, or whose guest pass ended, stops queuing and says why', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  phone.client.disconnected();
  await phone.client.refused('This phone isn’t linked to this family any more. Ask a parent to link it again.');
  assert.match(phone.client.status().blocked, /isn’t linked/);
  await assert.rejects(phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Hi') }), /isn’t linked/);
  assert.equal((await phone.client.api('GET', '/api/inbox')).length, 0, 'reading still works');
  // Linking again clears it.
  const again = hb.host.session({ mode: 'link', memberId: hb.sam.id, by: hb.mom.id });
  await phone.client.connected(connect(again), await again.handle({ t: 'hello', key: phone.client.link.key, accept: true }));
  assert.equal(phone.client.status().blocked, null);

  // A guest whose end date has passed is stopped on the phone too, before any sync.
  hb.as(hb.mom.id);
  await hb.call('PATCH', `/api/members/${hb.dad.id}`, { guest: true, guestUntil: '2099-01-01', isParent: false });
  const nana = await linkPhone(hb, hb.dad);
  nana.client.disconnected();
  assert.equal(nana.client.status().blocked, null);
  const later = await createPeerClient({ storage: nana.storage, now: () => new Date('2099-01-02T10:00:00') });
  assert.match(later.status().blocked, /guest pass has ended/);
  await assert.rejects(later.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('Hi') }), /guest pass/);
});

test('linking asks the phone to confirm whose phone it becomes before making a key', async () => {
  const hb = await homeBase();
  const session = hb.host.session({ mode: 'link', memberId: hb.ava?.id ?? hb.dad.id, by: hb.mom.id });
  const first = await session.handle({ t: 'hello', key: null });
  assert.equal(first.t, 'confirm');
  assert.equal(first.member.name, 'Dad');
  assert.equal(first.key, undefined);
  assert.equal(Object.keys(hb.store.raw().hub.peers).length, 0, 'nothing is linked until the phone accepts');
  assert.equal((await session.handle({ t: 'req', id: 1, method: 'GET', path: '/api/inbox' })).status, 401, 'no access before accepting');
  const ready = await session.handle({ t: 'hello', key: null, accept: true });
  assert.equal(ready.t, 'ready');
  assert.equal(Object.keys(hb.store.raw().hub.peers).length, 1);
});

// A data-channel stand-in that hands every message the phone sends to a host session (or a fake).
function linkTo(handle) {
  const listeners = new Set();
  const sent = [];
  return {
    sent,
    send(msg) {
      sent.push(structuredClone(msg));
      Promise.resolve(handle(msg)).then((reply) => { if (reply) for (const fn of listeners) fn(structuredClone(reply)); });
    },
    onMessage: (fn) => listeners.add(fn),
    onClose: () => {},
    closed: false,
  };
}

test('a linked phone gives its key only to a home base that proves it knows the link', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  const key = phone.client.link.key;

  // The real home base answers the challenge, so the phone sends its key and syncs.
  const session = hb.host.session({ mode: 'sync' });
  const realLink = linkTo((m) => session.handle(m));
  const ready = await hello(realLink, key);
  assert.equal(ready.t, 'ready');
  assert.equal(realLink.sent[0].t, 'challenge');
  assert.ok(!JSON.stringify(realLink.sent[0]).includes(key), 'the challenge doesn’t carry the key');
  assert.equal(realLink.sent[1].key, key, 'sent once the home base proved itself');

  // A look-alike "home base" (a modified copy of the app) can't prove it, so it never sees the key.
  const fake = linkTo((m) => (m.t === 'challenge' ? { t: 'proof', proof: 'made-up' } : { t: 'ready', key: null, member: { id: 1, name: 'x' }, family: {}, familyId: 'ATTACKERFAMILY00' }));
  const fakeReady = await hello(fake, key);
  assert.ok(!JSON.stringify(fake.sent).includes(key), 'the key never leaves the phone');
  await assert.rejects(phone.client.connected(connect({ handle: async () => ({ ok: true, data: [] }) }), fakeReady), { status: 409 }, 'nor does its queue, to another family');

  // Another family's real home base doesn't know the link either.
  const other = await homeBase();
  const otherSession = other.host.session({ mode: 'sync' });
  const otherLink = linkTo((m) => otherSession.handle(m));
  await assert.rejects(hello(otherLink, key), { status: 401 });
  assert.ok(!JSON.stringify(otherLink.sent).includes(key));
});

test('linking a phone to someone with a PIN needs their PIN', async () => {
  const hb = await homeBase();
  hb.as(hb.mom.id);
  await hb.call('PATCH', `/api/members/${hb.dad.id}`, { pin: '8642' });
  const without = hb.host.session({ mode: 'link', memberId: hb.dad.id, by: hb.mom.id });
  const refused = await without.handle({ t: 'hello', key: null, accept: true });
  assert.equal(refused.t, 'denied');
  assert.equal(refused.status, 401);
  assert.deepEqual(Object.keys(hb.store.raw().hub.peers), [], 'nothing linked');
  await assert.rejects(hb.call('POST', `/api/members/${hb.dad.id}/verify-pin`, { pin: '0000' }), { status: 401 });
  assert.deepEqual(await hb.call('POST', `/api/members/${hb.dad.id}/verify-pin`, { pin: '8642' }), { ok: true });
  const withPin = hb.host.session({ mode: 'link', memberId: hb.dad.id, by: hb.mom.id, pin: '8642' });
  assert.equal((await withPin.handle({ t: 'hello', key: null, accept: true })).t, 'ready');
});

test('on a home base, an anonymous message’s hold time is dropped once it shows', async () => {
  let t = Date.now();
  const hb = await homeBase(() => new Date(t));
  const phone = await linkPhone(hb, hb.sam);
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], anonymous: true, ...kidNote('A secret thank you') });
  await sync(hb, phone);
  const held = () => hb.store.raw().feedback.filter((f) => f.visibleAfter).length;
  assert.equal(held(), 1, 'held 1 to 6 hours after a sync');
  hb.as(hb.mom.id);
  t += 7 * 3600e3;
  assert.equal((await hb.call('GET', '/api/inbox')).length, 1);
  assert.equal(held(), 0, 'its time is gone once it shows (and so isn’t in backups)');
  assert.equal(JSON.stringify((await hb.call('GET', '/api/backup')).doc).includes('visibleAfter'), false);
});

test('questions on a linked phone: seen apart, answered or put aside apart, asked apart, all sent at the sync', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  hb.as(hb.mom.id);
  const q1 = await hb.call('POST', '/api/asks', { toIds: [hb.sam.id, hb.dad.id], what: 'I made dinner on my own.', help: 'well', model: 'glow-grow' });
  const q2 = await hb.call('POST', '/api/asks', { toIds: [hb.sam.id], what: 'I fixed the swing.', help: 'both', model: 'thanks' });
  await sync(hb, phone);
  phone.client.disconnected();

  // Apart: the phone shows both, answers one, puts the other aside, and asks Mom something.
  const apart = await phone.client.api('GET', '/api/asks');
  assert.deepEqual(apart.forMe.map((a) => [a.what, a.model]), [['I fixed the swing.', 'thanks'], ['I made dinner on my own.', 'glow-grow']]);
  assert.equal((await phone.client.api('GET', '/api/state')).me.asks, 2);
  await assert.rejects(phone.client.api('POST', '/api/feedback', { toIds: [hb.dad.id], askId: q1.id, ...kidNote('Yum') }), /person who asked/);
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], askId: q1.id, ...kidNote('Dinner was yummy!') });
  await phone.client.api('POST', `/api/asks/${q2.id}/dismiss`);
  await assert.rejects(phone.client.api('POST', `/api/asks/${q2.id}/dismiss`), /isn’t open/);
  const mine = await phone.client.api('POST', '/api/asks', { toIds: [hb.mom.id], what: 'I tidied my room.', help: 'well', model: 'kids' });
  assert.equal(mine.queued, true);
  const later = await phone.client.api('GET', '/api/asks');
  assert.deepEqual([later.forMe.length, later.mine[0].pending, later.mine[0].what], [0, true, 'I tidied my room.']);
  assert.equal((await phone.client.api('GET', '/api/state')).me.asks, 0);

  // At the sync the home base applies all three.
  const r = await sync(hb, phone);
  assert.equal(r.failed.length, 0);
  hb.as(hb.mom.id);
  const answer = (await hb.call('GET', '/api/inbox')).find((f) => f.askWhat === 'I made dinner on my own.');
  assert.equal(answer.from.name, 'Sam');
  const momAsks = await hb.call('GET', '/api/asks');
  assert.deepEqual(momAsks.forMe.map((a) => [a.from.name, a.what]), [['Sam', 'I tidied my room.']]);
  assert.deepEqual(momAsks.mine.map((a) => [a.what, a.answered]), [['I fixed the swing.', 0], ['I made dinner on my own.', 1]]);
  hb.as(hb.sam.id);
  assert.deepEqual((await hb.call('GET', '/api/asks')).forMe, [], 'answered and put aside on the home base too');
  phone.client.disconnected();
  assert.deepEqual((await phone.client.api('GET', '/api/asks')).mine.map((a) => [a.what, !!a.pending]), [['I tidied my room.', false]]);
});

test('an anonymous question on a linked phone apart: only anonymous answers, in the one style', async () => {
  const hb = await homeBase();
  hb.as(hb.mom.id);
  const leo = await hb.call('POST', '/api/members', { name: 'Leo', role: 'adult' });
  const phone = await linkPhone(hb, hb.sam);
  hb.as(hb.mom.id);
  const q = await hb.call('POST', '/api/asks', { toIds: [hb.sam.id, hb.dad.id, leo.id], what: 'I planned the trip.', help: 'both', model: 'glow-grow', anonymous: true });
  await sync(hb, phone);
  phone.client.disconnected();
  const [mine] = (await phone.client.api('GET', '/api/asks')).forMe;
  assert.deepEqual([mine.anonymous, mine.model], [true, 'glow-grow']);
  const glow = { model: 'glow-grow', fields: { glow: 'Fun trip' } };
  await assert.rejects(phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], askId: q.id, ...glow }), /without names/);
  await assert.rejects(phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], askId: q.id, anonymous: true, ...kidNote('Fun trip') }), /with Glow & Grow/);
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], askId: q.id, anonymous: true, ...glow });
  const r = await sync(hb, phone);
  assert.equal(r.failed.length, 0);
  hb.as(hb.mom.id);
  assert.deepEqual((await hb.call('GET', '/api/asks')).mine.map((a) => a.answeredBy), [null]);
});

// ---------- one person, two devices (a phone and an iPad, say) ----------

test('one person can link two devices: both stay linked, both get the inbox, and each sees what the other did', async () => {
  const hb = await homeBase();
  const phone = await linkPhone(hb, hb.sam);
  const ipad = await linkPhone(hb, hb.sam);
  assert.notEqual(phone.key, ipad.key, 'each device has its own key');
  assert.deepEqual(Object.values(hb.store.raw().hub.peers).map((p) => p.memberId), [hb.sam.id, hb.sam.id], 'linking the iPad kept the phone');
  hb.as(hb.mom.id);
  assert.equal((await hb.call('GET', '/api/state')).members.find((m) => m.id === hb.sam.id).linkedPhones, 2);

  await hb.call('POST', '/api/feedback', { toIds: [hb.sam.id], ...kidNote('You fed the cat') });
  await sync(hb, phone);
  await sync(hb, ipad);
  phone.client.disconnected();
  ipad.client.disconnected();
  for (const d of [phone, ipad]) assert.deepEqual((await d.client.api('GET', '/api/inbox')).map((x) => x.fields.happened), ['You fed the cat']);

  // Apart: the phone opens the message and sends Mom one. The iPad doesn't know yet.
  const [item] = await phone.client.api('GET', '/api/inbox');
  await phone.client.api('POST', `/api/feedback/${item.id}/read`);
  await phone.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], ...kidNote('From my phone') });
  assert.equal((await ipad.client.api('GET', '/api/state')).me.unread, 1);
  assert.deepEqual(await ipad.client.api('GET', '/api/sent'), []);

  // The phone syncs, then the iPad: it learns both.
  assert.deepEqual([(await sync(hb, phone)).sent, (await sync(hb, ipad)).sent], [2, 0]);
  ipad.client.disconnected();
  assert.equal((await ipad.client.api('GET', '/api/state')).me.unread, 0, 'read on the phone, read on the iPad');
  assert.deepEqual((await ipad.client.api('GET', '/api/sent')).map((g) => g.fields.happened), ['From my phone']);

  // Linking the phone again (same device, its own key) leaves the iPad linked.
  const again = hb.host.session({ mode: 'link', memberId: hb.sam.id, by: hb.mom.id });
  await phone.client.connected(connect(again), await again.handle({ t: 'hello', key: phone.client.link.key, accept: true }));
  assert.equal(Object.keys(hb.store.raw().hub.peers).length, 2);
  assert.equal((await sync(hb, ipad)).status, undefined, 'the iPad still syncs');

  // Unlink removes both.
  hb.as(hb.mom.id);
  await hb.call('DELETE', `/api/members/${hb.sam.id}/phones`);
  assert.deepEqual([(await sync(hb, phone)).status, (await sync(hb, ipad)).status], [401, 401]);
});

test('two devices change the same thing apart: first open counts, last reaction and reply win, a question is answered once, one plan per message', async () => {
  let t = new Date('2026-11-25T10:00:00Z').getTime();
  const hb = await homeBase(() => new Date(t));
  hb.as(hb.mom.id);
  await hb.call('POST', '/api/feedback', { toIds: [hb.sam.id], ...kidNote('You shared your toys') });
  const q = await hb.call('POST', '/api/asks', { toIds: [hb.sam.id], what: 'I made pancakes.', help: 'well', model: 'kids' });
  const clock = { now: () => new Date(t) };
  const phone = await linkPhone(hb, hb.sam, undefined, clock);
  const ipad = await linkPhone(hb, hb.sam, undefined, clock);
  await sync(hb, phone);
  phone.client.disconnected();
  ipad.client.disconnected();
  const [item] = await phone.client.api('GET', '/api/inbox');

  t += 60e3;
  const phoneOpened = new Date(t).toISOString();
  await phone.client.api('POST', `/api/feedback/${item.id}/read`);
  t += 5 * 60e3;
  await ipad.client.api('POST', `/api/feedback/${item.id}/read`);
  t += 40 * 60e3; // past the break on both
  await phone.client.api('POST', `/api/feedback/${item.id}/respond`, { reaction: 'thanks', reply: 'From the phone' });
  await ipad.client.api('POST', `/api/feedback/${item.id}/respond`, { reaction: 'got-it', reply: 'From the iPad' });
  for (const d of [phone, ipad]) {
    await d.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], askId: q.id, ...kidNote(d === phone ? 'Yummy (phone)' : 'Yummy (iPad)') });
  }
  const plan = { feedbackId: item.id, promiseId: 'calm-voice', when: 'feel cross', then: 'take three big breaths', days: 14, helperId: hb.dad.id };
  await phone.client.api('POST', '/api/plans', plan);
  await ipad.client.api('POST', '/api/plans', plan);

  const r1 = await sync(hb, phone);
  assert.equal(r1.failed.length, 0);
  const r2 = await sync(hb, ipad);
  assert.deepEqual(r2.failed.map((i) => i.path).sort(), ['/api/feedback', '/api/plans'], 'the iPad’s second answer and second plan are not applied');

  const f = hb.store.raw().feedback.find((x) => x.id === item.id);
  assert.equal(f.readAt, phoneOpened, 'the first time it was opened counts, so the break counts from then');
  assert.deepEqual([f.reaction, f.reply], ['got-it', 'From the iPad'], 'the last reaction and reply win, as when editing on one device');
  hb.as(hb.mom.id);
  assert.deepEqual((await hb.call('GET', '/api/inbox')).filter((x) => x.askWhat === 'I made pancakes.').map((x) => x.fields.happened), ['Yummy (phone)'], 'the question is answered once');
  hb.as(hb.sam.id);
  assert.equal((await hb.call('GET', '/api/plans')).mine.length, 1, 'one plan from the message, not two');

  // The iPad says why, and lets Sam let them go.
  ipad.client.disconnected();
  const failedAnswer = (await ipad.client.api('GET', '/api/sent')).find((g) => g.failed);
  assert.match(failedAnswer.error, /isn’t open any more/);
  const { failed: [failedPlan] } = await ipad.client.api('GET', '/api/plans');
  assert.match(failedPlan.error, /already made a promise from this message/);
  await ipad.client.discardFailed(failedAnswer.groupId);
  await ipad.client.discardFailed(failedPlan.id);
  assert.equal(ipad.client.status().failed, 0);
  assert.equal((await ipad.client.api('GET', '/api/plans')).mine.length, 1, 'and it shows the plan made on the phone');
});

test('a question for someone else on linked phones: asked apart, answered apart, checked the same way', async () => {
  const hb = await homeBase();
  const dad = await linkPhone(hb, hb.dad);
  const sam = await linkPhone(hb, hb.sam);
  dad.client.disconnected();
  const dinner = { what: 'Mom cooked Thanksgiving dinner.', help: 'well', model: 'kids', forIds: [hb.mom.id] };
  await assert.rejects(dad.client.api('POST', '/api/asks', { ...dinner, toIds: [hb.mom.id] }), /for Mom, so Mom can’t be asked/);
  const res = await dad.client.api('POST', '/api/asks', { ...dinner, to: 'everyone' });
  assert.deepEqual([res.queued, res.count, res.forCount], [true, 1, 1], 'Everyone leaves Mom out: only Sam is asked');
  const [pending] = (await dad.client.api('GET', '/api/asks')).mine;
  assert.deepEqual([pending.pending, pending.for.map((m) => m.name), pending.recipients.map((m) => m.name)], [true, ['Mom'], ['Sam']]);
  assert.equal((await sync(hb, dad)).failed.length, 0);

  await sync(hb, sam);
  sam.client.disconnected();
  const [q] = (await sam.client.api('GET', '/api/asks')).forMe;
  assert.deepEqual([q.from.name, q.for.map((m) => m.name)], ['Dad', ['Mom']]);
  await assert.rejects(sam.client.api('POST', '/api/feedback', { toIds: [hb.dad.id], askId: q.id, ...kidNote('Yum') }), /everyone the feedback is for/);
  await sam.client.api('POST', '/api/feedback', { toIds: [hb.mom.id], askId: q.id, ...kidNote('The pie was the best') });
  assert.deepEqual((await sam.client.api('GET', '/api/asks')).forMe, [], 'answered: it leaves Sam’s Inbox here too');
  assert.equal((await sync(hb, sam)).failed.length, 0);

  hb.as(hb.mom.id);
  const [msg] = await hb.call('GET', '/api/inbox');
  assert.deepEqual([msg.from.name, msg.fields.happened, msg.askBy.name, msg.askWhat], ['Sam', 'The pie was the best', 'Dad', 'Mom cooked Thanksgiving dinner.']);
  await sync(hb, dad);
  dad.client.disconnected();
  const [mine] = (await dad.client.api('GET', '/api/asks')).mine;
  assert.deepEqual([mine.answered, mine.answeredBy.map((m) => m.name)], [1, ['Sam']]);
});
