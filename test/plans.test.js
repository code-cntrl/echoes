// After feedback arrives: the break before replying and plans made from feedback, on the home base
// or device (core) and on a linked phone working apart (peer client), with a clock the tests move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../public/shared/core.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';
import { createPeerHost } from '../public/shared/peer-host.js';
import { createPeerClient } from '../public/shared/peer-client.js';
import { addDays, localDate, planProgress, planTodo } from '../public/shared/plans.js';

const pins = { hash: async (p) => `test$${p}`, verify: async (p, s) => s === `test$${p}` };
const MIN = 60_000;
const DAY = 864e5;
const grow = { model: 'glow-grow', fields: { glow: 'You cooked dinner.', grow: 'Please don’t raise your voice when we’re late.' } };

async function family({ onActivity } = {}) {
  let t = new Date('2026-03-02T09:00:00').getTime();
  const clock = { now: () => new Date(t), advance: (ms) => { t += ms; }, today: () => localDate(new Date(t)) };
  const store = createDocStore(emptyDoc());
  const core = createCore({ store, pins, mode: 'device', now: clock.now, onActivity });
  let meId = null;
  const call = (method, path, body) => core.handle(method, path, body, { me: store.getMember(meId), signIn: (id) => { meId = id; }, signOut: () => { meId = null; } });
  const by = (m) => (method, path, body) => { meId = m.id; return call(method, path, body); };
  const mom = (await call('POST', '/api/setup', { familyName: 'Lees', name: 'Mom' })).me;
  const add = (body) => by(mom)('POST', '/api/members', body);
  const dad = await add({ name: 'Dad', role: 'adult', isParent: true });
  const ava = await add({ name: 'Ava', role: 'adult' });
  const sam = await add({ name: 'Sam', role: 'kid' });
  const nana = await add({ name: 'Nana', role: 'adult', guest: true });
  return { store, core, clock, by, mom, dad, ava, sam, nana };
}

// `from` sends `to` a message and `to` opens it; returns its id in `to`'s inbox.
async function opened(fam, from, to, body = grow) {
  await fam.by(from)('POST', '/api/feedback', { toIds: [to.id], ...body });
  const [item] = await fam.by(to)('GET', '/api/inbox');
  await fam.by(to)('POST', `/api/feedback/${item.id}/read`);
  return item.id;
}

const avaPlan = (feedbackId, extra = {}) => ({
  feedbackId, heard: 'Shouting when we’re late makes everyone tense.', promise: 'Keep my voice calm', when: 'feel rushed', then: 'say “give me a minute”', days: 30, ...extra,
});

test('the break: calm reactions right away; disagreeing, replying and planning wait 30 minutes (kids 10)', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  const ava = fam.by(fam.ava);
  assert.equal((await ava('POST', `/api/feedback/${id}/respond`, { reaction: 'thanks' })).reaction, 'thanks');
  await ava('POST', `/api/feedback/${id}/respond`, { reaction: 'talk' });
  await assert.rejects(ava('POST', `/api/feedback/${id}/respond`, { reaction: 'disagree' }), { status: 409 });
  await assert.rejects(ava('POST', `/api/feedback/${id}/respond`, { reply: 'Okay.' }), (e) => e.status === 409 && /30 minutes/.test(e.message) && !!e.extra.calmUntil);
  await assert.rejects(ava('POST', '/api/plans', avaPlan(id)), (e) => e.status === 409 && /make a plan/.test(e.message));
  const [item] = await ava('GET', '/api/inbox');
  assert.equal(Date.parse(item.replyAfter) - fam.clock.now(), 30 * MIN);
  assert.equal(item.reaction, 'talk', 'a refused change changes nothing');

  fam.clock.advance(29 * MIN);
  await assert.rejects(ava('POST', `/api/feedback/${id}/respond`, { reply: 'Okay.' }), /in 1 minute\./);
  fam.clock.advance(MIN);
  assert.equal((await ava('POST', `/api/feedback/${id}/respond`, { reaction: 'disagree', reply: 'Can we talk tonight?' })).reply, 'Can we talk tonight?');

  // A kid waits 10 minutes; replying to a message not opened yet starts the break now.
  const kidMsg = await opened(fam, fam.mom, fam.sam, { model: 'kids', fields: { feeling: 'sad', happened: 'You yelled at your sister.' } });
  const sam = fam.by(fam.sam);
  fam.clock.advance(9 * MIN);
  await assert.rejects(sam('POST', `/api/feedback/${kidMsg}/respond`, { reply: 'Sorry' }), /in 1 minute/);
  fam.clock.advance(MIN);
  await sam('POST', `/api/feedback/${kidMsg}/respond`, { reply: 'Sorry' });
  await fam.by(fam.mom)('POST', '/api/feedback', { toIds: [fam.ava.id], ...grow });
  const fresh = (await ava('GET', '/api/inbox')).find((f) => !f.read);
  assert.equal(fresh.replyAfter, null, 'the break starts when a message is opened');
  await assert.rejects(ava('POST', `/api/feedback/${fresh.id}/respond`, { reply: 'Hi' }), { status: 409 });
});

test('a grown-up plan from a message: promise, When I…/I’ll…, and who can see it', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const ava = fam.by(fam.ava);
  await assert.rejects(ava('POST', '/api/plans', avaPlan(id, { heard: ' ' })), (e) => e.status === 400 && /what you heard/.test(e.message));
  await assert.rejects(ava('POST', '/api/plans', avaPlan(id, { days: 21 })), /7, 14 or 30 days/);
  await assert.rejects(ava('POST', '/api/plans', avaPlan(id, { when: '' })), /When I/);
  await assert.rejects(ava('POST', '/api/plans', avaPlan(id, { share: 'everyone' })), { status: 400 });
  await assert.rejects(fam.by(fam.mom)('POST', '/api/plans', avaPlan(id)), { status: 404 }, 'only the person it was sent to');

  const plan = await ava('POST', '/api/plans', avaPlan(id, { share: 'giver' }));
  assert.equal(plan.share, 'giver');
  assert.equal(plan.giver.name, 'Dad');
  assert.equal(plan.startDate, fam.clock.today());
  assert.equal((await ava('GET', '/api/inbox'))[0].planRef, plan.ref);

  const seen = async (m) => (await fam.by(m)('GET', '/api/plans')).shared.map((p) => p.ref);
  assert.deepEqual(await seen(fam.dad), [plan.ref]);
  assert.deepEqual(await seen(fam.mom), [], 'shared with the giver only');
  assert.equal((await fam.by(fam.dad)('GET', '/api/sent'))[0].recipients[0].planShared, true);

  await ava('PATCH', `/api/plans/${plan.ref}`, { share: 'family' });
  assert.deepEqual(await seen(fam.mom), [plan.ref]);
  assert.deepEqual(await seen(fam.sam), [plan.ref]);
  assert.deepEqual(await seen(fam.nana), [], 'guests are not in “the whole family”');

  await ava('PATCH', `/api/plans/${plan.ref}`, { share: 'private' });
  assert.deepEqual(await seen(fam.dad), []);
  assert.equal((await fam.by(fam.dad)('GET', '/api/sent'))[0].recipients[0].planShared, false);
  await assert.rejects(fam.by(fam.dad)('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' }), { status: 404 });
});

test('slip-ups stay with the owner: others see the day, good days and cheers', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const ava = fam.by(fam.ava);
  const plan = await ava('POST', '/api/plans', avaPlan(id, { share: 'giver' }));
  const today = fam.clock.today();
  assert.equal((await ava('GET', '/api/state')).me.plansDue, 1, 'today is not ticked yet');
  await ava('POST', `/api/plans/${plan.ref}/tick`, { date: today, value: 'kept' });
  assert.equal((await ava('GET', '/api/state')).me.plansDue, 0);
  await assert.rejects(ava('POST', `/api/plans/${plan.ref}/tick`, { date: addDays(today, 2), value: 'kept' }), /Pick a day/);
  await assert.rejects(ava('POST', `/api/plans/${plan.ref}/tick`, { date: addDays(today, -1), value: 'kept' }), /Pick a day/);
  await assert.rejects(ava('POST', `/api/plans/${plan.ref}/tick`, { date: today, value: 'maybe' }), { status: 400 });
  await assert.rejects(fam.by(fam.dad)('POST', `/api/plans/${plan.ref}/tick`, { date: today, value: 'slip' }), { status: 404 });

  fam.clock.advance(DAY);
  await ava('POST', `/api/plans/${plan.ref}/tick`, { date: fam.clock.today(), value: 'slip' });
  const mine = (await ava('GET', '/api/plans')).mine[0];
  assert.deepEqual(mine.ticks, { [today]: 'kept', [fam.clock.today()]: 'slip' });

  const dads = (await fam.by(fam.dad)('GET', '/api/plans')).shared[0];
  assert.equal(dads.keptDays, 1);
  assert.equal(dads.ticks, undefined);
  assert.equal(dads.checkins, undefined);
  assert.ok(!JSON.stringify(dads).includes('slip'), 'no trace of the missed day');

  const dad = fam.by(fam.dad);
  await dad('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'noticed' });
  await assert.rejects(dad('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' }), /already cheered today/);
  await assert.rejects(dad('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'wow' }), { status: 400 });
  await assert.rejects(ava('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' }), { status: 404 }, 'not your own plan');
  fam.clock.advance(DAY);
  await dad('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' });
  const cheers = (await ava('GET', '/api/plans')).mine[0].cheers;
  assert.deepEqual(cheers.map((c) => [c.from.name, c.cheer]), [['Dad', 'noticed'], ['Dad', 'proud']]);
});

test('halfway check-in, then the wrap-up: keep going, finish (asking the giver), or change the plan', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const ava = fam.by(fam.ava);
  const plan = await ava('POST', '/api/plans', avaPlan(id, { days: 7, share: 'giver' }));
  const r = plan.ref;
  await assert.rejects(ava('POST', `/api/plans/${r}/checkin`, { feeling: 'good' }), /halfway/);
  await assert.rejects(ava('POST', `/api/plans/${r}/wrap`, { outcome: 'finish' }), /last day/);
  fam.clock.advance(3 * DAY); // day 4 of 7
  await ava('POST', `/api/plans/${r}/tick`, { date: fam.clock.today(), value: 'kept' });
  assert.equal((await ava('GET', '/api/state')).me.plansDue, 1, 'the check-in is due');
  await assert.rejects(ava('POST', `/api/plans/${r}/checkin`, { feeling: 'meh' }), { status: 400 });
  const checked = await ava('POST', `/api/plans/${r}/checkin`, { feeling: 'hard', note: 'Mornings are tough.' });
  assert.deepEqual(checked.checkins.map((c) => [c.round, c.feeling]), [[1, 'hard']]);
  assert.equal((await fam.by(fam.dad)('GET', '/api/plans')).shared[0].checkins, undefined, 'the check-in is private');

  fam.clock.advance(3 * DAY); // day 7: wrap-up
  await assert.rejects(ava('POST', `/api/plans/${r}/wrap`, { outcome: 'stop' }), { status: 400 });
  const kept = await ava('POST', `/api/plans/${r}/wrap`, { outcome: 'keep', note: 'Getting better.' });
  assert.deepEqual([kept.status, kept.rounds], ['active', 2]);
  fam.clock.advance(7 * DAY); // day 14
  const done = await ava('POST', `/api/plans/${r}/wrap`, { outcome: 'finish', askGiver: true });
  assert.equal(done.status, 'done');
  assert.equal((await fam.by(fam.dad)('GET', '/api/state')).me.plansDue, 1, 'Dad is asked whether he has noticed a difference');
  await assert.rejects(fam.by(fam.mom)('POST', `/api/plans/${r}/noticed`, { answer: 'yes' }), { status: 404 });
  await assert.rejects(fam.by(fam.dad)('POST', `/api/plans/${r}/noticed`, { answer: 'maybe' }), { status: 400 });
  await fam.by(fam.dad)('POST', `/api/plans/${r}/noticed`, { answer: 'yes' });
  assert.equal((await ava('GET', '/api/plans')).mine[0].noticed.answer, 'yes');
  assert.equal((await fam.by(fam.dad)('GET', '/api/state')).me.plansDue, 0);
  await assert.rejects(fam.by(fam.dad)('POST', `/api/plans/${r}/cheer`, { cheer: 'proud' }), /finished/);

  // "Change the plan": a new one from the same message, still shared with the same giver.
  const second = await ava('POST', '/api/plans', avaPlan(id, { days: 7, share: 'giver' }));
  fam.clock.advance(6 * DAY);
  await ava('POST', `/api/plans/${second.ref}/wrap`, { outcome: 'change' });
  const third = await ava('POST', '/api/plans', { fromPlanId: second.ref, promise: 'Leave ten minutes earlier', when: 'we have somewhere to be', then: 'set an alarm', heard: 'Same as before.', days: 14, share: 'giver' });
  assert.equal(third.giver.name, 'Dad');
  assert.equal(third.feedbackId, second.feedbackId);
  await ava('POST', '/api/plans', avaPlan(id));
  await assert.rejects(ava('POST', '/api/plans', avaPlan(id)), /two plans going/);
});

test('the giver is told each time they are asked afresh whether they’ve noticed a difference', async () => {
  const told = [];
  const fam = await family({ onActivity: (ids) => told.push(...ids) });
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const ava = fam.by(fam.ava);
  const { ref } = await ava('POST', '/api/plans', avaPlan(id, { days: 7, share: 'giver' }));
  const toDad = () => told.filter((x) => x === fam.dad.id).length;
  const before = toDad();
  fam.clock.advance(6 * DAY);
  await ava('POST', `/api/plans/${ref}/wrap`, { outcome: 'keep', askGiver: true });
  assert.equal(toDad(), before + 1, 'asked the first time');
  await fam.by(fam.dad)('POST', `/api/plans/${ref}/noticed`, { answer: 'yes' });
  fam.clock.advance(7 * DAY);
  await ava('POST', `/api/plans/${ref}/wrap`, { outcome: 'keep', askGiver: true });
  assert.equal(toDad(), before + 2, 'asked again after answering');
  fam.clock.advance(7 * DAY);
  await ava('POST', `/api/plans/${ref}/wrap`, { outcome: 'finish', askGiver: true });
  assert.equal(toDad(), before + 2, 'still waiting on the last question: no second ping');
});

test('a kid’s plan: a picture promise, 7 or 14 days, and a grown-up helper who can cheer', async () => {
  const fam = await family();
  const id = await opened(fam, fam.mom, fam.sam, { model: 'kids', fields: { feeling: 'sad', happened: 'You shouted at me.' } });
  fam.clock.advance(10 * MIN);
  const sam = fam.by(fam.sam);
  const kidPlan = (extra) => ({ feedbackId: id, promiseId: 'calm-voice', when: 'feel cross', then: 'take three big breaths', days: 14, helperId: fam.dad.id, ...extra });
  await assert.rejects(sam('POST', '/api/plans', kidPlan({ days: 30 })), /7 or 14 days/);
  await assert.rejects(sam('POST', '/api/plans', kidPlan({ promiseId: 'fly' })), /Pick a promise/);
  await assert.rejects(sam('POST', '/api/plans', kidPlan({ helperId: fam.sam.id })), /grown-up/);
  await assert.rejects(sam('POST', '/api/plans', kidPlan({ helperId: fam.nana.id })), /grown-up/, 'not a guest');
  await assert.rejects(sam('POST', '/api/plans', kidPlan({ helperId: undefined })), /grown-up/);
  const plan = await sam('POST', '/api/plans', kidPlan({ promise: 'ignored' }));
  assert.deepEqual([plan.kid, plan.promise, plan.helper.name, plan.heard, plan.share], [true, 'Use my calm voice', 'Dad', '', 'private']);
  const dads = (await fam.by(fam.dad)('GET', '/api/plans')).shared[0];
  assert.deepEqual([dads.youAreHelper, dads.owner.name], [true, 'Sam']);
  assert.deepEqual((await fam.by(fam.mom)('GET', '/api/plans')).shared, [], 'private: only Sam and the helper');
  await fam.by(fam.dad)('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'keep-going' });
});

test('a plan from an anonymous message is private or family-wide, never “the giver”', async () => {
  const fam = await family();
  const id = await opened(fam, fam.sam, fam.mom, { model: 'kids', anonymous: true, fields: { feeling: 'left-out', happened: 'You were on your phone at dinner.' } });
  fam.clock.advance(31 * MIN);
  const mom = fam.by(fam.mom);
  await assert.rejects(mom('POST', '/api/plans', avaPlan(id, { share: 'giver' })), /anonymous/);
  const plan = await mom('POST', '/api/plans', avaPlan(id, { share: 'family' }));
  assert.deepEqual([plan.giver, plan.giverId], [null, null]);
  await assert.rejects(mom('PATCH', `/api/plans/${plan.ref}`, { share: 'giver' }), /anonymous/);
  const samSees = (await fam.by(fam.sam)('GET', '/api/plans')).shared[0];
  assert.deepEqual([samSees.youAreGiver, samSees.askGiver, samSees.feedbackId], [false, false, undefined]);
  fam.clock.advance(29 * DAY);
  await mom('POST', `/api/plans/${plan.ref}/wrap`, { outcome: 'finish', askGiver: true });
  assert.equal(fam.store.getPlan(plan.id).askGiver, false, 'nobody to ask');
});

test('removing someone removes their plans and their part in other people’s; backups keep plans', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const plan = await fam.by(fam.ava)('POST', '/api/plans', avaPlan(id, { share: 'giver' }));
  await fam.by(fam.dad)('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' });
  const backup = await fam.by(fam.mom)('GET', '/api/backup');
  assert.equal(backup.doc.plans.length, 1);
  await fam.by(fam.mom)('DELETE', `/api/members/${fam.dad.id}`);
  const p = fam.store.getPlan(plan.id);
  assert.deepEqual([p.giverId, p.share, p.cheers.length], [null, 'private', 0]);
  await fam.by(fam.mom)('DELETE', `/api/members/${fam.ava.id}`);
  assert.equal(fam.store.listPlans().length, 0);
});

// ---------- a linked phone working apart ----------

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
  return { load: async () => structuredClone(saved), save: async (rec) => { saved = structuredClone(rec); } };
}
async function linkedPhone(fam, member) {
  const host = createPeerHost({ core: fam.core, store: fam.store, now: fam.clock.now });
  const session = host.session({ mode: 'link', memberId: member.id, by: fam.mom.id });
  const ready = await session.handle({ t: 'hello', key: null, accept: true });
  const client = await createPeerClient({ storage: memoryStorage(), now: fam.clock.now });
  await client.connected(connect(session), ready);
  const sync = async (wrap = (c) => c) => {
    const s = host.session({ mode: 'sync' });
    const r = await s.handle({ t: 'hello', key: client.link.key, accept: true });
    return client.connected(wrap(connect(s)), r);
  };
  return { client, api: client.api, sync };
}

test('apart, a linked phone takes the break, makes a plan, ticks a day; it all lands at the next sync', async () => {
  const fam = await family();
  await fam.by(fam.dad)('POST', '/api/feedback', { toIds: [fam.ava.id], ...grow });
  const phone = await linkedPhone(fam, fam.ava);
  phone.client.disconnected();
  const [item] = await phone.api('GET', '/api/inbox');
  const openedAt = fam.clock.now().toISOString();
  await phone.api('POST', `/api/feedback/${item.id}/read`);
  await phone.api('POST', `/api/feedback/${item.id}/respond`, { reaction: 'got-it' });
  await assert.rejects(phone.api('POST', `/api/feedback/${item.id}/respond`, { reply: 'OK' }), /break/);
  await assert.rejects(phone.api('POST', '/api/plans', avaPlan(item.id)), /make a plan/);

  fam.clock.advance(31 * MIN);
  const plan = await phone.api('POST', '/api/plans', avaPlan(item.id, { share: 'giver' }));
  assert.match(plan.ref, /^c[a-z0-9]+$/);
  assert.equal(plan.pending, true);
  assert.equal((await phone.api('GET', '/api/state')).me.plansDue, 1);
  await phone.api('POST', `/api/plans/${plan.ref}/tick`, { date: fam.clock.today(), value: 'kept' });
  assert.equal((await phone.api('GET', '/api/state')).me.plansDue, 0);
  await phone.api('POST', `/api/feedback/${item.id}/respond`, { reply: 'Thanks, Dad. I made a plan.' });
  assert.equal((await phone.api('GET', '/api/inbox'))[0].planRef, plan.ref);

  fam.clock.advance(2 * 3600e3);
  const result = await phone.sync();
  assert.deepEqual([result.sent, result.failed.length], [5, 0]);
  const stored = fam.store.listPlans();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ticks[fam.clock.today()], 'kept');
  assert.equal(fam.store.getFeedback(item.id).readAt, openedAt, 'the break counted from when it was opened on the phone');
  assert.equal(fam.store.getFeedback(item.id).reply, 'Thanks, Dad. I made a plan.');
  const mine = (await phone.api('GET', '/api/plans')).mine[0];
  assert.deepEqual([mine.ref, mine.pending], [String(stored[0].id), undefined]);

  // Dad cheers on the home base; Ava sees it after her next sync, and cheers queue apart too.
  await fam.by(fam.dad)('POST', `/api/plans/${mine.ref}/cheer`, { cheer: 'noticed' });
  await phone.sync();
  phone.client.disconnected();
  assert.equal((await phone.api('GET', '/api/plans')).mine[0].cheers[0].from.name, 'Dad');
});

test('apart, cheering and answering “noticed?” queue; a refused plan is kept with its reason', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const plan = await fam.by(fam.ava)('POST', '/api/plans', avaPlan(id, { share: 'giver', days: 7 }));
  const dadPhone = await linkedPhone(fam, fam.dad);
  dadPhone.client.disconnected();
  await dadPhone.api('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' });
  await assert.rejects(dadPhone.api('POST', `/api/plans/${plan.ref}/cheer`, { cheer: 'proud' }), /already cheered/);
  await dadPhone.sync();
  assert.equal(fam.store.getPlan(plan.id).cheers.length, 1);

  // Ava's phone makes a plan apart, but on the home base she already has two going: it's refused.
  const avaPhone = await linkedPhone(fam, fam.ava);
  avaPhone.client.disconnected();
  await avaPhone.api('POST', '/api/plans', avaPlan(id));
  await fam.by(fam.ava)('POST', '/api/plans', avaPlan(id));
  const r = await avaPhone.sync();
  assert.equal(r.failed.length, 1);
  const { failed } = await avaPhone.api('GET', '/api/plans');
  assert.match(failed[0].error, /two plans/);
  await avaPhone.client.discardFailed(failed[0].id);
  assert.deepEqual((await avaPhone.api('GET', '/api/plans')).failed, []);

  // Wrap-up with the giver asked, then Dad answers apart.
  fam.clock.advance(6 * DAY);
  await fam.by(fam.ava)('POST', `/api/plans/${plan.ref}/wrap`, { outcome: 'finish', askGiver: true });
  await dadPhone.sync();
  dadPhone.client.disconnected();
  assert.equal((await dadPhone.api('GET', '/api/state')).me.plansDue, 1);
  await dadPhone.api('POST', `/api/plans/${plan.ref}/noticed`, { answer: 'little' });
  await dadPhone.sync();
  assert.equal(fam.store.getPlan(plan.id).noticed.answer, 'little');
});

test('a home base on an older version without plans still syncs', async () => {
  const fam = await family();
  const phone = await linkedPhone(fam, fam.ava);
  const oldHomeBase = (c) => ({
    request: (method, path, body, op) => (path.startsWith('/api/plans')
      ? Promise.reject(Object.assign(new Error('Not found.'), { status: 404 }))
      : c.request(method, path, body, op)),
  });
  await phone.sync(oldHomeBase);
  phone.client.disconnected();
  assert.deepEqual(await phone.api('GET', '/api/plans'), { mine: [], shared: [], failed: [] });
});

test('a plan made apart starts on the phone’s day and keeps the days ticked before the sync', async () => {
  const fam = await family();
  await fam.by(fam.dad)('POST', '/api/feedback', { toIds: [fam.ava.id], ...grow });
  const phone = await linkedPhone(fam, fam.ava);
  phone.client.disconnected();
  const [item] = await phone.api('GET', '/api/inbox');
  await phone.api('POST', `/api/feedback/${item.id}/read`);
  fam.clock.advance(31 * MIN);
  const day1 = fam.clock.today();
  const plan = await phone.api('POST', '/api/plans', avaPlan(item.id, { days: 7, startDate: day1 }));
  await phone.api('POST', `/api/plans/${plan.ref}/tick`, { date: day1, value: 'kept' });
  fam.clock.advance(DAY);
  const day2 = fam.clock.today();
  await phone.api('POST', `/api/plans/${plan.ref}/tick`, { date: day2, value: 'slip' });
  fam.clock.advance(DAY); // synced on day 3
  const r = await phone.sync();
  assert.deepEqual([r.sent, r.failed.length], [4, 0]);
  const [stored] = fam.store.listPlans();
  assert.equal(stored.startDate, day1);
  assert.deepEqual(stored.ticks, { [day1]: 'kept', [day2]: 'slip' });
});

test('cheers made apart on different days all arrive, each counted for its own day', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const plan = await fam.by(fam.ava)('POST', '/api/plans', avaPlan(id, { share: 'giver', days: 7 }));
  const dadPhone = await linkedPhone(fam, fam.dad);
  dadPhone.client.disconnected();
  const days = [];
  for (const cheer of ['noticed', 'proud']) {
    days.push(fam.clock.today());
    await dadPhone.api('POST', `/api/plans/${plan.ref}/cheer`, { cheer });
    fam.clock.advance(DAY);
  }
  const r = await dadPhone.sync();
  assert.deepEqual([r.sent, r.failed.length], [2, 0]);
  assert.deepEqual(fam.store.getPlan(plan.id).cheers.map((c) => [c.cheer, c.day]), [['noticed', days[0]], ['proud', days[1]]]);
});

test('“keep going” gives a full new round, even when the wrap-up comes late', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const ava = fam.by(fam.ava);
  const onTime = await ava('POST', '/api/plans', avaPlan(id, { days: 7 }));
  const late = await ava('POST', '/api/plans', avaPlan(id, { days: 7 }));
  fam.clock.advance(6 * DAY); // the last day
  const a = await ava('POST', `/api/plans/${onTime.ref}/wrap`, { outcome: 'keep' });
  assert.equal(a.roundStart, addDays(fam.clock.today(), 1), 'the next round starts tomorrow');
  assert.equal(planProgress(a, fam.clock.today()).endDate, addDays(fam.clock.today(), 7));
  fam.clock.advance(20 * DAY); // three weeks late
  const b = await ava('POST', `/api/plans/${late.ref}/wrap`, { outcome: 'keep' });
  const today = fam.clock.today();
  assert.equal(b.roundStart, today, 'a late “keep going” starts today');
  const pr = planProgress(b, today);
  assert.deepEqual([pr.ended, pr.halfway, pr.endDate, pr.round], [false, false, addDays(today, 6), 2]);
  assert.equal(planTodo(b, today), 'tick', 'not asked to wrap up again straight away');
  assert.equal((await fam.by(fam.dad)('GET', '/api/plans')).shared.length, 0);
});

test('a plan starts on the day the device asks for, within limits', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  fam.clock.advance(31 * MIN);
  const ava = fam.by(fam.ava);
  const today = fam.clock.today();
  const start = async (startDate) => {
    const p = await ava('POST', '/api/plans', avaPlan(id, { startDate }));
    await ava('DELETE', `/api/plans/${p.ref}`);
    return p.startDate;
  };
  assert.equal(await start(addDays(today, -1)), addDays(today, -1), 'a phone just before midnight');
  assert.equal(await start(addDays(today, 1)), addDays(today, 1), 'a phone just after midnight');
  assert.equal(await start(addDays(today, 2)), today, 'not in the future');
  assert.equal(await start(addDays(today, -5)), today, 'not before the message arrived');
  assert.equal(await start('2026-02-30'), today, 'a real date');
  assert.equal(await start(undefined), today);
  const { clientDay } = await import('../public/shared/plans.js');
  assert.equal(clientDay('2026-02-30', '2026-03-01'), '2026-03-01', 'a date that doesn’t exist is not used');
  assert.equal(clientDay('2026-02-28', '2026-03-01'), '2026-02-28');
});

test('the sender is told about new reactions and replies until they have seen them', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  const dad = fam.by(fam.dad);
  const ava = fam.by(fam.ava);
  assert.equal((await dad('GET', '/api/state')).me.responses, 0);
  await ava('POST', `/api/feedback/${id}/respond`, { reaction: 'thanks' });
  assert.equal((await dad('GET', '/api/state')).me.responses, 1);
  let [r] = await dad('GET', '/api/responses');
  assert.deepEqual([r.feedbackId, r.by.name, r.reaction, r.reply, r.modelName], [id, 'Ava', 'thanks', null, 'Glow & Grow']);
  assert.equal((await dad('GET', '/api/sent'))[0].recipients[0].newResponse, true);
  await dad('POST', '/api/responses/seen', { ids: [id + 100] });
  assert.equal((await dad('GET', '/api/state')).me.responses, 1, 'only the ones named are marked seen');
  await dad('POST', '/api/responses/seen', { ids: [id] });
  assert.equal((await dad('GET', '/api/state')).me.responses, 0);
  assert.deepEqual(await dad('GET', '/api/responses'), []);
  assert.equal((await dad('GET', '/api/sent'))[0].recipients[0].newResponse, false);
  // A reply after the break is new again; sending the same reaction again is not.
  fam.clock.advance(31 * MIN);
  await ava('POST', `/api/feedback/${id}/respond`, { reaction: 'thanks' });
  assert.equal((await dad('GET', '/api/state')).me.responses, 0);
  await ava('POST', `/api/feedback/${id}/respond`, { reply: 'I’ll try.' });
  [r] = await dad('GET', '/api/responses');
  assert.deepEqual([r.reaction, r.reply], ['thanks', 'I’ll try.']);
  await dad('POST', '/api/responses/seen', {});
  assert.equal((await dad('GET', '/api/state')).me.responses, 0, 'mark all as seen');
});

test('reactions to anonymous messages never reach their sender', async () => {
  const fam = await family();
  const id = await opened(fam, fam.sam, fam.mom, { model: 'kids', anonymous: true, fields: { feeling: 'happy', happened: 'Pancakes!' } });
  await fam.by(fam.mom)('POST', `/api/feedback/${id}/respond`, { reaction: 'thanks' });
  assert.equal((await fam.by(fam.sam)('GET', '/api/state')).me.responses, 0);
  assert.deepEqual(await fam.by(fam.sam)('GET', '/api/responses'), []);
  assert.equal(fam.store.getFeedback(id).respondedAt, undefined);
});

test('a linked phone gets new replies at sync and can mark them seen while apart', async () => {
  const fam = await family();
  const id = await opened(fam, fam.dad, fam.ava);
  const dadPhone = await linkedPhone(fam, fam.dad);
  await fam.by(fam.ava)('POST', `/api/feedback/${id}/respond`, { reaction: 'got-it' });
  await dadPhone.sync();
  dadPhone.client.disconnected();
  assert.equal((await dadPhone.api('GET', '/api/state')).me.responses, 1);
  assert.equal((await dadPhone.api('GET', '/api/responses'))[0].reaction, 'got-it');
  await dadPhone.api('POST', '/api/responses/seen', { ids: [id] });
  assert.equal((await dadPhone.api('GET', '/api/state')).me.responses, 0);
  assert.equal((await dadPhone.api('GET', '/api/sent'))[0].recipients[0].newResponse, false);
  assert.equal(fam.store.getFeedback(id).responseSeen, false, 'not on the home base until the sync');
  await dadPhone.sync();
  assert.equal(fam.store.getFeedback(id).responseSeen, true);
});
