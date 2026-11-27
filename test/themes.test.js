// Theme palettes in public/styles.css: every family/mode variant keeps body text at WCAG AA,
// and each dark variant's prefers-color-scheme copy matches its forced-dark block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector}`);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const graphiteLight = block(':root');
const paperLight = { ...graphiteLight, ...block(':root[data-theme-family="paper"]') };
const messagesLight = { ...graphiteLight, ...block(':root[data-theme-family="messages"]') };
const VARIANTS = {
  'messages light': messagesLight,
  'messages dark': { ...messagesLight, ...block(':root[data-theme-family="messages"][data-theme="dark"]') },
  'graphite light': graphiteLight,
  'graphite dark': { ...graphiteLight, ...block(':root[data-theme="dark"]') },
  'paper light': paperLight,
  'paper dark': { ...paperLight, ...block(':root[data-theme-family="paper"][data-theme="dark"]') },
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT_PAIRS = [
  ['--text', '--bg'], ['--text', '--surface'], ['--text', '--surface-2'], ['--text', '--accent-soft'],
  ['--muted', '--bg'], ['--muted', '--surface'], ['--muted', '--surface-2'], ['--muted', '--accent-soft'],
  ['--accent', '--surface'], ['--accent', '--accent-soft'], ['--accent-text', '--accent'],
  ['--good', '--good-soft'], ['--warn', '--warn-soft'], ['--bad', '--bad-soft'], ['--bad', '--surface'],
];

for (const [name, vars] of Object.entries(VARIANTS)) {
  test(`${name}: text meets WCAG AA and control edges meet 3:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(vars[fg], vars[bg]);
      assert.ok(ratio >= 4.5, `${fg} ${vars[fg]} on ${bg} ${vars[bg]} is ${ratio.toFixed(2)}:1`);
    }
    for (const bg of ['--surface', '--bg']) {
      const ratio = contrast(vars['--control-edge'], vars[bg]);
      assert.ok(ratio >= 3, `--control-edge on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    // The focus ring is solid --accent, drawn just outside the control on whatever sits behind it.
    for (const bg of ['--bg', '--surface', '--surface-2', '--accent-soft']) {
      const ratio = contrast(vars['--accent'], vars[bg]);
      assert.ok(ratio >= 3, `focus ring --accent on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('focus ring is a solid accent colour', () => {
  const rule = css.slice(css.indexOf('button:focus-visible'), css.indexOf('}', css.indexOf('button:focus-visible')));
  assert.match(rule, /outline:\s*3px solid var\(--accent\);/);
});

test('theme-init.js bar colours match each palette background', () => {
  const init = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  const bar = (family, mode) => init.match(new RegExp(`${family}: \\{ light: '(#\\w+)', dark: '(#\\w+)' \\}`))[mode === 'light' ? 1 : 2];
  for (const [name, vars] of Object.entries(VARIANTS)) {
    const [family, mode] = name.split(' ');
    assert.equal(bar(family, mode), vars['--bg'], `${name} bar colour`);
  }
});

test('system dark mode uses the same palettes as forced dark', () => {
  assert.deepEqual(block('  :root:not([data-theme="light"])'), block(':root[data-theme="dark"]'));
  assert.deepEqual(block('  :root[data-theme-family="paper"]:not([data-theme="light"])'),
    block(':root[data-theme-family="paper"][data-theme="dark"]'));
  assert.deepEqual(block('  :root[data-theme-family="messages"]:not([data-theme="light"])'),
    block(':root[data-theme-family="messages"][data-theme="dark"]'));
});
