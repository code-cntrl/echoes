// Plans made from feedback (rules in shared/plans.js).
import { CHEERS, FEELINGS, KID_PROMISES, NOTICED, PLAN_DAYS, addDays, keptDays, localDate, planProgress } from '../shared/plans.js';
import { ago, app, emptyState, esc, icon, plural, shortDate } from './dom.js';
import { calmLeft, minutesLabel, previewText } from './inbox.js';
import { renderChrome } from './router.js';
import { S, api, isKid, setS, ui } from './state.js';

export const kidPromise = (id) => KID_PROMISES.find((k) => k.id === id);
export const goodDays = (n, kid) => plural(n, kid ? 'star' : 'good day');
export const planIcon = (p) => (p.kid ? `<span class="icon-sq">${esc(kidPromise(p.promiseId)?.emoji || '⭐')}</span>` : `<span class="icon-sq green">${icon('sprout')}</span>`);
export const whenThen = (p) => `When I ${esc(p.when)}, I’ll ${esc(p.then)}.`;

export function shareChoices(kid, giver) {
  return [
    ['private', kid ? 'Me and my helper' : 'Only me', kid ? 'Your helper sees it and can cheer you on.' : 'Nobody else sees it.'],
    ...(giver ? [['giver', kid ? `Me, my helper and ${giver.name}` : `Me and ${giver.name}`, `${giver.name} sees the promise, how it’s going and can cheer you on.`]] : []),
    ['family', kid ? 'Everyone in the family' : 'The whole family', 'Everyone except guests can see it and cheer you on.'],
  ];
}

export function shareLabel(p) {
  if (p.share === 'family') return 'Whole family';
  if (p.share === 'giver' && p.giver) return `You and ${p.giver.name}`;
  return p.kid ? 'You and your helper' : 'Only you';
}

export function cheerList(p) {
  if (!p.cheers?.length) return '';
  const recent = p.cheers.slice(-3).reverse();
  return `<ul class="cheers" aria-label="Cheers">${recent.map((c) => {
    const k = CHEERS.find((x) => x.id === c.cheer);
    return `<li><span class="avatar sm">${esc(c.from.emoji)}</span><span class="grow"><strong>${esc(c.from.name)}</strong> · ${k ? `${k.emoji} ${esc(k.label)}` : ''}</span><span class="when">${esc(ago(c.at))}</span></li>`;
  }).join('')}</ul>${p.cheers.length > 3 ? `<p class="footnote m-0">${plural(p.cheers.length, 'cheer')} so far</p>` : ''}`;
}

export const noticedText = (n) => {
  const a = NOTICED.find((x) => x.id === n?.answer);
  return a ? `${a.emoji} ${esc(a.label)}` : '';
};

// Every day of the plan; only the owner ever sees this. Past days can be changed by tapping them.
export function dayStrip(p, today) {
  const { total } = planProgress(p, today);
  const cells = [];
  for (let i = 0; i < total; i++) {
    const date = addDays(p.startDate, i);
    const v = p.ticks?.[date];
    const when = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (date > today) {
      cells.push('<li class="future" aria-hidden="true"></li>');
      continue;
    }
    const mark = p.kid ? (v === 'kept' ? '⭐' : v === 'slip' ? '🌱' : '') : (v === 'kept' ? icon('check') : v === 'slip' ? '–' : '');
    const state = v === 'kept' ? 'kept' : v === 'slip' ? 'not this time' : 'not marked';
    cells.push(`<li class="${v || ''}${date === today ? ' today' : ''}"><button type="button" data-action="tick-cycle" data-ref="${esc(p.ref)}" data-date="${date}" aria-label="${esc(`${when}: ${state}. Tap to change.`)}">${mark}</button></li>`);
  }
  return `<ol class="days${p.kid ? ' stickers' : ''}" aria-label="Your days">${cells.join('')}</ol>
    <p class="footnote m-0">${icon('lock')} Only you see your days.</p>`;
}

export function todayRow(p, today, pr) {
  if (today > pr.endDate) return '';
  const v = p.ticks?.[today];
  const note = v === 'slip' ? 'That’s okay. Pick up again tomorrow.' : v === 'kept' ? (p.kid ? 'Star earned!' : 'Nice. Keep it going.') : (p.kid ? 'Did you do it today?' : 'Did you keep it today?');
  const btn = (value, label) => `<button type="button" class="chip ${v === value ? 'selected' : ''}" data-action="tick" data-ref="${esc(p.ref)}" data-date="${today}" data-value="${value}" aria-pressed="${v === value}">${label}</button>`;
  return `<div class="today-row" role="group" aria-label="Today">
    <span class="grow"><strong>Today</strong><span class="small muted d-block">${note}</span></span>
    ${btn('kept', p.kid ? '⭐ I did it' : `${icon('check')} Kept it`)}${btn('slip', 'Not today')}
  </div>`;
}

export function checkinBox(p, pr) {
  const done = (p.checkins || []).find((c) => c.round === pr.round);
  if (done) {
    const f = FEELINGS.find((x) => x.id === done.feeling);
    return `<p class="small muted m-0">Halfway check-in: ${f ? `${f.emoji} ${esc(f.label)}` : ''}${done.note ? ` · “${esc(done.note)}”` : ''}</p>`;
  }
  if (!pr.halfway || pr.ended) return '';
  return `<form class="inset stack" data-form="checkin" data-ref="${esc(p.ref)}">
    <div><strong>Halfway check-in</strong><div class="small muted">How is it going? Only you see this.</div></div>
    <div class="chips" role="radiogroup" aria-label="How is it going?">${FEELINGS.map((f) => `<label class="chip radio"><input type="radio" name="feeling" value="${f.id}" required>${f.emoji} ${esc(f.label)}</label>`).join('')}</div>
    <textarea name="note" maxlength="300" aria-label="Note" placeholder="${p.kid ? 'What helps? (you can skip this)' : 'What’s helping? What gets in the way? (optional)'}"></textarea>
    <div class="row"><button type="submit">Save check-in</button></div>
  </form>`;
}

export function wrapBox(p, pr) {
  if (!pr.ended) return '';
  const giver = p.giver && p.share !== 'private' ? p.giver : null;
  const choices = [
    ['finish', p.kid ? 'I’ve got this! Finish' : 'Finish: I’ve got this'],
    ['keep', `Keep going for another ${Number(p.days)} days`],
    ['change', 'Change the plan and try something else'],
  ];
  return `<form class="inset stack" data-form="wrap" data-ref="${esc(p.ref)}">
    <div><strong>${p.kid ? `You made it to day ${pr.total}!` : `Your ${pr.total} days are up`}</strong><div class="small muted">How did it go? What’s next?</div></div>
    <fieldset class="plain stack-tight"><legend class="sr-only">What’s next</legend>${choices.map(([v, l], i) => `<label class="check option"><input type="radio" name="outcome" value="${v}" ${i === 0 ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</fieldset>
    <textarea name="note" maxlength="300" aria-label="What did you learn?" placeholder="What did you learn? (optional)"></textarea>
    ${giver ? `<label class="check"><input type="checkbox" name="askGiver" checked><span>Ask ${esc(giver.name)} if they’ve noticed a difference</span></label>` : ''}
    <div class="row"><button type="submit" class="primary">Save</button></div>
  </form>`;
}

export function myPlanCard(p, today) {
  const pr = planProgress(p, today);
  return `<article class="card plan stack">
    <div class="plan-head">${planIcon(p)}
      <div class="grow"><h3 class="m-0">${esc(p.promise)}</h3><div class="small muted">${whenThen(p)}</div></div>
      <span class="pill">${p.pending ? 'Waiting' : esc(shareLabel(p))}</span>
    </div>
    <div><progress max="${pr.total}" value="${pr.day}" aria-label="Day ${pr.day} of ${pr.total}"></progress>
      <div class="small muted">Day ${pr.day} of ${pr.total} · ${goodDays(keptDays(p), p.kid)}${p.helper ? ` · Helper: ${esc(p.helper.name)}` : ''}</div></div>
    ${todayRow(p, today, pr)}
    ${dayStrip(p, today)}
    ${checkinBox(p, pr)}
    ${wrapBox(p, pr)}
    ${cheerList(p)}
    ${p.noticed && p.giver ? `<p class="small m-0">${esc(p.giver.name)} has noticed: ${noticedText(p.noticed)}</p>` : ''}
    <details class="plan-more"><summary>Details</summary>
      ${p.heard ? `<p class="heard small"><span class="muted">What I heard:</span> ${esc(p.heard)}</p>` : ''}
      <div><label for="share-${esc(p.ref)}" class="small">Who can see it</label>
        <select id="share-${esc(p.ref)}" data-action="share-plan" data-ref="${esc(p.ref)}">${shareChoices(p.kid, p.giver).map(([v, l]) => `<option value="${v}" ${p.share === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <p class="footnote m-0">Days you miss and your check-ins are only ever shown to you.</p>
      <div class="row"><button type="button" class="link danger small" data-action="stop-plan" data-ref="${esc(p.ref)}">Stop this ${p.kid ? 'promise' : 'plan'}</button></div>
    </details>
  </article>`;
}

export function sharedPlanCard(p, today) {
  const pr = planProgress(p, today);
  const cheeredToday = p.cheers.some((c) => c.from.id === S.me.id && c.day === today);
  const role = p.youAreHelper ? ' · you’re the helper' : p.youAreGiver ? ' · from your message' : '';
  return `<article class="card plan stack">
    <div class="plan-head"><span class="avatar">${esc(p.owner.emoji)}</span>
      <div class="grow"><div class="small muted">${esc(p.owner.name)}’s ${p.kid ? 'promise' : 'plan'}${role}</div>
        <h3 class="m-0">${p.kid ? `${esc(kidPromise(p.promiseId)?.emoji || '')} ` : ''}${esc(p.promise)}</h3>
        <div class="small muted">${whenThen(p)}</div></div>
    </div>
    ${p.heard ? `<p class="heard small"><span class="muted">What ${esc(p.owner.name)} heard:</span> ${esc(p.heard)}</p>` : ''}
    ${p.status === 'active'
      ? `<div><progress max="${pr.total}" value="${pr.day}" aria-label="Day ${pr.day} of ${pr.total}"></progress><div class="small muted">Day ${pr.day} of ${pr.total} · ${goodDays(p.keptDays, p.kid)}</div></div>`
      : `<p class="small muted m-0">Finished · ${goodDays(p.keptDays, p.kid)}</p>`}
    ${p.askGiver && !p.noticed ? `<div class="inset stack"><strong>${esc(p.owner.name)} asks: have you noticed a difference?</strong>
        <div class="chips">${NOTICED.map((n) => `<button type="button" class="chip" data-action="noticed" data-ref="${esc(p.ref)}" data-answer="${n.id}">${n.emoji} ${esc(n.label)}</button>`).join('')}</div></div>`
      : p.noticed ? `<p class="small m-0">You said: ${noticedText(p.noticed)}</p>` : ''}
    ${cheerList(p)}
    ${p.status === 'active' ? `<div class="chips" role="group" aria-label="Cheer ${esc(p.owner.name)} on">${CHEERS.map((c) => `<button type="button" class="chip" data-action="cheer" data-ref="${esc(p.ref)}" data-cheer="${c.id}" data-name="${esc(p.owner.name)}" ${cheeredToday ? 'disabled' : ''}>${c.emoji} ${esc(c.label)}</button>`).join('')}</div>
      ${cheeredToday ? '<p class="footnote m-0">You cheered today. Cheer again tomorrow.</p>' : ''}` : ''}
  </article>`;
}

export async function renderPlans() {
  const data = await api('GET', '/api/plans');
  ui.plans = data;
  const today = localDate();
  const mine = data.mine.filter((p) => p.status === 'active');
  const waitingOnMe = (p) => p.askGiver && !p.noticed;
  const shared = data.shared.filter((p) => p.status === 'active' || waitingOnMe(p));
  const finished = [...data.mine.filter((p) => p.status !== 'active'), ...data.shared.filter((p) => p.status !== 'active' && !waitingOnMe(p))];
  const failed = data.failed || [];
  if (!mine.length && !shared.length && !finished.length && !failed.length) {
    app.innerHTML = emptyState('sprout', isKid() ? 'No promises yet' : 'No plans yet',
      isKid() ? 'When someone tells you something, you can make a promise to try. Open a message and, after a little break, tap Make a promise.'
        : 'When feedback lands, you can turn it into one small promise. Open a message in your Inbox and, after a short break, tap Make a plan.',
      '<a class="btn primary" href="#/inbox">Go to Inbox</a>');
    return;
  }
  const finishedRow = (p) => {
    const kept = p.mine ? keptDays(p) : p.keptDays;
    const how = p.wrap?.outcome === 'change' ? 'changed' : 'finished';
    const noticed = p.mine && p.noticed && p.giver ? ` · ${esc(p.giver.name)}: ${noticedText(p.noticed)}` : '';
    return `<li><div class="item">${p.mine ? planIcon(p) : `<span class="avatar sm">${esc(p.owner.emoji)}</span>`}
      <span class="grow"><span class="title">${esc(p.promise)}</span><span class="sub">${p.mine ? '' : `${esc(p.owner.name)} · `}${goodDays(kept, p.kid)} · ${how} ${esc(shortDate(p.endedAt))}${noticed}</span></span></div></li>`;
  };
  app.innerHTML = `
    <section>
      <h1>${isKid() ? 'Promises' : 'Plans'}</h1>
      <p class="page-sub">${isKid() ? 'Little promises you made. Collect a star each day you do it.' : 'Small promises made from feedback. Only you see the days you miss.'}</p>
      ${failed.map((f) => `<div class="notice error small mt-1">“${esc(f.promise)}” wasn’t saved: ${esc(f.error)}
        <div class="row"><button type="button" class="link small danger" data-action="discard-failed-plan" data-id="${esc(f.id)}">Discard</button></div></div>`).join('')}
      ${mine.length ? `<span class="label">${isKid() ? 'My promises' : 'My plans'}</span><div class="stack card-grid">${mine.map((p) => myPlanCard(p, today)).join('')}</div>` : ''}
      ${shared.length ? `<span class="label">In the family</span><div class="stack card-grid">${shared.map((p) => sharedPlanCard(p, today)).join('')}</div>` : ''}
      ${finished.length ? `<span class="label">Finished</span><ul class="list inset-icon">${finished.map(finishedRow).join('')}</ul>` : ''}
    </section>`;
}

// Making a plan from a message (or, at the wrap-up, a new plan in place of an old one).
export async function renderPlanForm({ feedbackId = null, fromPlanId = null }) {
  const kid = isKid();
  let source = null;
  let old = null;
  if (fromPlanId) {
    old = (await api('GET', '/api/plans')).mine.find((p) => p.ref === fromPlanId);
  } else {
    ui.inbox = await api('GET', '/api/inbox');
    source = ui.inbox.find((f) => f.id === Number(feedbackId));
  }
  if (!source && !old) {
    app.innerHTML = emptyState('warning', 'That message isn’t here any more', '', '<a class="btn primary" href="#/inbox">Back to Inbox</a>');
    return;
  }
  const left = source ? (source.read ? calmLeft(source) : 1) : 0;
  if (left) {
    app.innerHTML = emptyState('timer', 'Take a short break first',
      `${source.read ? `You can make a plan in ${minutesLabel(left)}.` : 'Open the message first.'} Read it once more: what is one part that’s true?`,
      '<a class="btn primary" href="#/inbox">Back to Inbox</a>');
    return;
  }
  const giver = old ? old.giver : (!source.anonymous && source.from?.id ? source.from : null);
  const helpers = S.members.filter((m) => m.role === 'adult' && !m.guest && m.active && m.id !== S.me.id);
  const days = PLAN_DAYS[kid ? 'kid' : 'adult'];
  const intro = source
    ? `<div class="card"><div class="small muted">${source.anonymous ? 'From someone in your family' : `From ${esc(source.from.name)}`} · ${esc(source.modelName)}</div>
        <p class="m-0">${esc(previewText(source.model, source.fields))}</p></div>`
    : `<div class="card"><div class="small muted">In place of</div><p class="m-0">${esc(old.promise)}</p></div>`;
  const whenThenFields = `<div class="when-then">
      <div><label for="plan-when">When I…</label><input id="plan-when" name="when" type="text" maxlength="120" required placeholder="${kid ? 'feel cross' : 'feel my voice getting louder'}"></div>
      <div><label for="plan-then">I’ll…</label><input id="plan-then" name="then" type="text" maxlength="120" required placeholder="${kid ? 'take three big breaths' : 'stop, breathe and say “give me a minute”'}"></div>
    </div>`;
  const heardField = `<div><label for="plan-heard">${kid ? 'What did they say? <span class="muted small">(you can skip this)</span>' : 'What I heard'}</label>
      ${kid ? '' : '<p class="hint">Say it back in your own words, without a “but”.</p>'}
      <textarea id="plan-heard" name="heard" maxlength="400" ${kid ? '' : 'required'} placeholder="${kid ? 'In my words, they said…' : 'You’re saying that when I…'}">${esc(old?.heard || '')}</textarea></div>`;
  app.innerHTML = `
    <section>
      <h1>${kid ? 'Make a promise' : 'Make a plan'}</h1>
      <p class="page-sub">${kid ? 'Pick one thing to try. Your helper will cheer you on.' : 'Turn what you heard into one small promise you can keep.'}</p>
      <form class="cols plan-form" data-form="plan" data-feedback="${esc(source?.id ?? '')}" data-from="${esc(old?.ref ?? '')}">
        <div class="col">${intro}
        ${kid ? `
          <span class="label">Pick your promise</span>
          <div class="promises" role="radiogroup" aria-label="Pick your promise">${KID_PROMISES.map((k) => `
            <label class="ptile"><input type="radio" name="promiseId" value="${k.id}" data-action="pick-promise" required><span class="big" aria-hidden="true">${k.emoji}</span><span>${esc(k.label)}</span></label>`).join('')}
          </div>
          <div class="card stack mt-1">${whenThenFields}${heardField}</div>`
        : `<div class="card stack">${heardField}
            <div><label for="plan-promise">My promise</label><input id="plan-promise" name="promise" type="text" maxlength="120" required placeholder="Keep my voice calm when I’m upset"></div>
            ${whenThenFields}
            <p class="hint m-0">One small “When I…, I’ll…” step works better than a big promise.</p></div>`}
        </div><div class="col">
        <span class="label">How long</span>
        <div class="segmented${days.length === 2 ? ' two' : ''}" role="radiogroup" aria-label="How long">${days.map((n) => `
          <label><input type="radio" name="days" value="${n}" ${n === days.at(-1) ? 'checked' : ''}>${n} days</label>`).join('')}
        </div>
        ${kid ? `
          <span class="label">Your helper</span>
          ${helpers.length ? `<div class="grid" role="radiogroup" aria-label="Your helper">${helpers.map((m, i) => `
            <label class="tile"><input type="radio" name="helperId" value="${Number(m.id)}" ${i === 0 ? 'checked' : ''}><span class="avatar">${esc(m.emoji)}</span><span>${esc(m.name)}</span></label>`).join('')}</div>
            <p class="footnote">A grown-up who sees your promise and cheers you on.</p>`
          : '<div class="notice">Ask a parent to add a grown-up to the family first.</div>'}` : ''}
        <span class="label">Who can see it</span>
        <fieldset class="plain stack-tight"><legend class="sr-only">Who can see it</legend>${shareChoices(kid, giver).map(([v, l, hint]) => `
          <label class="check option"><input type="radio" name="share" value="${v}" ${v === (old?.share || 'private') ? 'checked' : ''}><span>${esc(l)}<br><span class="hint">${esc(hint)}</span></span></label>`).join('')}
        </fieldset>
        <p class="footnote">Days you miss and your check-ins are only shown to you. Others see the day count, ${kid ? 'stars' : 'good days'} and cheers.${source?.anonymous ? ' This message was anonymous, so the plan can’t go back to whoever sent it.' : ''}</p>
        <div id="plan-error" class="mt-1"></div>
        <div class="row mt-1"><button class="primary big-btn" type="submit">${kid ? 'Start my promise' : 'Start my plan'}</button></div>
        </div>
      </form>
    </section>`;
}

export async function afterPlanChange(focusSelector) {
  setS(await api('GET', '/api/state'));
  renderChrome();
  await renderPlans();
  if (focusSelector) document.querySelector(focusSelector)?.focus();
}
