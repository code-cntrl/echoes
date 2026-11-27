// The home hub over https, so phones can turn on notifications (and install the app and work
// offline). Uses the family's own certificate from scripts/local-certs.mjs: install it on each
// iPhone once from the setup page. Same data as npm start (data/family.json, or DATA_PATH).
//
//   npm run start:https            (or: node scripts/start-https.mjs --host 192.168.1.20)
//
// Opens:  https://<this computer>:3443/   the app
//         http://<this computer>:3080/    how to trust the certificate on an iPhone
// Notifications go through Apple's or Google's push service, so this computer must be online.
// PUSH_CONTACT (a mailto: or https: address) is the contact the push services may use.
import { createApp } from '../src/server.js';
import { ensureCertificates, fingerprintOf, homeAddresses, keepCertificatesCurrent, setupServer } from './local-certs.mjs';

const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3080;
const ips = homeAddresses();
if (!ips.length) {
  console.error('No home-network (private) IPv4 address found. Connect to Wi-Fi, or pass --host <ip>.');
  process.exit(1);
}
const { key, cert, ca } = ensureCertificates(ips);
let familyCa = ca;
// Invite links use the address the phone reached the hub on (or PUBLIC_URL), so they follow a new one.
const hub = createApp({ tls: { key, cert } });
const hostOf = (req) => (req.headers.host || ips[0]).replace(/:\d+$/, '');
const help = setupServer({ appUrl: (req) => `https://${hostOf(req)}:${HTTPS_PORT}/`, ca: () => familyCa, notifications: true });

const showAddresses = (list) => {
  for (const ip of list) console.log(`  App:   https://${ip}:${HTTPS_PORT}/`);
  console.log(`  Setup: http://${list[0]}:${HTTP_PORT}/   (open this first on each iPhone to trust the certificate)`);
};

// Left running for months: follow a new address and keep the certificates fresh, without a restart.
keepCertificatesCurrent({
  server: hub,
  ips,
  onChange({ ips: now, changed, ca: nextCa }) {
    familyCa = nextCa;
    if (changed) {
      console.log('This computer has a new address on the home network. Phones should now use:');
      showAddresses(now);
    }
  },
});

hub.listen(HTTPS_PORT, '0.0.0.0', () => {
  help.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('Echoes hub (https):');
    showAddresses(ips);
    console.log(`Family certificate fingerprint (SHA-256), to compare on each iPhone before trusting it:\n  ${fingerprintOf(familyCa)}`);
    console.log('Phones must be on the same Wi-Fi as this computer. Press Ctrl+C to stop.');
  });
});
