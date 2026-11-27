// The app's rules, shared by the home hub (Node) and device-only mode (browser).
// Both call handle(method, path, body, ctx); only storage, PIN hashing and sessions differ.
import { MODELS, getModel, modelsFor, validateFields } from './models.js';
import { checkFields } from './tone.js';
import { HttpError } from './errors.js';
import { ANON_ASK_MIN, ASK_HELP, ASK_MAX, helpLabel } from './asks.js';
import {
  CALM_REACTIONS, addDays, applyCheckin, applyCheer, applyNoticed, applyShare, applyTick, applyWrap, checkCalm, checkOnePlanPerMessage, checkPlan,
  clientDay, daysBetween, localDate, newPlan, ownerView, plansDue, replyAfter, sharedView, sharedWith,
} from './plans.js';

export { HttpError };

export const REACTIONS = ['thanks', 'got-it', 'talk', 'disagree'];
// PIN guessing: five tries, then a wait that doubles with each further wrong try (1 minute, 2, 4…
// up to an hour). Kept with the family's data, so a restart or reload doesn't reset it.
const MAX_PIN_FAILURES = 5;
const LOCKOUT_MS = 60_000;
const MAX_LOCKOUT_MS = 3600e3;
const FORGET_FAILURES_MS = 864e5; // a day without wrong tries starts afresh

function cleanName(name) {
  const v = typeof name === 'string' ? name.trim() : '';
  if (!v || v.length > 40) throw new HttpError(400, 'Name is required (max 40 characters).');
  return v;
}

const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (graphemeSegmenter ? [...graphemeSegmenter.segment(s)].length : [...s].length);

// One emoji can be several code points (👨‍👩‍👧, 🇯🇵, 👋🏽), so count what people see.
function cleanEmoji(emoji) {
  const v = typeof emoji === 'string' ? emoji.trim() : '';
  if (!v) return '🙂';
  if (v.length > 32 || graphemes(v) > 2) throw new HttpError(400, 'Pick one emoji for the picture.');
  return v;
}

function checkPin(pin) {
  if (pin === undefined || pin === null || pin === '') return null;
  if (!/^\d{4,8}$/.test(String(pin))) throw new HttpError(400, 'PIN must be 4 to 8 digits.');
  return String(pin);
}

export function publicMember(m) {
  return {
    id: m.id, name: m.name, emoji: m.emoji, role: m.role,
    isParent: !!m.isParent, hasPin: !!m.pinHash, welcomed: !!m.welcomedAt,
    guest: !!m.guest, guestUntil: m.guest ? m.guestUntil || null : null, active: isActive(m),
  };
}

// Guests stop working after their end date (inclusive, local calendar date of the device/hub).
export function isActive(m, today = localDate()) {
  return !m.guest || !m.guestUntil || today <= m.guestUntil;
}

// Works on stored members and on the public copies a linked phone caches (which carry `active`).
const activeMember = (m, today) => ('active' in m ? !!m.active : isActive(m, today));

function resolveRecipients(me, members, body, today) {
  const others = members.filter((m) => m.id !== me.id && activeMember(m, today));
  if (body.to === 'everyone') {
    // "Everyone" means the household: guests are reached one-to-one or in a group instead.
    const family = others.filter((m) => !m.guest);
    if (!family.length) throw new HttpError(400, 'Add more family members first.');
    return { audience: 'everyone', recipients: family };
  }
  const raw = Array.isArray(body.toIds) ? body.toIds : body.toId != null ? [body.toId] : [];
  const ids = [...new Set(raw.map(Number))];
  if (!ids.length) throw new HttpError(400, 'Choose who the feedback is for.');
  if (ids.includes(me.id)) throw new HttpError(400, 'You cannot send feedback to yourself.');
  const recipients = ids.map((id) => others.find((m) => m.id === id));
  if (recipients.some((r) => !r)) throw new HttpError(404, 'Choose who the feedback is for.');
  return { audience: recipients.length === 1 ? 'one' : 'some', recipients };
}

/**
 * Every rule a message must pass before it is stored. The home base runs it when saving, and a
 * linked phone runs it before queueing a message, so a queued message is not rejected later.
 */
export function checkFeedback({ me, members, body, allowAnonymous, today = localDate() }) {
  const { audience, recipients } = resolveRecipients(me, members, body, today);
  const model = getModel(body.model);
  if (!model || !modelsFor(me.role).includes(model)) throw new HttpError(400, 'Choose a feedback style.');
  const { ok, errors, clean } = validateFields(model, body.fields);
  if (!ok) throw new HttpError(400, errors[0], { errors });

  const anonymous = !!body.anonymous;
  if (anonymous && !allowAnonymous) throw new HttpError(400, 'Anonymous feedback is turned off for this family.');

  const hurtful = checkFields(clean).filter((t) => t.level === 'hurtful');
  if (hurtful.length) {
    if (anonymous || recipients.some((r) => r.role === 'kid')) {
      throw new HttpError(422, 'Some words could really hurt. Please rephrase before sending.', { tone: hurtful });
    }
    if (!body.confirmTone) {
      throw new HttpError(422, 'Some words could really hurt. Rephrase, or confirm you want to send it as is.', { tone: hurtful, canConfirm: true });
    }
  }
  return { audience, recipients, model, clean, anonymous };
}

/**
 * Every rule a question must pass (asking people for feedback on something you did). The home base
 * runs it when saving, and a linked phone before queueing.
 */
export function checkAsk({ me, members, body, allowAnonymous, today = localDate() }) {
  const { audience, recipients } = resolveRecipients(me, members, body, today);
  const what = typeof body.what === 'string' ? body.what.trim() : '';
  if (!what) throw new HttpError(400, 'Say what you did, so they know what you mean.');
  if (what.length > ASK_MAX) throw new HttpError(400, `Keep what you did to ${ASK_MAX} characters.`);
  const help = ASK_HELP.some((h) => h.id === body.help) ? body.help : 'both';
  const model = getModel(body.model);
  if (!model) throw new HttpError(400, 'Choose how they should answer.');
  const anonymous = !!body.anonymous;
  if (anonymous && !allowAnonymous) throw new HttpError(400, 'Anonymous feedback is turned off for this family.');
  if (anonymous && recipients.length < ANON_ASK_MIN) {
    throw new HttpError(400, `Anonymous answers need ${ANON_ASK_MIN} or more people, so nobody can tell who said what.`);
  }
  return { audience, recipients, what, help, model, anonymous };
}

/**
 * The rules for an answer to a question, on top of checkFeedback's. `ask` is what the person
 * answering knows: who asked (fromId), whether answers may be anonymous, the style to answer in
 * (answerModel) and how many were asked (count). When answers may be anonymous, every answer is,
 * in the same style, so neither a name nor the style can single anyone out.
 */
export function checkAnswer({ ask, recipients, model, anonymous }) {
  if (recipients.length !== 1 || recipients[0].id !== ask.fromId) throw new HttpError(400, 'An answer goes to the person who asked.');
  if (!ask.anonymous) {
    if (anonymous) throw new HttpError(400, 'This question asked for answers with your name.');
    return;
  }
  if (ask.count < ANON_ASK_MIN) throw new HttpError(404, 'This question isn’t open any more.');
  if (!anonymous) throw new HttpError(400, 'Answers to this question come without names, so send it anonymously.');
  if (model.id !== ask.answerModel) {
    throw new HttpError(400, `Everyone answers this question with ${getModel(ask.answerModel)?.name || 'the same style'}, so the style doesn’t give anyone away.`);
  }
}

const brief = (m) => (m ? { id: m.id, name: m.name, emoji: m.emoji } : null);
const newestFirst = (a, b) => (b.createdAt.localeCompare(a.createdAt)) || (b.id - a.id);

/**
 * @param {object} o
 * @param {ReturnType<import('./store.js').createDocStore>} o.store
 * @param {{hash(pin:string):Promise<string>, verify(pin:string, stored:string):Promise<boolean>}} o.pins
 * @param {'hub'|'device'} o.mode
 * @param {(memberIds: number[]) => void} [o.onActivity] someone has something new (the hub sends a push)
 * @param {(at: string) => void} [o.onHold] an anonymous message is held until `at` (the hub then calls releaseHeld)
 * @param {[number, number]} [o.anonymousHoldMs] on the hub, how long anonymous messages wait (random in this range)
 */
export function createCore({
  store, pins, mode, now = () => new Date(), onActivity = () => {}, onHold = () => {}, anonymousHoldMs = [3600e3, 3 * 3600e3],
}) {
  const pinLocks = () => store.raw().hub.pinLocks;

  /** Checks someone's PIN against the shared limit on guessing (sign-in, profile changes, new phones). */
  async function verifyPin(member, pin, wrong = 'That PIN is not right.') {
    const t = Date.now();
    const lock = pinLocks()[member.id] ?? { count: 0, until: 0, last: 0 };
    if (lock.until > t) {
      const mins = Math.ceil((lock.until - t) / 60_000);
      throw new HttpError(429, `Too many tries. Wait ${mins === 1 ? 'a minute' : `${mins} minutes`} and try again.`);
    }
    // Count the try before checking it (checking takes a while): guesses sent all at once must not
    // all see "no tries yet" and get past the limit.
    const count = (t - lock.last > FORGET_FAILURES_MS ? 0 : lock.count) + 1;
    const until = count >= MAX_PIN_FAILURES ? t + Math.min(LOCKOUT_MS * 2 ** (count - MAX_PIN_FAILURES), MAX_LOCKOUT_MS) : 0;
    pinLocks()[member.id] = { count, until, last: t };
    const ok = await pins.verify(String(pin ?? ''), member.pinHash);
    if (ok) delete pinLocks()[member.id];
    await store.save();
    if (!ok) throw new HttpError(401, wrong);
  }
  const iso = () => now().toISOString();
  // Messages held back (see visibleAfter in POST /api/feedback) stay out of sight until their time comes.
  const isDelivered = (f) => !f.visibleAfter || f.visibleAfter <= iso();
  const delivered = (memberId) => store.feedbackTo(memberId).filter(isDelivered);
  const today = () => localDate(now());

  // A person's own plans (active first, then newest), and plans others shared with them that are
  // still going or ended in the last 30 days.
  function plansFor(me) {
    const all = store.listPlans();
    const order = (a, b) => ((a.status !== 'active') - (b.status !== 'active')) || b.createdAt.localeCompare(a.createdAt);
    const recent = (p) => p.status === 'active' || (p.endedAt && daysBetween(p.endedAt.slice(0, 10), today()) <= 30);
    return {
      mine: all.filter((p) => p.ownerId === me.id).sort(order).map((p) => ownerView(p, store.getMember)),
      shared: all.filter((p) => sharedWith(p, me) && recent(p)).sort(order).map((p) => sharedView(p, me, store.getMember)),
    };
  }
  // Plans are found by id, or by the id a linked phone gave a plan it made while apart.
  function findPlan(ref, me) {
    const r = String(ref ?? '');
    if (/^\d+$/.test(r)) return store.getPlan(r);
    return (/^c[a-z0-9]{8,32}$/.test(r) && store.listPlans().find((p) => p.ownerId === me.id && p.clientId === r.slice(1))) || null;
  }
  function ownPlan(ctx, ref) {
    const me = requireMember(ctx);
    const p = findPlan(ref, me);
    if (!p || p.ownerId !== me.id) throw new HttpError(404, 'Plan not found.');
    return p;
  }
  function seenPlan(ctx, ref) {
    const me = requireMember(ctx);
    const p = findPlan(ref, me);
    if (!p || !sharedWith(p, me)) throw new HttpError(404, 'Plan not found.');
    return p;
  }

  const requireMember = (ctx) => {
    if (!ctx.me) throw new HttpError(401, 'Please sign in.');
    return ctx.me;
  };
  const requireParent = (ctx) => {
    const me = requireMember(ctx);
    if (!me.isParent) throw new HttpError(403, 'Only parents can do that.');
    return me;
  };

  function family() {
    return {
      name: store.getSetting('familyName', 'Our Family'),
      allowAnonymous: store.getSetting('allowAnonymous', true),
    };
  }

  function sortedMembers() {
    return store.listMembers().sort((a, b) =>
      (!!a.guest - !!b.guest) || (b.isParent - a.isParent) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  function state(me) {
    const linked = {};
    if (mode === 'device' && me?.isParent) {
      for (const p of Object.values(store.raw().hub?.peers || {})) linked[p.memberId] = (linked[p.memberId] || 0) + 1;
    }
    return {
      mode,
      setupDone: store.listMembers().length > 0,
      family: family(),
      members: sortedMembers().map((m) => (me?.isParent && mode === 'device' ? { ...publicMember(m), linkedPhones: linked[m.id] || 0 } : publicMember(m))),
      me: me ? {
        ...publicMember(me), unread: delivered(me.id).filter((f) => !f.readAt).length, plansDue: plansDue(plansFor(me), today()),
        responses: store.feedbackFrom(me.id).filter((f) => f.respondedAt && !f.responseSeen && store.getMember(f.toId)).length,
        asks: asksForMe(me).length,
      } : null,
      models: me ? modelsFor(me.role) : MODELS,
    };
  }

  function modelInfo(id) {
    const model = getModel(id);
    return { modelName: model ? model.name : id, modelEmoji: model ? model.emoji : '💬' };
  }

  function inboxItem(f, viewer, planRefs) {
    const viewerId = viewer.id;
    const item = {
      id: f.id, model: f.model, ...modelInfo(f.model), fields: f.fields, anonymous: !!f.anonymous,
      createdAt: f.createdAt, read: !!f.readAt, reaction: f.reaction ?? null, reply: f.reply ?? null,
      // Replies wait for a short break after the message is first opened (see plans.js).
      replyAfter: replyAfter(f.readAt, viewer.role), planRef: planRefs.get(f.id) ?? null,
      audience: f.audience || 'one', others: null,
      from: f.anonymous ? null : brief(store.getMember(f.fromId)) || { id: null, name: 'Former member', emoji: '👋' },
      // An answer to a question you asked shows what it answers.
      askWhat: f.askId ? store.getAsk(f.askId)?.what ?? null : null,
    };
    // Never list recipients of anonymous messages: whoever is missing from the list would be the sender.
    if (item.audience === 'some' && !f.anonymous) {
      item.others = store.feedbackInGroup(f.groupId).filter((x) => x.toId !== viewerId).map((x) => brief(store.getMember(x.toId))).filter(Boolean);
    }
    return item;
  }

  function sentGroups(me) {
    const meId = me.id;
    const groups = new Map();
    // Plans the recipient made from a message and chose to show the sender.
    const planFrom = new Set(store.listPlans().filter((p) => p.feedbackId && sharedWith(p, me)).map((p) => p.feedbackId));
    for (const f of store.feedbackFrom(meId).sort(newestFirst)) {
      const key = f.groupId ?? `single-${f.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          groupId: key, model: f.model, ...modelInfo(f.model), fields: f.fields, createdAt: f.createdAt,
          audience: f.audience || 'one', recipients: [],
        });
      }
      const m = store.getMember(f.toId);
      if (m) groups.get(key).recipients.push({
        ...brief(m), feedbackId: f.id, read: !!f.readAt, reaction: f.reaction ?? null, reply: f.reply ?? null, planShared: planFrom.has(f.id),
        newResponse: !!(f.respondedAt && !f.responseSeen),
      });
    }
    return [...groups.values()].filter((g) => g.recipients.length);
  }

  async function memberFromBody(body, { partial = false, existing = null } = {}) {
    const out = {};
    if (!partial || body.name !== undefined) out.name = cleanName(body.name);
    if (!partial || body.emoji !== undefined) out.emoji = cleanEmoji(body.emoji);
    if (!partial || body.role !== undefined) {
      if (!['adult', 'kid'].includes(body.role)) throw new HttpError(400, 'Role must be "adult" or "kid".');
      out.role = body.role;
    }
    if (!partial || body.isParent !== undefined) out.isParent = !!body.isParent;
    if (!partial || body.guest !== undefined) out.guest = !!body.guest;
    if (!partial || body.guestUntil !== undefined) {
      const until = typeof body.guestUntil === 'string' ? body.guestUntil.trim() : '';
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new HttpError(400, 'Guest end date must look like 2026-12-31.');
      out.guestUntil = until || null;
    }
    const role = out.role ?? existing?.role;
    if ((out.isParent ?? existing?.isParent) && role === 'kid') throw new HttpError(400, 'Kids cannot be parents.');
    if ((out.isParent ?? existing?.isParent) && (out.guest ?? existing?.guest)) throw new HttpError(400, 'Guests cannot be parents.');
    if (body.pin !== undefined) {
      const pin = checkPin(body.pin);
      out.pinHash = pin ? await pins.hash(pin) : null;
    }
    return out;
  }

  function ownedFeedback(ctx, id) {
    const me = requireMember(ctx);
    const f = store.getFeedback(id);
    if (!f || f.toId !== me.id || !isDelivered(f)) throw new HttpError(404, 'Feedback not found.');
    return f;
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/api\/state$/, ({ ctx }) => state(ctx.me));

  route('POST', /^\/api\/setup$/, async ({ ctx, body }) => {
    if (store.listMembers().length) throw new HttpError(409, 'Family is already set up.');
    const familyName = typeof body.familyName === 'string' && body.familyName.trim() ? body.familyName.trim().slice(0, 60) : 'Our Family';
    const m = await memberFromBody({ ...body, role: 'adult', isParent: true });
    await store.setSetting('familyName', familyName);
    await store.setSetting('allowAnonymous', body.allowAnonymous !== false);
    const id = await store.insertMember({ pinHash: null, ...m, createdAt: iso(), welcomedAt: iso() });
    await ctx.signIn(id);
    return state(store.getMember(id));
  });

  route('POST', /^\/api\/login$/, async ({ ctx, body }) => {
    const member = store.getMember(body.memberId);
    if (!member) throw new HttpError(404, 'Member not found.');
    if (!isActive(member)) throw new HttpError(403, 'This guest pass has ended. Ask a parent to extend it.');
    if (member.pinHash) await verifyPin(member, body.pin);
    // On the hub, a sign-in from the tiles is for a shared computer unless the person keeps it.
    await ctx.signIn(member.id, { shared: body.keep !== true });
    return { ok: true };
  });

  route('POST', /^\/api\/logout$/, async ({ ctx }) => {
    await ctx.signOut();
    return { ok: true };
  });

  route('POST', /^\/api\/welcome$/, async ({ ctx }) => {
    const me = requireMember(ctx);
    await store.updateMember(me.id, { welcomedAt: iso() });
    return { ok: true };
  });

  route('PATCH', /^\/api\/settings$/, async ({ ctx, body }) => {
    requireParent(ctx);
    if (typeof body.familyName === 'string' && body.familyName.trim()) await store.setSetting('familyName', body.familyName.trim().slice(0, 60));
    if (typeof body.allowAnonymous === 'boolean') await store.setSetting('allowAnonymous', body.allowAnonymous);
    return family();
  });

  route('POST', /^\/api\/members$/, async ({ ctx, body }) => {
    requireParent(ctx);
    const m = await memberFromBody(body);
    const id = await store.insertMember({ pinHash: null, ...m, createdAt: iso(), welcomedAt: null });
    return publicMember(store.getMember(id));
  });

  route('PATCH', /^\/api\/members\/(\d+)$/, async ({ ctx, body, params: [id] }) => {
    const me = requireMember(ctx);
    const target = store.getMember(id);
    if (!target) throw new HttpError(404, 'Member not found.');
    const isSelf = me.id === target.id;
    if (!me.isParent) {
      // Non-parents may only change their own name, emoji and PIN.
      if (!isSelf || ['role', 'isParent', 'guest', 'guestUntil'].some((k) => body[k] !== undefined)) throw new HttpError(403, 'Only parents can do that.');
      if (target.pinHash && body.pin !== undefined) await verifyPin(target, body.currentPin, 'Current PIN is not right.');
    }
    const changes = await memberFromBody(body, { partial: true, existing: target });
    if (target.isParent && changes.isParent === false && store.listMembers().filter((m) => m.isParent).length <= 1) {
      throw new HttpError(400, 'The family needs at least one parent.');
    }
    await store.updateMember(target.id, changes);
    // A new (or removed) PIN ends that person's other sign-ins and drops their other devices'
    // notifications: the reason to change a PIN is often a lost or shared phone.
    if (changes.pinHash !== undefined) await ctx.pinChanged?.(target.id, { self: isSelf, keepEndpoint: isSelf ? body.pushEndpoint : null });
    return publicMember(store.getMember(target.id));
  });

  route('DELETE', /^\/api\/members\/(\d+)$/, async ({ ctx, params: [id] }) => {
    const me = requireParent(ctx);
    if (me.id === Number(id)) throw new HttpError(400, 'You cannot remove yourself.');
    if (!store.getMember(id)) throw new HttpError(404, 'Member not found.');
    await store.deleteMember(id);
    return { ok: true };
  });

  route('POST', /^\/api\/feedback$/, async ({ ctx, body }) => {
    const me = requireMember(ctx);
    const { audience, recipients, model, clean, anonymous } = checkFeedback({
      me, members: store.listMembers(), body, allowAnonymous: family().allowAnonymous, today: localDate(now()),
    });
    // An answer to a question: it goes to whoever asked, and is anonymous when (and only when) they allowed it.
    const ask = body.askId != null ? openAskFor(me, body.askId) : null;
    if (ask) checkAnswer({ ask: answerView(ask, me), recipients, model, anonymous });

    // Anonymous: no sender id and only the date, so the time sent cannot reveal who wrote it.
    // The date is the family's local calendar date (stored at noon UTC, shown in UTC), so an
    // evening message never shows tomorrow's date.
    // Held back for a random while, so it doesn't show up (or ping anyone) just as its sender puts
    // their phone down: on the hub 1 to 3 hours, shown together with its notification; through a
    // phone sync 1 to 6 hours, as the home base would otherwise show it right after "Synced with Sam".
    const createdAt = anonymous ? `${localDate(now())}T12:00:00.000Z` : iso();
    const [min, max] = !anonymous ? [0, 0] : ctx.viaSync ? [3600e3, 6 * 3600e3] : mode === 'hub' ? anonymousHoldMs : [0, 0];
    const visibleAfter = max > 0 ? new Date(now().getTime() + min + Math.random() * (max - min)).toISOString() : null;
    const groupId = anonymous ? store.randomId() : store.nextGroupId();
    // Answered before saving, so a second answer sent at the same moment finds the question closed.
    if (ask) ask.done.push(me.id);
    let ids;
    try {
      ids = await store.insertFeedback(recipients.map((r) => ({
        groupId, audience, toId: r.id, fromId: anonymous ? null : me.id, anonymous, model: model.id,
        fields: clean, createdAt, readAt: null, reaction: null, reply: null, ...(visibleAfter && { visibleAfter }), ...(ask && { askId: ask.id }),
      })));
    } catch (err) {
      if (ask) ask.done.splice(ask.done.lastIndexOf(me.id), 1);
      throw err;
    }
    if (visibleAfter) onHold(visibleAfter);
    else onActivity(recipients.map((r) => r.id));
    return { ids, groupId, audience, count: recipients.length, anonymous, ...(visibleAfter && !ctx.viaSync && { held: true }) };
  });

  route('GET', /^\/api\/inbox$/, ({ ctx }) => {
    const me = requireMember(ctx);
    const planRefs = new Map();
    for (const p of store.listPlans().filter((x) => x.ownerId === me.id && x.feedbackId).sort((a, b) => a.id - b.id)) planRefs.set(p.feedbackId, String(p.id));
    return delivered(me.id).sort(newestFirst).map((f) => inboxItem(f, me, planRefs));
  });

  route('GET', /^\/api\/sent$/, ({ ctx }) => sentGroups(requireMember(ctx)));

  route('POST', /^\/api\/feedback\/(\d+)\/read$/, async ({ ctx, body, params: [id] }) => {
    const f = ownedFeedback(ctx, id);
    // A linked phone opened it earlier, while apart, and says when: the break counts from then.
    const at = typeof body.at === 'string' ? Date.parse(body.at) : NaN;
    const readAt = Number.isFinite(at) && at <= now().getTime() ? new Date(at).toISOString() : iso();
    if (!f.readAt) await store.updateFeedback(f.id, { readAt });
    return { ok: true };
  });

  route('POST', /^\/api\/feedback\/(\d+)\/respond$/, async ({ ctx, body, params: [id] }) => {
    const me = requireMember(ctx);
    const f = ownedFeedback(ctx, id);
    const reaction = body.reaction !== undefined ? body.reaction : f.reaction ?? null;
    if (reaction !== null && !REACTIONS.includes(reaction)) throw new HttpError(400, 'Unknown reaction.');
    let reply = f.reply ?? null;
    if (body.reply !== undefined) {
      if (f.anonymous) throw new HttpError(400, 'Anonymous feedback cannot receive written replies.');
      reply = typeof body.reply === 'string' && body.reply.trim() ? body.reply.trim().slice(0, 1000) : null;
    }
    const until = replyAfter(f.readAt || iso(), me.role);
    if (reply && reply !== f.reply) checkCalm(until, now(), 'write back');
    if (reaction && reaction !== f.reaction && !CALM_REACTIONS.includes(reaction)) checkCalm(until, now(), 'say you see it differently');
    // Something new for the sender to see in their Inbox (never for anonymous messages: no sender).
    const added = (reaction && reaction !== (f.reaction ?? null)) || (reply && reply !== (f.reply ?? null));
    const news = added && f.fromId ? { respondedAt: iso(), responseSeen: false } : !reaction && !reply ? { responseSeen: true } : {};
    await store.updateFeedback(f.id, { reaction, reply, readAt: f.readAt || iso(), ...news });
    if (news.respondedAt) onActivity([f.fromId]);
    return { ok: true, reaction, reply };
  });

  // Replies and reactions to what I sent that I haven't seen yet, newest first.
  const newResponses = (me) => store.feedbackFrom(me.id).filter((f) => f.respondedAt && !f.responseSeen && store.getMember(f.toId));

  route('GET', /^\/api\/responses$/, ({ ctx }) => newResponses(requireMember(ctx))
    .sort((a, b) => b.respondedAt.localeCompare(a.respondedAt))
    .map((f) => ({
      feedbackId: f.id, groupId: f.groupId ?? `single-${f.id}`, by: brief(store.getMember(f.toId)),
      reaction: f.reaction ?? null, reply: f.reply ?? null, respondedAt: f.respondedAt, model: f.model, ...modelInfo(f.model), fields: f.fields,
    })));

  route('POST', /^\/api\/responses\/seen$/, async ({ ctx, body }) => {
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map(Number)) : null;
    for (const f of newResponses(requireMember(ctx))) if (!ids || ids.has(f.id)) f.responseSeen = true;
    await store.save();
    return { ok: true };
  });

  route('DELETE', /^\/api\/feedback\/(\d+)$/, async ({ ctx, params: [id] }) => {
    const f = ownedFeedback(ctx, id);
    await store.deleteFeedback(f.id);
    return { ok: true };
  });

  // ---------- asking for feedback (shared parts in asks.js) ----------
  // A question allowing anonymous answers closes if anonymous feedback is turned off or fewer than
  // ANON_ASK_MIN people are left to ask (someone was removed): too few to hide among.
  const answerable = (a) => !a.anonymous || (family().allowAnonymous && a.toIds.length >= ANON_ASK_MIN);
  const answerView = (a, me) => ({ fromId: a.fromId, anonymous: !!a.anonymous, answerModel: a.model, count: a.toIds.length });

  // Questions waiting for this person: not answered, not put aside, from someone still in the family.
  function asksForMe(me) {
    return store.listAsks()
      .filter((a) => a.toIds.includes(me.id) && !a.done.includes(me.id) && answerable(a))
      .map((a) => ({ a, from: store.getMember(a.fromId) }))
      .filter(({ from }) => from && isActive(from))
      .sort((x, y) => y.a.createdAt.localeCompare(x.a.createdAt) || y.a.id - x.a.id)
      .map(({ a, from }) => {
        const model = a.model;
        return {
          id: a.id, from: brief(from), what: a.what, help: a.help, helpLabel: helpLabel(a.help), model, ...modelInfo(model),
          anonymous: !!a.anonymous, audience: a.audience, count: a.toIds.length, createdAt: a.createdAt,
        };
      });
  }
  function openAskFor(me, id) {
    const ask = store.getAsk(id);
    const from = ask && store.getMember(ask.fromId);
    if (!ask || !ask.toIds.includes(me.id) || ask.done.includes(me.id) || !from || !isActive(from) || !answerable(ask)) {
      throw new HttpError(404, 'This question isn’t open any more.');
    }
    return ask;
  }
  // What I asked, and how many answers have arrived. Names only when answers can't be anonymous:
  // otherwise who answered, and when, would point to who wrote what. Held answers aren't counted yet.
  function myAsks(me) {
    return store.listAsks().filter((a) => a.fromId === me.id)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.id - x.id)
      .map((a) => {
        const answers = delivered(me.id).filter((f) => f.askId === a.id);
        return {
          id: a.id, what: a.what, help: a.help, helpLabel: helpLabel(a.help), model: a.model, ...modelInfo(a.model),
          anonymous: !!a.anonymous, audience: a.audience, createdAt: a.createdAt, closed: !answerable(a),
          recipients: a.toIds.map((id) => brief(store.getMember(id))).filter(Boolean),
          answered: answers.length,
          answeredBy: a.anonymous ? null : [...new Set(answers.map((f) => f.fromId))].map((id) => brief(store.getMember(id))).filter(Boolean),
        };
      });
  }

  route('GET', /^\/api\/asks$/, ({ ctx }) => {
    const me = requireMember(ctx);
    return { forMe: asksForMe(me), mine: myAsks(me) };
  });

  route('POST', /^\/api\/asks$/, async ({ ctx, body }) => {
    const me = requireMember(ctx);
    const { audience, recipients, what, help, model, anonymous } = checkAsk({
      me, members: store.listMembers(), body, allowAnonymous: family().allowAnonymous, today: localDate(now()),
    });
    const id = await store.insertAsk({
      fromId: me.id, audience, toIds: recipients.map((r) => r.id), what, help, model: model.id, anonymous, createdAt: iso(), done: [],
    });
    onActivity(recipients.map((r) => r.id));
    return { id, audience, count: recipients.length, anonymous };
  });

  // Not now: the question leaves this person's Inbox. The asker isn't told.
  route('POST', /^\/api\/asks\/(\d+)\/dismiss$/, async ({ ctx, params: [id] }) => {
    const ask = openAskFor(requireMember(ctx), id);
    ask.done.push(ctx.me.id);
    await store.save();
    return { ok: true };
  });

  // Stop asking: the question leaves everyone's Inbox; answers that arrived stay.
  route('DELETE', /^\/api\/asks\/(\d+)$/, async ({ ctx, params: [id] }) => {
    const me = requireMember(ctx);
    const ask = store.getAsk(id);
    if (!ask || ask.fromId !== me.id) throw new HttpError(404, 'Question not found.');
    await store.deleteAsk(ask.id);
    return { ok: true };
  });

  // ---------- plans made from feedback (rules in plans.js) ----------
  const PLAN = '(\\d+|c[a-z0-9]{8,32})';
  const planPath = (suffix = '') => new RegExp(`^/api/plans/${PLAN}${suffix}$`);
  const mineView = (p) => ownerView(p, store.getMember);

  route('GET', /^\/api\/plans$/, ({ ctx }) => plansFor(requireMember(ctx)));

  route('POST', /^\/api\/plans$/, async ({ ctx, body }) => {
    const me = requireMember(ctx);
    // A plan a linked phone made while apart carries the id the phone gave it; sent twice, it is kept once.
    const clientId = typeof body.clientId === 'string' && /^[a-z0-9]{8,32}$/.test(body.clientId) ? body.clientId : null;
    const existing = clientId && store.listPlans().find((p) => p.ownerId === me.id && p.clientId === clientId);
    if (existing) return mineView(existing);
    let source;
    if (body.fromPlanId != null) {
      // "Change the plan" at the wrap-up: a new plan from the same message.
      const old = findPlan(body.fromPlanId, me);
      if (!old || old.ownerId !== me.id) throw new HttpError(404, 'Plan not found.');
      source = { feedbackId: old.feedbackId, giverId: old.giverId, earliest: old.startDate };
    } else {
      const f = ownedFeedback(ctx, body.feedbackId);
      checkOnePlanPerMessage(me, store.listPlans().some((p) => p.ownerId === me.id && p.feedbackId === f.id));
      checkCalm(replyAfter(f.readAt || iso(), me.role), now(), 'make a plan');
      // A linked phone may sync days after making the plan; it starts on the phone's day, never before the message.
      source = { feedbackId: f.id, giverId: f.anonymous ? null : f.fromId ?? null, earliest: addDays(f.createdAt.slice(0, 10), -1) };
    }
    const fields = checkPlan({
      me, body, source, today: today(),
      members: store.listMembers().filter((m) => isActive(m, today())),
      activeCount: store.listPlans().filter((p) => p.ownerId === me.id && p.status === 'active').length,
    });
    const id = await store.insertPlan(newPlan(fields, { ownerId: me.id, clientId, at: iso() }));
    return mineView(store.getPlan(id));
  });

  route('PATCH', planPath(), async ({ ctx, body, params: [ref] }) => {
    const p = ownPlan(ctx, ref);
    applyShare(p, body.share);
    await store.save();
    return mineView(p);
  });

  route('DELETE', planPath(), async ({ ctx, params: [ref] }) => {
    await store.deletePlan(ownPlan(ctx, ref).id);
    return { ok: true };
  });

  route('POST', planPath('/tick'), async ({ ctx, body, params: [ref] }) => {
    const p = ownPlan(ctx, ref);
    applyTick(p, body, today());
    await store.save();
    return mineView(p);
  });

  // Check-ins, wrap-ups and cheers happen on the day the person's device says (see clientDay), so
  // ones made on a linked phone apart count for the day they were made, not the day it synced.
  const dayOf = (body, p) => clientDay(body.day, today(), addDays(p.startDate, -1));

  route('POST', planPath('/checkin'), async ({ ctx, body, params: [ref] }) => {
    const p = ownPlan(ctx, ref);
    applyCheckin(p, body, dayOf(body, p), iso());
    await store.save();
    return mineView(p);
  });

  route('POST', planPath('/wrap'), async ({ ctx, body, params: [ref] }) => {
    const p = ownPlan(ctx, ref);
    const waiting = p.askGiver && !p.noticed;
    applyWrap(p, body, dayOf(body, p), iso());
    await store.save();
    // A fresh question for the giver: the first time, or again in a later round after they answered.
    if (p.askGiver && !p.noticed && !waiting) onActivity([p.giverId]);
    return mineView(p);
  });

  route('POST', planPath('/cheer'), async ({ ctx, body, params: [ref] }) => {
    const p = seenPlan(ctx, ref);
    applyCheer(p, { fromId: ctx.me.id }, body.cheer, dayOf(body, p), iso());
    await store.save();
    onActivity([p.ownerId]);
    return sharedView(p, ctx.me, store.getMember);
  });

  route('POST', planPath('/noticed'), async ({ ctx, body, params: [ref] }) => {
    const p = seenPlan(ctx, ref);
    applyNoticed(p, ctx.me.id === p.giverId, body.answer, iso());
    await store.save();
    onActivity([p.ownerId]);
    return sharedView(p, ctx.me, store.getMember);
  });

  // Backups only exist in device-only mode, where losing the device (or browser storage) loses everything.
  if (mode === 'device') {
    // Before linking a phone to someone with a PIN, they type it on the home base (see peer-host).
    route('POST', /^\/api\/members\/(\d+)\/verify-pin$/, async ({ ctx, body, params: [id] }) => {
      requireParent(ctx);
      const m = store.getMember(id);
      if (!m) throw new HttpError(404, 'Member not found.');
      if (m.pinHash) await verifyPin(m, body.pin);
      return { ok: true };
    });
    // Forget every phone linked to this person; they must be linked again in person.
    route('DELETE', /^\/api\/members\/(\d+)\/phones$/, async ({ ctx, params: [id] }) => {
      requireParent(ctx);
      if (!store.getMember(id)) throw new HttpError(404, 'Member not found.');
      const peers = store.raw().hub.peers;
      for (const [k, p] of Object.entries(peers)) if (p.memberId === Number(id)) delete peers[k];
      await store.save();
      return { ok: true };
    });
    route('GET', /^\/api\/backup$/, ({ ctx }) => {
      requireParent(ctx);
      const { hub, ...doc } = structuredClone(store.raw());
      return { app: 'family-feedback', exportedAt: iso(), doc };
    });
    route('POST', /^\/api\/restore$/, async ({ ctx, body }) => {
      requireParent(ctx);
      const doc = body?.doc;
      if (body?.app !== 'family-feedback' || !doc || !Array.isArray(doc.members) || !doc.members.some((m) => m.isParent)) {
        throw new HttpError(400, 'That file is not an Echoes backup.');
      }
      await store.replace(doc);
      await ctx.signOut();
      return { ok: true };
    });
  }

  async function handle(method, path, body, ctx) {
    // On a device the held anonymous messages are let go as they come due (the hub does it with a
    // timer), so their time isn't kept, or put in backups, once they show.
    if (mode === 'device') await releaseHeld();
    // An expired guest is treated as signed out everywhere.
    const scoped = ctx.me && !isActive(ctx.me) ? { ...ctx, me: null } : ctx;
    for (const r of routes) {
      const m = r.method === method && path.match(r.pattern);
      if (m) return r.handler({ ctx: scoped, body: body && typeof body === 'object' ? body : {}, params: m.slice(1) });
    }
    throw new HttpError(404, 'Not found.');
  }

  // The hub: held messages whose time has come are shown (the stored time is dropped, so the file
  // no longer hints when they were written). Returns who has something new.
  async function releaseHeld() {
    const t = iso();
    const ids = new Set();
    for (const f of store.raw().feedback) {
      if (f.visibleAfter && f.visibleAfter <= t) {
        delete f.visibleAfter;
        ids.add(f.toId);
      }
    }
    if (ids.size) await store.save();
    return [...ids];
  }
  const nextHeld = () => store.raw().feedback.reduce((next, f) => (f.visibleAfter && (!next || f.visibleAfter < next) ? f.visibleAfter : next), null);

  return { handle, state, requireParent, isActive, releaseHeld, nextHeld, verifyPin };
}
