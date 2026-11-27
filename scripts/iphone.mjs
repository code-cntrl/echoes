// Try the app like an iPhone on this PC: a window running Safari's engine (Playwright WebKit) with an
// iPhone's screen, touch and user agent. Its storage is kept between runs (data/iphone-sim), like a
// phone's, so you stay signed in. Close the window to stop.
//   npm run iphone                         the hub at http://localhost:3000 (start it with npm start)
//   npm run iphone http://192.168.1.20:3000 dark landscape device "iPhone 15 Pro Max"
//   npm run iphone fresh                   start with empty storage (signed out, no saved data)
//   npm run iphone headless screenshot shot.png   (for checks: no window)
// Options work as plain words or with dashes (--dark); PowerShell drops npm's "--", so words are safest.
// It is not a real iPhone: see "Trying it like an iPhone on this PC" in the README.
import { devices, webkit } from 'playwright-core';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const words = args.map((a) => a.replace(/^--?/, ''));
const flag = (name) => words.includes(name);
const value = (name) => { const i = words.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const url = args.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:3000';
const name = value('device') || args.find((a) => devices[a] && !/landscape$/.test(a)) || 'iPhone 15';
const device = devices[flag('landscape') ? `${name} landscape` : name];
if (!device) {
  console.error(`Unknown device "${name}". Try one of: ${Object.keys(devices).filter((k) => /^iPhone/.test(k) && !/landscape/.test(k)).join(', ')}`);
  process.exit(1);
}
const profile = resolve('data/iphone-sim');
if (flag('fresh')) rmSync(profile, { recursive: true, force: true });

const { defaultBrowserType, ...options } = device;
let ctx;
try {
  ctx = await webkit.launchPersistentContext(profile, { ...options, headless: flag('headless'), colorScheme: flag('dark') ? 'dark' : 'light' });
} catch (err) {
  console.error(`WebKit isn't installed. Run: node node_modules/playwright-core/cli.js install webkit\n${err.message.split('\n')[0]}`);
  process.exit(1);
}
const page = ctx.pages()[0] || await ctx.newPage();
page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
try {
  await page.goto(url);
} catch {
  console.error(`Can't reach ${url}. Is the hub running (npm start)?`);
  await ctx.close();
  process.exit(1);
}
if (value('screenshot')) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: value('screenshot') });
  console.log(`Saved ${value('screenshot')}`);
}
if (flag('headless')) {
  await ctx.close();
} else {
  console.log(`${name} (Safari’s engine, WebKit ${ctx.browser()?.version() || ''}) is showing ${url}. Close the window to stop.`);
  await new Promise((r) => { page.on('close', r); ctx.on('close', r); });
  await ctx.close().catch(() => {});
}
