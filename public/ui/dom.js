// Icons, the page’s fixed elements, escaping, toasts and small text helpers.
// Line icons drawn for this app (24×24, stroked with the text colour). Emoji stay for people's
// faces, feelings, reactions and feedback styles; everything else uses these.
export const ICONS = {
  inbox: '<path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.6 5h12.8L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/>',
  give: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  sent: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  family: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.8-3.6 3.3-5.6 6.2-5.6s5.4 2 6.2 5.6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.6 14.5c2.3.3 4 2 4.7 5"/>',
  guide: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  warning: '<path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 10v4M12 17.5h.01"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.9-3.8 3.6-6 7-6s6.1 2.2 7 6"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path class="fill" d="M12 3.5a8.5 8.5 0 0 1 0 17z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  mask: '<path d="M3 9c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v2.5c0 3-2.2 4.5-4.5 4.5S12.5 14 12 12.5C11.5 14 9.8 16 7.5 16S3 14.5 3 11.5z"/>',
  sprout: '<path d="M12 21v-8.5"/><path d="M12 12.5c0-4.2 3-6.8 8-6.8 0 4.6-3 6.8-8 6.8z"/><path d="M12 15c0-3.4-2.5-5.6-6.8-5.6 0 3.8 2.6 5.6 6.8 5.6z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 2.2"/><path d="M9.5 2.75h5"/>',
  ask: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.9A8.5 8.5 0 1 1 21 12z"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2.2-2.4 3.4M12 16.6h.01"/>',
};
export function icon(name, cls = '') {
  return `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

export const app = document.getElementById('app');
export const nav = document.getElementById('nav');
export const meArea = document.getElementById('me');
export const banner = document.getElementById('banner');
export const toastEl = document.getElementById('toast');

// Pictures to pick from: default-tone emoji (no skin colour), people who aren't a particular gender
// first, then animals and things. Anyone can still type any emoji they like.
export const EMOJIS = ['🧑', '🧒', '🧓', '👶', '🙂', '😎', '🤓', '🥳', '😇', '🤠', '🦊', '🐼', '🦁', '🐯', '🐶', '🐱', '🐰', '🐻',
  '🐸', '🐙', '🐢', '🦉', '🦄', '🐝', '🌻', '🌈', '⭐', '🚀', '⚽', '🎸', '🎨', '📚'];
export const REACTIONS = [
  { id: 'thanks', emoji: '💛', label: 'Thank you' },
  { id: 'got-it', emoji: '👍', label: 'Got it' },
  { id: 'talk', emoji: '🗣️', label: 'Let’s talk' },
  { id: 'disagree', emoji: '🤔', label: 'I see it differently' },
];
export const AUDIENCES = [
  { id: 'one', emoji: '👤', label: 'One person' },
  { id: 'some', emoji: '👥', label: 'A few people' },
  { id: 'everyone', emoji: '📣', label: 'Everyone' },
];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const names = (list) => list.length <= 1 ? (list[0] || '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;

export let toastTimer;
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}
// On a shared device the next person must not see the previous person's "Sent to …" message.
export function clearToast() {
  clearTimeout(toastTimer);
  toastEl.classList.remove('show');
  toastEl.textContent = '';
}

export function formatDate(iso, anonymous) {
  const d = new Date(iso);
  if (anonymous) return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A calm full-screen message: a line icon in a circle, a title, a sentence and an action.
export function emptyState(iconName, title, text = '', action = '') {
  return `<section class="empty"><div class="big">${icon(iconName)}</div><h1>${title}</h1>${text ? `<p class="muted">${text}</p>` : ''}${action}</section>`;
}

export function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

// Like Messages: the time today, "Yesterday", the weekday this week, then the date.
// Anonymous messages only ever show the date.
export function shortDate(iso, anonymous) {
  const d = new Date(iso);
  if (anonymous) return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
