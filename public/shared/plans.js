// After feedback arrives: a short break before replying, then an optional small plan made from it.
// Shared by the hub and device-only mode (through core.js) and by a linked phone working apart
// (peer-client.js), so a change made apart is checked the same way and not refused at the next sync.
import { HttpError } from './errors.js';

// ---------- the break before replying ----------

export const COOL_OFF_MINUTES = { adult: 30, kid: 10 };
// These say "I got it" calmly, so they never wait. "I see it differently", a written reply and a
// plan wait until the break is over. The break counts from when the message was first opened.
export const CALM_REACTIONS = ['thanks', 'got-it', 'talk'];

export const coolOffMs = (role) => (role === 'kid' ? COOL_OFF_MINUTES.kid : COOL_OFF_MINUTES.adult) * 60_000;

/** When someone who first opened a message at `readAt` may reply (ISO), or null while unread. */
export function replyAfter(readAt, role) {
  return readAt ? new Date(new Date(readAt).getTime() + coolOffMs(role)).toISOString() : null;
}

/** Throws while the break that ends at `until` is still running. `what` finishes "You can … in N minutes". */
export function checkCalm(until, now, what) {
  const left = new Date(until).getTime() - now.getTime();
  if (left > 0) {
    const mins = Math.ceil(left / 60_000);
    throw new HttpError(409, `Take a short break first. You can ${what} in ${mins} minute${mins === 1 ? '' : 's'}.`, { calmUntil: new Date(until).toISOString() });
  }
}

// ---------- calendar days (the family's local dates, as YYYY-MM-DD) ----------

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const utc = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(utc(s)).toISOString().slice(0, 10) === s;
export const addDays = (date, n) => new Date(utc(date) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 864e5);

/**
 * The day a phone or browser says something happened on, by its own calendar: a linked phone
 * syncs days later, and two clocks can sit either side of midnight. Accepted if it is a real date
 * no later than tomorrow, at most 60 days back and not before `earliest`; otherwise today.
 */
export function clientDay(asked, today, earliest = null) {
  if (!isDate(asked) || asked > addDays(today, 1) || asked < addDays(today, -60) || (earliest && asked < earliest)) return today;
  return asked;
}

// ---------- plans ----------

export const MAX_ACTIVE_PLANS = 2;
export const MAX_CHEERS = 200;
export const PLAN_DAYS = { adult: [7, 14, 30], kid: [7, 14] };
// private: only the owner (and a kid's helper). giver: also whoever sent the message. family: everyone but guests.
export const SHARES = ['private', 'giver', 'family'];
export const WRAP_OUTCOMES = ['finish', 'keep', 'change'];
export const CHEERS = [
  { id: 'noticed', emoji: '👀', label: 'I noticed' },
  { id: 'proud', emoji: '🙌', label: 'Proud of you' },
  { id: 'keep-going', emoji: '💪', label: 'Keep going' },
];
export const FEELINGS = [
  { id: 'good', emoji: '😊', label: 'Going well' },
  { id: 'okay', emoji: '😐', label: 'Okay' },
  { id: 'hard', emoji: '😣', label: 'Hard' },
];
export const NOTICED = [
  { id: 'yes', emoji: '🌟', label: 'Yes, a lot' },
  { id: 'little', emoji: '🙂', label: 'A little' },
  { id: 'not-yet', emoji: '⏳', label: 'Not yet' },
];
// Kids pick a picture promise; its "When I…, I'll…" step is filled in for them and can be changed.
export const KID_PROMISES = [
  { id: 'calm-voice', emoji: '🤫', label: 'Use my calm voice', when: 'feel cross', then: 'take three big breaths first' },
  { id: 'listen', emoji: '👂', label: 'Listen the first time', when: 'someone asks me something', then: 'stop, look and answer' },
  { id: 'kind-words', emoji: '🌈', label: 'Use kind words', when: 'feel grumpy', then: 'say how I feel instead of mean words' },
  { id: 'gentle', emoji: '✋', label: 'Keep my hands gentle', when: 'feel angry', then: 'squeeze my hands and use words' },
  { id: 'share', emoji: '🤝', label: 'Share and take turns', when: 'someone wants a turn', then: 'count to ten and pass it' },
  { id: 'tidy', emoji: '🧸', label: 'Tidy up my things', when: 'finish playing', then: 'put my things back' },
  { id: 'screens', emoji: '📱', label: 'Screen off when asked', when: 'hear “time’s up”', then: 'finish my turn and switch off' },
  { id: 'sorry', emoji: '💬', label: 'Say sorry and fix it', when: 'hurt someone’s feelings', then: 'say sorry and ask how to help' },
];
const ANONYMOUS_SHARE = 'That message was anonymous, so the plan can be just yours or shared with the family.';

function text(value, max, label, required = true) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s && required) throw new HttpError(400, `Please fill in ${label}.`);
  if (s.length > max) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} can be up to ${max} characters.`);
  return s;
}

/**
 * Checks a new plan and returns the fields to store.
 * @param {object} o
 * @param {{id:number, role:string}} o.me the owner
 * @param {Array} o.members active family members as the caller sees them
 * @param {object} o.body what the person filled in
 * @param {{feedbackId:number|null, giverId:number|null, earliest?:string}} o.source the message it comes from; giverId is null when anonymous; earliest is the first day the plan may start on
 * @param {number} o.activeCount the owner's plans still going
 * @param {string} o.today the local date; the plan starts then, or on the day the device asked for (see clientDay)
 */
export function checkPlan({ me, members, body, source, activeCount, today }) {
  if (activeCount >= MAX_ACTIVE_PLANS) throw new HttpError(409, 'You already have two plans going. Finish or stop one first.');
  const kid = me.role === 'kid';
  const days = Number(body.days);
  if (!PLAN_DAYS[kid ? 'kid' : 'adult'].includes(days)) throw new HttpError(400, kid ? 'Pick 7 or 14 days.' : 'Pick 7, 14 or 30 days.');
  let promiseId = null;
  let promise;
  if (kid) {
    const pick = KID_PROMISES.find((p) => p.id === body.promiseId);
    if (!pick) throw new HttpError(400, 'Pick a promise.');
    promiseId = pick.id;
    promise = pick.label;
  } else {
    promise = text(body.promise, 120, 'your promise');
  }
  const when = text(body.when, 120, '“When I…”');
  const then = text(body.then, 120, '“I’ll…”');
  const heard = text(body.heard, 400, 'what you heard', !kid);
  const share = body.share === undefined ? 'private' : body.share;
  if (!SHARES.includes(share)) throw new HttpError(400, 'Choose who can see the plan.');
  if (share === 'giver' && !source.giverId) throw new HttpError(400, ANONYMOUS_SHARE);
  let helperId = null;
  if (kid) {
    const helper = members.find((m) => m.id === Number(body.helperId));
    if (!helper || helper.role !== 'adult' || helper.guest) throw new HttpError(400, 'Pick a grown-up to be your helper.');
    helperId = helper.id;
  }
  return {
    kid, promiseId, promise, when, then, heard, days, share, helperId,
    giverId: source.giverId ?? null, feedbackId: source.feedbackId ?? null, startDate: clientDay(body.startDate, today, source.earliest),
  };
}

/** A stored plan, from checkPlan's fields. */
export function newPlan(fields, { ownerId, clientId = null, at }) {
  return {
    ...fields, clientId, ownerId, rounds: 1, roundStart: fields.startDate, status: 'active', ticks: {}, checkins: [], wrap: null,
    askGiver: false, noticed: null, cheers: [], createdAt: at, endedAt: null,
  };
}

/**
 * Where a plan is on `today`. "Keep going" at the wrap-up starts another round of the same length
 * (roundStart), the day after the last one ended or, if the wrap-up came late, on the wrap-up day.
 * The day count runs from the very first day, so a late wrap-up's gap is included.
 */
export function planProgress(p, today) {
  const round = p.rounds || 1;
  const roundStart = p.roundStart || addDays(p.startDate, p.days * (round - 1));
  const endDate = addDays(roundStart, p.days - 1);
  const total = daysBetween(p.startDate, endDate) + 1;
  const day = Math.min(total, Math.max(1, daysBetween(p.startDate, today) + 1));
  const inRound = daysBetween(roundStart, today) + 1;
  return { total, endDate, day, round, ended: today >= endDate, halfway: inRound >= Math.ceil(p.days / 2) };
}

export const keptDays = (p) => Object.values(p.ticks || {}).filter((v) => v === 'kept').length;

/** Who besides the owner sees a plan. Never the days missed: see sharedView. */
export function sharedWith(p, viewer) {
  if (!viewer || viewer.id === p.ownerId) return false;
  if (viewer.id === p.helperId) return true;
  if (p.share === 'giver') return viewer.id === p.giverId;
  if (p.share === 'family') return !viewer.guest || viewer.id === p.giverId;
  return false;
}

const mustBeActive = (p) => {
  if (p.status !== 'active') throw new HttpError(409, 'This plan has finished.');
};

// The changes below are checked before anything is changed, so a refused one changes nothing.
// They work on a stored plan and on the owner's copy a linked phone keeps (same field names).

export function applyTick(p, body, today) {
  mustBeActive(p);
  const { endDate } = planProgress(p, today);
  const { date } = body;
  // One day ahead is allowed: a phone and the home base can be either side of midnight.
  if (!isDate(date) || date < p.startDate || date > endDate || date > addDays(today, 1)) throw new HttpError(400, 'Pick a day from this plan.');
  const value = body.value ?? null;
  if (value !== null && value !== 'kept' && value !== 'slip') throw new HttpError(400, 'Mark the day as kept or not.');
  if (value) p.ticks[date] = value;
  else delete p.ticks[date];
}

export function applyCheckin(p, body, today, at) {
  mustBeActive(p);
  const pr = planProgress(p, today);
  if (!pr.halfway) throw new HttpError(409, 'The check-in opens halfway through.');
  if (!FEELINGS.some((f) => f.id === body.feeling)) throw new HttpError(400, 'Pick how it’s going.');
  const note = text(body.note, 300, 'your note', false);
  p.checkins = [...(p.checkins || []).filter((c) => c.round !== pr.round), { round: pr.round, feeling: body.feeling, note, at }];
}

export function applyWrap(p, body, today, at) {
  mustBeActive(p);
  const pr = planProgress(p, today);
  if (!pr.ended) throw new HttpError(409, 'You can wrap up on the plan’s last day.');
  if (!WRAP_OUTCOMES.includes(body.outcome)) throw new HttpError(400, 'Pick finish, keep going or change the plan.');
  const note = text(body.note, 300, 'your note', false);
  p.wrap = { round: pr.round, outcome: body.outcome, note, at };
  // The person who gave the feedback is asked only if they can see the plan.
  if (body.askGiver && p.giverId && p.share !== 'private') {
    p.askGiver = true;
    p.noticed = null;
  }
  if (body.outcome === 'keep') {
    const next = addDays(pr.endDate, 1);
    p.rounds = pr.round + 1;
    p.roundStart = today > next ? today : next;
  } else {
    p.status = 'done';
    p.endedAt = at;
  }
}

export function applyShare(p, share) {
  if (!SHARES.includes(share)) throw new HttpError(400, 'Choose who can see the plan.');
  if (share === 'giver' && !p.giverId) throw new HttpError(400, ANONYMOUS_SHARE);
  p.share = share;
  if (share === 'private') p.askGiver = false;
}

/** `who` is { fromId } on a stored plan, or { from } (a member's name and emoji) in a phone's copy. */
export function applyCheer(p, who, cheer, today, at) {
  mustBeActive(p);
  if (!CHEERS.some((c) => c.id === cheer)) throw new HttpError(400, 'Pick a cheer.');
  const id = who.fromId ?? who.from?.id;
  if (p.cheers.some((c) => (c.fromId ?? c.from?.id) === id && c.day === today)) throw new HttpError(409, 'You already cheered today. Cheer again tomorrow.');
  p.cheers.push({ ...who, cheer, day: today, at });
  if (p.cheers.length > MAX_CHEERS) p.cheers.splice(0, p.cheers.length - MAX_CHEERS);
}

/** The person who gave the feedback answers "Have you noticed a difference?". */
export function applyNoticed(p, isGiver, answer, at) {
  if (!isGiver || !p.askGiver) throw new HttpError(404, 'Plan not found.');
  if (!NOTICED.some((n) => n.id === answer)) throw new HttpError(400, 'Pick an answer.');
  p.noticed = { answer, at };
}

// ---------- what each person sees ----------

const brief = (m) => (m ? { id: m.id, name: m.name, emoji: m.emoji } : null);
const cheersView = (p, getMember) => p.cheers
  .map((c) => ({ cheer: c.cheer, day: c.day, at: c.at, from: brief(getMember(c.fromId)) }))
  .filter((c) => c.from);

/** The owner sees everything, including the days they missed. */
export function ownerView(p, getMember) {
  const { ownerId, cheers, ...rest } = p;
  return {
    ...structuredClone(rest), ref: String(p.id), mine: true,
    giver: brief(getMember(p.giverId)), helper: brief(getMember(p.helperId)), cheers: cheersView(p, getMember),
  };
}

/** Everyone else sees the promise, the day count, how many days went well and the cheers. */
export function sharedView(p, viewer, getMember) {
  const isGiver = viewer.id === p.giverId;
  return {
    id: p.id, ref: String(p.id), mine: false, owner: brief(getMember(p.ownerId)),
    kid: p.kid, promiseId: p.promiseId, promise: p.promise, when: p.when, then: p.then, heard: p.heard,
    days: p.days, rounds: p.rounds, roundStart: p.roundStart, startDate: p.startDate, status: p.status, endedAt: p.endedAt, share: p.share,
    keptDays: keptDays(p), cheers: cheersView(p, getMember),
    youAreGiver: isGiver, youAreHelper: viewer.id === p.helperId,
    askGiver: isGiver && p.askGiver, noticed: isGiver ? p.noticed : null,
  };
}

/** What a plan needs from this person today: 'tick', 'checkin', 'wrap', 'noticed' or null. */
export function planTodo(v, today) {
  if (v.failed) return null;
  if (!v.mine) return v.askGiver && !v.noticed ? 'noticed' : null;
  if (v.status !== 'active') return null;
  const pr = planProgress(v, today);
  if (pr.ended) return 'wrap';
  if (pr.halfway && !(v.checkins || []).some((c) => c.round === pr.round)) return 'checkin';
  return v.ticks?.[today] ? null : 'tick';
}

export const plansDue = (plans, today) => [...(plans?.mine || []), ...(plans?.shared || [])].filter((v) => planTodo(v, today)).length;
