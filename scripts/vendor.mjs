// Copies the two browser libraries the app needs into public/vendor, so the app also works as
// plain static files (GitHub Pages, any web server) with no build step. Run after npm install.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'vendor');
mkdirSync(OUT, { recursive: true });

const files = [
  ['qrcode-generator/dist/qrcode.mjs', 'qrcode.mjs'], // MIT; the notice is at the top of the file
  ['jsqr/dist/jsQR.js', 'jsQR.js'],
  ['jsqr/LICENSE', 'jsqr.LICENSE.txt'],
];
for (const [from, to] of files) {
  const src = join(ROOT, 'node_modules', from);
  if (!existsSync(src)) throw new Error(`Missing ${from}. Run npm install first.`);
  copyFileSync(src, join(OUT, to));
}
writeFileSync(join(OUT, 'README.md'), `# Vendored browser libraries

Copied from node_modules by \`npm run vendor\`. Do not edit by hand.

- \`qrcode.mjs\`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), draws the sync QR codes.
- \`jsQR.js\`: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0), reads QR codes from the camera.
`);
console.log(`Copied ${files.length} files to public/vendor`);
