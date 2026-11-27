// The linked-phone side of phone-to-phone sync. While connected to the home base, requests go
// straight to it. Apart, the phone shows what it last saw and queues what the person does, then
// sends the queue in order at the next sync. It only ever holds its own person's messages.
import { checkAnswer, checkAsk, checkFeedback, HttpError, REACTIONS } from './core.js';
import { getModel } from './models.js';
import { helpLabel } from './asks.js';
import {
  CALM_REACTIONS, KID_PROMISES, addDays, applyCheckin, applyCheer, applyNoticed, applyShare, applyTick, applyWrap,
  checkCalm, checkPlan, clientDay, localDate, newPlan, plansDue, replyAfter,
} from './plans.js';

// A plan is named by its id, or, if this phone made it while apart, by "c" and the id it gave it.
const PLAN_REF = '(\\d+|c[a-z0-9]{8,32})';
const QUEUEABLE = [
  ['POST', /^\/api\/feedback$/],
  ['POST', /^\/api\/feedback\/(\d+)\/read$/],
  ['POST', /^\/api\/feedback\/(\d+)\/respond$/],
  ['DELETE', /^\/api\/feedback\/(\d+)$/],
  ['POST', /^\/api\/welcome$/],
  ['POST', /^\/api\/plans$/],
  ['POST', /^\/api\/responses\/seen$/],
  ['PATCH', new RegExp(`^/api/plans/${PLAN_REF}$`)],
  ['DELETE', new RegExp(`^/api/plans/${PLAN_REF}$`)],
  ['POST', new RegExp(`^/api/plans/${PLAN_REF}/(tick|checkin|wrap|cheer|noticed)$`)],
  ['POST', /^\/api\/asks$/],
  ['POST', /^\/api\/asks\/(\d+)\/dismiss$/],
  ['DELETE', /^\/api\/asks\/(\d+)$/],
];
// Refused at the sync, these are kept and shown with the reason; any other refused change is dropped.
const KEEP_IF_REFUSED = ['/api/feedback', '/api/plans', '/api/asks'];
const brief = (m) => (m ? { id: m.id, name: m.name, emoji: m.emoji } : null);

const newOp = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

const emptyCache = () => ({ state: null, inbox: [], sent: [], plans: { mine: [], shared: [] }, responses: [], asks: { forMe: [], mine: [] } });
const emptyRecord = () => ({ link: null, cache: emptyCache(), outbox: [], failed: [], lastSyncAt: null, seq: 0, revoked: null });

function offline(message = 'Bring your phone to the home base and sync to do this.') {
  const err = new HttpError(409, message);
  err.offline = true;
  return err;
}

/**
 * @param {object} o
 * @param {{load(): Promise<any>, save(rec: any): Promise<void>}} o.storage
 */
export async function createPeerClient({ storage, now = () => new Date() }) {
  let rec = { ...emptyRecord(), ...((await storage.load()) || {}) };
  rec.cache = { ...emptyCache(), ...rec.cache }; // a phone linked before plans existed has none cached
  let conn = null;
  const save = () => storage.save(rec);

  const status = () => ({
    linked: !!rec.link, connected: !!conn, lastSyncAt: rec.lastSyncAt,
    pending: rec.outbox.length, failed: rec.failed.length, family: rec.link?.family || null,
    // Why this phone can't be used any more, if so: the home base refused it, or its guest pass ended.
    blocked: rec.revoked || (guestEnded() ? 'Your guest pass has ended. Ask a parent to extend it, then sync.' : null),
  });

  function guestEnded() {
    const me = rec.cache.state?.me;
    if (!me?.guest || !me.guestUntil) return false;
    const d = now();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return today > me.guestUntil;
  }

  function cachedState() {
    const base = rec.cache.state || {
      setupDone: true, family: rec.link?.family || { name: 'Our Family', allowAnonymous: true },
      members: rec.link ? [rec.link.member] : [], me: rec.link?.member || null, models: [],
    };
    const me = base.me ? {
      ...base.me, unread: rec.cache.inbox.filter((f) => !f.read).length, plansDue: plansDue(rec.cache.plans, localDate(now())),
      responses: rec.cache.responses.length, asks: rec.cache.asks.forMe.length,
    } : null;
    return { ...base, me };
  }

  const withPeer = (state) => ({ ...state, mode: 'peer', peer: status() });

  function pendingGroups() {
    const members = rec.cache.state?.members || [];
    const toGroup = (item, extra) => {
      const b = item.body;
      const ids = b.to === 'everyone' ? members.filter((m) => m.id !== rec.link?.member.id && m.active && !m.guest).map((m) => m.id) : b.toIds || [];
      return {
        groupId: item.id, model: b.model, fields: b.fields, createdAt: item.createdAt, anonymous: !!b.anonymous,
        audience: b.to === 'everyone' ? 'everyone' : ids.length > 1 ? 'some' : 'one',
        recipients: ids.map((id) => members.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, read: false, reaction: null, reply: null })),
        ...extra,
      };
    };
    const isSend = (i) => i.method === 'POST' && i.path === '/api/feedback';
    return [
      ...rec.failed.filter(isSend).map((i) => toGroup(i, { failed: true, error: i.error })),
      ...rec.outbox.filter(isSend).map((i) => toGroup(i, { pending: true })),
    ];
  }

  // Plans this phone made that the home base refused, with its reason, until discarded.
  const failedPlans = () => rec.failed.filter((i) => i.method === 'POST' && i.path === '/api/plans').map((i) => ({
    failed: true, id: i.id, error: i.error, promise: i.body.promise || KID_PROMISES.find((k) => k.id === i.body.promiseId)?.label || 'A plan',
  }));

  // Questions this phone asked that are waiting to be sent, or that the home base refused.
  function pendingAsks() {
    const members = rec.cache.state?.members || [];
    const toAsk = (item, extra) => {
      const b = item.body;
      const ids = b.to === 'everyone' ? members.filter((m) => m.id !== rec.link?.member.id && m.active && !m.guest).map((m) => m.id) : b.toIds || [];
      const model = getModel(b.model);
      return {
        id: item.id, what: b.what, help: b.help, helpLabel: helpLabel(b.help), model: b.model, modelName: model?.name || b.model, modelEmoji: model?.emoji || '💬',
        anonymous: !!b.anonymous, createdAt: item.createdAt, answered: 0, answeredBy: b.anonymous ? null : [],
        recipients: ids.map((id) => members.find((m) => m.id === id)).filter(Boolean).map(brief), ...extra,
      };
    };
    const isAsk = (i) => i.method === 'POST' && i.path === '/api/asks';
    return [...rec.failed.filter(isAsk).map((i) => toAsk(i, { failed: true, error: i.error })), ...rec.outbox.filter(isAsk).map((i) => toAsk(i, { pending: true }))];
  }
  const asksWithPending = (asks) => ({ forMe: asks.forMe || [], mine: [...pendingAsks(), ...(asks.mine || [])] });

  async function queue(method, path, body, op) {
    rec.seq += 1;
    rec.outbox.push({ id: `q${rec.seq}`, op: op || newOp(), method, path, body, createdAt: now().toISOString() });
    await save();
  }

  // What happens while apart: check it the way the home base will, update the copy, queue it.
  async function offlineRequest(method, path, body, op) {
    if (method === 'GET' && path === '/api/state') return withPeer(cachedState());
    if (method === 'GET' && path === '/api/inbox') return structuredClone(rec.cache.inbox);
    if (method === 'GET' && path === '/api/sent') return [...pendingGroups(), ...structuredClone(rec.cache.sent)];
    if (method === 'GET' && path === '/api/plans') return { ...structuredClone(rec.cache.plans), failed: failedPlans() };
    if (method === 'GET' && path === '/api/responses') return structuredClone(rec.cache.responses);
    if (method === 'GET' && path === '/api/asks') return asksWithPending(structuredClone(rec.cache.asks));
    if (!QUEUEABLE.some(([m, re]) => m === method && re.test(path))) throw offline();
    const blocked = status().blocked;
    if (blocked) throw offline(blocked);

    const state = cachedState();
    if (!state.me) throw offline('Link this phone to your family first.');
    const itemId = Number((path.match(/\/api\/feedback\/(\d+)/) || [])[1]);
    const item = itemId ? rec.cache.inbox.find((f) => f.id === itemId) : null;
    if (itemId && !item) throw new HttpError(404, 'Feedback not found.');
    if (path.startsWith('/api/plans')) return offlinePlan(method, path, body, op, state);
    if (path === '/api/responses/seen') {
      // Seen here while apart: clear them from this phone now, and tell the home base at the next sync.
      const ids = Array.isArray(body.ids) ? new Set(body.ids.map(Number)) : null;
      rec.cache.responses = rec.cache.responses.filter((r) => ids && !ids.has(r.feedbackId));
      for (const g of rec.cache.sent) for (const r of g.recipients || []) if (!ids || ids.has(r.feedbackId)) r.newResponse = false;
      await queue(method, path, body, op);
      return { ok: true, queued: true };
    }
    const at = now().toISOString();

    if (path.startsWith('/api/asks')) {
      if (path === '/api/asks') {
        const res = checkAsk({ me: state.me, members: state.members, body, allowAnonymous: state.family.allowAnonymous });
        await queue(method, path, body, op);
        return { queued: true, audience: res.audience, count: res.recipients.length, anonymous: res.anonymous };
      }
      const askId = Number(path.match(/\/api\/asks\/(\d+)/)[1]);
      if (method === 'DELETE') {
        if (!rec.cache.asks.mine.some((a) => a.id === askId)) throw new HttpError(404, 'Question not found.');
        rec.cache.asks.mine = rec.cache.asks.mine.filter((a) => a.id !== askId);
      } else {
        if (!rec.cache.asks.forMe.some((a) => a.id === askId)) throw new HttpError(404, 'This question isn’t open any more.');
        rec.cache.asks.forMe = rec.cache.asks.forMe.filter((a) => a.id !== askId);
      }
      await queue(method, path, body, op);
      return { ok: true, queued: true };
    }
    if (path === '/api/feedback') {
      const res = checkFeedback({ me: state.me, members: state.members, body, allowAnonymous: state.family.allowAnonymous });
      // An answer to a question: the same checks the home base makes, then it leaves the list here.
      if (body.askId != null) {
        const q = rec.cache.asks.forMe.find((a) => a.id === Number(body.askId));
        if (!q) throw new HttpError(404, 'This question isn’t open any more.');
        checkAnswer({ ask: { fromId: q.from.id, anonymous: !!q.anonymous, answerModel: q.model, count: q.count }, recipients: res.recipients, model: res.model, anonymous: res.anonymous });
        rec.cache.asks.forMe = rec.cache.asks.forMe.filter((a) => a.id !== q.id);
      }
      await queue(method, path, body, op);
      return { queued: true, audience: res.audience, count: res.recipients.length, anonymous: res.anonymous };
    }
    if (path.endsWith('/respond')) {
      if (body.reaction !== undefined && body.reaction !== null && !REACTIONS.includes(body.reaction)) throw new HttpError(400, 'Unknown reaction.');
      if (body.reply !== undefined && item.anonymous) throw new HttpError(400, 'Anonymous feedback cannot receive written replies.');
      const reply = body.reply === undefined ? item.reply : typeof body.reply === 'string' && body.reply.trim() ? body.reply.trim().slice(0, 1000) : null;
      // A copy saved before breaks existed has read messages without a time: no wait for those.
      const until = item.read ? item.replyAfter || null : replyAfter(at, state.me.role);
      if (until && reply && reply !== item.reply) checkCalm(until, now(), 'write back');
      if (until && body.reaction && body.reaction !== item.reaction && !CALM_REACTIONS.includes(body.reaction)) checkCalm(until, now(), 'say you see it differently');
      // Opened here first: the home base learns when, so the break counts from then there too.
      if (!item.read) await queue('POST', `/api/feedback/${item.id}/read`, { at }, newOp());
      if (body.reaction !== undefined) item.reaction = body.reaction;
      item.reply = reply;
      item.read = true;
      item.replyAfter = until;
    } else if (path.endsWith('/read')) {
      if (!item.read) {
        item.read = true;
        item.replyAfter = replyAfter(at, state.me.role);
        body = { ...body, at };
      }
    } else if (method === 'DELETE') {
      rec.cache.inbox = rec.cache.inbox.filter((f) => f.id !== itemId);
    } else if (path === '/api/welcome' && rec.cache.state?.me) {
      rec.cache.state.me.welcomed = true;
    }
    await queue(method, path, body, op);
    return { ok: true, queued: true, reaction: item?.reaction, reply: item?.reply };
  }

  // A plan change while apart: checked with the same rules (plans.js), made on the copy, queued.
  async function offlinePlan(method, path, body, op, state) {
    const plans = rec.cache.plans;
    const me = state.me;
    const at = now().toISOString();
    const today = localDate(now());
    const member = (id) => state.members.find((m) => m.id === id) || null;
    if (method === 'POST' && path === '/api/plans') {
      let source;
      if (body.fromPlanId != null) {
        const old = plans.mine.find((p) => p.ref === String(body.fromPlanId));
        if (!old) throw new HttpError(404, 'Plan not found.');
        source = { feedbackId: old.feedbackId, giverId: old.giverId, earliest: old.startDate };
      } else {
        const f = rec.cache.inbox.find((x) => x.id === Number(body.feedbackId));
        if (!f) throw new HttpError(404, 'Feedback not found.');
        const until = f.read ? f.replyAfter : replyAfter(at, me.role);
        if (until) checkCalm(until, now(), 'make a plan');
        source = { feedbackId: f.id, giverId: f.anonymous ? null : f.from?.id ?? null, earliest: addDays(f.createdAt.slice(0, 10), -1) };
      }
      const fields = checkPlan({
        me, body, source, today,
        members: state.members.filter((m) => m.active !== false),
        activeCount: plans.mine.filter((p) => p.status === 'active').length,
      });
      const clientId = newOp().slice(0, 24);
      const { ownerId, ...plan } = newPlan(fields, { ownerId: me.id, clientId, at });
      const view = { ...plan, id: `c${clientId}`, ref: `c${clientId}`, mine: true, pending: true, giver: brief(member(fields.giverId)), helper: brief(member(fields.helperId)) };
      plans.mine.unshift(view);
      const f = source.feedbackId && rec.cache.inbox.find((x) => x.id === source.feedbackId);
      if (f) f.planRef = view.ref;
      // The plan starts on this phone's day, even if it reaches the home base days later.
      await queue(method, path, { ...body, clientId, startDate: fields.startDate }, op);
      return structuredClone(view);
    }
    const [, ref, action] = path.match(/^\/api\/plans\/([^/]+)(?:\/(\w+))?$/);
    // Cheers, check-ins and wrap-ups count for the day they were made here (see clientDay).
    const dayFor = (p) => clientDay(body.day, today, addDays(p.startDate, -1));
    if (action === 'cheer' || action === 'noticed') {
      const v = plans.shared.find((p) => p.ref === ref);
      if (!v) throw new HttpError(404, 'Plan not found.');
      if (action === 'cheer') {
        body = { ...body, day: dayFor(v) };
        applyCheer(v, { from: brief(me) }, body.cheer, body.day, at);
      } else applyNoticed(v, v.youAreGiver, body.answer, at);
      await queue(method, path, body, op);
      return structuredClone(v);
    }
    const v = plans.mine.find((p) => p.ref === ref);
    if (!v) throw new HttpError(404, 'Plan not found.');
    if (method === 'DELETE') {
      plans.mine = plans.mine.filter((p) => p !== v);
      for (const f of rec.cache.inbox) if (f.planRef === ref) f.planRef = null;
    } else if (method === 'PATCH') applyShare(v, body.share);
    else if (action === 'tick') applyTick(v, body, today);
    else if (action === 'checkin') {
      body = { ...body, day: dayFor(v) };
      applyCheckin(v, body, body.day, at);
    } else if (action === 'wrap') {
      body = { ...body, day: dayFor(v) };
      applyWrap(v, body, body.day, at);
    } else throw offline();
    await queue(method, path, body, op);
    return method === 'DELETE' ? { ok: true, queued: true } : structuredClone(v);
  }

  async function remember(method, path, data) {
    if (method !== 'GET') return;
    if (path === '/api/state') {
      const { peer, mode, ...state } = data;
      rec.cache.state = state;
      if (rec.link && state.me) rec.link.member = state.me;
      if (rec.link) rec.link.family = state.family;
    } else if (path === '/api/inbox') rec.cache.inbox = data;
    else if (path === '/api/sent') rec.cache.sent = data;
    else if (path === '/api/plans') rec.cache.plans = { mine: data.mine || [], shared: data.shared || [] };
    else if (path === '/api/responses') rec.cache.responses = data;
    else if (path === '/api/asks') rec.cache.asks = { forMe: data.forMe || [], mine: (data.mine || []).filter((a) => !a.pending && !a.failed) };
    else return;
    await save();
  }

  async function api(method, path, body = {}) {
    if (!rec.link) throw offline('Link this phone to your family first.');
    // Each change gets a random id; if its reply is lost and it is sent again, it isn't applied twice.
    const op = method === 'GET' ? undefined : newOp();
    if (!conn) return offlineRequest(method, path, body, op);
    try {
      const data = await conn.request(method, path, body, op);
      await remember(method, path, data);
      if (method === 'GET' && path === '/api/state') return withPeer(data);
      if (method === 'GET' && path === '/api/sent') return [...pendingGroups(), ...data];
      if (method === 'GET' && path === '/api/plans') return { ...data, failed: failedPlans() };
      if (method === 'GET' && path === '/api/asks') return asksWithPending(data);
      return data;
    } catch (e) {
      // Removed or no longer allowed: stop using the connection so the app falls back to the copy.
      if (e.status === 401) conn = null;
      if (e.status) throw e;
      conn = null; // the connection dropped: carry on from the copy
      return offlineRequest(method, path, body, op);
    }
  }

  // Send the queue in order. A refused message is set aside with its reason; a refused reaction,
  // read mark or removal is dropped, since the fresh inbox fetched next shows how things stand.
  // A dropped connection stops, keeping the rest for next time.
  async function flush() {
    let sent = 0;
    const failedNow = [];
    while (conn && rec.outbox.length) {
      const item = rec.outbox[0];
      try {
        await conn.request(item.method, item.path, item.body, item.op);
        sent += 1;
      } catch (e) {
        if (!e.status) break;
        if (item.method === 'POST' && KEEP_IF_REFUSED.includes(item.path)) {
          const failed = { ...item, error: e.message };
          rec.failed.push(failed);
          failedNow.push(failed);
        }
      }
      rec.outbox.shift();
      await save();
    }
    return { sent, failed: failedNow };
  }

  const closedError = () => new Error('The connection to the home base closed before the sync finished. Try again.');

  async function sync() {
    const result = await flush();
    for (const path of ['/api/state', '/api/inbox', '/api/sent', '/api/plans', '/api/responses', '/api/asks']) {
      if (!conn) throw closedError();
      let data;
      try {
        data = await conn.request('GET', path, {});
      } catch (e) {
        if (!e.status) throw closedError();
        // A home base on an older version has no plans or replies list yet.
        if (path === '/api/plans' && e.status === 404) data = { mine: [], shared: [] };
        else if (path === '/api/responses' && e.status === 404) data = [];
        else if (path === '/api/asks' && e.status === 404) data = { forMe: [], mine: [] };
        else throw e;
      }
      await remember('GET', path, data);
    }
    rec.lastSyncAt = now().toISOString();
    await save();
    return result;
  }

  return {
    api,
    status,
    get link() { return rec.link; },
    // Called once the home base said "ready". Linking again to the same person in the same family
    // keeps what is waiting to send; linking to someone else starts fresh, so nothing crosses over.
    async connected(c, ready) {
      let dropped = 0;
      if (ready.key) {
        const same = rec.link && ready.familyId && rec.link.familyId === ready.familyId && rec.link.member?.id === ready.member.id;
        dropped = same ? 0 : rec.outbox.length + rec.failed.length;
        const link = { key: ready.key, member: ready.member, family: ready.family, familyId: ready.familyId };
        rec = same ? { ...rec, link, revoked: null } : { ...emptyRecord(), link };
        await save();
      } else if (rec.link && ready.familyId && !rec.link.familyId) {
        rec.link.familyId = ready.familyId;
      } else if (rec.link?.familyId && ready.familyId !== rec.link.familyId) {
        // Never send this phone's queue to (or take an inbox from) another family's home base.
        throw Object.assign(new Error('That isn’t this phone’s home base. Sync with your own family’s home base.'), { status: 409 });
      }
      rec.revoked = null;
      conn = c;
      return { ...(await sync()), dropped };
    },
    // The home base refused this phone (unlinked, removed, or guest pass ended): remember why,
    // so the phone says so and stops queuing changes that can never be delivered.
    async refused(message) {
      if (!rec.link) return;
      rec.revoked = message;
      await save();
    },
    disconnected() { conn = null; },
    async discardFailed(id) {
      rec.failed = rec.failed.filter((i) => i.id !== id);
      await save();
    },
    async forget() {
      rec = emptyRecord();
      conn = null;
      await save();
    },
  };
}
