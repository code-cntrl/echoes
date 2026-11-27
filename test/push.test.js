// Notifications through the home hub: Web Push encryption (checked against RFC 8291's example),
// the VAPID token Apple's push service checks, the push-service allowlist, and the hub sending
// (or holding back) content-free pushes for real events. A fake push service records what is sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { checkSubscription, createPusher, encrypt, makeVapidKeys, vapidToken } from '../src/push.js';
import { createApp } from '../src/server.js';
import { createDocStore, emptyDoc } from '../public/shared/store.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const strip = (s) => s.replace(/\s+/g, '');
const b64u = (b) => Buffer.from(b).toString('base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

test('encryption matches RFC 8291’s worked example byte for byte', () => {
  const out = encrypt(Buffer.from('When I grow up, I want to be a watermelon'),
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url') });
  const expected = Buffer.concat([
    Buffer.from(strip('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'), 'base64url'),
    Buffer.from(strip('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ'), 'base64url'),
  ]);
  assert.ok(out.equals(expected), b64u(out));
});

test('the VAPID token is what Apple asks for, and verifies with the hub’s public key', () => {
  const keys = makeVapidKeys();
  const now = Date.UTC(2026, 10, 25, 12);
  const token = vapidToken(keys, 'https://web.push.apple.com', 'mailto:family@example.com', now);
  const [h, c, s] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:family@example.com');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600, 'expires within a day');
  const raw = Buffer.from(keys.publicKey, 'base64url');
  assert.equal(raw.length, 65);
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

// A phone's push keys, and decryption as the phone would do it (RFC 8291 from the receiving side).
function phone() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) },
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const asPublic = body.subarray(21, 21 + idlen);
      const prkKey = hmac(auth, ecdh.computeSecret(asPublic));
      const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
      const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
      const record = body.subarray(21 + idlen);
      const d = createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(record.subarray(-16));
      const plain = Buffer.concat([d.update(record.subarray(0, -16)), d.final()]);
      assert.equal(plain.at(-1), 2, 'last-record padding delimiter');
      return plain.subarray(0, -1).toString();
    },
  };
}

test('only real push services are accepted', () => {
  const { keys } = phone();
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/abc', 'https://wns2-by3p.notify.windows.com/w/?token=x', 'https://updates.push.services.mozilla.com/wpush/v2/x']) {
    assert.ok(checkSubscription({ endpoint, keys }), endpoint);
  }
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://example.com/push', 'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com./x', 'https://fcm.googleapis.com.evil.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://192.168.1.10/x', 'not a url']) {
    assert.equal(checkSubscription({ endpoint, keys }), null, endpoint);
  }
  assert.equal(checkSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'AAAA', auth: keys.auth } }), null);
});

// ---------- the hub ----------
let server;
let base;
const pushes = [];
let reply = () => ({ status: 201 });
const fakePushService = async (url, init) => {
  pushes.push({ url, headers: init.headers, body: Buffer.from(init.body), redirect: init.redirect });
  const r = reply(url);
  return { status: r.status, ok: r.status < 300 };
};
before(async () => {
  server = createApp({ dataPath: ':memory:', push: { fetch: fakePushService, coalesceMs: 120 }, anonymousHoldMs: [250, 300] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client(at = () => base) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(at() + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status });
    return data;
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the hub sends a content-free push for new messages, replies and cheers, coalesced, and anonymous ones later', async () => {
  const mom = client();
  const momId = (await mom('POST', '/api/setup', { name: 'Mom' })).me.id;
  const dadId = (await mom('POST', '/api/members', { name: 'Dad', role: 'adult' })).id;
  const samId = (await mom('POST', '/api/members', { name: 'Sam', role: 'kid' })).id;
  const dad = client();
  await dad('POST', '/api/login', { memberId: dadId });
  const sam = client();
  await sam('POST', '/api/login', { memberId: samId });

  await assert.rejects(client()('GET', '/api/push/key'), { status: 401 });
  const { publicKey } = await mom('GET', '/api/push/key');
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  assert.equal((await mom('GET', '/api/state')).push, true);

  const momsPhone = phone();
  const momSub = { endpoint: 'https://web.push.apple.com/mom-iphone', keys: momsPhone.keys };
  await assert.rejects(mom('POST', '/api/push/subscribe', { subscription: { ...momSub, endpoint: 'https://example.com/steal' } }), { status: 400 });
  await mom('POST', '/api/push/subscribe', { subscription: momSub });
  assert.deepEqual(await mom('POST', '/api/push/status', { endpoint: momSub.endpoint }), { on: true });
  assert.deepEqual(await dad('POST', '/api/push/status', { endpoint: momSub.endpoint }), { on: false }, 'someone else’s device');

  await dad('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'Dinner was lovely, thank you!' } });
  await wait(40);
  assert.equal(pushes.length, 1);
  const [p] = pushes;
  assert.equal(p.url, momSub.endpoint);
  assert.equal(p.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(p.headers.TTL, '86400');
  assert.equal(p.headers.Topic, 'echoes', 'queued pings to an offline phone merge');
  assert.equal(p.redirect, 'error', 'never sent on anywhere else');
  assert.match(p.headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${publicKey}$`));
  const claims = JSON.parse(Buffer.from(p.headers.Authorization.slice(8).split('.')[1], 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(momsPhone.decrypt(p.body), '{"t":"new"}', 'no message text, no names');
  assert.ok(!p.body.includes(Buffer.from('Dinner')));

  // Two more within the window: one more push, after the window.
  await dad('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'And the dishes.' } });
  await dad('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'And the garden.' } });
  await wait(40);
  assert.equal(pushes.length, 1, 'held back');
  await wait(140);
  assert.equal(pushes.length, 2, 'one push for both');
  assert.equal(pushes[1].headers.Authorization, pushes[0].headers.Authorization, 'one token per push service, reused (as Apple asks)');

  // An anonymous message is held a random while (here 250 to 300 ms; really 1 to 3 hours). It shows
  // up, and pings, only then, so neither gives away who just put their phone down.
  await wait(150);
  const unread = (await mom('GET', '/api/state')).me.unread;
  const sent = await sam('POST', '/api/feedback', { toIds: [momId], model: 'kids', anonymous: true, fields: { feeling: ['happy'], happened: 'Pancakes!' } });
  assert.equal(sent.held, true);
  const anonShown = async () => (await mom('GET', '/api/inbox')).some((f) => f.anonymous);
  assert.equal(await anonShown(), false, 'held');
  assert.equal((await mom('GET', '/api/state')).me.unread, unread, 'not counted yet');
  // Something ordinary meanwhile pings at once, but neither shows the held one nor brings it forward.
  await dad('POST', '/api/feedback', { toIds: [momId], model: 'thanks', fields: { what: 'Coffee' } });
  await wait(40);
  assert.equal(pushes.length, 3, 'Dad’s ping');
  assert.equal(await anonShown(), false, 'still held after an ordinary ping');
  await wait(330);
  assert.equal(pushes.length, 4, 'its own ping, when it shows');
  assert.equal(await anonShown(), true);

  // Replies and reactions go to the sender; nobody without a subscription gets anything.
  const dadsPhone = phone();
  await dad('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/dad', keys: dadsPhone.keys } });
  const fromDad = (await mom('GET', '/api/inbox')).find((f) => f.from?.name === 'Dad');
  await mom('POST', `/api/feedback/${fromDad.id}/respond`, { reaction: 'thanks' });
  await wait(40);
  assert.equal(pushes.at(-1).url, 'https://fcm.googleapis.com/fcm/send/dad');
  assert.equal(dadsPhone.decrypt(pushes.at(-1).body), '{"t":"new"}');

  // Send a test; a push service that says "gone" makes the hub forget that device.
  assert.deepEqual(await dad('POST', '/api/push/test'), { devices: 1, sent: 1 });
  reply = (url) => ({ status: url.endsWith('/dad') ? 410 : 201 });
  assert.deepEqual(await dad('POST', '/api/push/test'), { devices: 1, sent: 0 });
  assert.deepEqual(await dad('POST', '/api/push/status', { endpoint: 'https://fcm.googleapis.com/fcm/send/dad' }), { on: false });
  reply = () => ({ status: 201 });

  // Turning off, and removing a member, stop pushes.
  await mom('POST', '/api/push/unsubscribe', { endpoint: momSub.endpoint });
  assert.deepEqual(await mom('POST', '/api/push/test'), { devices: 0, sent: 0 });
  await sam('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/sam', keys: phone().keys } });
  await mom('DELETE', `/api/members/${samId}`);
  const before = pushes.length;
  await dad('POST', '/api/feedback', { to: 'everyone', model: 'thanks', fields: { what: 'Family movie night!' } });
  await wait(200);
  assert.equal(pushes.length, before, 'Mom turned it off and Sam was removed');
});

test('a push waiting out the 30-second window when the hub restarts goes out after the restart', async () => {
  let saved = null;
  const persist = async (doc) => { saved = structuredClone(doc); };
  const first = createDocStore(emptyDoc(), persist);
  const id = await first.insertMember({ name: 'Mom', role: 'adult' });
  const sent = [];
  const pushService = async (url) => { sent.push(url); return { status: 201, ok: true }; };
  const sub = { endpoint: 'https://web.push.apple.com/restart', keys: phone().keys };
  const running = createPusher({ store: first, fetch: pushService, coalesceMs: 1500 });
  await running.subscribe(id, sub);
  running.notify([id]);
  await wait(30);
  assert.equal(sent.length, 1, 'straight away');
  running.notify([id]); // within the window: waits for it
  await wait(20);
  running.close(); // the hub stops (Ctrl+C, an update) before it goes
  assert.equal(Object.keys(saved.hub.pushDue).length, 1, 'the wait is saved');

  const restarted = createPusher({ store: createDocStore(saved, persist), fetch: pushService });
  await wait(100);
  assert.equal(sent.length, 1, 'still waiting after the restart');
  await wait(1500);
  assert.deepEqual(sent, [sub.endpoint, sub.endpoint]);
  assert.deepEqual(saved.hub.pushDue, {}, 'sent, so nothing is left to send again');
  restarted.close();

  // Removing the person drops anything still waiting for them.
  const third = createDocStore(saved, persist);
  third.raw().hub.pushDue[id] = Date.now() + 60e3;
  await third.deleteMember(id);
  assert.deepEqual(saved.hub.pushDue, {});
});

test('a push the push service can’t take now is tried again (honouring Retry-After), across a restart', async () => {
  let saved = null;
  const persist = async (doc) => { saved = structuredClone(doc); };
  const store = createDocStore(emptyDoc(), persist);
  const id = await store.insertMember({ name: 'Mom', role: 'adult' });
  const replies = [
    { status: 429, headers: { get: (h) => (h === 'retry-after' ? '0.25' : null) } },
    'offline',
    { status: 503 },
    { status: 201, ok: true },
  ];
  const calls = [];
  const pushService = async (url) => {
    calls.push(Date.now());
    const r = replies.shift();
    if (r === 'offline') throw new TypeError('fetch failed');
    return { ok: r.status < 300, ...r };
  };
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/retry', keys: phone().keys };
  const running = createPusher({ store, fetch: pushService, retryBaseMs: 60 });
  await running.subscribe(id, sub);
  running.notify([id]);
  await wait(150);
  assert.equal(calls.length, 1, 'waits as long as Retry-After says (250 ms), not the usual 60 ms');
  const key = Object.keys(saved.hub.push)[0];
  assert.equal(saved.hub.push[key].retry.tries, 1, 'saved with the device');
  running.close(); // a restart in between

  const restarted = createPusher({ store: createDocStore(saved, persist), fetch: pushService, retryBaseMs: 60 });
  await wait(160);
  assert.equal(calls.length, 2, 'carried on after the restart (no internet this time)');
  await wait(160);
  assert.equal(calls.length, 3, 'then the push service was busy');
  await wait(300);
  assert.equal(calls.length, 4, 'and then it went');
  assert.equal(saved.hub.push[key].retry, undefined, 'nothing left to retry');
  restarted.close();
});

test('a held anonymous message shows, and pings, on time after a hub restart, and then keeps no time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-hold-'));
  const dataPath = join(dir, 'family.json');
  const sent = [];
  const pushService = async (url) => { sent.push(url); return { status: 201, ok: true }; };
  let app;
  let at = '';
  const start = async (o) => {
    app = createApp({ dataPath, push: { fetch: pushService, coalesceMs: 50 }, ...o });
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    at = `http://127.0.0.1:${app.address().port}`;
  };
  const stop = () => new Promise((r) => { app.closeAllConnections(); app.close(r); });
  try {
    await start({ anonymousHoldMs: [400, 400] });
    const mom = client(() => at);
    const momId = (await mom('POST', '/api/setup', { name: 'Mom' })).me.id;
    const samId = (await mom('POST', '/api/members', { name: 'Sam', role: 'kid' })).id;
    const sam = client(() => at);
    await sam('POST', '/api/login', { memberId: samId });
    await mom('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://web.push.apple.com/mom', keys: phone().keys } });
    await sam('POST', '/api/feedback', { toIds: [momId], model: 'kids', anonymous: true, fields: { feeling: ['happy'], happened: 'Thanks for the pancakes' } });
    await wait(200);
    await sam('POST', '/api/feedback', { toIds: [momId], model: 'kids', anonymous: true, fields: { feeling: ['happy'], happened: 'And the tent' } });
    await stop();
    assert.ok(JSON.parse(readFileSync(dataPath, 'utf8')).feedback[0].visibleAfter, 'held, with its time');
    assert.deepEqual(JSON.parse(readFileSync(dataPath, 'utf8')).hub.pushDue, {}, 'no separate push schedule for it');

    await start(); // the hub comes back (default hold for anything new)
    assert.equal(sent.length, 0);
    assert.equal((await mom('GET', '/api/inbox')).length, 0, 'still held after the restart');
    await wait(300);
    assert.equal(sent.length, 1, 'the first pinged when it showed');
    assert.equal((await mom('GET', '/api/inbox')).length, 1);
    await wait(250);
    assert.equal(sent.length, 2, 'then the second, at its own time');
    assert.equal((await mom('GET', '/api/inbox')).length, 2);
    assert.ok(JSON.parse(readFileSync(dataPath, 'utf8')).feedback.every((f) => f.visibleAfter === undefined), 'their times are dropped once they show');
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a new PIN signs that person out on their other devices and drops those devices’ notifications', async () => {
  const app = createApp({ dataPath: ':memory:', push: { fetch: fakePushService } });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const at = () => `http://127.0.0.1:${app.address().port}`;
  try {
    const mom = client(at);
    await mom('POST', '/api/setup', { name: 'Mom' });
    const avaId = (await mom('POST', '/api/members', { name: 'Ava', role: 'adult' })).id;
    const laptop = client(at);
    const ownPhone = client(at);
    await laptop('POST', '/api/login', { memberId: avaId });
    await ownPhone('POST', '/api/login', { memberId: avaId });
    const laptopSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/ava-laptop', keys: phone().keys };
    const phoneSub = { endpoint: 'https://web.push.apple.com/ava-phone', keys: phone().keys };
    await laptop('POST', '/api/push/subscribe', { subscription: laptopSub });
    await ownPhone('POST', '/api/push/subscribe', { subscription: phoneSub });

    // Ava changes her PIN on her phone: the laptop is signed out and stops getting her pings.
    await ownPhone('PATCH', `/api/members/${avaId}`, { pin: '2468', pushEndpoint: phoneSub.endpoint });
    await assert.rejects(laptop('GET', '/api/push/key'), { status: 401 });
    assert.deepEqual(await ownPhone('POST', '/api/push/status', { endpoint: phoneSub.endpoint }), { on: true }, 'the phone she used keeps them');
    assert.deepEqual(await ownPhone('POST', '/api/push/status', { endpoint: laptopSub.endpoint }), { on: false });

    // A parent resetting it signs her out everywhere.
    await mom('PATCH', `/api/members/${avaId}`, { pin: '' });
    await assert.rejects(ownPhone('GET', '/api/push/key'), { status: 401 });
    assert.ok((await mom('GET', '/api/push/key')).publicKey, 'the parent stays signed in');
    // A name change alone signs nobody out.
    const again = client(at);
    await again('POST', '/api/login', { memberId: avaId });
    await mom('PATCH', `/api/members/${avaId}`, { name: 'Ava B' });
    assert.ok((await again('GET', '/api/push/key')).publicKey);
  } finally {
    app.closeAllConnections();
    app.close();
  }
});
