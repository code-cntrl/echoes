// The family's own https certificate, for phones on the home Wi-Fi. Phones only allow
// notifications, the camera, Home Screen install and offline use on secure pages, so this makes a
// private certificate authority (CA) for this computer and a certificate for its network address.
// The CA and its key stay in data/https/ (not committed). The CA can only vouch for private
// network addresses and localhost, so even if its key leaked it couldn't impersonate real websites.
// Used by npm run start:https (the hub) and npm run serve:https (a this-device test copy).
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = join(ROOT, 'data', 'https');
const VIRTUAL_NIC = /(vethernet|hyper-v|wsl|vmware|virtualbox|vboxnet|docker|^br-|^veth|^virbr|^utun|^tun|^tap|loopback)/i;
const privateIp = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

export const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};

/** This computer's home-network addresses (or the one passed with --host). */
export function homeAddresses(host = argValue('--host')) {
  if (host) return [host];
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL_NIC.test(name))
    .flatMap(([, a]) => a || [])
    .filter((a) => a.family === 'IPv4' && !a.internal && privateIp(a.address))
    .map((a) => a.address);
}

export function findOpenssl() {
  const candidates = [process.env.OPENSSL, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  for (const c of candidates.filter(Boolean)) {
    try {
      execFileSync(c, ['version'], { stdio: 'pipe' });
      return c;
    } catch { /* try the next one */ }
  }
  throw new Error('openssl was not found. Install Git for Windows (it includes openssl) or set OPENSSL to its path.');
}

const DAY = 864e5;
const readCert = (file) => new X509Certificate(readFileSync(file));
const dateOf = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * Makes the CA and a server certificate for these addresses, and keeps them current: the server
 * certificate is made again when the addresses change, when it has 30 days or less left, or when
 * the CA changed. The CA is only replaced once it has expired, because every phone has to trust a
 * new one by hand; it warns 60 days ahead. `dir`, `now` and `log` are for tests.
 */
export function ensureCertificates(ips, { dir = DIR, now = Date.now(), log = console.log } = {}) {
  mkdirSync(dir, { recursive: true });
  const openssl = findOpenssl();
  const f = (name) => join(dir, name);
  // Pass our own config everywhere: some openssl builds on Windows have no default openssl.cnf.
  const ssl = (...args) => execFileSync(openssl, args, { cwd: dir, stdio: 'pipe', env: { ...process.env, OPENSSL_CONF: f('ca.cnf') } });
  const haveCa = existsSync(f('ca.crt')) && existsSync(f('ca.key'));
  const caLeft = haveCa ? Date.parse(readCert(f('ca.crt')).validTo) - now : -1;
  const newCa = caLeft <= 0;
  if (newCa) {
    writeFileSync(f('ca.cnf'), [
      '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
      '[dn]', 'CN=Echoes test CA (this computer only)',
      '[ext]', 'basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign', 'subjectKeyIdentifier=hash',
      'nameConstraints=critical,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.0/255.0.0.0,permitted;DNS:localhost',
    ].join('\n'));
    // Ten years, so phones rarely need to trust a new one (the 825-day limit is for server certificates).
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '3650', '-config', 'ca.cnf');
    log(haveCa
      ? 'The family certificate had expired, so there is a new one in data/https/ca.crt. Open the setup page on each phone and trust it again (and remove the old one).'
      : 'Made a new certificate authority in data/https/ca.crt');
  } else if (caLeft < 60 * DAY) {
    log(`The family certificate expires on ${dateOf(now + caLeft)}. After that, the next start makes a new one, and each phone must trust it again from the setup page.`);
  }
  const want = JSON.stringify(ips);
  const serverOk = () => {
    if (newCa || !existsSync(f('server.crt')) || !existsSync(f('server.key')) || !existsSync(f('ips.json'))) return false;
    if (readFileSync(f('ips.json'), 'utf8') !== want) return false;
    const cert = readCert(f('server.crt'));
    return Date.parse(cert.validTo) - now > 30 * DAY && cert.verify(readCert(f('ca.crt')).publicKey);
  };
  if (!serverOk()) {
    const renewing = existsSync(f('server.crt'));
    writeFileSync(f('server.cnf'), [
      'basicConstraints=CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth',
      `subjectAltName=${[...ips.map((ip) => `IP:${ip}`), 'IP:127.0.0.1', 'DNS:localhost'].join(',')}`,
    ].join('\n'));
    writeFileSync(f('server-req.cnf'), ['[req]', 'distinguished_name=dn', 'prompt=no', '[dn]', 'CN=Echoes server'].join('\n'));
    ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-config', 'server-req.cnf');
    // iPhones refuse server certificates valid for more than 825 days; one year is plenty.
    ssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '365', '-sha256', '-extfile', 'server.cnf');
    writeFileSync(f('ips.json'), want);
    if (renewing) log('Made a fresh certificate for the hub (phones that trust the family certificate accept it as is).');
  }
  return { key: readFileSync(f('server.key')), cert: readFileSync(f('server.crt')), ca: readFileSync(f('ca.crt')) };
}

/** A certificate's SHA-256 fingerprint the way iPhone Settings shows it: pairs of hex digits. */
export const fingerprintOf = (pem) => new X509Certificate(pem).fingerprint256.replace(/:/g, ' ');

/**
 * Keeps a running https server's certificate current. Every few minutes it looks at this
 * computer's home-network addresses; when they change (a new router, DHCP), or once a day, it
 * makes sure the certificates are good and switches the server to them without a restart.
 * `getIps`, `ensure` and `now` are for tests; call `check()` to look straight away.
 */
export function keepCertificatesCurrent({
  server, ips, onChange = () => {}, getIps = () => homeAddresses(), ensure = ensureCertificates,
  every = 5 * 60e3, now = Date.now, log = console.warn,
}) {
  let current = ips;
  let checkedAt = now();
  const check = () => {
    try {
      const found = getIps();
      const changed = found.length > 0 && JSON.stringify(found) !== JSON.stringify(current);
      if (!changed && now() - checkedAt < 864e5) return false;
      const certs = ensure(changed ? found : current);
      server.setSecureContext({ key: certs.key, cert: certs.cert });
      checkedAt = now();
      if (changed) current = found;
      onChange({ ips: current, changed, ...certs });
      return true;
    } catch (e) {
      log(`Couldn’t check the certificates: ${e.message}`);
      return false;
    }
  };
  const timer = setInterval(check, every);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer), ips: () => current };
}

/**
 * A plain-http page that walks an iPhone through trusting the certificate, and serves the CA file.
 * `ca` is the file, or a function returning the current one; `appUrl` a string, or a function of
 * the request (so it follows whichever address the phone used).
 * Plain http can be tampered with on a hostile network, so it asks people to check the
 * certificate's fingerprint against the hub computer's screen before trusting it.
 */
export function setupServer({ appUrl, ca, notifications = false }) {
  // The certificate's own name, as iPhone Settings shows it: one made before the app was renamed
  // Echoes is still called "Family Feedback test CA".
  const caName = () => {
    try {
      return new X509Certificate(typeof ca === 'function' ? ca() : ca).subject.match(/CN=([^(\n]+)/)[1].trim();
    } catch {
      return 'Echoes test CA';
    }
  };
  return createHttp((req, res) => {
    if (req.url === '/ca.crt') {
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="echoes-ca.crt"' });
      return res.end(typeof ca === 'function' ? ca() : ca);
    }
    const url = typeof appUrl === 'function' ? appUrl(req) : appUrl;
    const link = url.replace(/[<>"&]/g, '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Echoes setup</title>
<style>body{font:17px/1.5 -apple-system,system-ui,sans-serif;max-width:34rem;margin:1.5rem auto;padding:0 1rem}a.btn{display:inline-block;padding:.7rem 1rem;border-radius:10px;background:#2f5bd3;color:#fff;text-decoration:none;font-weight:600}li{margin:.5rem 0}.note{background:#fff4d6;border-radius:10px;padding:.6rem .8rem}</style>
<h1>Set up Echoes on this iPhone</h1>
<p class="note">Do this only on your own home Wi-Fi, and check the fingerprint in step 2: it proves the certificate came from your hub computer.</p>
<p>Do this once on each iPhone, in <strong>Safari</strong>:</p>
<ol>
<li><a class="btn" href="/ca.crt">Download the family certificate</a>, then tap <strong>Allow</strong>.</li>
<li>Open <strong>Settings</strong> and tap <strong>Profile Downloaded</strong> near the top. Before installing, tap <strong>More Details</strong>, then the certificate, and compare its <strong>SHA-256</strong> fingerprint with the one on the hub computer’s screen. If they differ, stop and delete the profile. If they match, go back and tap <strong>Install</strong> (three times).</li>
<li>Go to <strong>Settings → General → About → Certificate Trust Settings</strong> and turn on <strong>${caName().replace(/[<>"&]/g, '')}</strong>.</li>
<li>Open <a href="${link}">${link}</a> in Safari. Tap Share ⬆️ → <strong>Add to Home Screen</strong>, then open it from the Home Screen.</li>
${notifications ? '<li>In the app, open <strong>Family → Notifications</strong> and tap <strong>Turn on notifications</strong>.</li>' : ''}
</ol>
<p>To remove it later: <strong>Settings → General → VPN &amp; Device Management</strong>.</p>`);
  });
}
