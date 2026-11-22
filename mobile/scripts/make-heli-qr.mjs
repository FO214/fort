/**
 * Make the printable helicopter sign for a map.
 *
 * The helicopter is the only QR code in the game: in the final wave at least
 * two players aim their phones at it and hold to extract. This writes a page
 * to print and tape to the wall where the helicopter is.
 *
 *   node scripts/make-heli-qr.mjs              # the code the arena map expects
 *   node scripts/make-heli-qr.mjs schmeichel   # the code another map expects
 *
 * Every map shipped so far expects the same text, LOONIE:HELI, so one sign
 * serves them all.
 *
 * Output: docs/helicopter-qr.svg. Open it in a browser and print at 100 %.
 * Uses `toqr`, the small QR encoder that Expo's command line already installs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const { toQR } = createRequire(import.meta.url)('toqr');

const mapId = process.argv[2] ?? 'arena';
const map = JSON.parse(readFileSync(join(repo, 'backend', 'maps', `${mapId}.json`), 'utf8'));
const payload = map.helicopter.qr ?? 'LOONIE:HELI';

const EC_HIGH = 2;                 // highest error correction: survives glare and creases
const cells = toQR(payload, EC_HIGH);
const n = Math.sqrt(cells.length);
if (!Number.isInteger(n)) throw new Error('unexpected QR matrix size');

const PAGE_W = 210, PAGE_H = 297;  // A4 in millimetres; prints fine on Letter with "fit to page"
const CODE = 150;                  // big enough to read from a few metres
const QUIET = 4;                   // white border, in modules, that the QR standard asks for
const cell = CODE / (n + QUIET * 2);
const x0 = (PAGE_W - CODE) / 2, y0 = 62;

let squares = '';
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (cells[r * n + c]) {
      squares += `<rect x="${(x0 + (QUIET + c) * cell).toFixed(3)}" y="${(y0 + (QUIET + r) * cell).toFixed(3)}" width="${(cell + 0.02).toFixed(3)}" height="${(cell + 0.02).toFixed(3)}"/>`;
    }
  }
}

const font = 'font-family="Helvetica, Arial, sans-serif"';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
<title>LOONIE helicopter sign</title>
<rect width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>
<text x="${PAGE_W / 2}" y="34" text-anchor="middle" ${font} font-size="22" font-weight="700" letter-spacing="3">HELICOPTER</text>
<text x="${PAGE_W / 2}" y="46" text-anchor="middle" ${font} font-size="7" fill="#444444">LOONIE extraction point</text>
<rect x="${x0}" y="${y0}" width="${CODE}" height="${CODE}" fill="#ffffff" stroke="#000000" stroke-width="0.6"/>
<g fill="#000000">${squares}</g>
<text x="${PAGE_W / 2}" y="${y0 + CODE + 16}" text-anchor="middle" ${font} font-size="8" font-weight="700">Final wave: two players aim here and hold to extract.</text>
<text x="${PAGE_W / 2}" y="${y0 + CODE + 25}" text-anchor="middle" ${font} font-size="6" fill="#444444">Tape it flat at chest height, in good light. Print at full size, do not crop.</text>
<text x="${PAGE_W / 2}" y="${PAGE_H - 12}" text-anchor="middle" font-family="Courier, monospace" font-size="5" fill="#666666">${payload}</text>
</svg>
`;

mkdirSync(join(repo, 'docs'), { recursive: true });
const out = join(repo, 'docs', 'helicopter-qr.svg');
writeFileSync(out, svg);
console.log(`wrote ${out}: "${payload}" as a ${n}x${n} code for map "${mapId}"`);
