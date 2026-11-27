// Device-only mode runs the same core in the browser. This exercises it without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../public/shared/core.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';

const pins = { hash: async (p) => `test$${p}`, verify: async (p, s) => s === `test$${p}` };

function device(initial = emptyDoc()) {
  let saved = null;
  const store = createDocStore(initial, async (d) => { saved = structuredClone(d); });
  const core = createCore({ store, pins, mode: 'device' });
  let meId = null;
  const call = (method, path, body) => core.handle(method, path, body, {
    me: store.getMember(meId),
    signIn: (id) => { meId = id; },
    signOut: () => { meId = null; },
  });
  return { call, saved: () => saved, as: (id) => { meId = id; } };
}

test('device mode: setup, broadcast, persistence hook, backup and restore', async () => {
  const d = device();
  const st = await d.call('POST', '/api/setup', { familyName: 'iPad Family', name: 'Mom', pin: '1234' });
  assert.equal(st.mode, 'device');
  const momId = st.me.id;
  const kid = await d.call('POST', '/api/members', { name: 'Sam', role: 'kid' });
  const dad = await d.call('POST', '/api/members', { name: 'Dad', role: 'adult' });

  d.as(kid.id);
  const sent = await d.call('POST', '/api/feedback', { to: 'everyone', anonymous: true, model: 'kids', fields: { feeling: 'happy', happened: 'Movie night!' } });
  assert.equal(sent.count, 2);
  assert.equal(sent.audience, 'everyone');
  await assert.rejects(d.call('GET', '/api/backup'), { status: 403 });

  d.as(dad.id);
  const [item] = await d.call('GET', '/api/inbox');
  assert.equal(item.from, null);
  assert.equal(item.audience, 'everyone');

  // Everything was handed to the persist hook (IndexedDB in the browser).
  assert.equal(d.saved().members.length, 3);
  assert.ok(d.saved().feedback.every((f) => f.fromId === null));

  d.as(momId);
  const backup = await d.call('GET', '/api/backup');
  assert.equal(backup.app, 'family-feedback');
  assert.equal(backup.doc.hub, undefined);

  const fresh = device();
  await fresh.call('POST', '/api/setup', { name: 'Temp' });
  await fresh.call('POST', '/api/restore', backup);
  const restored = await fresh.call('GET', '/api/state');
  assert.equal(restored.family.name, 'iPad Family');
  assert.equal(restored.members.length, 3);
  assert.equal(restored.me, null, 'restore signs everyone out');
  await assert.rejects(fresh.call('POST', '/api/login', { memberId: momId, pin: '0000' }), { status: 401 });
  await fresh.call('POST', '/api/login', { memberId: momId, pin: '1234' });
  await assert.rejects(fresh.call('POST', '/api/restore', { app: 'other' }), { status: 400 });
});

test('guests: end date, not parents, left out of whole-family broadcasts', async () => {
  const d = device();
  const { me } = await d.call('POST', '/api/setup', { name: 'Mom' });
  const dad = await d.call('POST', '/api/members', { name: 'Dad', role: 'adult' });
  const nana = await d.call('POST', '/api/members', { name: 'Nana', role: 'adult', guest: true, guestUntil: '2999-12-31' });
  const old = await d.call('POST', '/api/members', { name: 'Old sitter', role: 'adult', guest: true, guestUntil: '2000-01-01' });
  assert.equal(nana.guest, true);
  assert.equal(old.active, false);
  await assert.rejects(d.call('POST', '/api/members', { name: 'X', role: 'adult', guest: true, isParent: true }), { status: 400 });
  await assert.rejects(d.call('POST', '/api/members', { name: 'X', role: 'adult', guest: true, guestUntil: 'soon' }), { status: 400 });

  const all = await d.call('POST', '/api/feedback', { to: 'everyone', model: 'thanks', fields: { what: 'Dinner' } });
  assert.equal(all.count, 1, 'only Dad; guests are not in "everyone"');
  const toNana = await d.call('POST', '/api/feedback', { toIds: [nana.id, dad.id], model: 'thanks', fields: { what: 'Visiting' } });
  assert.equal(toNana.count, 2);
  await assert.rejects(d.call('POST', '/api/feedback', { toIds: [old.id], model: 'thanks', fields: { what: 'x' } }), { status: 404 });

  await d.call('POST', '/api/logout');
  await assert.rejects(d.call('POST', '/api/login', { memberId: old.id }), { status: 403 });
  await d.call('POST', '/api/login', { memberId: nana.id });
  assert.equal((await d.call('GET', '/api/inbox')).length, 1);
  await assert.rejects(d.call('PATCH', `/api/members/${nana.id}`, { guestUntil: '3000-01-01' }), { status: 403 });
  assert.ok(me.isParent);
});

test('emoji pictures count what people see; required-field messages read naturally', async () => {
  const d = device();
  await d.call('POST', '/api/setup', { name: 'Mom' });
  for (const emoji of ['👨‍👩‍👧', '🇯🇵', '👋🏽', '🧑‍🦯']) {
    assert.equal((await d.call('POST', '/api/members', { name: `E ${emoji}`, role: 'adult', emoji })).emoji, emoji);
  }
  await assert.rejects(d.call('POST', '/api/members', { name: 'Bob', role: 'adult', emoji: 'Bob' }), { status: 400 });
  const other = await d.call('POST', '/api/members', { name: 'Kid', role: 'kid' });
  await assert.rejects(d.call('POST', '/api/feedback', { toIds: [other.id], model: 'kids', fields: { happened: 'x' } }),
    (e) => e.status === 400 && e.message === 'Please answer “How did you feel?”.');
});

test('feelings: pick several; one on its own still works; only real options', async () => {
  const { MODELS, validateFields } = await import('../public/shared/models.js');
  const kids = MODELS.find((m) => m.id === 'kids');
  const nvc = MODELS.find((m) => m.id === 'nvc');
  assert.deepEqual(validateFields(kids, { feeling: ['proud', 'happy', 'happy'], happened: 'x' }).clean.feeling, ['happy', 'proud'], 'in the options’ order, once each');
  assert.deepEqual(validateFields(kids, { feeling: 'sad', happened: 'x' }).clean.feeling, ['sad'], 'a single value is a list of one');
  assert.equal(validateFields(kids, { feeling: ['happy', 'grumpy'], happened: 'x' }).ok, false);
  assert.equal(validateFields(kids, { feeling: [], happened: 'x' }).ok, false, 'at least one');
  assert.equal(validateFields(nvc, { observation: 'a', feeling: ['worried', 'frustrated'], need: 'b', request: 'c' }).ok, true);

  const d = device();
  const mom = (await d.call('POST', '/api/setup', { name: 'Mom' })).me;
  const sam = await d.call('POST', '/api/members', { name: 'Sam', role: 'kid' });
  d.as(sam.id);
  await d.call('POST', '/api/feedback', { toIds: [mom.id], model: 'kids', fields: { feeling: ['happy', 'thankful'], happened: 'You came to my game.' } });
  d.as(mom.id);
  assert.deepEqual((await d.call('GET', '/api/inbox'))[0].fields.feeling, ['happy', 'thankful']);
});

test('PIN guesses sent all at once still stop after five (the check is slow and async on devices)', async () => {
  // Like PBKDF2 in the browser: the check takes a while, so many guesses overlap.
  const slow = { hash: pins.hash, verify: (p, h) => new Promise((r) => setTimeout(() => r(h === `test$${p}`), 20)) };
  const store = createDocStore(emptyDoc());
  const core = createCore({ store, pins: slow, mode: 'device' });
  let meId = null;
  const ctx = () => ({ me: store.getMember(meId), signIn: (id) => { meId = id; }, signOut: () => { meId = null; } });
  const momId = (await core.handle('POST', '/api/setup', { familyName: 'F', name: 'Mom', pin: '2468' }, ctx())).me.id;
  meId = null;
  const tries = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => core.handle('POST', '/api/login', { memberId: momId, pin: String(1000 + i) }, ctx())));
  const checked = tries.filter((t) => t.status === 'rejected' && t.reason.status === 401).length;
  assert.equal(checked, 5, 'five checked, the rest refused straight away');
  assert.equal(tries.filter((t) => t.status === 'rejected' && t.reason.status === 429).length, 35);
  await assert.rejects(core.handle('POST', '/api/login', { memberId: momId, pin: '2468' }, ctx()), { status: 429 });
});

test('PIN guessing: the wait grows with each wrong try, survives a restart, and covers PIN changes', async () => {
  const store = createDocStore(emptyDoc());
  let core = createCore({ store, pins, mode: 'device' });
  let meId = null;
  const ctx = () => ({ me: store.getMember(meId), signIn: (id) => { meId = id; }, signOut: () => { meId = null; } });
  const call = (m, p, b) => core.handle(m, p, b, ctx());
  const momId = (await call('POST', '/api/setup', { familyName: 'F', name: 'Mom', pin: '2468' })).me.id;
  const ava = await call('POST', '/api/members', { name: 'Ava', role: 'adult', pin: '1357' });
  meId = null;
  for (let i = 0; i < 5; i++) await assert.rejects(call('POST', '/api/login', { memberId: momId, pin: '0000' }), { status: 401 });
  await assert.rejects(call('POST', '/api/login', { memberId: momId, pin: '2468' }), { status: 429, message: /a minute/ });
  // A restart (or a reload on a device) doesn't wipe the count.
  core = createCore({ store, pins, mode: 'device' });
  await assert.rejects(call('POST', '/api/login', { memberId: momId, pin: '2468' }), { status: 429 }, 'still locked after a restart');
  // After the wait, one more wrong try locks for longer.
  store.raw().hub.pinLocks[momId].until = Date.now() - 1;
  await assert.rejects(call('POST', '/api/login', { memberId: momId, pin: '0000' }), { status: 401 });
  await assert.rejects(call('POST', '/api/login', { memberId: momId, pin: '2468' }), { status: 429, message: /2 minutes/ });
  store.raw().hub.pinLocks[momId].until = Date.now() - 1;
  await call('POST', '/api/login', { memberId: momId, pin: '2468' });
  assert.equal(store.raw().hub.pinLocks[momId], undefined, 'the right PIN clears the count');

  // Guessing someone's current PIN to change it counts too.
  meId = ava.id;
  for (let i = 0; i < 5; i++) await assert.rejects(call('PATCH', `/api/members/${ava.id}`, { pin: '9999', currentPin: String(1000 + i) }), { status: 401 });
  await assert.rejects(call('PATCH', `/api/members/${ava.id}`, { pin: '9999', currentPin: '1357' }), { status: 429 });
  assert.equal((await createDocStore(structuredClone(store.raw())).raw().hub.pinLocks[ava.id]).count, 5, 'kept with the family’s data');
});
