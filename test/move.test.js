// Moving a family from a home-base phone to a home hub, so messages flow without syncing by hand:
// the phone's backup starts a new hub, with its people, messages, questions and PINs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../public/shared/core.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';
import { pins as phonePins } from '../public/local-backend.js';
import { createApp } from '../src/server.js';

// A home-base phone: the same rules in device mode, with the phone's own PIN hashing (PBKDF2).
async function homeBasePhone() {
  const store = createDocStore(emptyDoc());
  const core = createCore({ store, pins: phonePins, mode: 'device' });
  let meId = null;
  const ctx = () => ({ me: store.getMember(meId), signIn: (id) => { meId = id; }, signOut: () => { meId = null; } });
  const as = (m) => (method, path, body) => { meId = m.id; return core.handle(method, path, body ?? {}, ctx()); };
  const mom = (await core.handle('POST', '/api/setup', { familyName: 'The Riveras', name: 'Mom', pin: '2468' }, ctx())).me;
  const dad = await as(mom)('POST', '/api/members', { name: 'Dad', role: 'adult', pin: '1357' });
  const sam = await as(mom)('POST', '/api/members', { name: 'Sam', role: 'kid' });
  await as(sam)('POST', '/api/feedback', { toIds: [mom.id], model: 'kids', fields: { feeling: ['happy'], happened: 'Thanks for the pancakes' } });
  await as(dad)('POST', '/api/feedback', { toIds: [mom.id], anonymous: true, model: 'glow-grow', fields: { glow: 'Great trip.', grow: 'Pack snacks.' } });
  await as(mom)('POST', '/api/asks', { toIds: [dad.id], what: 'Cooked dinner.', help: 'well', model: 'glow-grow' });
  return { store, as, mom, dad, sam, backup: await as(mom)('GET', '/api/backup') };
}

async function hub() {
  const app = createApp({ dataPath: ':memory:' });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const client = (cookie = '') => async (method, path, body) => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { app, client, close: () => { app.closeAllConnections(); app.close(); } };
}

test('a new hub takes the home-base phone’s family: people, messages, questions and PINs', async () => {
  const phone = await homeBasePhone();
  const h = await hub();
  try {
    const mom = h.client();
    assert.equal((await mom('GET', '/api/state')).data.setupDone, false);
    assert.equal((await mom('POST', '/api/setup-restore', { app: 'something-else', doc: phone.backup.doc })).status, 400);
    assert.equal((await mom('POST', '/api/setup-restore', { app: 'family-feedback', doc: { members: [{ id: 1, name: 'X' }] } })).status, 400, 'a family needs a parent');

    const moved = await mom('POST', '/api/setup-restore', phone.backup);
    assert.equal(moved.status, 200);
    assert.deepEqual([moved.data.family, moved.data.members, moved.data.messages], ['The Riveras', 3, 2]);
    const st = (await mom('GET', '/api/state')).data;
    assert.deepEqual([st.setupDone, st.me, st.mode, st.members.map((m) => m.name).sort()], [true, null, 'hub', ['Dad', 'Mom', 'Sam']], 'nobody is signed in yet');

    // PINs made on the phone work on the hub.
    assert.equal((await mom('POST', '/api/login', { memberId: phone.mom.id, pin: '0000' })).status, 401);
    assert.equal((await mom('POST', '/api/login', { memberId: phone.mom.id, pin: '2468' })).status, 200);
    const inbox = (await mom('GET', '/api/inbox')).data;
    assert.deepEqual(inbox.map((f) => (f.anonymous ? 'anonymous' : f.from.name)).sort(), ['Sam', 'anonymous']);
    assert.equal((await mom('GET', '/api/asks')).data.mine[0].what, 'Cooked dinner.');
    const dad = h.client();
    assert.equal((await dad('POST', '/api/login', { memberId: phone.dad.id, pin: '1357' })).status, 200);
    assert.equal((await dad('GET', '/api/asks')).data.forMe[0].from.name, 'Mom', 'Dad still has Mom’s question');

    // New things never reuse an old id.
    const leo = (await mom('POST', '/api/members', { name: 'Leo', role: 'kid' })).data;
    assert.ok(leo.id > Math.max(phone.mom.id, phone.dad.id, phone.sam.id));
    assert.equal((await mom('POST', '/api/feedback', { toIds: [leo.id], model: 'kids', fields: { feeling: ['happy'], happened: 'Welcome!' } })).status, 200);

    // Only once: an hub with a family takes no backup, and no big bodies.
    assert.equal((await h.client()('POST', '/api/setup-restore', phone.backup)).status, 409);
    assert.equal((await h.client()('POST', '/api/setup', { name: 'Intruder' })).status, 409);
    assert.equal((await h.client()('POST', '/api/setup-restore', JSON.stringify({ pad: 'x'.repeat(600 * 1024) }))).status, 413);
  } finally {
    h.close();
  }
});

test('a backup brings no sign-ins with it, and a crafted PIN can’t stall the hub', async () => {
  const phone = await homeBasePhone();
  const h = await hub();
  try {
    const doc = structuredClone(phone.backup.doc);
    doc.hub = { sessions: { planted: { memberId: phone.mom.id, createdAt: new Date().toISOString() } } };
    doc.members.find((m) => m.id === phone.sam.id).pinHash = `pbkdf2$999999999$${'00'.repeat(16)}$${'00'.repeat(32)}`;
    assert.equal((await h.client()('POST', '/api/setup-restore', { app: 'family-feedback', doc })).status, 200);
    const planted = h.client('ff_session=planted');
    assert.equal((await planted('GET', '/api/state')).data.me, null, 'a session written into the file doesn’t sign anyone in');
    const started = Date.now();
    assert.equal((await h.client()('POST', '/api/login', { memberId: phone.sam.id, pin: '1234' })).status, 401);
    assert.ok(Date.now() - started < 2000, 'an absurd PBKDF2 count is refused, not computed');
  } finally {
    h.close();
  }
});
