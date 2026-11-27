// What taps and changes do (data-action handlers).
import { KID_PROMISES, localDate } from '../shared/plans.js';
import { claimData, peer, useDevice } from './backend.js';
import { plural, toast } from './dom.js';
import { openInvite, renderFamily } from './family.js';
import { renderGive, sendFeedback } from './give.js';
import { isWide, renderInbox } from './inbox.js';
import { afterPlanChange, renderPlans } from './plans.js';
import { b64uBytes, currentPushSub, pushReady, updateNotifyCard } from './push.js';
import { refresh, renderChrome } from './router.js';
import { renderSent } from './sent.js';
import { S, api, blankCompose, clearDraft, compose, isKid, memberById, saveDraft, setCompose, setS, ui } from './state.js';
import { endSync, hostFlow, peerLink, renderSync, syncFailed } from './sync.js';
import { renderSignIn, signIn, signOut } from './welcome.js';

export function setPressed(el) {
  el.parentElement.querySelectorAll('.chip').forEach((c) => {
    const on = c === el;
    c.classList.toggle('selected', on);
    c.setAttribute('aria-pressed', on);
  });
}

export const actions = {
  async retry() { await refresh(); },
  // Take the family data over from another window; that window stops using it.
  async 'use-here'() {
    await claimData({ take: true });
    location.reload();
  },
  async logout() {
    await signOut();
  },
  async install() {
    ui.installPrompt?.prompt();
    ui.installPrompt = null;
  },
  'pick-emoji'(el) {
    ui[el.dataset.name] = el.dataset.emoji;
    setPressed(el);
  },
  async 'pick-signin'(el) {
    const m = memberById(el.dataset.id);
    ui.signInId = m.id;
    if (m.hasPin) return renderSignIn();
    await signIn(m.id);
  },
  async 'toggle-card'(el) {
    const id = Number(el.dataset.id);
    const f = ui.inbox.find((x) => x.id === id);
    ui.openAsk = null; // a message takes the reading pane
    // Wide: the row selects the message for the reading pane. Narrow: it opens or closes in place.
    if (!isWide() && ui.openCards.has(id)) ui.openCards.delete(id);
    else {
      ui.openCards.add(id);
      ui.lastOpened = id;
      if (!f.read) {
        await api('POST', `/api/feedback/${id}/read`);
        setS(await api('GET', '/api/state'));
      }
    }
    await renderInbox();
    renderChrome();
    document.querySelector(`.fb-head[data-id="${id}"]`)?.focus({ preventScroll: true });
  },
  async react(el) {
    const id = Number(el.dataset.id);
    const f = ui.inbox.find((x) => x.id === id);
    const reaction = f.reaction === el.dataset.reaction ? null : el.dataset.reaction;
    await api('POST', `/api/feedback/${id}/respond`, { reaction });
    f.reaction = reaction;
    // Update in place: re-rendering would steal focus from a reply being typed.
    el.closest('.reactions').querySelectorAll('[data-reaction]').forEach((b) => {
      const on = b.dataset.reaction === reaction;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on);
    });
    if (reaction) toast('Reaction sent');
  },
  async 'remove-feedback'(el) {
    if (!confirm('Remove this from your inbox? This cannot be undone.')) return;
    await api('DELETE', `/api/feedback/${el.dataset.id}`);
    setS(await api('GET', '/api/state'));
    renderChrome();
    await renderInbox();
  },
  // ---------- asking for feedback ----------
  'give-mode'(el) {
    compose.mode = el.dataset.id === 'ask' ? 'ask' : 'give';
    compose.error = null;
    compose.canConfirm = false;
    saveDraft();
    renderGive();
  },
  'pick-ask-help'(el) {
    compose.askHelp = el.dataset.id;
    saveDraft();
    renderGive();
  },
  'pick-ask-model'(el) {
    compose.askModel = el.dataset.id;
    compose.error = null;
    saveDraft();
    renderGive();
  },
  'reset-ask'() {
    Object.assign(compose, { audience: 'one', toIds: [], askWhat: '', askHelp: 'well', askModel: 'glow-grow', askAnon: false, error: null });
    saveDraft();
    renderGive();
  },
  // A question in the Inbox: wide screens show it in the reading pane, narrower ones open it in place.
  async 'open-ask'(el) {
    const id = Number(el.dataset.id);
    ui.openAsk = isWide() || ui.openAsk !== id ? id : null;
    await renderInbox();
  },
  // Answer: Give, ready for the person who asked, in the style they asked for (kids: Kind Words).
  'answer-ask'(el) {
    const a = ui.asks.find((x) => x.id === Number(el.dataset.id));
    if (!a) return;
    const models = S.models.map((m) => m.id);
    const model = models.includes(a.model) ? a.model : null;
    setCompose({ ...blankCompose(), audience: 'one', toIds: [a.from.id], model, answering: { id: a.id, from: a.from, what: a.what, help: a.help, anonymous: a.anonymous, model: a.model } });
    ui.openAsk = null;
    saveDraft();
    location.hash = '#/give';
  },
  async 'dismiss-ask'(el) {
    const a = ui.asks.find((x) => x.id === Number(el.dataset.id));
    await api('POST', `/api/asks/${Number(el.dataset.id)}/dismiss`);
    ui.openAsk = null;
    setS(await api('GET', '/api/state'));
    await renderInbox();
    renderChrome();
    toast(`Removed from your Inbox. ${a ? a.from.name : 'They'} won’t be told.`);
  },
  'stop-answering'() {
    compose.answering = null;
    saveDraft();
    renderGive();
  },
  async 'stop-asking'(el) {
    if (!confirm('Stop asking? The question leaves everyone’s Inbox. Answers that already arrived stay.')) return;
    await api('DELETE', `/api/asks/${Number(el.dataset.id)}`);
    toast('Stopped asking');
    await renderSent();
  },
  // The next worked example in the composer's ghost text.
  'next-example'() {
    compose.example = (compose.example || 0) + 1;
    saveDraft();
    renderGive();
  },
  'pick-audience'(el) {
    const prev = compose.audience;
    compose.audience = el.dataset.id;
    if (compose.audience === 'one' && prev !== 'one') compose.toIds = compose.toIds.slice(0, 1);
    compose.error = null;
    compose.canConfirm = false;
    saveDraft();
    renderGive();
  },
  'pick-to'(el) {
    const id = Number(el.dataset.id);
    if (compose.audience === 'some') {
      compose.toIds = compose.toIds.includes(id) ? compose.toIds.filter((x) => x !== id) : [...compose.toIds, id];
    } else {
      compose.toIds = [id];
    }
    compose.error = null;
    compose.canConfirm = false;
    saveDraft();
    renderGive();
  },
  'pick-model'(el) {
    // Keep what was typed for each style, so trying another style never loses words.
    if (compose.model) compose.drafts[compose.model] = compose.fields;
    compose.model = el.dataset.id;
    compose.fields = { ...(compose.drafts[compose.model] || {}) };
    compose.error = null;
    compose.canConfirm = false;
    saveDraft();
    renderGive();
    document.querySelector('[data-form="send"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'pick-choice'(el) {
    const { key, value } = el.dataset;
    if (el.dataset.multiple) {
      // Several feelings at once: each chip turns on and off by itself.
      const was = [].concat(compose.fields[key] || []);
      const now = was.includes(value) ? was.filter((v) => v !== value) : [...was, value];
      compose.fields[key] = now;
      el.classList.toggle('selected', now.includes(value));
      el.setAttribute('aria-pressed', now.includes(value));
    } else {
      compose.fields[key] = value;
      setPressed(el);
    }
    saveDraft();
  },
  'toggle-keep'(el) { ui.keepSignedIn = el.checked; },
  'toggle-anon'(el) {
    compose.anonymous = el.checked;
    saveDraft();
    const btn = document.querySelector('[data-form="send"] button[type="submit"]');
    if (btn) btn.textContent = compose.anonymous ? 'Send anonymously' : 'Send';
  },
  'send-anyway'() { sendFeedback(true); },
  'reset-compose'() {
    clearDraft();
    renderGive();
  },
  'edit-member'(el) {
    ui.editingId = Number(el.dataset.id);
    renderFamily();
  },
  'cancel-edit'() {
    ui.editingId = null;
    renderFamily();
  },
  async 'remove-member'(el) {
    const m = memberById(el.dataset.id);
    if (!confirm(`Remove ${m.name}? Their inbox will be deleted.`)) return;
    await api('DELETE', `/api/members/${m.id}`);
    if (ui.invite?.memberId === m.id) ui.invite = null;
    await refresh();
  },
  async invite(el) { await openInvite(el.dataset.id); },
  'start-join'() { location.hash = '#/sync'; },
  'link-phone'(el) {
    endSync();
    const m = memberById(el.dataset.id);
    // Someone with a PIN types it first: linking puts their messages on the phone.
    if (m.hasPin) {
      ui.linkPinFor = m.id;
      ui.linkPinError = null;
      renderFamily();
      document.getElementById('link-pin')?.focus();
      return;
    }
    ui.linkFor = m.id;
    ui.linkPin = null;
    location.hash = '#/sync';
  },
  'cancel-link-pin'() {
    ui.linkPinFor = null;
    renderFamily();
  },
  async 'unlink-phones'(el) {
    const m = memberById(el.dataset.id);
    const n = m.linkedPhones || 1; // one person can link several (a phone and an iPad, say)
    const which = n === 1 ? `${m.name}’s phone` : `all ${n} of ${m.name}’s phones`;
    if (!confirm(`Unlink ${which}? ${n === 1 ? 'It' : 'They'} won’t be able to sync until a parent links ${n === 1 ? 'it' : 'them'} again.`)) return;
    await api('DELETE', `/api/members/${m.id}/phones`);
    toast(n === 1 ? `${m.name}’s phone unlinked` : `${m.name}’s ${n} phones unlinked`);
    await refresh();
  },
  async 'unlink-this-phone'() {
    const p = S.peer;
    const lose = p?.pending ? ` ${plural(p.pending, 'change')} not synced yet will be lost.` : '';
    if (!confirm(`Unlink this phone from ${S.family.name}? Your copy of your messages is removed from this phone.${lose}`)) return;
    peerLink?.close();
    await peer.client.forget();
    // The setup screen then offers linking again first, not starting a new family.
    localStorage.setItem('ff-was-linked', S.family.name);
    await useDevice();
    location.hash = '';
    await refresh();
    toast('This phone is no longer linked');
  },
  async 'discard-failed'(el) {
    await peer.client.discardFailed(el.dataset.id);
    setS(await api('GET', '/api/state'));
    renderChrome();
    await renderSent();
  },
  async 'sync-copy'() {
    const code = ui.sync?.role === 'host' ? ui.sync.host?.code : ui.sync?.pending?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copied');
    } catch {
      prompt('Copy this code:', code);
    }
  },
  // Get Echoes is done (or wasn't needed): on to the link code.
  'sync-get-next'() {
    const s = ui.sync;
    if (!s || s.step !== 'get') return;
    s.pastGet = true;
    hostFlow(s).catch((err) => syncFailed(s, err));
  },
  async 'sync-share-link'() {
    const url = ui.sync?.getUrl;
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: 'Echoes', text: `Get Echoes for ${S.family.name}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') prompt('Copy this link:', url);
    }
  },
  'sync-again'() {
    const linkFor = ui.sync?.mode === 'link' && ui.sync.step === 'error' ? ui.sync.memberId : null;
    // Trying again after linking failed: their phone already has Echoes.
    ui.linkSkipGet = !!(linkFor && ui.sync?.pastGet);
    endSync();
    ui.linkFor = linkFor;
    renderSync();
  },
  'sync-done'() {
    ui.sync?.link?.close();
  },
  'close-invite'() {
    ui.invite = null;
    renderFamily();
  },
  async 'share-invite'() {
    const m = memberById(ui.invite.memberId);
    try {
      await navigator.share({ title: `Join ${S.family.name}`, text: `${S.me.name} invited you to ${S.family.name} on Echoes.`, url: ui.invite.url });
    } catch (err) {
      if (err.name !== 'AbortError') toast(`Couldn’t open sharing. Show ${m.name} the QR code instead.`);
    }
  },
  async 'copy-invite'() {
    const input = document.querySelector('.invite-url');
    try {
      await navigator.clipboard.writeText(ui.invite.url);
      toast('Invite link copied');
    } catch {
      input.select();
      toast('Link selected: copy it from the box');
    }
  },
  async backup() {
    const data = await api('GET', '/api/backup');
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `echoes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  async 'push-on'() {
    // Asked straight from the tap: browsers only show the permission prompt for one.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast(permission === 'denied' ? 'Notifications are blocked. You can allow them in Settings.' : 'Notifications stay off.');
      updateNotifyCard();
      return;
    }
    const reg = await pushReady();
    const key = b64uBytes((await api('GET', '/api/push/key')).publicKey);
    // Always a fresh subscription: an old one may be dead (made for another hub, or ended by the push
    // service; iPhones don't renew them by themselves).
    await (await reg.pushManager.getSubscription())?.unsubscribe().catch(() => {});
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
    ui.push = { on: true };
    updateNotifyCard();
    toast('Notifications are on for this device');
  },
  async 'push-off'() {
    const sub = await currentPushSub();
    if (sub) {
      await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe().catch(() => {});
    }
    ui.push = { on: false };
    updateNotifyCard();
    toast('Notifications are off for this device');
  },
  async 'push-test'() {
    const r = await api('POST', '/api/push/test');
    toast(r.sent ? 'Sent. It should arrive in a few seconds.' : 'The push service didn’t take it. Is the hub computer online?');
  },
  // A reply or reaction in the Inbox opens the message it answers, in Sent.
  async 'open-response'(el) {
    ui.highlightGroup = el.dataset.group;
    await api('POST', '/api/responses/seen', { ids: [Number(el.dataset.id)] });
    setS(await api('GET', '/api/state'));
    location.hash = '#/sent';
  },
  async 'responses-seen'() {
    await api('POST', '/api/responses/seen', {});
    setS(await api('GET', '/api/state'));
    renderChrome();
    await renderInbox();
  },
  async tick(el) {
    const on = el.getAttribute('aria-pressed') === 'true';
    await api('POST', `/api/plans/${el.dataset.ref}/tick`, { date: el.dataset.date, value: on ? null : el.dataset.value });
    await afterPlanChange(`[data-action="tick"][data-ref="${el.dataset.ref}"][data-value="${el.dataset.value}"]`);
  },
  // A tap on a past day goes kept → not this time → unmarked.
  async 'tick-cycle'(el) {
    const plan = ui.plans?.mine.find((p) => p.ref === el.dataset.ref);
    const v = plan?.ticks?.[el.dataset.date];
    await api('POST', `/api/plans/${el.dataset.ref}/tick`, { date: el.dataset.date, value: v === 'kept' ? 'slip' : v === 'slip' ? null : 'kept' });
    await afterPlanChange(`[data-action="tick-cycle"][data-ref="${el.dataset.ref}"][data-date="${el.dataset.date}"]`);
  },
  async cheer(el) {
    const res = await api('POST', `/api/plans/${el.dataset.ref}/cheer`, { cheer: el.dataset.cheer, day: localDate() });
    toast(res.queued ? `Cheer saved for ${el.dataset.name}. It goes out when you next sync.` : `Cheer sent to ${el.dataset.name}`);
    await afterPlanChange();
  },
  async noticed(el) {
    await api('POST', `/api/plans/${el.dataset.ref}/noticed`, { answer: el.dataset.answer });
    toast('Thanks for letting them know');
    await afterPlanChange();
  },
  async 'stop-plan'(el) {
    if (!confirm(`Stop this ${isKid() ? 'promise' : 'plan'}? It’s removed for you and anyone you shared it with.`)) return;
    await api('DELETE', `/api/plans/${el.dataset.ref}`);
    toast(isKid() ? 'Promise stopped' : 'Plan stopped');
    await afterPlanChange();
  },
  async 'discard-failed-plan'(el) {
    await peer.client.discardFailed(el.dataset.id);
    await renderPlans();
  },
};

export const changeActions = {
  'toggle-ask-anon'(el) {
    compose.askAnon = el.checked;
    saveDraft();
    renderGive();
  },
  async restore(el) {
    const file = el.files?.[0];
    if (!file) return;
    if (!confirm('Replace everything on this device with this backup? Everyone will need to sign in again.')) return;
    const data = JSON.parse(await file.text());
    await api('POST', '/api/restore', data);
    toast('Backup restored');
    location.hash = '';
    await refresh();
  },
  'toggle-anon': (el) => actions['toggle-anon'](el),
  'toggle-keep': (el) => actions['toggle-keep'](el),
  async 'share-plan'(el) {
    await api('PATCH', `/api/plans/${el.dataset.ref}`, { share: el.value });
    toast('Saved');
    await afterPlanChange();
  },
  // A kid's picture promise fills in its "When I…, I'll…" step, unless they changed it.
  'pick-promise'(el) {
    const k = KID_PROMISES.find((x) => x.id === el.value);
    for (const key of ['when', 'then']) {
      const input = el.form.elements[key];
      if (!input.value || input.value === input.dataset.auto) {
        input.value = k[key];
        input.dataset.auto = k[key];
      }
    }
  },
};

export async function runAction(fn, el, e) {
  try { await fn(el, e); } catch (err) { toast(err.message); }
}
