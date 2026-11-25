/**
 * Print the AR markers for a map, and write the reference images the AR
 * module looks for.
 *
 *   node scripts/make-markers.mts [map-id ...]      (or: npm run markers)
 *
 * With no ids, every map in backend/maps/ that has `anchors`. For each anchor:
 *
 *   assets/markers/<map>-<id>.png    the reference image, 1024 px square. The
 *                                    native AR module bundles these, and needs
 *                                    the printed width (`size_m`) alongside.
 *   scripts/output/<map>-markers.pdf one marker per page at its true printed
 *                                    width, with a 10 cm bar to check the
 *                                    printer did not scale it.
 *
 * What the pattern needs to be: ARKit and ARCore find an image by its corners
 * and edges, so it is busy, high-contrast, and the same nowhere twice (no
 * flat areas, no repeats, no symmetry, which would make its facing
 * ambiguous). A QR code is a poor marker for this. Each pattern is seeded
 * from its map and id, so running this again draws the same marker.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Anchor { id: string; x: number; y: number; facing: number; size_m: number }
interface MapFile { id: string; name: string; anchors?: Anchor[] }

const here = dirname(fileURLToPath(import.meta.url));
const mapsDir = join(here, '..', '..', 'backend', 'maps');
const imageDir = join(here, '..', 'assets', 'markers');
const printDir = join(here, 'output');
const PX = 1024;

/** A small seeded random generator (mulberry32), seeded from a string. */
function random(seed: string): () => number {
  let a = 0;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The marker as SVG, PX square. */
function pattern(seed: string): string {
  const r = random(seed);
  const tones = ['#000000', '#ffffff', '#1f1f1f', '#5a5a5a', '#9a9a9a', '#d6d6d6'];
  const pick = () => tones[Math.floor(r() * tones.length)];
  const shapes: string[] = [];
  // Big shapes first, small ones on top: detail at every scale, so it is found near and far.
  for (let i = 0; i < 420; i++) {
    const size = PX * (0.28 * (1 - i / 420) ** 2 + 0.015);
    const x = r() * PX, y = r() * PX, turn = r() * 360;
    const kind = r();
    if (kind < 0.4) {
      shapes.push(`<rect x="${(x - size / 2).toFixed(1)}" y="${(y - size / 4).toFixed(1)}" width="${size.toFixed(1)}" height="${(size / 2).toFixed(1)}" fill="${pick()}" transform="rotate(${turn.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
    } else if (kind < 0.7) {
      const pts = [0, 1, 2].map((k) => {
        const a = ((turn + k * (100 + r() * 40)) * Math.PI) / 180;
        return `${(x + Math.cos(a) * size).toFixed(1)},${(y + Math.sin(a) * size).toFixed(1)}`;
      });
      shapes.push(`<polygon points="${pts.join(' ')}" fill="${pick()}"/>`);
    } else if (kind < 0.9) {
      shapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size / 2).toFixed(1)}" fill="${pick()}"/>`);
    } else {
      shapes.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(turn) * size * 1.5).toFixed(1)}" y2="${(y + Math.sin(turn) * size * 1.5).toFixed(1)}" stroke="${pick()}" stroke-width="${(size / 8 + 3).toFixed(1)}"/>`);
    }
  }
  // A heavy bar along the top edge: which way up it hangs is never in doubt to a person.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="0 0 ${PX} ${PX}">
<rect width="${PX}" height="${PX}" fill="#808080"/>${shapes.join('')}
<rect x="0" y="0" width="${PX}" height="${PX * 0.04}" fill="#000000"/>
</svg>`;
}

function printSheet(map: MapFile, images: { anchor: Anchor; png: string }[]): string {
  const pages = images.map(({ anchor, png }) => {
    const cm = (anchor.size_m * 100).toFixed(1);
    return `<section>
  <img src="data:image/png;base64,${png}" style="width:${cm}cm;height:${cm}cm">
  <p class="id">${map.name} · marker “${anchor.id}” · hang with the black bar at the top, flat on the wall, at about chest height</p>
  <p>Print at 100% (no “fit to page”). The square must measure <b>${cm} cm</b> across; this bar must measure 10 cm:</p>
  <div class="bar"></div>
  <p>Its place on the map: x ${anchor.x} m, y ${anchor.y} m, facing ${anchor.facing}°. If it ends up somewhere else, measure where and update the map.</p>
</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 8mm; }
body { margin: 0; font: 10pt -apple-system, Helvetica, Arial, sans-serif; color: #111; }
section { page-break-after: always; display: flex; flex-direction: column; align-items: center; gap: 3mm; }
.id { font-weight: 700; font-size: 11pt; margin-top: 4mm; }
.bar { width: 10cm; height: 3mm; background: #111; }
p { margin: 0; max-width: 18cm; text-align: center; }
</style></head><body>${pages.join('')}</body></html>`;
}

const wanted = process.argv.slice(2);
const maps: MapFile[] = readdirSync(mapsDir).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(mapsDir, f), 'utf8')) as MapFile)
  .filter((m) => (wanted.length ? wanted.includes(m.id) : (m.anchors?.length ?? 0) > 0));
for (const id of wanted) if (!maps.some((m) => m.id === id)) throw new Error(`no map ${id} in ${mapsDir}`);

mkdirSync(imageDir, { recursive: true });
mkdirSync(printDir, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
const preinstalled = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? preinstalled });
for (const map of maps) {
  const images: { anchor: Anchor; png: string }[] = [];
  for (const anchor of map.anchors ?? []) {
    const tab = await browser.newPage({ viewport: { width: PX, height: PX }, deviceScaleFactor: 1 });
    await tab.setContent(`<html><body style="margin:0">${pattern(`${map.id}:${anchor.id}`)}</body></html>`);
    const file = join(imageDir, `${map.id}-${anchor.id}.png`);
    const png = await tab.screenshot({ path: file, clip: { x: 0, y: 0, width: PX, height: PX } });
    images.push({ anchor, png: png.toString('base64') });
    await tab.close();
    console.log(`wrote ${file} (prints ${(anchor.size_m * 100).toFixed(1)} cm wide)`);
  }
  if (!images.length) continue;
  const sheet = await browser.newPage();
  await sheet.setContent(printSheet(map, images));
  const pdf = join(printDir, `${map.id}-markers.pdf`);
  await sheet.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await sheet.close();
  console.log(`wrote ${pdf}`);
}
await browser.close();
