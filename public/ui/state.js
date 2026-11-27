// What the app knows right now (the signed-in state, UI state, the draft) and who is using it.
import { MODELS } from '../shared/models.js';

export let S = null; // state from /api/state
export let api = null; // remote (hub), local (device-only / home base) or peer (linked phone) backend
export const ui = {
  signInId: null, openCards: new Set(), editingId: null, setupEmoji: '🧑', invite: null, inbox: [], installPrompt: null,
  replyDrafts: {}, lastRouteKey: null, draftOwner: undefined, signedOutForPrivacy: false,
};
// mode: give or ask. ask*: a question about something you (or askFor: others) did. answering: the question being answered.
export const blankCompose = () => ({
  mode: 'give', audience: 'one', toIds: [], model: null, fields: {}, drafts: {}, anonymous: false, error: null, canConfirm: false, example: 0,
  askWhat: '', askHelp: 'well', askModel: 'glow-grow', askAnon: false, askFor: null, answering: null,
});
export let compose = blankCompose();

// Drafts survive a reload or an accidental style switch, per person, until sent or signed out.
export const draftKey = () => `ff-draft-${S?.me?.id}`;
export function saveDraft() {
  if (!S?.me) return;
  const { mode, audience, toIds, model, fields, drafts, anonymous, example, askWhat, askHelp, askModel, askAnon, askFor, answering } = compose;
  sessionStorage.setItem(draftKey(), JSON.stringify({ mode, audience, toIds, model, fields, drafts, anonymous, example, askWhat, askHelp, askModel, askAnon, askFor, answering }));
}
export function loadDraft() {
  try {
    return { ...blankCompose(), ...JSON.parse(sessionStorage.getItem(draftKey()) || '{}') };
  } catch {
    return blankCompose();
  }
}
export function clearDraft() {
  if (S?.me) sessionStorage.removeItem(draftKey());
  compose = blankCompose();
}

export const modelById = (id) => MODELS.find((m) => m.id === id);
// Who the question being written is for: you (askFor null, the usual), or the people picked under
// Someone else (still in the family; none yet is an empty list).
export const askForIds = () => (compose.askFor == null ? [S.me.id]
  : compose.askFor.filter((id) => id === S.me.id || S.members.some((m) => m.id === id && m.active)));
export const askIsMine = (ids = askForIds()) => ids.length === 1 && ids[0] === S.me.id;
// A question's people, as answered: who it's for (the asker, unless they asked for someone else).
export const questionFor = (a) => (a.for?.length ? a.for : [a.from]);
export const forOthers = (a) => { const f = questionFor(a); return !(f.length === 1 && f[0].id === a.from.id); };
export const memberById = (id) => S.members.find((m) => m.id === Number(id));
export const isKid = () => S?.me?.role === 'kid';
export const isDevice = () => S?.mode === 'device';
export const isHub = () => S?.mode === 'hub';
export const isPeer = () => S?.mode === 'peer';
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const platform = () => (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ? 'ios' : /CrOS/.test(navigator.userAgent) ? 'chromeos' : 'other');
export const memberTag = (m) => [m.guest ? 'Guest' : m.role === 'kid' ? 'Kid' : 'Grown-up', m.isParent ? 'Parent' : ''].filter(Boolean).join(' · ');

// Other modules can't assign an imported binding, so they change these through setters.
export function setS(v) { S = v; }
export function setApi(v) { api = v; }
export function setCompose(v) { compose = v; }
