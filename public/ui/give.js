// Give: choosing people and a style, writing, the tone helper and sending. Also asking people for
// feedback on something you did (the Ask side), and answering a question someone asked you.
import { ANON_ASK_MIN, ASK_HELP, helpLabel } from '../shared/asks.js';
import { exampleFor } from '../shared/models.js';
import { checkTone } from '../shared/tone.js';
import { AUDIENCES, app, emptyState, esc, icon, names, plural, toast } from './dom.js';
import { S, api, clearDraft, compose, isHub, isKid, isPeer, memberById, memberTag, modelById, setS } from './state.js';

export function toneHtml(text) {
  return checkTone(text).map((t) => `<div class="${t.level}">${t.level === 'hurtful' ? `${icon('warning')} ` : ''}<strong>“${esc(t.match)}”</strong>: ${esc(t.tip)}</div>`).join('');
}

export function recipientsFor() {
  const others = S.members.filter((m) => m.id !== S.me.id && m.active);
  if (compose.audience === 'everyone') return others.filter((m) => !m.guest);
  return compose.toIds.map(memberById).filter(Boolean);
}

// Give or Ask: one switch at the top of the tab.
function modeSwitch() {
  const seg = (id, label) => `<button type="button" role="radio" aria-checked="${compose.mode === id}" class="${compose.mode === id ? 'selected' : ''}" data-action="give-mode" data-id="${id}">${label}</button>`;
  return `<div class="segmented two mode-switch" role="radiogroup" aria-label="Give or ask">${seg('give', isKid() ? 'Say it' : 'Give')}${seg('ask', 'Ask')}</div>`;
}

// Who: one person, a few or everyone, then their pictures.
function peopleBlock(label, others, recipients) {
  const multi = compose.audience === 'some';
  const guestsLeftOut = others.some((m) => m.guest);
  return `
      <span class="label">${label}</span>
      <div class="segmented" role="radiogroup" aria-label="Audience">${AUDIENCES.map((a) => `
        <button type="button" role="radio" aria-checked="${compose.audience === a.id}" class="${compose.audience === a.id ? 'selected' : ''}" data-action="pick-audience" data-id="${a.id}">${a.label}</button>`).join('')}
      </div>
      ${compose.audience === 'everyone'
        ? `<div class="card everyone mt-1"><div class="avatars">${recipients.map((m) => `<span title="${esc(m.name)}" class="avatar">${esc(m.emoji)}</span>`).join('')}</div>
            <p class="small muted m-0">Goes to ${plural(recipients.length, 'person')}: ${esc(names(recipients.map((m) => m.name)))}.${guestsLeftOut ? ' Guests aren’t included in “Everyone”.' : ''}</p></div>`
        : `${multi ? '<p class="footnote">Tap everyone who should get it.</p>' : ''}
           <div class="grid mt-1">${others.map((m) => {
             const on = compose.toIds.includes(m.id);
             return `<button type="button" class="tile ${on ? 'selected' : ''}" data-action="pick-to" data-id="${Number(m.id)}" aria-pressed="${on}">
               <span class="avatar">${esc(m.emoji)}</span>${multi ? `<span class="tick" aria-hidden="true">${icon('check')}</span>` : ''}
               <span>${esc(m.name)}</span><span class="tag">${memberTag(m)}</span></button>`;
           }).join('')}</div>`}`;
}

function modelList(models, picked, action) {
  return `<ul class="list inset-icon">${models.map((m) => `
          <li><button type="button" class="item model-tile ${m.id === picked ? 'selected' : ''}" data-action="${action}" data-id="${m.id}" aria-pressed="${m.id === picked}">
            <span class="icon-sq">${m.emoji}</span>
            <span class="grow"><span class="title">${esc(m.name)}</span><span class="sub">${esc(m.summary)}</span></span>
            ${m.id === picked ? icon('check', 'check-mark') : m.audience === 'all' ? '' : `<span class="pill">${m.audience === 'kid' ? 'Kid-friendly' : 'Grown-up'}</span>`}
          </button></li>`).join('')}
        </ul>`;
}

// Writing an answer to someone's question: what it answers, and a way to leave it for later.
function answeringNotice(recipients) {
  const a = compose.answering;
  if (!a) return '';
  const note = answeringFor(recipients) ? '' : `<span class="small muted d-block">It counts as an answer only when it goes to ${esc(a.from.name)} alone.</span>`;
  return `<div class="notice answering">${icon('ask')}<span class="grow"><strong>Answering ${esc(a.from.name)}:</strong> “${esc(a.what)}” · ${esc(helpLabel(a.help))}${note}</span>
    <button type="button" class="link small" data-action="stop-answering">Don’t link</button></div>`;
}

export function renderGive() {
  const others = S.members.filter((m) => m.id !== S.me.id && m.active);
  if (!others.length) {
    app.innerHTML = emptyState('family', 'Add your family first',
      S.me.isParent ? 'Add family members on the Family page.' : 'Ask a parent to add more family members.',
      S.me.isParent ? '<a class="btn primary" href="#/family">Go to Family</a>' : '');
    return;
  }
  if (compose.mode === 'ask') return renderAsk(others);
  const recipients = recipientsFor();
  const ready = recipients.length > 0;
  const anyKid = recipients.some((m) => m.role === 'kid');
  let models = S.models;
  if (anyKid) models = [...models].sort((a, b) => (a.audience === 'adult') - (b.audience === 'adult'));
  // Answers to a question that allows anonymous answers all use one style (see asks.js).
  const answering = answeringFor(recipients);
  const oneStyle = answering?.anonymous && models.filter((m) => m.id === answering.model);
  if (oneStyle?.length) models = oneStyle;
  const model = ready ? models.find((m) => m.id === compose.model) : null;

  app.innerHTML = `
    <section>
      <h1>${isKid() ? 'Say something' : 'Give feedback'}</h1>
      <p class="page-sub">${isKid() ? 'Tell someone how you feel. Be kind and be honest.' : 'Kind, specific and about behavior, not character.'}</p>
      ${modeSwitch()}
      ${answeringNotice(recipients)}
      <div class="cols give-layout"><div class="col">
      ${peopleBlock('To', others, recipients)}

      ${ready ? `
        <span class="label">Style</span>
        ${modelList(models, compose.model, 'pick-model')}
        ${oneStyle?.length ? `<p class="footnote">Everyone answers ${esc(answering.from.name)}’s question with ${esc(models[0].name)}, without names, so no answer stands out.</p>`
          : anyKid && !isKid() ? '<p class="footnote">Writing to a kid? The kid-friendly styles are listed first.</p>' : ''}` : ''}
      </div><div class="col give-write">
      ${model ? composerForm(recipients, model) : `<div class="card write-hint">${icon('give')}<span>${ready ? 'Pick a style, then write it here.' : 'Choose who it’s for, then pick a style.'}</span></div>`}
      </div></div>
    </section>`;
}

export function toLabel(recipients) {
  if (compose.audience === 'everyone') return '<strong>the whole family</strong>';
  return recipients.map((m) => `<strong>${esc(m.name)}</strong>`).join(', ');
}

export function composerForm(recipients, model) {
  // Grey ghost text: a worked example for this style, a kid's or a grown-up's. Never sent.
  const example = exampleFor(model, isKid() ? 'kid' : 'adult', compose.example);
  const exampleBar = example.count ? `<p class="hint m-0 example-bar">${isKid() ? 'The grey words are an example.' : 'The grey text is an example.'}${example.count > 1
    ? ` <button type="button" class="link small" data-action="next-example">Show another (${example.index + 1} of ${example.count})</button>` : ''}</p>` : '';
  const kidHint = isKid() && model.audience === 'adult'
    ? `<p class="hint m-0">${esc(model.name)} has more steps than the others. Take your time, or ask a grown-up to help.</p>` : '';
  const fieldHtml = model.fields.map((f) => {
    const id = `field-${f.key}`;
    const label = `${esc(f.label)}${f.required ? '' : ' <span class="muted small">(optional)</span>'}`;
    if (f.type === 'choice') {
      const picked = [].concat(compose.fields[f.key] || []);
      return `<div><label id="${id}-label">${label}</label>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}
        <div class="chips" role="${f.multiple ? 'group' : 'radiogroup'}" aria-labelledby="${id}-label">${f.options.map((o) => `
          <button type="button" class="chip ${picked.includes(o.value) ? 'selected' : ''}" data-action="pick-choice" data-key="${f.key}" data-value="${o.value}"${f.multiple ? ' data-multiple="1"' : ''} aria-pressed="${picked.includes(o.value)}">${o.emoji} ${esc(o.label)}</button>`).join('')}
        </div></div>`;
    }
    return `<div><label for="${id}">${label}</label>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}
      <textarea id="${id}" data-field="${f.key}" maxlength="2000" placeholder="${esc(example.fields[f.key] || '')}">${esc(compose.fields[f.key] || '')}</textarea>
      <div class="tone" id="tone-${f.key}">${toneHtml(compose.fields[f.key] || '')}</div></div>`;
  }).join('');

  const who = recipients.length === 1 ? esc(recipients[0].name) : 'They';
  // An answer to a question is anonymous only if the person asking allowed it.
  const answering = answeringFor(recipients);
  const anon = answering?.anonymous ? `
    <label class="check"><input type="checkbox" checked disabled>
      <span>Send anonymously<br><span class="hint">Answers to ${esc(answering.from.name)}’s question come without names. Your name is not saved, and only the date is kept.${isHub() ? ' It shows up 1 to 3 hours later, so the time doesn’t give you away.' : ''}</span></span></label>`
    : !S.family.allowAnonymous ? ''
    : answering ? `<p class="small muted m-0">${esc(answering.from.name)} asked for answers with your name.</p>`
      : `
    <label class="check"><input type="checkbox" data-action="toggle-anon" ${compose.anonymous ? 'checked' : ''}>
      <span>Send anonymously<br><span class="hint">Your name is not saved, and only the date is kept. ${who} can react but can’t reply.
      ${isPeer() ? 'It reaches the home base when you next sync, which waits a few hours before showing it, but whoever syncs your phone may still guess. ' : ''}${isHub() ? 'It shows up 1 to 3 hours later, so the time doesn’t give you away. ' : ''}In a small family people may still guess, so write it the way you’d like to hear it.</span></span></label>`;

  return `
    <span class="label">Write it</span>
    <div class="two-col">
      <form class="card stack" data-form="send">
        <p class="muted small m-0">To ${toLabel(recipients)} · ${esc(model.name)}</p>
        ${kidHint}${exampleBar}
        ${fieldHtml}
        ${anon}
        ${compose.error ? `<div class="notice error">${esc(compose.error)}</div>` : ''}
        <div class="row">
          <button class="primary" type="submit">${(answering ? answering.anonymous : compose.anonymous) ? 'Send anonymously' : 'Send'}</button>
          ${compose.canConfirm ? '<button type="button" class="danger" data-action="send-anyway">Send as is</button>' : ''}
          <button type="button" class="link" data-action="reset-compose">Start over</button>
        </div>
      </form>
      <aside class="card stack">
        <h3>${esc(model.name)} tips</h3>
        <ul class="tips">${model.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p class="muted small">${esc(model.summary)}</p>
      </aside>
    </div>`;
}

// The question being answered, while the message still goes to the person who asked.
function answeringFor(recipients) {
  const a = compose.answering;
  return a && compose.audience === 'one' && recipients.length === 1 && recipients[0].id === a.from.id ? a : null;
}

export async function sendFeedback(confirmTone = false) {
  try {
    const target = compose.audience === 'everyone' ? { to: 'everyone' } : { toIds: compose.toIds };
    const answering = answeringFor(recipientsFor());
    const anonymous = answering ? !!answering.anonymous : compose.anonymous;
    const res = await api('POST', '/api/feedback', {
      ...target, model: compose.model, fields: compose.fields, anonymous, confirmTone, ...(answering && { askId: answering.id }),
    });
    const label = res.audience === 'everyone' ? 'the whole family' : res.count === 1 ? memberById(compose.toIds[0]).name : `${res.count} people`;
    clearDraft();
    toast(res.queued
      ? `Saved for ${label}${res.anonymous ? ' (anonymous)' : ''}. It goes out next time you sync.`
      : res.held
        ? `Sent to ${label} anonymously. It shows up in 1 to 3 hours, so the time doesn’t give you away.`
        : `Sent to ${label}${res.anonymous ? ' anonymously' : ''}${answering ? '. Thanks for answering.' : ''}`);
    // The question has left the Inbox: update its count.
    if (answering) setS(await api('GET', '/api/state'));
    if (res.anonymous) renderGive();
    else location.hash = '#/sent';
  } catch (err) {
    compose.error = err.message;
    compose.canConfirm = !!err.data?.canConfirm;
    renderGive();
    document.querySelector('.notice.error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// ---------- Ask: feedback on something you did ----------

function renderAsk(others) {
  const recipients = recipientsFor();
  const ready = recipients.length > 0;
  const n = recipients.length;
  const kids = recipients.filter((m) => m.role === 'kid');
  const model = S.models.find((m) => m.id === compose.askModel) || S.models.find((m) => m.id === 'glow-grow') || S.models[0];
  const anonOk = S.family.allowAnonymous && n >= ANON_ASK_MIN;
  const anon = compose.askAnon && anonOk;
  // Everyone answers in the style you pick, kids too. A grown-up style has more steps for a kid.
  const easier = S.models.filter((m) => m.audience === 'kid').concat(S.models.filter((m) => m.audience === 'all')).slice(0, 2).map((m) => m.name);
  const kidNote = !kids.length || model.audience !== 'adult' ? ''
    : `${kids.length === 1 ? `${esc(kids[0].name)} is a kid.` : 'Some of them are kids.'} ${esc(model.name)} has more steps, so ${esc(easier.join(' or '))} might be easier for ${kids.length === 1 ? esc(kids[0].name) : 'them'}.`;
  const askLabel = !ready ? 'Ask' : n === 1 ? `Ask ${esc(recipients[0].name)}` : compose.audience === 'everyone' ? 'Ask everyone' : `Ask ${n} people`;

  app.innerHTML = `
    <section>
      <h1>Ask for feedback</h1>
      <p class="page-sub">${isKid() ? 'Ask how you did. Their answers come to your Inbox.' : 'Ask about something you did. Their answers arrive in your Inbox, like any message.'}</p>
      ${modeSwitch()}
      <div class="cols give-layout"><div class="col">
        <span class="label">Your question</span>
        <div class="card stack">
          <div><label for="ask-what">What did you do?</label><p class="hint">Say it plainly, so they know what you mean.</p>
            <textarea id="ask-what" data-ask="what" form="ask-form" rows="2" maxlength="300" required placeholder="I ran the bake sale stall on Saturday.">${esc(compose.askWhat)}</textarea></div>
          <div><label id="ask-help">What would help most?</label>
            <div class="chips" role="radiogroup" aria-labelledby="ask-help">${ASK_HELP.map((h) => `<button type="button" class="chip ${compose.askHelp === h.id ? 'selected' : ''}" role="radio" aria-checked="${compose.askHelp === h.id}" data-action="pick-ask-help" data-id="${h.id}">${esc(h.label)}</button>`).join('')}</div></div>
        </div>
        ${peopleBlock('Ask', others, recipients)}
        ${ready ? `
          <span class="label">How should they answer?</span>
          ${modelList(S.models, model.id, 'pick-ask-model')}
          ${kidNote ? `<p class="footnote">${kidNote}</p>` : ''}` : ''}
      </div><div class="col give-write">
        <span class="label">Send it</span>
        <div class="two-col">
          <form class="card stack" id="ask-form" data-form="ask">
            <p class="muted small m-0">${ready ? `To ${toLabel(recipients)} · ${esc(model.emoji)} ${esc(model.name)}` : 'Choose who to ask.'}</p>
            ${S.family.allowAnonymous ? `<label class="check"><input type="checkbox" data-action="toggle-ask-anon" ${anon ? 'checked' : ''}${anonOk ? '' : ' disabled'}>
              <span>Let them answer anonymously<br><span class="hint">${anonOk
                ? `Their names aren’t kept on their answers, and you see how many answered, not who.${isHub() ? ' Each answer arrives 1 to 3 hours after it’s sent.' : ''}`
                : `Only when you ask ${ANON_ASK_MIN} or more people, so nobody can tell who said what.`}</span></span></label>` : ''}
            ${compose.error ? `<div class="notice error">${esc(compose.error)}</div>` : ''}
            <div class="row"><button class="primary" type="submit"${ready ? '' : ' disabled'}>${askLabel}</button><button type="button" class="link" data-action="reset-ask">Start over</button></div>
          </form>
          <aside class="card stack">
            <h3>What they’ll see</h3>
            <ul class="tips">
              <li>“${esc(S.me.name)} asked for your feedback” at the top of their Inbox, with what you did.</li>
              <li>They answer with ${esc(model.name)}, when they’re ready.</li>
              <li>Answers arrive in your Inbox ${anon ? 'without names' : 'with their names'}, and you can make a plan from them.</li>
            </ul>
          </aside>
        </div>
      </div></div>
    </section>`;
}

export async function sendAsk() {
  try {
    const target = compose.audience === 'everyone' ? { to: 'everyone' } : { toIds: compose.toIds };
    const anonOk = S.family.allowAnonymous && recipientsFor().length >= ANON_ASK_MIN;
    const res = await api('POST', '/api/asks', {
      ...target, what: compose.askWhat, help: compose.askHelp, model: compose.askModel, anonymous: compose.askAnon && anonOk,
    });
    const label = res.audience === 'everyone' ? 'the whole family' : res.count === 1 ? memberById(compose.toIds[0]).name : `${res.count} people`;
    clearDraft();
    compose.mode = 'ask';
    toast(res.queued ? `Saved. Your question goes to ${label} next time you sync.` : `Asked ${label}. Their answers will arrive in your Inbox.`);
    location.hash = '#/sent';
  } catch (err) {
    compose.error = err.message;
    renderGive();
    document.querySelector('.notice.error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
