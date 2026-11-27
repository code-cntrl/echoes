// Renders public/icons/icon.svg to the PNG sizes iPhone and Chromebook need.
//   node scripts/icons.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = readFileSync(dir + 'icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const [name, size, rounded] of [['icon-192.png', 192, true], ['icon-512.png', 512, false], ['apple-touch-icon.png', 180, false]]) {
  // iOS and maskable icons get a full square; the OS applies its own corner mask.
  const art = rounded ? svg : svg.replace('rx="112"', 'rx="0"');
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${art}`);
  await page.screenshot({ path: dir + name, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('Icons written to', dir);
