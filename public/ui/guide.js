// The Guide to feedback styles.
import { modelsFor } from '../shared/models.js';
import { app, esc } from './dom.js';
import { isKid } from './state.js';
import { installTips } from './welcome.js';

export function renderGuide() {
  const visible = modelsFor(isKid() ? 'kid' : 'adult');
  app.innerHTML = `
    <section>
      <h1>Guide</h1>
      <p class="page-sub">How to give feedback that helps.</p>
      <div class="cols"><div class="col">
      <span class="label">${isKid() ? 'Kind and honest' : 'Good habits'}</span>
      <div class="card stack">
        <ul class="tips">
          <li>Talk about <strong>what happened</strong>, not what kind of person someone is.</li>
          <li>Use <strong>“I feel…”</strong> words instead of “You always…”.</li>
          <li>Ask for <strong>one small thing</strong> they can actually do.</li>
          <li>Notice the good stuff too. Thank-you notes count!</li>
          ${isKid() ? '' : '<li>Pick a calm moment, and be ready to listen to their side.</li>'}
        </ul>
      </div>
      <span class="label">Who gets it?</span>
      <div class="card stack">
        <ul class="tips">
          <li><strong>One person</strong>: private, just between you two.</li>
          <li><strong>A few people</strong>: for things that involve several of you, like siblings sharing a room.</li>
          <li><strong>Everyone</strong>: the whole family (not guests). Best for thank-yous and family-wide ideas, not for criticism of one person.</li>
        </ul>
      </div>
      <span class="label">About anonymous feedback</span>
      <div class="card stack">
        <p>When you send anonymously, your name is never saved and only the date is kept, so not even a parent can look it up.
          People can react, but can’t write back, and they don’t see who else got it. Hurtful words are blocked.</p>
        <p class="muted small">Anonymous doesn’t mean invisible: in a small family, people may still guess. Write it the way you’d want to hear it.</p>
      </div>
      <span class="label">Asking for feedback</span>
      <div class="card stack">
        <ul class="tips">
          <li>On <strong>${isKid() ? 'Say it' : 'Give'}</strong>, tap <strong>Ask</strong> and say what you did, like “I made dinner on Sunday”.</li>
          <li>Pick what would help most: <strong>what went well</strong>, <strong>one thing to try</strong>, or both.</li>
          <li>Their answers come to your Inbox.${isKid() ? '' : ' Ask 3 or more people and you can let them answer without their names.'}</li>
          <li>Asked something? It’s at the top of your Inbox. Answer when you’re ready, or tap <strong>Not now</strong>. They won’t be told.</li>
        </ul>
      </div>
      <span class="label">${isKid() ? 'When someone tells you something' : 'When you get feedback'}</span>
      <div class="card stack">
        <ul class="tips">
          <li><strong>Take a break first.</strong> After you open a message, writing back waits ${isKid() ? '10' : '30'} minutes. You can still say Thank you, Got it or Let’s talk right away.</li>
          <li><strong>Make ${isKid() ? 'a promise' : 'a plan'}.</strong> Turn it into one small step, “When I…, I’ll…”, for ${isKid() ? '7 or 14' : '7, 14 or 30'} days.${isKid() ? ' Pick a grown-up helper to cheer you on.' : ''}</li>
          <li><strong>Tick each day.</strong> Missed one? Only you see that. Pick up again tomorrow.</li>
          <li><strong>Share it if you like.</strong> Keep it ${isKid() ? 'between you and your helper' : 'to yourself'}, or let the person who told you, or the whole family, see it and cheer you on.</li>
          <li><strong>Wrap up at the end.</strong> Finish, keep going, or change it for something that works better.</li>
        </ul>
        ${isKid() ? '' : '<p class="muted small">Seeing someone keep their promise? Tap “I noticed” on their plan. Noticing helps more than reminding.</p>'}
      </div>
      <div class="mt-1">${installTips()}</div>
      </div><div class="col">
      <span class="label">Feedback styles</span>
      <div class="stack">${visible.map((m) => `
        <article class="card stack">
          <div class="row"><span class="icon-sq">${m.emoji}</span><h3 class="grow m-0">${esc(m.name)}</h3>${m.audience === 'all' ? '' : `<span class="pill">${m.audience === 'adult' ? 'Grown-up' : 'Kid-friendly'}</span>`}</div>
          <p class="muted small">${esc(m.summary)}</p>
          <ol class="tips">${m.fields.map((f) => `<li>${esc(f.label)}${f.hint ? `: <span class="muted">${esc(f.hint)}</span>` : ''}</li>`).join('')}</ol>
          <ul class="tips small muted">${m.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </article>`).join('')}
      </div>
      </div></div>
    </section>`;
}
