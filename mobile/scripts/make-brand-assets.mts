/**
 * Write the FORTIRL brand assets from the geometry the app itself draws
 * (src/brand/geometry.ts), so the files and the components cannot drift.
 *
 *   node scripts/make-brand-assets.mts        (or: npm run brand)
 *
 * Vectors, in src/assets/brand/:
 *   fortirl-symbol.svg            the Formation, amber
 *   fortirl-symbol-bone.svg       one-colour variants
 *   fortirl-symbol-black.svg
 *   fortirl-symbol-micro.svg      the simplified mark for very small sizes
 *   fortirl-wordmark.svg          the lettering, bone
 *   fortirl-wordmark-black.svg
 *   fortirl-lockup.svg            symbol over wordmark
 *
 * App icons, in assets/, rendered from those with a headless browser:
 *   icon.png, splash-icon.png, favicon.png and the three Android adaptive layers.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FORMATION, FORMATION_MICRO, MARK_SIZE, WORDMARK } from '../src/brand/geometry.ts';
import { colors } from '../src/theme.ts';

const here = dirname(fileURLToPath(import.meta.url));
const brandDir = join(here, '..', 'src', 'assets', 'brand');
const assetsDir = join(here, '..', 'assets');
mkdirSync(brandDir, { recursive: true });

const AMBER = colors.brand.amber, BONE = colors.textPrimary, BLACK = colors.background;

const symbol = (segments: string[], fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}" role="img" aria-label="FORTIRL insignia">\n`
  + segments.map((p) => `  <polygon points="${p}" fill="${fill}"/>`).join('\n') + '\n</svg>\n';

const wordmark = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WORDMARK.width} ${WORDMARK.height}" role="img" aria-label="FORTIRL">\n`
  + `  <path d="${WORDMARK.d}" fill="${fill}" fill-rule="evenodd"/>\n</svg>\n`;

/** Symbol centred over the wordmark, the wordmark as wide as the lockup. */
function lockup(): string {
  const w = WORDMARK.width, mark = 200, gap = 34;
  const h = mark + gap + WORDMARK.height;
  const k = mark / MARK_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="FORTIRL">\n`
    + `  <g transform="translate(${(w - mark) / 2} 0) scale(${k})">\n`
    + FORMATION.map((p) => `    <polygon points="${p}" fill="${AMBER}"/>`).join('\n') + '\n  </g>\n'
    + `  <path transform="translate(0 ${mark + gap})" d="${WORDMARK.d}" fill="${BONE}" fill-rule="evenodd"/>\n</svg>\n`;
}

const vectors: Record<string, string> = {
  'fortirl-symbol.svg': symbol(FORMATION, AMBER),
  'fortirl-symbol-bone.svg': symbol(FORMATION, BONE),
  'fortirl-symbol-black.svg': symbol(FORMATION, BLACK),
  'fortirl-symbol-micro.svg': symbol(FORMATION_MICRO, AMBER),
  'fortirl-wordmark.svg': wordmark(BONE),
  'fortirl-wordmark-black.svg': wordmark(BLACK),
  'fortirl-lockup.svg': lockup(),
};
for (const [name, svg] of Object.entries(vectors)) writeFileSync(join(brandDir, name), svg);
console.log(`wrote ${Object.keys(vectors).length} vectors to src/assets/brand`);

// ---- raster icons ---------------------------------------------------------

/** A square page: optional background, the mark centred at `share` of the side. */
const page = (size: number, share: number, fill: string, background: string | null) => {
  const mark = Math.round(size * share), at = (size - mark) / 2;
  return `<html><body style="margin:0;background:${background ?? 'transparent'}">`
    + `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<g transform="translate(${at} ${at}) scale(${mark / MARK_SIZE})">${(size < 64 ? FORMATION_MICRO : FORMATION).map((p) => `<polygon points="${p}" fill="${fill}"/>`).join('')}</g>`
    + `</svg></body></html>`;
};

const icons: { file: string; size: number; share: number; fill: string; background: string | null }[] = [
  { file: 'icon.png', size: 1024, share: 0.6, fill: AMBER, background: BLACK },
  { file: 'splash-icon.png', size: 1024, share: 0.42, fill: AMBER, background: null },
  { file: 'favicon.png', size: 48, share: 0.84, fill: AMBER, background: BLACK },
  // Android adaptive icon: the launcher crops to the middle two thirds.
  { file: 'android-icon-foreground.png', size: 512, share: 0.44, fill: AMBER, background: null },
  { file: 'android-icon-background.png', size: 512, share: 0, fill: BLACK, background: BLACK },
  { file: 'android-icon-monochrome.png', size: 432, share: 0.44, fill: '#FFFFFF', background: null },
];

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
const preinstalled = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? preinstalled });
for (const icon of icons) {
  const tab = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
  await tab.setContent(page(icon.size, icon.share, icon.fill, icon.background));
  await tab.screenshot({ path: join(assetsDir, icon.file), omitBackground: icon.background == null });
  await tab.close();
}
await browser.close();
console.log(`wrote ${icons.length} icons to assets`);
