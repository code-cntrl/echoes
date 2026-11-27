// Sent: what you sent and how it landed.
import { REACTIONS, app, emptyState, esc, icon, names, plural, shortDate } from './dom.js';
import { ANON_ASK_MIN } from '../shared/asks.js';
import { renderFieldValues } from './inbox.js';
import { renderChrome } from './router.js';
import { S, api, isPeer, modelById, setS, ui } from './state.js';

// Questions you asked: who has answered, or how many when answers may be anonymous (then never who).
function questionsHtml(asks) {
  if (!asks.length) return '';
  const status = (a) => {
    if (a.failed) return `<span class="danger-text">The home base didn’t accept this: ${esc(a.error)}</span>`;
    if (a.pending) return 'Waiting to sync';
    if (a.closed) return `Closed: answers without names need ${ANON_ASK_MIN} or more people${S.family.allowAnonymous ? '' : ', and anonymous feedback is turned off'}.${a.answered ? ` ${plural(a.answered, 'answer')} arrived.` : ''}`;
    if (a.answeredBy) {
      const done = new Set(a.answeredBy.map((m) => m.id));
      const waiting = a.recipients.filter((m) => !done.has(m.id));
      return [a.answeredBy.length ? `${esc(names(a.answeredBy.map((m) => m.name)))} answered` : '', waiting.length ? `waiting for ${esc(names(waiting.map((m) => m.name)))}` : '']
        .filter(Boolean).join(' · ');
    }
    return a.answered ? `${plural(a.answered, 'answer')} so far, without names` : 'No answers yet. Answers come without names.';
  };
  const pill = (a) => (a.failed ? '<span class="pill bad">Not sent</span>' : a.pending ? '<span class="pill neutral">Waiting</span>'
    : `<span class="pill ${a.answered ? 'good' : 'neutral'}">${Number(a.answered)}/${a.recipients.length} answered</span>`);
  return `<span class="label">Your questions</span>
    <ul class="list inset-icon asks-mine">${asks.map((a) => `<li><div class="item">
      <span class="icon-sq">${icon('ask')}</span>
      <span class="grow"><span class="title">“${esc(a.what)}”</span>
        <span class="sub">${a.audience === 'everyone' ? 'To the whole family' : `To ${esc(names(a.recipients.map((m) => m.name)))}`} · ${esc(a.modelEmoji)} ${esc(a.modelName)} · ${esc(a.helpLabel.toLowerCase())}</span>
        <span class="sub">${status(a)}</span>
        ${a.failed ? `<button type="button" class="link small danger" data-action="discard-failed" data-id="${esc(a.id)}">Discard</button>`
          : a.pending ? '' : `<button type="button" class="link small" data-action="stop-asking" data-id="${Number(a.id)}">Stop asking</button>`}</span>
      <span class="end">${pill(a)}</span></div></li>`).join('')}
    </ul>`;
}

export async function renderSent() {
  const [groups, asks] = await Promise.all([api('GET', '/api/sent'), api('GET', '/api/asks').catch(() => ({ mine: [] }))]);
  const mine = asks.mine || [];
  const note = `Anonymous messages aren’t listed here, because they aren’t linked to you.${isPeer() ? ' Messages waiting to sync are shown until they’re sent.' : ''}`;
  if (!groups.length && !mine.length) {
    app.innerHTML = emptyState('sent', 'Nothing sent yet', note, '<a class="btn primary" href="#/give">Give feedback</a>');
    return;
  }
  const status = (g, readCount) => {
    if (g.failed) return '<span class="pill bad">Not sent</span>';
    if (g.pending) return '<span class="pill neutral">Waiting</span>';
    if (g.recipients.length === 1) return `<span class="pill ${readCount ? 'good' : 'neutral'}">${readCount ? 'Read' : 'Not read yet'}</span>`;
    return `<span class="pill ${readCount === g.recipients.length ? 'good' : 'neutral'}">${readCount}/${g.recipients.length} read</span>`;
  };
  app.innerHTML = `
    <section>
      <h1>Sent</h1><p class="page-sub">${note}</p>
      ${questionsHtml(mine)}
      ${mine.length && groups.length ? '<span class="label">Messages</span>' : ''}
      <div class="stack card-grid">${groups.map((g) => {
        const title = g.audience === 'everyone' ? 'To the whole family'
          : `To ${esc(names(g.recipients.map((r) => r.name)))}`;
        const readCount = g.recipients.filter((r) => r.read).length;
        const waiting = g.pending || g.failed;
        return `<article class="card stack${g.failed ? ' failed' : ''}" data-group="${esc(String(g.groupId))}">
          <div class="row align-start"><span class="grow"><strong>${title}</strong>${g.anonymous ? ' <span class="muted small">· anonymous</span>' : ''}<br><span class="muted small">${esc(g.modelEmoji || modelById(g.model)?.emoji || '')} ${esc(g.modelName || modelById(g.model)?.name || '')} · ${esc(shortDate(g.createdAt))}</span></span>
            ${status(g, readCount)}</div>
          ${g.failed ? `<div class="notice error small">The home base didn’t accept this: ${esc(g.error)}
            <div class="row"><button type="button" class="link small danger" data-action="discard-failed" data-id="${esc(g.groupId)}">Discard</button></div></div>` : ''}
          <div>${renderFieldValues(g.model, g.fields)}</div>
          ${waiting ? '' : `<ul class="recipients">${g.recipients.map((r) => {
            const reaction = REACTIONS.find((x) => x.id === r.reaction);
            return `<li><span class="avatar">${esc(r.emoji)}</span><span class="grow"><strong>${esc(r.name)}</strong>${r.newResponse ? ' <span class="pill new">New</span>' : ''}
              <span class="muted small">${r.read ? 'read it' : 'hasn’t read it yet'}${reaction ? ` · ${reaction.emoji} ${esc(reaction.label)}` : ''}${r.planShared ? ` · <a href="#/plans">made a plan from it</a>` : ''}</span>
              ${r.reply ? `<span class="reply">${esc(r.reply)}</span>` : ''}</span></li>`;
          }).join('')}</ul>`}
        </article>`;
      }).join('')}</div>
    </section>`;
  // Seeing replies here counts as seeing them: the Inbox stops listing them, and the New marks
  // stay until the next visit. Not when the app only caught up in the background (a phone picked up
  // on Sent), since nobody has looked yet. An older home base without this list is fine.
  if (!ui.quiet && groups.some((g) => g.recipients.some((r) => r.newResponse))) {
    await api('POST', '/api/responses/seen', {}).catch(() => {});
    setS(await api('GET', '/api/state'));
    renderChrome();
  }
  // Opened from a reply in the Inbox: show that message. After the route's scroll to the top.
  const target = ui.highlightGroup != null && app.querySelector(`article[data-group="${CSS.escape(String(ui.highlightGroup))}"]`);
  ui.highlightGroup = null;
  if (target) {
    target.classList.add('highlight');
    setTimeout(() => target.scrollIntoView({ block: 'center' }), 0);
  }
}
