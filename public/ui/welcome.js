// Setting up a family, signing in, joining with an invite and the welcome screen.
import { EMOJIS, app, clearToast, emptyState, esc, icon } from './dom.js';
import { currentPushSub, setAppBadge } from './push.js';
import { refresh } from './router.js';
import { S, api, clearDraft, isDevice, isHub, isKid, isPeer, isStandalone, memberById, memberTag, platform, ui } from './state.js';
import { endSync } from './sync.js';

export function emojiPicker(name, selected) {
  return `<div class="chips" role="radiogroup" aria-label="Pick an emoji">${EMOJIS.map((e) => `
    <button type="button" class="chip ${e === selected ? 'selected' : ''}" data-action="pick-emoji" data-name="${name}" data-emoji="${e}" aria-pressed="${e === selected}">${e}</button>`).join('')}
  </div>`;
}

export function renderSetup() {
  const where = isDevice()
    ? `<div class="notice"><strong>Saved on this device.</strong> It becomes your family’s <strong>home base</strong>:
         pass it around, or link everyone’s own phone to it and sync when you’re together.
         ${platform() === 'ios' ? 'Add it to your Home Screen first, so iOS keeps your family’s data.' : ''}</div>`
    : `<fieldset class="stack plain"><legend>Where should your family’s feedback live?</legend>
         <label class="check option"><input type="radio" name="where" value="hub" checked>
           <span><strong>Home hub</strong> <span class="pill">Recommended</span><br><span class="hint">Everyone uses their own iPhone or Chromebook on your home Wi-Fi. This computer keeps the messages.</span></span></label>
         <label class="check option"><input type="radio" name="where" value="device">
           <span><strong>Only this device</strong><br><span class="hint">One shared iPad or Chromebook that the family passes around. Nothing is stored on the hub.</span></span></label>
       </fieldset>`;
  const setup = `
    <section class="stack narrow">
      <h1>Welcome</h1>
      <p class="page-sub">Set up your family’s feedback space. You’ll be the first parent, then you can add everyone else.</p>
      <form data-form="setup" class="stack">
        ${where}
        <div class="card stack">
          <div><label for="familyName">Family name</label><input id="familyName" name="familyName" type="text" maxlength="60" placeholder="The Garcias" required></div>
          <div><label for="name">Your name</label><input id="name" name="name" type="text" maxlength="40" placeholder="Mom" required autocomplete="given-name"></div>
          <div><label>Your picture</label>${emojiPicker('setupEmoji', ui.setupEmoji)}</div>
          <div><label for="pin">PIN (optional, 4–8 digits)</label>
            <p class="hint">A PIN stops others from signing in as you on a shared device.</p>
            <input id="pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password"></div>
          <label class="check"><input type="checkbox" name="allowAnonymous" checked> Allow anonymous feedback</label>
        </div>
        <button class="primary big-btn" type="submit">Create our family space</button>
      </form>
    </section>`;
  if (!isDevice()) {
    app.innerHTML = setup;
    return;
  }
  // A phone that was linked before most likely wants to be linked again, not start a new family.
  const wasLinked = localStorage.getItem('ff-was-linked');
  const join = `<section class="stack narrow">
      <span class="label">${wasLinked ? 'Link this phone again?' : 'Joining your family?'}</span>
      <ul class="list inset-icon"><li><button type="button" class="item" data-action="start-join">
        <span class="icon-sq solid">${icon('link')}</span>
        <span class="grow"><span class="title">Link this phone</span>
          <span class="sub">${wasLinked ? `This phone used to be linked to ${esc(wasLinked)}.` : 'Your family already uses Echoes on another phone.'}
            A parent starts it there from Family → Link phone.</span></span>${icon('chevron', 'chev')}</button></li></ul>
    </section>`;
  app.innerHTML = wasLinked ? `${join}<p class="center muted small mt-2">Or start a new family on this phone</p>${setup}` : `${setup}${join}`;
}

export function renderSignIn() {
  const people = S.members.filter((m) => m.active);
  const sel = memberById(ui.signInId);
  app.innerHTML = `
    <section class="stack">
      <h1>Who’s here?</h1>
      <p class="page-sub">Tap your picture to sign in.</p>
      ${ui.signedOutForPrivacy ? `<div class="notice">${icon('lock')}The last person was signed out to keep their messages private.</div>` : ''}
      ${isHub() ? `<label class="check narrow"><input type="checkbox" data-action="toggle-keep" ${ui.keepSignedIn ? 'checked' : ''}>
        <span>Keep me signed in on this device<br><span class="hint">Only on your own phone or computer. Otherwise you’re signed out after 3 minutes without a tap, or when the browser closes, so the next person can’t read your messages.</span></span></label>` : ''}
      <div class="grid">${people.map((m) => `
        <button type="button" class="tile ${m.id === ui.signInId ? 'selected' : ''}" data-action="pick-signin" data-id="${Number(m.id)}">
          <span class="avatar">${esc(m.emoji)}</span><span>${esc(m.name)}</span>
          <span class="tag">${m.hasPin ? `${icon('lock')} ` : ''}${memberTag(m)}</span>
        </button>`).join('')}
      </div>
      ${sel && sel.hasPin ? `
        <form data-form="signin" class="card stack narrow">
          <label for="signin-pin">${esc(sel.name)}, enter your PIN</label>
          <input id="signin-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
          <div id="signin-error"></div>
          <button class="primary" type="submit">Sign in</button>
        </form>` : ''}
      ${isDevice() ? `<ul class="list inset-icon mt-2"><li><a class="item" href="#/sync"><span class="icon-sq">${icon('sync')}</span>
        <span class="grow title">Sync someone’s phone</span>${icon('chevron', 'chev')}</a></li></ul>` : ''}
    </section>`;
  document.getElementById('signin-pin')?.focus();
}

export async function signIn(memberId, pin) {
  await api('POST', '/api/login', { memberId, pin, ...(isHub() && { keep: !!ui.keepSignedIn }) });
  ui.keepSignedIn = false;
  ui.signInId = null;
  ui.signedOutForPrivacy = false;
  clearToast();
  location.hash = '#/inbox';
  await refresh();
}

export async function signOut({ privacy = false } = {}) {
  endSync();
  clearDraft();
  clearToast();
  // The next person on a shared device turns notifications on for themselves. Unsubscribe the browser
  // too, so this device can't get the last person's pings even if the hub can't be told right now.
  if (isHub()) {
    const sub = await currentPushSub().catch(() => null);
    if (sub) {
      await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  }
  setAppBadge(0);
  await api('POST', '/api/logout');
  ui.invite = null;
  ui.signedOutForPrivacy = privacy;
  history.replaceState(null, '', location.pathname);
  await refresh();
}

export async function joinWithInvite(token, pin) {
  if (pin === undefined) app.innerHTML = emptyState('link', 'Joining your family…');
  try {
    if (!isHub()) throw new Error('Invites only work with a home hub.');
    await api('POST', '/api/join', { token, ...(pin !== undefined && { pin }) });
    ui.joinPin = null;
    history.replaceState(null, '', '#/inbox');
    await refresh();
  } catch (err) {
    // Someone with a PIN types it, so an invite alone can't open their messages on another phone.
    if ((err.status === 401 || err.status === 429) && (err.data?.needPin || ui.joinPin?.token === token)) {
      ui.joinPin = { token, name: err.data?.name || ui.joinPin?.name || '' };
      return renderJoinPin(err.data?.needPin ? '' : err.message);
    }
    ui.joinPin = null;
    app.innerHTML = emptyState('warning', 'This invite didn’t work', esc(err.message), '<a class="btn primary" href="#/inbox">Continue</a>');
  }
}

export function renderJoinPin(error) {
  app.innerHTML = `<section class="stack narrow"><h1>Add this phone</h1>
      <form data-form="join-pin" class="card stack">
        <label for="join-pin">${esc(ui.joinPin.name)}, type your PIN</label>
        <input id="join-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
        ${error ? `<div class="notice error">${esc(error)}</div>` : ''}
        <p class="small muted m-0">This makes sure the phone is yours before your messages show up on it.</p>
        <div><button class="primary" type="submit">Add this phone</button></div>
      </form></section>`;
  document.getElementById('join-pin').focus();
}

export function installTips() {
  if (isStandalone()) return '';
  const p = platform();
  const how = p === 'ios'
    ? `Tap <strong>Share</strong> ${icon('upload')} in Safari, then <strong>Add to Home Screen</strong>.`
    : p === 'chromeos'
      ? 'Click the <strong>Install</strong> icon in Chrome’s address bar, or open the ⋮ menu and choose <strong>Install</strong>.'
      : 'In your browser menu, choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.';
  return `<div class="notice stack"><div>${icon('phone')}<strong>Put it on your Home Screen</strong> so it opens like an app.</div><div class="small muted">${how}</div>
    ${ui.installPrompt ? '<div><button type="button" data-action="install">Install now</button></div>' : ''}</div>`;
}

export function renderWelcome() {
  const kid = isKid();
  const promises = kid
    ? ['I say how I feel with kind words.', 'I talk about what happened, not about the person.', 'I say thank you when someone does something nice.', 'If something is hard to hear, I can say “Let’s talk”.']
    : ['We give feedback to help each other, never to hurt.', 'We describe what happened and how it felt, not what kind of person someone is.', 'We notice the good stuff and say thanks often.', 'When something is hard to hear, we take a breath and talk it through.'];
  app.innerHTML = `
    <section class="stack narrow welcome">
      <div class="big"><span class="avatar xl">${esc(S.me.emoji)}</span></div>
      <h1 class="center">Welcome, ${esc(S.me.name)}!</h1>
      <p class="center muted">${esc(S.family.name)} uses this space to say thanks and to ask for what we need, kindly.
        ${S.me.guest ? `You’re a guest${S.me.guestUntil ? ` until ${esc(new Date(S.me.guestUntil + 'T12:00').toLocaleDateString())}` : ''}.` : ''}</p>
      <span class="label">${kid ? 'My promise' : 'Our family promise'}</span>
      <ul class="promise">${promises.map((p) => `<li>${icon('check')}<span>${esc(p)}</span></li>`).join('')}</ul>
      <form data-form="welcome" class="stack">
        ${S.me.hasPin || isPeer() ? '' : `<div class="card"><label for="w-pin">Pick a PIN (optional)</label>
          <p class="hint">${isDevice() ? 'Others use this device too, so a PIN keeps your inbox yours.' : 'Without one, anyone who can open the family hub can sign in as you by tapping your picture. A PIN keeps your inbox yours.'}</p>
          <input id="w-pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password"></div>`}
        ${installTips()}
        <button class="primary big-btn" type="submit">${kid ? 'I promise!' : 'We’re in'}</button>
      </form>
    </section>`;
}
