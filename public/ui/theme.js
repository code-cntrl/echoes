// Appearance: family (Messages / Graphite / Paper) and mode (System / Light / Dark).
import { icon } from './dom.js';

// Family (Messages / Graphite / Paper) and mode (System / Light / Dark) are separate, saved per device.
// theme-init.js applies both before first paint; this keeps them in sync with the picker.
export const FAMILIES = [
  { id: 'messages', label: 'Messages', hint: 'Like iPhone' },
  { id: 'graphite', label: 'Graphite', hint: 'Calm and cool' },
  { id: 'paper', label: 'Paper', hint: 'Warm, for reading' },
];
export const MODES = [
  { id: 'auto', icon: 'contrast', label: 'System' },
  { id: 'light', icon: 'sun', label: 'Light' },
  { id: 'dark', icon: 'moon', label: 'Dark' },
];
export const themeToggle = document.getElementById('theme-toggle');
export const appearanceEl = document.getElementById('appearance');
export const savedFamily = () => (FAMILIES.some((f) => f.id === localStorage.getItem('ff-theme-family')) ? localStorage.getItem('ff-theme-family') : 'messages');
export const savedMode = () => (MODES.some((m) => m.id === localStorage.getItem('ff-theme')) ? localStorage.getItem('ff-theme') : 'auto');

export function applyTheme() {
  const family = savedFamily();
  const mode = MODES.find((m) => m.id === savedMode());
  window.ffTheme.apply(); // theme-init.js: <html> data attributes and the browser bar colour
  const name = `${FAMILIES.find((f) => f.id === family).label}, ${mode.label}`;
  themeToggle.innerHTML = icon(mode.icon);
  themeToggle.title = `Appearance: ${name}`;
  themeToggle.setAttribute('aria-label', `Appearance: ${name}`);
  const option = (action, item, on, text) => `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'selected' : ''}" data-action="${action}" data-id="${item.id}">${text}</button>`;
  appearanceEl.innerHTML = `
    <h2 class="appearance-title">Appearance</h2>
    <p class="appearance-label" id="appearance-family">Theme</p>
    <div class="segmented" role="radiogroup" aria-labelledby="appearance-family">${FAMILIES.map((f) => option('theme-family', f, f.id === family,
      `<span class="swatch swatch-${f.id}" aria-hidden="true"></span>${f.label}<span class="hint">${f.hint}</span>`)).join('')}</div>
    <p class="appearance-label" id="appearance-mode">Mode</p>
    <div class="segmented" role="radiogroup" aria-labelledby="appearance-mode">${MODES.map((m) => option('theme-mode', m, m.id === mode.id, `${icon(m.icon)}${m.label}`)).join('')}</div>
    <p class="hint">Saved on this device.</p>`;
}

export function showAppearance(open) {
  appearanceEl.hidden = !open;
  themeToggle.setAttribute('aria-expanded', String(open));
}
