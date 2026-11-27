// The Inbox: cards, the reading pane, replies and reactions, the break before replying.
import { CALM_REACTIONS, COOL_OFF_MINUTES } from '../shared/plans.js';
import { REACTIONS, app, emptyState, esc, formatDate, icon, names, shortDate } from './dom.js';
import { api, forOthers, isKid, modelById, questionFor, ui } from './state.js';

export function renderFieldValues(modelId, fields) {
  const model = modelById(modelId);
  if (!model) return Object.entries(fields).map(([k, v]) => `<div class="fb-field"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
  return model.fields.filter((f) => fields[f.key]).map((f) => {
    let value = esc(fields[f.key]);
    if (f.type === 'choice') {
      // One value, or several (older messages hold one).
      const opts = [].concat(fields[f.key]).map((v) => f.options.find((o) => o.value === v)).filter(Boolean);
      if (opts.length) value = opts.map((o) => `${o.emoji} ${esc(o.label)}`).join(', ');
    }
    return `<div class="fb-field"><div class="k">${esc(f.label)}</div><div class="v">${value}</div></div>`;
  }).join('');
}

export function audienceLine(f) {
  if (f.audience === 'everyone') return 'to the whole family';
  if (f.audience === 'some') return f.others ? `to you and ${esc(names(f.others.map((o) => o.name)))}` : 'to you and others';
  return '';
}

// One line to show in a list: the first written answer, or the first choice made.
export function previewText(modelId, fields) {
  const model = modelById(modelId);
  const text = (model?.fields || []).filter((f) => f.type !== 'choice').map((f) => fields[f.key]).find(Boolean);
  if (text) return text;
  const choice = model?.fields.find((f) => f.type === 'choice' && fields[f.key]);
  const opts = choice ? [].concat(fields[choice.key]).map((v) => choice.options.find((o) => o.value === v)).filter(Boolean) : [];
  return opts.length ? opts.map((o) => `${o.emoji} ${o.label}`).join(', ') : String(Object.values(fields).find(Boolean) || '');
}

// How long until someone may write back to a message they opened (0 once the break is over).
export const calmLeft = (f) => (f.read && f.replyAfter ? Math.max(0, Date.parse(f.replyAfter) - Date.now()) : 0);
// Capped at the break's length, so a phone a few seconds behind the hub never shows "31 min".
export const minutesLabel = (ms) => `${Math.min(COOL_OFF_MINUTES[isKid() ? 'kid' : 'adult'], Math.max(1, Math.ceil(ms / 60_000)))} min`;

// While the break runs, the card offers a calm prompt (kids breathe with a bubble) and a countdown.
export function calmPanel(f, left) {
  const what = f.anonymous ? (isKid() ? 'make a promise' : 'make a plan') : (isKid() ? 'write back or make a promise' : 'write back or make a plan');
  return `<div class="calm" data-calm-until="${esc(f.replyAfter)}">
    ${isKid() ? '<span class="breathe" aria-hidden="true"><span class="bubble"></span><span class="breath-words"><span>Breathe in</span><span>Breathe out</span></span></span>' : `<span class="icon-sq">${icon('timer')}</span>`}
    <div class="grow"><strong>${isKid() ? 'Take a little break' : 'Take a short break'}</strong>
      <div class="small muted">${isKid() ? 'Breathe in and out slowly with the bubble.' : 'Read it once more. What is one part that’s true?'}
        You can ${what} in <span data-calm-left>${minutesLabel(left)}</span>.</div></div>
  </div>`;
}

export function planLink(f) {
  if (f.planRef) return `<p class="status-line">${icon('sprout')} You made a ${isKid() ? 'promise' : 'plan'} from this. <a href="#/plans">See it</a></p>`;
  return `<div class="row mt-1"><a class="btn" href="#/plan/${Number(f.id)}">${icon('sprout')}${isKid() ? 'Make a promise' : 'Make a plan from this'}</a></div>`;
}

export function inboxCard(f, { inline = true, selected = false } = {}) {
  const open = inline && ui.openCards.has(f.id);
  const reaction = REACTIONS.find((r) => r.id === f.reaction);
  const aud = audienceLine(f);
  const avatar = f.anonymous ? `<span class="avatar lg">${icon('mask')}</span>` : `<span class="avatar lg">${esc(f.from.emoji)}</span>`;
  const name = f.anonymous ? '<span class="who anon">Someone in your family</span>' : `<span class="who">${esc(f.from.name)}</span>`;
  // In the wide layout the row selects the message for the reading pane instead of opening in place.
  const state = inline ? `aria-expanded="${open}"` : `aria-controls="reader"${selected ? ' aria-current="true"' : ''}`;
  return `
    <li class="fb ${f.read ? '' : 'unread'}${selected ? ' selected' : ''}">
      ${f.read ? '' : '<i class="dot" aria-hidden="true"></i>'}
      <button type="button" class="fb-head" data-action="toggle-card" data-id="${Number(f.id)}" ${state}>
        ${avatar}
        <span class="text">
          <span class="top">${name}${f.read ? '' : '<span class="sr-only">, new</span>'}<span class="when">${esc(shortDate(f.createdAt, f.anonymous))}${icon('chevron')}</span></span>
          ${open ? '' : `<span class="preview">${esc(previewText(f.model, f.fields))}</span>`}
          <span class="kind">${esc(f.modelEmoji)} ${esc(f.modelName)}${aud ? ` · ${aud}` : ''}${reaction ? ` · ${reaction.emoji} ${esc(reaction.label)}` : ''}</span>
        </span>
      </button>
      ${open ? cardBody(f) : ''}
    </li>`;
}

// What an opened message shows: its answers, the break, reactions, the reply box and the plan link.
export function cardBody(f) {
  const left = calmLeft(f);
  return `
        <div class="fb-body">
          ${f.askWhat ? `<p class="status-line mt-0">${icon('ask')} ${f.askBy ? `${esc(f.askBy.name)} asked for feedback for you: “${esc(f.askWhat)}”` : `An answer to your question: “${esc(f.askWhat)}”`}</p>` : ''}
          ${renderFieldValues(f.model, f.fields)}
          ${left ? calmPanel(f, left) : ''}
          <div class="reactions" role="group" aria-label="React">
            ${REACTIONS.map((r) => {
              const wait = left && !CALM_REACTIONS.includes(r.id) && f.reaction !== r.id;
              return `<button type="button" class="chip ${f.reaction === r.id ? 'selected' : ''}" data-action="react" data-id="${Number(f.id)}" data-reaction="${r.id}" aria-pressed="${f.reaction === r.id}"${wait ? ' disabled title="After the break"' : ''}>${r.emoji} ${esc(r.label)}</button>`;
            }).join('')}
          </div>
          ${f.anonymous
            ? '<p class="status-line">This was sent anonymously, so you can react but not reply.</p>'
            : left ? '' : `<form class="reply-box stack" data-form="reply" data-id="${Number(f.id)}">
                 <label for="reply-${Number(f.id)}" class="small">Write back to ${esc(f.from.name)} (only they will see it)</label>
                 <textarea id="reply-${Number(f.id)}" name="reply" data-reply="${Number(f.id)}" maxlength="1000" placeholder="Thanks for telling me…">${esc(ui.replyDrafts[f.id] ?? f.reply ?? '')}</textarea>
                 <div class="row"><button type="submit">Send reply</button>${f.reply ? `<span class="muted small">${icon('check')} Reply sent</span>` : ''}</div>
               </form>`}
          ${left ? '' : planLink(f)}
          <div class="row"><span class="grow"></span><button type="button" class="link small danger" data-action="remove-feedback" data-id="${Number(f.id)}">Remove from my inbox</button></div>
        </div>`;
}

// Laptops and desktops (and an iPad held sideways) read messages in a pane beside the list, like
// Messages on a Mac; narrower screens open them in place. Both keep the same open message and drafts.
export const wideQuery = matchMedia('(min-width: 1100px)');
export const isWide = () => wideQuery.matches;

export function readerPane(f) {
  if (!f) {
    return `<div class="reader card" id="reader">${emptyState('inbox', 'Pick a message', 'Open one when you’re ready. Feedback is a gift, even when it’s hard to hear.')}</div>`;
  }
  const who = f.anonymous ? 'Someone in your family' : esc(f.from.name);
  const aud = audienceLine(f);
  return `<article class="reader card" id="reader" aria-label="Message from ${who}">
      <header class="reader-head">
        <span class="avatar lg">${f.anonymous ? icon('mask') : esc(f.from.emoji)}</span>
        <div class="grow"><h2 class="m-0">${who}</h2>
          <div class="small muted">${esc(f.modelEmoji)} ${esc(f.modelName)}${aud ? ` · ${aud}` : ''} · ${esc(formatDate(f.createdAt, f.anonymous))}</div></div>
      </header>
      ${cardBody(f)}
    </article>`;
}

// Replies and reactions to what you sent, shown at the top of the Inbox until you've seen them.
export function responsesSection(responses) {
  if (!responses.length) return '';
  const row = (r) => {
    const k = REACTIONS.find((x) => x.id === r.reaction);
    const what = r.reply ? `${k ? `${k.emoji} ` : ''}“${esc(r.reply)}”` : k ? `${k.emoji} ${esc(k.label)}` : '';
    return `<li><button type="button" class="item response" data-action="open-response" data-id="${Number(r.feedbackId)}" data-group="${esc(String(r.groupId))}">
        <span class="avatar">${esc(r.by.emoji)}</span>
        <span class="grow"><span class="title">${esc(r.by.name)} <span class="muted">${r.reply ? 'replied' : 'reacted'}</span></span>
          <span class="what">${what}</span>
          <span class="sub">To your ${esc(r.modelName)}: ${esc(previewText(r.model, r.fields))}</span></span>
        <span class="end">${esc(shortDate(r.respondedAt))}${icon('chevron', 'chev')}</span>
      </button></li>`;
  };
  return `<div class="section-head"><span class="label">${isKid() ? 'Answers to what you said' : 'Replies and reactions'}</span>
      <button type="button" class="link small" data-action="responses-seen">Mark all as seen</button></div>
    <ul class="list inset-avatar responses">${responses.map(row).join('')}</ul>
    <span class="label">Messages</span>`;
}

// Questions people asked you about something they did, or someone else did, at the top of the Inbox.
// On wide screens the row opens the question in the reading pane; narrower ones open it in place.
// Both can answer or put it aside.
const forNames = (a) => esc(names(questionFor(a).map((m) => m.name)));
function askDetails(a) {
  const them = questionFor(a);
  const others = forOthers(a);
  // Asked for themselves and others ("You too"), the asker reads every answer like the rest.
  const askerReads = them.some((m) => m.id === a.from.id);
  const goesTo = others ? ` It goes to ${forNames(a)}.` : '';
  return `
      <div class="fb-field"><div class="k">What ${forNames(a)} did</div><div class="v">${esc(a.what)}</div></div>
      <div class="fb-field"><div class="k">What would help most</div><div class="v">${esc(a.helpLabel)}</div></div>
      <div class="row mt-1"><button type="button" class="primary" data-action="answer-ask" data-id="${Number(a.id)}">Answer with ${esc(a.modelName)}</button>
        <button type="button" class="link" data-action="dismiss-ask" data-id="${Number(a.id)}">Not now</button></div>
      <p class="status-line">${a.anonymous
        ? `You can answer without your name: ${esc(a.from.name)} asked ${Number(a.count)} people.${goesTo}`
        : others ? `${forNames(a)} ${them.length === 1 ? 'gets' : 'get'} your answer with your name, like any message.${askerReads ? '' : ` ${esc(a.from.name)} sees that you answered, not what you said.`}`
          : `${esc(a.from.name)} sees your answer with your name, like any message.`} There’s no rush.</p>`;
}

export function questionsSection(asks, wide) {
  if (!asks.length) return '';
  const row = (a) => {
    const open = ui.openAsk === a.id;
    return `<li><button type="button" class="item response${wide && open ? ' selected' : ''}" data-action="open-ask" data-id="${Number(a.id)}" ${wide ? 'aria-controls="reader"' : `aria-expanded="${open}"`}>
        <span class="avatar">${esc(a.from.emoji)}</span>
        <span class="grow"><span class="title">${esc(a.from.name)} <span class="muted">asked you</span></span>
          <span class="what">“${esc(a.what)}”</span>
          <span class="sub">${forOthers(a) ? `For ${forNames(a)} · ` : ''}${esc(a.modelEmoji)} ${esc(a.modelName)} · ${esc(a.helpLabel.toLowerCase())}</span></span>
        <span class="end"><span class="pill new">Answer</span>${icon('chevron', 'chev')}</span>
      </button>${!wide && open ? `<div class="ask-detail">${askDetails(a)}</div>` : ''}</li>`;
  };
  return `<div class="section-head"><span class="label">Questions for you</span></div>
    <ul class="list inset-avatar responses asks">${asks.map(row).join('')}</ul>`;
}

function askReader(a) {
  return `<article class="reader card" id="reader" aria-label="${esc(a.from.name)} asked you">
      <header class="reader-head"><span class="avatar lg">${esc(a.from.emoji)}</span>
        <div class="grow"><h2 class="m-0">${esc(a.from.name)} asked you</h2><div class="small muted">${esc(a.modelEmoji)} ${esc(a.modelName)} · ${esc(shortDate(a.createdAt))}</div></div></header>
      <div class="fb-body">${askDetails(a)}</div></article>`;
}

export async function renderInbox() {
  const [items, responses, asks] = await Promise.all([
    api('GET', '/api/inbox'), api('GET', '/api/responses').catch(() => []), api('GET', '/api/asks').catch(() => ({ forMe: [] })),
  ]);
  ui.inbox = items;
  ui.asks = asks.forMe || [];
  if (ui.openAsk != null && !ui.asks.some((a) => a.id === ui.openAsk)) ui.openAsk = null;
  // The Messages heading follows the sections above it (replies and reactions add their own).
  const top = (wide) => `${questionsSection(ui.asks, wide)}${responsesSection(responses)}${ui.asks.length && !responses.length ? '<span class="label">Messages</span>' : ''}`;
  if (!items.length && !responses.length && !ui.asks.length) {
    app.innerHTML = emptyState('inbox', 'No feedback yet', 'When someone sends you something, it shows up here.',
      `<a class="btn primary" href="#/give">${isKid() ? 'Say something kind' : 'Give someone feedback'}</a>`);
    return;
  }
  const unread = items.filter((f) => !f.read).length;
  const head = `<h1>Inbox</h1>
      <p class="page-sub">${unread ? `${Number(unread)} new · ` : ''}Take a breath before you open one. Feedback is a gift, even when it is hard to hear.</p>`;
  const list = (inline, selected) => (items.length
    ? `<ul class="list msgs">${items.map((f) => inboxCard(f, inline ? {} : { inline: false, selected: f === selected })).join('')}</ul>`
    : '<p class="footnote mt-0">No messages for you yet.</p>');
  if (isWide()) {
    // Never open a message by itself: opening one starts its break, so the person chooses.
    const openAsk = ui.asks.find((a) => a.id === ui.openAsk);
    const selected = openAsk ? null : items.find((f) => f.id === ui.lastOpened && ui.openCards.has(f.id)) || null;
    app.innerHTML = `
      <section>${head}
        <div class="split">
          <div class="split-list">${top(true)}${list(false, selected)}</div>
          ${openAsk ? askReader(openAsk) : readerPane(selected)}
        </div>
      </section>`;
    return;
  }
  app.innerHTML = `
    <section>${head}
      ${top(false)}${list(true)}
    </section>`;
}
