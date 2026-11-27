// A tiny in-memory document store with a pluggable persist() hook.
// The hub persists it to a JSON file; device-only mode persists it to IndexedDB.
// A family's data is small, so one document is simpler and safer than a database.

export const DOC_VERSION = 2;

export function emptyDoc() {
  return {
    version: DOC_VERSION,
    settings: {},
    members: [],
    feedback: [],
    // Plans people made from feedback they received (see plans.js).
    plans: [],
    // Questions people asked others about something they (or forIds: others) did (see asks.js). done: who answered or
    // said Not now, so it leaves their Inbox (never shown to the asker when answers may be anonymous).
    asks: [],
    seq: { member: 0, feedback: 0, group: 0, plan: 0, ask: 0 },
    // Sign-in secrets, never included in backups. peers: linked phones, keyed by a hash of their key.
    // ops: random ids of changes already applied from linked phones, so a retry isn't applied twice.
    // push: devices to notify (home hub), pushDue: when each person's next push is due (so a hub
    // restart doesn't lose one waiting out the anonymous delay), vapid: the hub's push signing key.
    // pinLocks: wrong PIN tries per person (see verifyPin in core.js).
    hub: { sessions: {}, invites: {}, peers: {}, ops: {}, push: {}, pushDue: {}, vapid: null, pinLocks: {} },
  };
}

function normalize(doc) {
  const base = emptyDoc();
  const d = doc && typeof doc === 'object' ? doc : base;
  return {
    ...base,
    ...d,
    settings: { ...(d.settings || {}) },
    members: Array.isArray(d.members) ? d.members : [],
    feedback: Array.isArray(d.feedback) ? d.feedback : [],
    plans: Array.isArray(d.plans) ? d.plans : [],
    // A question saved before it could be for someone else is for whoever asked it.
    asks: Array.isArray(d.asks) ? d.asks.map((a) => (Array.isArray(a.forIds) && a.forIds.length ? a : { ...a, forIds: [a.fromId] })) : [],
    seq: { ...base.seq, ...(d.seq || {}) },
    hub: {
      sessions: { ...(d.hub?.sessions || {}) }, invites: { ...(d.hub?.invites || {}) },
      peers: { ...(d.hub?.peers || {}) }, ops: { ...(d.hub?.ops || {}) },
      push: { ...(d.hub?.push || {}) }, pushDue: { ...(d.hub?.pushDue || {}) }, vapid: d.hub?.vapid || null,
      pinLocks: { ...(d.hub?.pinLocks || {}) },
    },
    version: DOC_VERSION,
  };
}

// Saves made close together share one write: once a family has thousands of messages each write
// takes a while, and a burst (everyone sending at once) would otherwise queue a write per change.
// Every caller still waits until its change is written.
const soon = globalThis.setImmediate ?? ((fn) => setTimeout(fn, 0));
function coalesce(write) {
  let queued = null;
  return () => {
    queued ??= new Promise((resolve, reject) => {
      soon(() => {
        queued = null;
        Promise.resolve().then(write).then(resolve, reject);
      });
    });
    return queued;
  };
}

export function createDocStore(initial, persist = async () => {}) {
  let doc = normalize(initial);
  const save = coalesce(() => persist(doc));

  /** A random id no message or group uses yet, for anonymous messages (see insertFeedback). */
  function randomId() {
    for (;;) {
      const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
      const id = 1e9 + (hi % 2 ** 20) * 2 ** 32 + lo; // well past any counted id, within safe integers
      if (!doc.feedback.some((f) => f.id === id || f.groupId === id)) return id;
    }
  }

  return {
    raw: () => doc,
    save,
    async replace(next) {
      doc = normalize(next);
      await save();
    },

    getSetting: (key, fallback) => (key in doc.settings ? doc.settings[key] : fallback),
    async setSetting(key, value) {
      doc.settings[key] = value;
      await save();
    },

    listMembers: () => doc.members.slice(),
    getMember: (id) => doc.members.find((m) => m.id === Number(id)) || null,
    async insertMember(member) {
      const id = ++doc.seq.member;
      doc.members.push({ ...member, id });
      await save();
      return id;
    },
    async updateMember(id, changes) {
      const m = doc.members.find((x) => x.id === Number(id));
      if (m) Object.assign(m, changes);
      await save();
    },
    async deleteMember(id) {
      id = Number(id);
      doc.members = doc.members.filter((m) => m.id !== id);
      doc.feedback = doc.feedback.filter((f) => f.toId !== id);
      for (const f of doc.feedback) if (f.fromId === id) f.fromId = null;
      // Their plans go; on other people's plans they are no longer the giver, helper or a cheerer.
      doc.plans = doc.plans.filter((p) => p.ownerId !== id);
      for (const p of doc.plans) {
        if (p.giverId === id) {
          p.giverId = null;
          p.askGiver = false;
          if (p.share === 'giver') p.share = 'private';
        }
        if (p.helperId === id) p.helperId = null;
        p.cheers = p.cheers.filter((c) => c.fromId !== id);
      }
      // Their questions go; on others' questions they are no longer asked, or asked about. A
      // question with nobody left to ask, or nobody left to give feedback to, goes too.
      doc.asks = doc.asks.filter((a) => a.fromId !== id);
      for (const a of doc.asks) {
        a.toIds = a.toIds.filter((x) => x !== id);
        a.done = a.done.filter((x) => x !== id);
        a.forIds = a.forIds.filter((x) => x !== id);
      }
      doc.asks = doc.asks.filter((a) => a.toIds.length && a.forIds.length);
      for (const [k, s] of Object.entries(doc.hub.sessions)) if (s.memberId === id) delete doc.hub.sessions[k];
      for (const [k, i] of Object.entries(doc.hub.invites)) if (i.memberId === id) delete doc.hub.invites[k];
      for (const [k, p] of Object.entries(doc.hub.peers)) if (p.memberId === id) delete doc.hub.peers[k];
      for (const [k, p] of Object.entries(doc.hub.push)) if (p.memberId === id) delete doc.hub.push[k];
      delete doc.hub.pushDue[id];
      delete doc.hub.pinLocks[id];
      await save();
    },

    nextGroupId: () => ++doc.seq.group,
    randomId,
    async insertFeedback(rows) {
      // Anonymous messages get a random id and a random place in the list: a counted id, or the
      // order, would date them against named messages, which keep their exact time.
      const ids = rows.map((row) => {
        const id = row.anonymous ? randomId() : ++doc.seq.feedback;
        const item = { ...row, id };
        if (row.anonymous) doc.feedback.splice(Math.floor(Math.random() * (doc.feedback.length + 1)), 0, item);
        else doc.feedback.push(item);
        return id;
      });
      await save();
      return ids;
    },
    getFeedback: (id) => doc.feedback.find((f) => f.id === Number(id)) || null,
    feedbackTo: (memberId) => doc.feedback.filter((f) => f.toId === memberId),
    feedbackFrom: (memberId) => doc.feedback.filter((f) => f.fromId === memberId),
    feedbackInGroup: (groupId) => doc.feedback.filter((f) => f.groupId === groupId),
    async updateFeedback(id, changes) {
      const f = doc.feedback.find((x) => x.id === Number(id));
      if (f) Object.assign(f, changes);
      await save();
    },
    async deleteFeedback(id) {
      doc.feedback = doc.feedback.filter((f) => f.id !== Number(id));
      await save();
    },

    // Plans are changed in place (see plans.js) and then saved.
    listPlans: () => doc.plans.slice(),
    getPlan: (id) => doc.plans.find((p) => p.id === Number(id)) || null,
    async insertPlan(plan) {
      const id = ++doc.seq.plan;
      doc.plans.push({ ...plan, id });
      await save();
      return id;
    },
    async deletePlan(id) {
      doc.plans = doc.plans.filter((p) => p.id !== Number(id));
      await save();
    },

    // Questions are changed in place (done) and then saved.
    listAsks: () => doc.asks.slice(),
    getAsk: (id) => doc.asks.find((a) => a.id === Number(id)) || null,
    async insertAsk(ask) {
      const id = ++doc.seq.ask;
      doc.asks.push({ ...ask, id });
      await save();
      return id;
    },
    async deleteAsk(id) {
      doc.asks = doc.asks.filter((a) => a.id !== Number(id));
      await save();
    },
  };
}
