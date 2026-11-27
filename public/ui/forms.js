// What each form does when it is sent (data-form handlers).
import { localDate } from '../shared/plans.js';
import { useDevice } from './backend.js';
import { esc, toast } from './dom.js';
import { emojiFrom, memberBody, openInvite, pinValue, renderFamily } from './family.js';
import { sendAsk, sendFeedback } from './give.js';
import { renderInbox } from './inbox.js';
import { afterPlanChange } from './plans.js';
import { myPushEndpoint } from './push.js';
import { refresh } from './router.js';
import { S, api, isDevice, isHub, isKid, setS, ui } from './state.js';
import { hostAccept, joinAnswer, syncFailed } from './sync.js';
import { joinWithInvite, signIn } from './welcome.js';

export const forms = {
  async setup(form) {
    const d = new FormData(form);
    if (d.get('where') === 'device') await useDevice();
    await api('POST', '/api/setup', {
      familyName: d.get('familyName'), name: d.get('name'), emoji: ui.setupEmoji,
      pin: d.get('pin') || undefined, allowAnonymous: d.get('allowAnonymous') === 'on',
    });
    location.hash = '#/family';
    localStorage.removeItem('ff-was-linked');
    await refresh();
    toast(isDevice() ? 'Welcome! Now add your family.' : 'Welcome! Now add and invite your family.');
  },
  async 'link-pin'(form) {
    const pin = new FormData(form).get('pin');
    try {
      await api('POST', `/api/members/${ui.linkPinFor}/verify-pin`, { pin });
    } catch (err) {
      ui.linkPinError = err.message;
      renderFamily();
      document.getElementById('link-pin')?.focus();
      return;
    }
    ui.linkFor = ui.linkPinFor;
    ui.linkPin = pin;
    ui.linkPinFor = null;
    location.hash = '#/sync';
  },
  async 'join-pin'(form) {
    await joinWithInvite(ui.joinPin.token, new FormData(form).get('pin'));
  },
  async signin(form) {
    try {
      await signIn(ui.signInId, new FormData(form).get('pin'));
    } catch (err) {
      document.getElementById('signin-error').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
      form.pin.value = '';
      form.pin.focus();
    }
  },
  async welcome(form) {
    const pin = new FormData(form).get('pin');
    if (pin) await api('PATCH', `/api/members/${S.me.id}`, { pin });
    await api('POST', '/api/welcome');
    location.hash = '#/inbox';
    await refresh();
  },
  async reply(form) {
    const id = Number(form.dataset.id);
    const text = String(new FormData(form).get('reply') || '').trim();
    const had = ui.inbox.find((x) => x.id === id)?.reply;
    if (!text && !had) {
      toast('Write something first');
      form.reply.focus();
      return;
    }
    await api('POST', `/api/feedback/${id}/respond`, { reply: text });
    delete ui.replyDrafts[id];
    toast(text ? 'Reply sent' : 'Reply removed');
    await renderInbox();
  },
  async send() { await sendFeedback(false); },
  async ask() { await sendAsk(); },
  async plan(form) {
    const d = new FormData(form);
    const body = {
      heard: d.get('heard') || '', when: d.get('when'), then: d.get('then'), days: Number(d.get('days')), share: d.get('share'),
      startDate: localDate(), // this device's day, so day 1 is today here even if the hub's clock is past midnight
      ...(d.get('promise') !== null && { promise: d.get('promise') }),
      ...(d.get('promiseId') && { promiseId: d.get('promiseId') }),
      ...(d.get('helperId') && { helperId: Number(d.get('helperId')) }),
      ...(form.dataset.from ? { fromPlanId: form.dataset.from } : { feedbackId: Number(form.dataset.feedback) }),
    };
    try {
      const plan = await api('POST', '/api/plans', body);
      toast(plan.pending ? 'Saved on this phone. It reaches the home base when you next sync.' : isKid() ? 'Promise made. You can do it!' : 'Plan started. Tick each day you keep it.');
      setS(await api('GET', '/api/state'));
      location.hash = '#/plans';
    } catch (err) {
      document.getElementById('plan-error').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
      document.getElementById('plan-error').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  },
  async checkin(form) {
    const d = new FormData(form);
    await api('POST', `/api/plans/${form.dataset.ref}/checkin`, { feeling: d.get('feeling'), note: d.get('note') || '', day: localDate() });
    toast('Check-in saved');
    await afterPlanChange();
  },
  async wrap(form) {
    const d = new FormData(form);
    const outcome = d.get('outcome');
    const plan = await api('POST', `/api/plans/${form.dataset.ref}/wrap`, { outcome, note: d.get('note') || '', askGiver: d.get('askGiver') === 'on', day: localDate() });
    if (outcome === 'change') {
      location.hash = `#/replan/${form.dataset.ref}`;
      return;
    }
    toast(outcome === 'keep' ? `Another ${plan.days} days. Keep going!` : isKid() ? 'You did it! Well done.' : 'Plan finished. Well done.');
    await afterPlanChange();
  },
  async 'sync-paste'(form) {
    const s = ui.sync;
    const code = String(new FormData(form).get('code') || '').trim();
    if (!s || !code) return;
    const run = s.role === 'host' ? hostAccept(s, code) : joinAnswer(s, code);
    await run.catch((err) => syncFailed(s, err));
  },
  async profile(form) {
    const d = new FormData(form);
    const pin = pinValue(d.get('pin'));
    await api('PATCH', `/api/members/${S.me.id}`, {
      name: d.get('name'), emoji: emojiFrom(d), pin, currentPin: d.get('currentPin') || undefined,
      // A PIN change drops notifications on this person's other devices; this one keeps them.
      ...(pin !== undefined && { pushEndpoint: await myPushEndpoint() }),
    });
    toast(pin !== undefined && isHub() ? 'Profile saved. Your other devices are signed out.' : 'Profile saved');
    await refresh();
  },
  async 'add-member'(form) {
    const d = new FormData(form);
    const m = await api('POST', '/api/members', memberBody(d));
    toast(`${m.name} added`);
    setS(await api('GET', '/api/state'));
    if (isHub()) await openInvite(m.id);
    else renderFamily();
  },
  async 'edit-member'(form) {
    const d = new FormData(form);
    const body = memberBody(d);
    if (Number(form.dataset.id) === S.me.id && body.pin !== undefined) body.pushEndpoint = await myPushEndpoint();
    await api('PATCH', `/api/members/${form.dataset.id}`, body);
    ui.editingId = null;
    toast('Saved');
    await refresh();
  },
  async settings(form) {
    const d = new FormData(form);
    await api('PATCH', '/api/settings', { familyName: d.get('familyName'), allowAnonymous: d.get('allowAnonymous') === 'on' });
    toast('Settings saved');
    await refresh();
  },
};
