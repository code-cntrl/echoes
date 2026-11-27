// Optional live check: one real push, end to end, through the push service Edge uses (Microsoft's
// on Windows). Headless Edge subscribes for real, the hub signs and encrypts a push, the push
// service delivers it back to Edge, and the service worker shows "You have something new."
// Needs the internet. It sends one content-free ping (the encrypted {"t":"new"}) and nothing else.
//   npm run test:push-live
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

const replies = [];
const hub = createApp({
  dataPath: ':memory:',
  push: {
    coalesceMs: 0,
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      replies.push(`${new URL(url).host} ${res.status}`);
      return res;
    },
  },
});
const base = await new Promise((r) => hub.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${hub.address().port}`)));
// Push needs a normal (not private) browser profile, so use a throwaway one.
const dir = mkdtempSync(join(tmpdir(), 'ff-push-live-'));
const ctx = await chromium.launchPersistentContext(dir, { channel: 'msedge', headless: true });
let result;
try {
  await ctx.grantPermissions(['notifications'], { origin: base });
  const page = await ctx.newPage();
  await page.goto(base);
  result = await page.evaluate(async () => {
    const api = async (method, path, body) => (await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
    await api('POST', '/api/setup', { familyName: 'Live check', name: 'Tester', emoji: '🧑' });
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api('GET', '/api/push/key');
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
    try {
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const subscribed = await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
      return { service: new URL(sub.endpoint).host, subscribed: subscribed.ok === true, test: await api('POST', '/api/push/test') };
    } catch (e) {
      return { error: String(e) };
    }
  });
  if (!result.error) {
    // Poll from here: waitForFunction would take an async predicate's Promise as "true" at once.
    const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.body));
    for (let i = 0; i < 300 && !(await shown()).length; i++) await new Promise((r) => setTimeout(r, 100));
    result.shown = await shown();
  }
} finally {
  await ctx.close();
  hub.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`Push service: ${result.service || '-'}; replies: ${replies.join(', ') || 'none'}`);
if (result.error) {
  console.error(`This browser couldn't subscribe: ${result.error}`);
  process.exit(1);
}
if (!result.subscribed || result.test?.sent !== 1 || result.shown?.[0] !== 'You have something new.') {
  console.error(`Live push failed: ${JSON.stringify(result)}`);
  process.exit(1);
}
console.log('Live push passed: accepted by the push service and shown by the service worker.');
