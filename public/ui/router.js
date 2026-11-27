// Routing, the top bar and tabs, the banner and error screens.
import { ago, app, banner, emptyState, esc, icon, meArea, nav } from './dom.js';
import { renderFamily } from './family.js';
import { renderGive } from './give.js';
import { renderGuide } from './guide.js';
import { renderInbox } from './inbox.js';
import { renderPlanForm, renderPlans } from './plans.js';
import { setAppBadge } from './push.js';
import { renderSent } from './sent.js';
import { S, api, blankCompose, compose, isKid, isPeer, loadDraft, setCompose, setS, ui } from './state.js';
import { renderSync } from './sync.js';
import { joinWithInvite, renderSetup, renderSignIn, renderWelcome } from './welcome.js';

export async function refresh() {
  setS(await api('GET', '/api/state'));
  if (ui.draftOwner !== (S.me?.id ?? null)) {
    ui.draftOwner = S.me?.id ?? null;
    setCompose(S.me ? loadDraft() : blankCompose());
    ui.replyDrafts = {};
    ui.openCards.clear();
    ui.lastOpened = null;
    ui.push = undefined;
  }
  document.body.classList.toggle('kid', isKid());
  document.body.classList.toggle('signed-in', !!S.me);
  document.getElementById('family-name').textContent = S.setupDone ? S.family.name : 'Echoes';
  renderChrome();
  await route();
}

export const currentView = () => (location.hash.replace(/^#\/?/, '') || 'inbox').split('/')[0];

export async function route() {
  await renderRoute();
  // A new screen starts at the top; re-renders of the same screen keep their place.
  const key = `${S?.me?.id}|${S?.me?.welcomed}|${location.hash}`;
  if (key !== ui.lastRouteKey) window.scrollTo(0, 0);
  ui.lastRouteKey = key;
}

export async function renderRoute() {
  try {
    const [view, arg] = location.hash.replace(/^#\/?/, '').split('/');
    if (view === 'join' && arg) return await joinWithInvite(arg);
    if (view === 'sync') return await renderSync();
    if (!S.setupDone) return renderSetup();
    if (!S.me) return renderSignIn();
    if (!S.me.welcomed) return renderWelcome();
    renderChrome();
    const v = currentView();
    if (v === 'give') return renderGive();
    if (v === 'sent') return await renderSent();
    if (v === 'plans') return await renderPlans();
    if (v === 'plan') return await renderPlanForm({ feedbackId: arg });
    if (v === 'replan') return await renderPlanForm({ fromPlanId: arg });
    if (v === 'family') return renderFamily();
    if (v === 'guide') return renderGuide();
    return await renderInbox();
  } catch (err) {
    if (err.status === 401) return refresh();
    renderError(err);
  }
}

export function renderError(err) {
  if (err.elsewhere) {
    app.innerHTML = emptyState('window', 'Open in another window',
      'Echoes is already open in another tab or window on this device. Use it there, or move it here.',
      '<button type="button" class="primary" data-action="use-here">Use it here</button>');
    return;
  }
  app.innerHTML = emptyState(err.offline ? 'wifi' : 'warning', err.offline ? 'Can’t reach the family hub' : 'Something went wrong',
    esc(err.message), '<button type="button" class="primary" data-action="retry">Try again</button>');
}

// A linked phone shows whether it's talking to the home base right now, and what is waiting.
// data-state and data-pending describe it for tests and assistive tech alike.
export function syncChip() {
  const p = S?.peer;
  if (!p) return '';
  if (p.blocked) return `<a href="#/family" class="sync-chip attention" data-state="blocked">${icon('warning')}Not linked</a>`;
  const full = `${p.connected ? 'Connected to the home base' : `Last synced ${ago(p.lastSyncAt)}`}${p.pending ? `, ${p.pending} waiting to send` : ''}. Open Sync.`;
  const state = p.connected ? '<span class="live" aria-hidden="true"></span>Live' : `${icon('sync')}${esc(ago(p.lastSyncAt))}`;
  return `<a href="#/sync" class="sync-chip${p.pending || p.failed ? ' attention' : ''}" data-state="${p.connected ? 'live' : 'idle'}" data-pending="${Number(p.pending)}"
    aria-label="${esc(full)}" title="${esc(full)}">${state}${p.pending ? ` · ${Number(p.pending)} waiting` : ''}</a>`;
}

// A linked phone the home base no longer accepts says so on every screen, with a way out.
export function renderBanner() {
  const why = S?.peer?.blocked;
  banner.hidden = !why;
  banner.innerHTML = why ? `<div class="notice error stack"><div>${icon('warning')}<strong>${esc(why)}</strong></div>
    <div class="small">You can still read what’s on this phone. New messages can’t be sent from it until it’s linked again.</div>
    <div class="row"><a class="btn" href="#/sync">${icon('sync')}Try syncing</a><button type="button" class="link danger" data-action="unlink-this-phone">Unlink this phone</button></div></div>` : '';
}

export function renderChrome() {
  renderBanner();
  setAppBadge(S?.me ? (S.me.unread || 0) + (S.me.responses || 0) + (S.me.asks || 0) + (S.me.plansDue || 0) : 0);
  if (!S?.me || !S.me.welcomed) {
    nav.innerHTML = '';
    meArea.innerHTML = S?.me && !isPeer() ? '<button type="button" class="link small" data-action="logout">Switch person</button>' : '';
    return;
  }
  // Making a plan belongs to the Plans tab.
  const v = { plan: 'plans', replan: 'plans' }[currentView()] || currentView();
  const link = (id, ico, label, extra = '') => `<a href="#/${id}" class="${v === id ? 'active' : ''}" ${v === id ? 'aria-current="page"' : ''}><span class="ico" aria-hidden="true">${icon(ico)}${extra}</span><span class="lbl">${label}</span></a>`;
  const fresh = S.me.unread + (S.me.responses || 0) + (S.me.asks || 0);
  const badge = fresh ? `<span class="badge" aria-label="${Number(fresh)} new">${Number(fresh)}</span>` : '';
  const due = S.me.plansDue ? `<span class="badge" aria-label="${Number(S.me.plansDue)} to do">${Number(S.me.plansDue)}</span>` : '';
  // Five tabs, as on iPhone; the Guide is a button in the top bar.
  nav.innerHTML = `
    ${link('inbox', 'inbox', 'Inbox', badge)}
    ${link('give', 'give', isKid() ? 'Say it' : 'Give')}
    ${link('plans', 'sprout', isKid() ? 'Promises' : 'Plans', due)}
    ${link('sent', 'sent', 'Sent')}
    ${link('family', 'family', 'Family')}`;
  // A linked phone belongs to one person, so there is no "Switch"; it shows its sync state instead.
  meArea.innerHTML = `<span class="me-chip"><span class="avatar">${esc(S.me.emoji)}</span><span class="name">${esc(S.me.name)}</span></span>
    ${isPeer() ? syncChip() : '<button type="button" class="link small" data-action="logout">Switch</button>'}
    <a class="icon-btn" href="#/guide" title="Guide" aria-label="Guide" ${v === 'guide' ? 'aria-current="page"' : ''}>${icon('guide')}</a>`;
}
