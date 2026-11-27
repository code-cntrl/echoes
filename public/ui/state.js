// What the app knows right now (the signed-in state, UI state, the draft) and who is using it.
import { MODELS } from '../shared/models.js';

export let S = null; // state from /api/state
export let api = null; // remote (hub), local (device-only / home base) or peer (linked phone) backend
export const ui = {
  signInId: null, openCards: new Set(), editingId: null, setupEmoji: '🧑', invite: null, inbox: [], installPrompt: null,
  replyDrafts: {}, lastRouteKey: null, draftOwner: undefined, signedOutForPrivacy: false,
};
// mode: give or ask. ask*: a question about something you did. answering: the question being answered.
export const blankCompose = () => ({
  mode: 'give', audience: 'one', toIds: [], model: null, fields: {}, drafts: {}, anonymous: false, error: null, canConfirm: false, example: 0,
  askWhat: '', askHelp: 'well', askModel: 'glow-grow', askAnon: false, answering: null,
});
export let compose = blankCompose();

// Drafts survive a reload or an accidental style switch, per person, until sent or signed out.
export const draftKey = () => `ff-draft-${S?.me?.id}`;
export function saveDraft() {
  if (!S?.me) return;
  const { mode, audience, toIds, model, fields, drafts, anonymous, example, askWhat, askHelp, askModel, askAnon, answering } = compose;
  sessionStorage.setItem(draftKey(), JSON.stringify({ mode, audience, toIds, model, fields, drafts, anonymous, example, askWhat, askHelp, askModel, askAnon, answering }));
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
