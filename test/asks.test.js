// Asking family members for feedback on something you did: who sees the question, how answers link
// back, Not now, stopping, member removal, and that anonymous answers can't be traced to anyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../public/shared/core.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';
import { createApp } from '../src/server.js';

const pins = { hash: async (p) => `test$${p}`, verify: async (p, s) => s === `test$${p}` };
const glow = { model: 'glow-grow', fields: { glow: 'The stall looked great.', grow: 'Bring more change next time.' } };
const kind = { model: 'kids', fields: { feeling: ['happy'], happened: 'You sold all the cupcakes!' } };

async function family(persist) {
  const store = createDocStore(emptyDoc(), persist);
  const pinged = [];
  const core = createCore({ store, pins, mode: 'device', onActivity: (ids) => pinged.push(...ids) });
  let meId = null;
  const call = (method, path, body) => core.handle(method, path, body, { me: store.getMember(meId), signIn: (id) => { meId = id; }, signOut: () => { meId = null; } });
  const by = (m) => (method, path, body) => { meId = m.id; return call(method, path, body); };
  const mom = (await call('POST', '/api/setup', { familyName: 'Lees', name: 'Mom' })).me;
  const add = (body) => by(mom)('POST', '/api/members', body);
  const dad = await add({ name: 'Dad', role: 'adult', isParent: true });
  const ava = await add({ name: 'Ava', role: 'adult' });
  const sam = await add({ name: 'Sam', role: 'kid' });
  const nana = await add({ name: 'Nana', role: 'adult', guest: true });
  return { store, by, pinged, mom, dad, ava, sam, nana };
}
const ask = (extra = {}) => ({ what: 'I ran the bake sale stall on Saturday.', help: 'well', model: 'glow-grow', ...extra });

test('asking: who it reaches, the style each answers in, and what has to be filled in', async () => {
  const fam = await family();
  const ava = fam.by(fam.ava);
  await assert.rejects(ava('POST', '/api/asks', ask({ toIds: [fam.dad.id], what: '  ' })), /Say what you did/);
  await assert.rejects(ava('POST', '/api/asks', ask({ toIds: [fam.ava.id] })), /yourself/);
  await assert.rejects(ava('POST', '/api/asks', ask({ toIds: [fam.dad.id], model: 'nope' })), /how they should answer/);
  await assert.rejects(ava('POST', '/api/asks', ask({ toIds: [fam.dad.id], what: 'x'.repeat(301) })), /300 characters/);
  await assert.rejects(ava('POST', '/api/asks', ask({ toIds: [fam.dad.id, fam.sam.id], anonymous: true })), /3 or more people/);

  fam.pinged.length = 0;
  const sent = await ava('POST', '/api/asks', ask({ toIds: [fam.dad.id, fam.sam.id] }));
  assert.deepEqual([sent.audience, sent.count, sent.anonymous], ['some', 2, false]);
  assert.deepEqual(fam.pinged.sort(), [fam.dad.id, fam.sam.id].sort(), 'both are told something is new');

  const dads = (await fam.by(fam.dad)('GET', '/api/asks')).forMe;
  assert.equal(dads.length, 1);
  assert.deepEqual([dads[0].from.name, dads[0].what, dads[0].helpLabel, dads[0].model], ['Ava', 'I ran the bake sale stall on Saturday.', 'What went well', 'glow-grow']);
  assert.equal((await fam.by(fam.sam)('GET', '/api/asks')).forMe[0].model, 'glow-grow', 'kids answer in the style asked for too');
  assert.equal((await fam.by(fam.dad)('GET', '/api/state')).me.asks, 1, 'counted with what is new');
  assert.deepEqual((await fam.by(fam.mom)('GET', '/api/asks')).forMe, [], 'not asked, not shown');

  // Everyone means the household: the guest isn't asked.
  await ava('POST', '/api/asks', ask({ to: 'everyone' }));
  assert.equal((await fam.by(fam.nana)('GET', '/api/asks')).forMe.length, 0);
  assert.equal((await fam.by(fam.mom)('GET', '/api/asks')).forMe.length, 1);
});

test('answering: an ordinary message to whoever asked, linked to the question, once', async () => {
  const fam = await family();
  const { id } = await fam.by(fam.ava)('POST', '/api/asks', ask({ toIds: [fam.dad.id, fam.sam.id] }));
  const dad = fam.by(fam.dad);
  await assert.rejects(dad('POST', '/api/feedback', { toIds: [fam.mom.id], askId: id, ...glow }), /person who asked/);
  await assert.rejects(dad('POST', '/api/feedback', { toIds: [fam.ava.id], askId: id, anonymous: true, ...glow }), /with your name/);
  await assert.rejects(fam.by(fam.mom)('POST', '/api/feedback', { toIds: [fam.ava.id], askId: id, ...glow }), /isn’t open/, 'only people asked');
  await dad('POST', '/api/feedback', { toIds: [fam.ava.id], askId: id, ...glow });
  await assert.rejects(dad('POST', '/api/feedback', { toIds: [fam.ava.id], askId: id, ...glow }), /isn’t open/, 'answered once');
  assert.deepEqual((await dad('GET', '/api/asks')).forMe, [], 'gone from Dad’s Inbox');

  const inbox = await fam.by(fam.ava)('GET', '/api/inbox');
  assert.equal(inbox[0].from.name, 'Dad');
  assert.equal(inbox[0].askWhat, 'I ran the bake sale stall on Saturday.', 'the answer shows what it answers');

  // Sam puts it aside: the question leaves Sam's Inbox, and Ava isn't told.
  await fam.by(fam.sam)('POST', `/api/asks/${id}/dismiss`);
  assert.deepEqual((await fam.by(fam.sam)('GET', '/api/asks')).forMe, []);
  await assert.rejects(fam.by(fam.sam)('POST', '/api/feedback', { toIds: [fam.ava.id], askId: id, ...kind }), /isn’t open/);
  const [mine] = (await fam.by(fam.ava)('GET', '/api/asks')).mine;
  assert.deepEqual([mine.answered, mine.answeredBy.map((m) => m.name), mine.recipients.map((m) => m.name)], [1, ['Dad'], ['Dad', 'Sam']]);
  assert.equal(JSON.stringify(mine).includes('done'), false, 'who said Not now is never shown');
});

test('stop asking, and removing people, tidy up', async () => {
  const fam = await family();
  const { id } = await fam.by(fam.ava)('POST', '/api/asks', ask({ toIds: [fam.dad.id, fam.sam.id] }));
  await assert.rejects(fam.by(fam.dad)('DELETE', `/api/asks/${id}`), { status: 404 }, 'only the asker');
  await fam.by(fam.mom)('DELETE', `/api/members/${fam.sam.id}`);
  assert.deepEqual(fam.store.getAsk(id).toIds, [fam.dad.id], 'a removed member is no longer asked');
  await fam.by(fam.ava)('DELETE', `/api/asks/${id}`);
  assert.deepEqual((await fam.by(fam.dad)('GET', '/api/asks')).forMe, []);

  await fam.by(fam.ava)('POST', '/api/asks', ask({ toIds: [fam.dad.id] }));
  await fam.by(fam.mom)('DELETE', `/api/members/${fam.ava.id}`);
  assert.deepEqual(fam.store.listAsks(), [], 'their questions go with them');
});

test('anonymous answers: only when 3+ are asked, held like any anonymous message, and never traced', async () => {
  const app = createApp({ dataPath: ':memory:', anonymousHoldMs: [200, 200] });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status });
      return data;
    };
  };
  try {
    const mom = client();
    await mom('POST', '/api/setup', { name: 'Mom' });
    const ids = {};
    for (const [name, role] of [['Dad', 'adult'], ['Ava', 'adult'], ['Sam', 'kid']]) ids[name] = (await mom('POST', '/api/members', { name, role })).id;
    const as = async (id) => { const c = client(); await c('POST', '/api/login', { memberId: id }); return c; };
    const ava = await as(ids.Ava);
    const dad = await as(ids.Dad);
    const { id } = await ava('POST', '/api/asks', ask({ to: 'everyone', anonymous: true }));
    assert.equal((await dad('GET', '/api/asks')).forMe[0].anonymous, true);
    await dad('POST', '/api/feedback', { toIds: [ids.Ava], askId: id, anonymous: true, ...glow });

    let [mine] = (await ava('GET', '/api/asks')).mine;
    assert.equal(mine.answered, 0, 'not counted while held, so the count can’t time who answered');
    assert.equal(mine.answeredBy, null, 'never who');
    await new Promise((r) => setTimeout(r, 300));
    [mine] = (await ava('GET', '/api/asks')).mine;
    assert.equal(mine.answered, 1);
    assert.equal(mine.answeredBy, null);
    const [msg] = await ava('GET', '/api/inbox');
    assert.deepEqual([msg.anonymous, msg.from, msg.askWhat], [true, null, 'I ran the bake sale stall on Saturday.']);
    assert.match(msg.createdAt, /T12:00:00\.000Z$/, 'only the date, as for any anonymous message');
  } finally {
    app.closeAllConnections();
    app.close();
  }
});

test('anonymous questions: every answer anonymous and in one style, so nothing singles anyone out', async () => {
  const { by, mom, dad, ava, sam } = await family();
  // Everyone, kids included, answers in the style asked for: a different style would single someone out.
  const withKid = await by(ava)('POST', '/api/asks', ask({ toIds: [mom.id, dad.id, sam.id], anonymous: true, model: 'dearman' }));
  const forDad = (await by(dad)('GET', '/api/asks')).forMe.find((a) => a.id === withKid.id);
  const forSam = (await by(sam)('GET', '/api/asks')).forMe.find((a) => a.id === withKid.id);
  assert.deepEqual([forDad.model, forSam.model], ['dearman', 'dearman']);
  const dear = { model: 'dearman', fields: { describe: 'You ran the stall.', express: 'I felt proud.', assert: 'Do it again next year.' } };
  const answer = (who, extra) => by(who)('POST', '/api/feedback', { toIds: [ava.id], askId: withKid.id, ...extra });
  await assert.rejects(answer(dad, { anonymous: false, ...dear }), /without names/, 'a named answer would point to the anonymous ones');
  await assert.rejects(answer(sam, { anonymous: true, ...kind }), /Everyone answers this question with DEAR MAN/);
  await answer(dad, { anonymous: true, ...dear });
  await answer(sam, { anonymous: true, ...dear });
  const got = (await by(ava)('GET', '/api/inbox')).filter((f) => f.askWhat);
  assert.deepEqual(got.map((f) => [f.anonymous, f.from, f.model]), [[true, null, 'dearman'], [true, null, 'dearman']]);

  // Named questions: the style asked for is a suggestion, and anyone may answer in another.
  const named = await by(ava)('POST', '/api/asks', ask({ toIds: [dad.id, sam.id] }));
  assert.equal((await by(sam)('GET', '/api/asks')).forMe.find((a) => a.id === named.id).model, 'glow-grow');
  await by(sam)('POST', '/api/feedback', { toIds: [ava.id], askId: named.id, ...kind });
});

test('anonymous questions close when too few are left to hide among, or anonymity is turned off', async () => {
  const { by, store, mom, dad, ava, sam } = await family();
  const q = await by(ava)('POST', '/api/asks', ask({ toIds: [mom.id, dad.id, sam.id], anonymous: true }));
  await by(mom)('DELETE', `/api/members/${sam.id}`);
  assert.equal(store.getAsk(q.id).toIds.length, 2);
  assert.equal((await by(dad)('GET', '/api/asks')).forMe.length, 0, 'two people left: the question leaves their Inbox');
  assert.equal((await by(dad)('GET', '/api/state')).me.asks, 0, 'and the badge');
  await assert.rejects(by(dad)('POST', '/api/feedback', { toIds: [ava.id], askId: q.id, anonymous: true, ...kind }), /isn’t open any more/);
  assert.equal((await by(ava)('GET', '/api/asks')).mine[0].closed, true, 'Sent says it closed');

  const q2 = await by(ava)('POST', '/api/asks', ask({ toIds: [mom.id, dad.id, (await by(mom)('POST', '/api/members', { name: 'Leo', role: 'adult' })).id], anonymous: true }));
  assert.equal((await by(dad)('GET', '/api/asks')).forMe.length, 1);
  await by(mom)('PATCH', '/api/settings', { allowAnonymous: false });
  assert.equal((await by(dad)('GET', '/api/asks')).forMe.length, 0, 'anonymous feedback off: closed');
  assert.equal((await by(ava)('GET', '/api/asks')).mine.find((a) => a.id === q2.id).closed, true);
  await by(mom)('PATCH', '/api/settings', { allowAnonymous: true });
  assert.equal((await by(dad)('GET', '/api/asks')).forMe.length, 1, 'and open again when it is turned back on');
});

test('two answers sent at the same moment count once', async () => {
  const { by, store, mom, dad, ava } = await family(() => new Promise((r) => setTimeout(r, 20)));
  const q = await by(ava)('POST', '/api/asks', ask({ toIds: [mom.id, dad.id], model: 'glow-grow' }));
  const send = () => by(dad)('POST', '/api/feedback', { toIds: [ava.id], askId: q.id, ...glow });
  const results = await Promise.allSettled([send(), send()]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /isn’t open any more/);
  assert.deepEqual(store.getAsk(q.id).done, [dad.id]);
  assert.equal((await by(ava)('GET', '/api/asks')).mine[0].answered, 1);
});
