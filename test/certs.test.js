// The family's https certificates (scripts/local-certs.mjs) stay current: the hub's certificate is
// made again before it expires, and a new certificate authority only once the old one has expired.
// Needs openssl (Git for Windows includes it); skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCertificates, findOpenssl, fingerprintOf, keepCertificatesCurrent, setupServer } from '../scripts/local-certs.mjs';

const DAY = 864e5;
let hasOpenssl = true;
try { findOpenssl(); } catch { hasOpenssl = false; }

test('certificates are renewed before the hub’s expires, and the authority only once it has expired', { skip: !hasOpenssl && 'openssl not found' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-certs-'));
  try {
    const logs = [];
    const ips = ['192.168.1.20'];
    const at = (days) => ensureCertificates(ips, { dir, now: Date.now() + days * DAY, log: (m) => logs.push(m) });
    const cert = (name) => new X509Certificate(readFileSync(join(dir, name)));

    at(0);
    const ca1 = cert('ca.crt');
    const server1 = cert('server.crt');
    assert.ok(Date.parse(ca1.validTo) - Date.now() > 9 * 365 * DAY, 'a new authority lasts ten years');
    assert.ok(server1.verify(ca1.publicKey));
    assert.match(server1.subjectAltName, /IP Address:192\.168\.1\.20/);
    assert.match(fingerprintOf(readFileSync(join(dir, 'ca.crt'))), /^([0-9A-F]{2} ){31}[0-9A-F]{2}$/, 'the fingerprint as iPhone Settings shows it');

    at(100);
    assert.equal(cert('server.crt').fingerprint256, server1.fingerprint256, 'nothing changes while it is good');

    at(340); // 25 days left on the hub's certificate
    const server2 = cert('server.crt');
    assert.notEqual(server2.fingerprint256, server1.fingerprint256, 'the hub’s certificate is made again');
    assert.equal(cert('ca.crt').fingerprint256, ca1.fingerprint256, 'phones keep trusting the same authority');
    assert.ok(server2.verify(ca1.publicKey));
    assert.ok(logs.some((m) => /fresh certificate/.test(m)));

    ensureCertificates(['192.168.1.30'], { dir, now: Date.now(), log: () => {} });
    assert.match(cert('server.crt').subjectAltName, /IP Address:192\.168\.1\.30/, 'a new address gets a new certificate');

    const caDays = (Date.parse(ca1.validTo) - Date.now()) / DAY;
    logs.length = 0;
    at(caDays - 40);
    assert.equal(cert('ca.crt').fingerprint256, ca1.fingerprint256, 'not replaced early: phones would stop trusting the hub');
    assert.ok(logs.some((m) => /expires on/.test(m)), 'warns ahead');

    logs.length = 0;
    at(caDays + 1);
    const ca2 = cert('ca.crt');
    assert.notEqual(ca2.fingerprint256, ca1.fingerprint256, 'expired: a new authority');
    assert.ok(cert('server.crt').verify(ca2.publicKey), 'and a hub certificate from it');
    assert.ok(logs.some((m) => /trust it again/.test(m)), 'says each phone must trust it again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a running hub follows a new address: new certificate, switched without a restart', () => {
  let ips = ['192.168.1.20'];
  let t = 0;
  const made = [];
  const contexts = [];
  const changes = [];
  const watch = keepCertificatesCurrent({
    server: { setSecureContext: (c) => contexts.push(c) },
    ips,
    getIps: () => ips,
    ensure: (list) => { made.push(list); return { key: `key-${list[0]}`, cert: `cert-${list[0]}`, ca: 'ca' }; },
    now: () => t,
    onChange: (c) => changes.push(c),
    log: () => {},
  });
  try {
    assert.equal(watch.check(), false, 'nothing to do');
    ips = []; // Wi-Fi off for a moment: keep what we have
    assert.equal(watch.check(), false);
    ips = ['192.168.1.37']; // the router handed out a new address
    assert.equal(watch.check(), true);
    assert.deepEqual(made, [['192.168.1.37']]);
    assert.deepEqual(contexts, [{ key: 'key-192.168.1.37', cert: 'cert-192.168.1.37' }]);
    assert.equal(changes[0].changed, true);
    assert.deepEqual(watch.ips(), ['192.168.1.37']);
    t += 864e5; // a day later, same address: checked anyway (renewal)
    assert.equal(watch.check(), true);
    assert.equal(changes[1].changed, false);
  } finally {
    watch.stop();
  }
});

test('the setup page asks to compare the fingerprint, and links to the address the phone used', async () => {
  const help = setupServer({ appUrl: (req) => `https://${req.headers.host.replace(/:\d+$/, '')}:3443/`, ca: () => Buffer.from('CA'), notifications: true });
  await new Promise((r) => help.listen(0, '127.0.0.1', r));
  try {
    const port = help.address().port;
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(page, /SHA-256/);
    assert.match(page, /hub computer’s screen/);
    assert.match(page, /own home Wi-Fi/);
    assert.match(page, /href="https:\/\/127\.0\.0\.1:3443\/"/, 'the app link follows the address used');
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/ca.crt`)).text(), 'CA');
  } finally {
    help.close();
  }
});
