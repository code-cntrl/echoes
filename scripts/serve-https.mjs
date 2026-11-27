// An https copy of the app on this computer, for testing on real iPhones on the same Wi-Fi.
// Phones only allow the camera, Home Screen install and offline use on secure pages, so this
// makes a private certificate authority (CA) for this computer and a certificate for its
// network address, then serves public/ as static files, like GitHub Pages would.
//
//   npm run serve:https            (or: node scripts/serve-https.mjs --host 192.168.1.20)
//
// Opens:  https://<this computer>:8443/   the app
//         http://<this computer>:8080/    how to install the CA on an iPhone, and the CA file
// The certificate comes from scripts/local-certs.mjs (shared with npm run start:https).
import { createServer as createHttps } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCertificates, fingerprintOf, homeAddresses, setupServer } from './local-certs.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 8080;
const ips = homeAddresses();
if (!ips.length) {
  console.error('No home-network (private) IPv4 address found. Connect to Wi-Fi, or pass --host <ip>.');
  process.exit(1);
}
const { key, cert, ca } = ensureCertificates(ips);

// ---------- static app over https ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; media-src 'self' blob: mediastream:; frame-ancestors 'none'",
};

const app = createHttps({ key, cert }, (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  const file = normalize(join(PUBLIC, path === '/' ? 'index.html' : path));
  // No /api here: the app runs in this-device mode, as it would on GitHub Pages.
  if (!file.startsWith(PUBLIC + sep) || !existsSync(file)) {
    res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/html' });
    return res.end('<h1>Not found</h1>');
  }
  res.writeHead(200, { ...HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

// ---------- plain http: how to trust the certificate ----------
const help = setupServer({ appUrl: `https://${ips[0]}:${HTTPS_PORT}/`, ca });

app.listen(HTTPS_PORT, '0.0.0.0', () => {
  help.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('Echoes test copy (https, this-device mode):');
    for (const ip of ips) console.log(`  App:   https://${ip}:${HTTPS_PORT}/`);
    console.log(`  Setup: http://${ips[0]}:${HTTP_PORT}/   (open this first on each iPhone to trust the certificate)`);
    console.log(`Family certificate fingerprint (SHA-256), to compare on each iPhone before trusting it:\n  ${fingerprintOf(ca)}`);
    console.log('Phones must be on the same Wi-Fi as this computer. Press Ctrl+C to stop.');
  });
});
