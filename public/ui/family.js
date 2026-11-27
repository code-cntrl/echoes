// Family: members, invites, notifications, profile and settings.
import { actions } from './actions.js';
import { EMOJIS, ago, app, esc, icon, plural } from './dom.js';
import { checkPush, notificationsSection } from './push.js';
import { S, api, isDevice, isHub, isPeer, memberById, memberTag, platform, ui } from './state.js';

// A picture picker for forms: the grid above, the person's current picture kept even if it isn't
// in the grid, and "Type your own" for anything else.
export function emojiField(selected, id) {
  const options = EMOJIS.includes(selected) ? EMOJIS : [selected, ...EMOJIS];
  return `<fieldset class="plain emoji-field"><legend>Picture</legend>
      <div class="emoji-grid">${options.map((e) => `<label class="emoji-opt"><input type="radio" name="emoji" value="${esc(e)}" ${e === selected ? 'checked' : ''} aria-label="${esc(e)}"><span aria-hidden="true">${esc(e)}</span></label>`).join('')}</div>
      <details class="emoji-own"><summary>Type your own</summary>
        <input id="${id}" name="emojiOwn" type="text" maxlength="16" class="emoji-input" aria-label="Your own emoji" placeholder="🙂"></details>
    </fieldset>`;
}
export const emojiFrom = (d) => String(d.get('emojiOwn') || '').trim() || d.get('emoji');

export function memberForm(m, formName) {
  const isEdit = !!m;
  // A new person gets a picture nobody else has yet, so tiles and inboxes stay easy to tell apart.
  const emoji = m?.emoji || EMOJIS.find((e) => !S.members.some((x) => x.emoji === e)) || '🙂';
  return `
    <form class="stack" data-form="${formName}" ${isEdit ? `data-id="${Number(m.id)}"` : ''}>
      <div><label>Name</label><input name="name" type="text" maxlength="40" required value="${esc(m?.name || '')}"></div>
      ${emojiField(emoji, `emoji-own-${m?.id ?? 'new'}`)}
      <div><label>Role</label><select name="role">
        <option value="adult" ${m?.role !== 'kid' ? 'selected' : ''}>Grown-up</option>
        <option value="kid" ${m?.role === 'kid' ? 'selected' : ''}>Kid</option></select></div>
      <label class="check"><input type="checkbox" name="guest" ${m?.guest ? 'checked' : ''}> <span>Guest (visiting family, a sitter…)<br><span class="hint">Guests can give and get feedback, aren’t part of “Everyone” messages, and stop working after their end date.</span></span></label>
      <div class="guest-until"><label>Guest until <span class="muted small">(optional)</span></label>
        <input name="guestUntil" type="date" value="${esc(m?.guestUntil || '')}"></div>
      <label class="check parent-check"><input type="checkbox" name="isParent" ${m?.isParent ? 'checked' : ''}> Parent (can manage the family)</label>
      <div><label>${isEdit && m.hasPin ? 'New PIN (leave blank to keep, type “none” to remove)' : 'PIN (optional, 4–8 digits)'}</label>
        <input name="pin" type="password" inputmode="numeric" autocomplete="new-password"></div>
      <div class="row"><button class="primary" type="submit">${isEdit ? 'Save' : isHub() ? 'Add and invite' : 'Add to family'}</button>
        ${isEdit ? '<button type="button" class="link" data-action="cancel-edit">Cancel</button>' : ''}</div>
    </form>`;
}

export function invitePanel() {
  const inv = ui.invite;
  if (!inv) return '';
  const m = memberById(inv.memberId);
  if (!m) return '';
  const text = `${S.me.name} invited you to ${S.family.name} on Echoes. Open this on your phone while you’re on our home Wi-Fi:`;
  const canShare = typeof navigator.share === 'function';
  return `
    <section class="card stack invite" id="invite-panel">
      <div class="row"><h2 class="grow">Invite ${esc(m.name)}</h2><button type="button" class="link" data-action="close-invite">Close</button></div>
      ${inv.reachable ? '' : `<div class="notice error">Phones can’t reach this hub yet: it only accepts connections from this computer.
        Restart it with <code>HOST=0.0.0.0</code> (see README), then make a new invite.</div>`}
      <div class="invite-body">
        <img class="qr" src="${esc(inv.qr)}" alt="QR code for ${esc(m.name)}’s invite">
        <div class="stack">
          <p><strong>Bring the phones together:</strong> ${esc(m.name)} points their iPhone or Chromebook camera at this code and taps the link.</p>
          <div class="row">
            ${canShare ? '<button type="button" class="primary" data-action="share-invite">Share… (AirDrop, Messages)</button>' : ''}
            <a class="btn" href="sms:?&body=${encodeURIComponent(`${text} ${inv.url}`)}">Text it</a>
            <button type="button" data-action="copy-invite">Copy link</button>
          </div>
          <input type="text" readonly class="invite-url" value="${esc(inv.url)}" aria-label="Invite link">
          <p class="muted small">Works once and expires ${esc(new Date(inv.expiresAt).toLocaleDateString())}. Anyone with the link can sign in as ${esc(m.name)}, so share it only with them.</p>
        </div>
      </div>
    </section>`;
}

export function storageCard() {
  if (isHub()) {
    return `<span class="label">Home hub</span>
      <p class="footnote mt-0">Messages are kept on the computer running the hub. Add a phone by tapping <strong>Invite</strong> next to someone.</p>`;
  }
  if (isPeer()) {
    const p = S.peer;
    return `<span class="label">Linked to your family’s home base</span>
      <ul class="list inset-icon">
        <li><a class="item" href="#/sync"><span class="icon-sq solid">${icon('sync')}</span><span class="grow title">Sync now</span>
          <span class="end">${p.connected ? 'Connected' : esc(ago(p.lastSyncAt))}${p.pending ? ` · ${Number(p.pending)} waiting` : ''}</span>${icon('chevron', 'chev')}</a></li>
        <li><button type="button" class="item danger-text" data-action="unlink-this-phone"><span class="icon-sq bad">${icon('link')}</span><span class="grow title">Unlink this phone</span></button></li>
      </ul>
      <p class="footnote">The home base phone keeps the family’s messages. This phone keeps a copy of yours and syncs when the two phones are together on the same Wi-Fi, or on the home base’s Personal Hotspot when you’re away from home.</p>`;
  }
  return `<span class="label">This device is the home base</span>
    <ul class="list inset-icon">
      <li><a class="item" href="#/sync"><span class="icon-sq solid">${icon('sync')}</span><span class="grow title">Sync a linked phone</span>${icon('chevron', 'chev')}</a></li>
      ${S.me.isParent ? `<li><button type="button" class="item" data-action="backup"><span class="icon-sq green">${icon('download')}</span><span class="grow title">Download backup</span>${icon('chevron', 'chev')}</button></li>
      <li><label class="item file-btn"><span class="icon-sq">${icon('upload')}</span><span class="grow title">Restore backup</span>${icon('chevron', 'chev')}<input type="file" accept="application/json,.json" data-action="restore" hidden></label></li>` : ''}
    </ul>
    <p class="footnote">Everything lives in this browser on this device.${platform() === 'ios' ? ' Keep it on your Home Screen so iOS doesn’t clear it.' : ''}
      Others can use it here, or link their own phone and sync when they’re nearby. Back up now and then: the file holds everyone’s messages, so keep it private.</p>
    ${S.me.isParent ? `<details class="card move-out">
      <summary>Messages without syncing by hand</summary>
      <p class="small">Phones can’t pass messages to each other on their own: iPhones don’t let web apps find each other or run in the background. To keep everything at home and still have messages arrive by themselves, let a computer that stays on at home be your family’s <strong>home hub</strong>, and bring your family there:</p>
      <ol class="tips small">
        <li>On the computer, start the hub (see the README, “Quick start (home hub)”).</li>
        <li>Sync every linked phone with this one a last time, then tap <strong>Download backup</strong> above.</li>
        <li>Open the hub’s address here, choose <strong>Moving from a home-base phone?</strong> and pick the file.</li>
        <li>Sign in and send everyone an invite from Family. PINs stay the same.</li>
      </ol>
    </details>` : ''}`;
}

export function renderFamily() {
  const me = S.me;
  // A linked phone that isn't connected can't change anything about the family: say so instead
  // of showing forms that would only fail.
  const apart = isPeer() && !S.peer?.connected;
  const profile = apart ? `
    <span class="label">My profile</span>
    <p class="footnote mt-0">Name, emoji and PIN changes are made while this phone is connected to the home base.
      <a href="#/sync">Sync now</a> and change them then.</p>` : `
    <span class="label">My profile</span>
    <form class="card stack" data-form="profile">
      <div><label for="p-name">Name</label><input id="p-name" name="name" type="text" maxlength="40" required value="${esc(me.name)}"></div>
      ${emojiField(me.emoji, 'p-emoji')}
      ${me.hasPin && !me.isParent ? '<div><label for="p-cur">Current PIN</label><input id="p-cur" name="currentPin" type="password" inputmode="numeric"></div>' : ''}
      <div><label for="p-pin">${me.hasPin ? 'New PIN (leave blank to keep, “none” to remove)' : 'Set a PIN (optional)'}</label>
        <input id="p-pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password"></div>
      <div><button class="primary" type="submit">Save my profile</button></div>
    </form>`;

  const actions = (m) => {
    if (!me.isParent || apart) return '';
    const parts = [];
    if (isHub() && m.active) parts.push(`<button type="button" class="link" data-action="invite" data-id="${Number(m.id)}">Invite</button>`);
    if (isDevice() && m.active) parts.push(`<button type="button" class="link" data-action="link-phone" data-id="${Number(m.id)}">Link phone</button>`);
    if (isDevice() && m.linkedPhones) parts.push(`<button type="button" class="link" data-action="unlink-phones" data-id="${Number(m.id)}">Unlink ${plural(m.linkedPhones, 'phone')}</button>`);
    parts.push(`<button type="button" class="link" data-action="edit-member" data-id="${Number(m.id)}">Edit</button>`);
    if (m.id !== me.id) parts.push(`<button type="button" class="link danger" data-action="remove-member" data-id="${Number(m.id)}">Remove</button>`);
    return parts.join('');
  };
  const meta = (m) => [
    memberTag(m),
    m.hasPin ? `${icon('lock')} PIN` : '',
    m.linkedPhones ? `${icon('phone')} ${m.linkedPhones > 1 ? `${Number(m.linkedPhones)} phones linked` : 'linked'}` : '',
    m.guest && m.guestUntil ? `until ${esc(new Date(m.guestUntil + 'T12:00').toLocaleDateString())}` : '',
    m.active ? '' : 'ended',
  ].filter(Boolean).join(' · ');
  const members = `
    <span class="label">Members</span>
    <ul class="list inset-avatar people">${S.members.map((m) => ui.editingId === m.id ? `<li class="editing">${memberForm(m, 'edit-member')}</li>` : `
      <li><div class="item${m.active ? '' : ' inactive'}"><span class="avatar">${esc(m.emoji)}</span>
        <span class="grow"><span class="title">${esc(m.name)}${m.id === me.id ? ' <span class="muted">(you)</span>' : ''}</span>
          <span class="sub">${meta(m)}</span></span>
        <span class="actions">${actions(m)}</span></div></li>`).join('')}
    </ul>`;

  const parentTools = me.isParent && !apart ? `
    <span class="label">Add someone</span>
    <div class="card">${memberForm(null, 'add-member')}</div>
    <span class="label">Family settings</span>
    <form class="card stack" data-form="settings">
      <div><label for="s-name">Family name</label><input id="s-name" name="familyName" type="text" maxlength="60" value="${esc(S.family.name)}"></div>
      <label class="check"><input type="checkbox" name="allowAnonymous" ${S.family.allowAnonymous ? 'checked' : ''}>
        <span>Allow anonymous feedback<br><span class="hint">Hurtful words are always blocked in anonymous messages and in messages to kids.</span></span></label>
      <div><button class="primary" type="submit">Save settings</button></div>
    </form>` : '';

  app.innerHTML = `<section><h1>Family</h1><p class="page-sub">${esc(S.family.name)} · ${plural(S.members.length, 'person', 'people')}</p>
    ${invitePanel()}${linkPinPanel()}<div class="cols"><div class="col">${members}${storageCard()}${notificationsSection()}</div><div class="col">${parentTools}${profile}</div></div></section>`;
  if (ui.push?.on === undefined) checkPush();
}

// Linking a phone to someone with a PIN: they type it on the home base first.
export function linkPinPanel() {
  const m = ui.linkPinFor && memberById(ui.linkPinFor);
  if (!m) return '';
  return `<form class="card stack narrow" data-form="link-pin" id="link-pin-panel">
      <label for="link-pin">${esc(m.name)}, type your PIN to link your phone</label>
      <input id="link-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" required>
      ${ui.linkPinError ? `<div class="notice error">${esc(ui.linkPinError)}</div>` : ''}
      <p class="small muted m-0">Linking puts ${esc(m.name)}’s messages on that phone, so only ${esc(m.name)} can start it.</p>
      <div class="row"><button class="primary" type="submit">Link phone</button><button type="button" class="link" data-action="cancel-link-pin">Cancel</button></div>
    </form>`;
}

export function pinValue(raw) {
  const v = (raw || '').trim();
  if (!v) return undefined;
  if (v.toLowerCase() === 'none') return '';
  return v;
}

export function memberBody(d) {
  return {
    name: d.get('name'), emoji: emojiFrom(d), role: d.get('role'), isParent: d.get('isParent') === 'on' && d.get('guest') !== 'on',
    guest: d.get('guest') === 'on', guestUntil: d.get('guest') === 'on' ? d.get('guestUntil') || '' : '', pin: pinValue(d.get('pin')),
  };
}

export async function openInvite(memberId) {
  ui.invite = { memberId: Number(memberId), ...(await api('POST', '/api/invites', { memberId: Number(memberId) })) };
  renderFamily();
  document.getElementById('invite-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
