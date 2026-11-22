/**
 * The FORTIRL brand marks as plain geometry. No React here, so the same
 * numbers draw the in-app components (FormationMark, Wordmark) and the
 * exported assets (`npm run brand` → src/assets/brand, app icons).
 *
 * THE FORMATION
 * Four identical segments on a diamond, each one a quarter turn from the
 * last, closing on a shared negative space. Four operators, four directions,
 * one squad, one objective. Each segment carries a blade that runs out along
 * its own channel, so the mark turns clockwise instead of sitting still.
 *
 * Construction, on a 120-unit square centred on (60, 60):
 *   diamond       |x − 60| + |y − 60| ≤ 52
 *   channels      8 units wide, on both axes
 *   central void  the diamond |x − 60| + |y − 60| ≤ 19
 *   blade         10 units wide, 10 units past the diamond's point, cut at 45°
 */

export type Pt = readonly [number, number];

export const MARK_SIZE = 120;

/** The north-east segment. The other three are this one turned about the centre. */
const SEGMENT: Pt[] = [[64, 2], [74, 12], [74, 22], [108, 56], [75, 56], [64, 45]];

/** For very small sizes: no blades, wider channels, so it does not fill in. */
const SEGMENT_MICRO: Pt[] = [[66, 12], [108, 54], [78, 54], [66, 42]];

const turn = (pts: Pt[], quarterTurns: number): Pt[] => {
  let out = pts;
  for (let i = 0; i < quarterTurns; i++) out = out.map(([x, y]) => [MARK_SIZE - y, x] as const);
  return out;
};

const toPoints = (pts: Pt[]) => pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
const round = (v: number) => Math.round(v * 100) / 100;

/** Four `points` strings, one per segment, clockwise from north-east. */
export const FORMATION: string[] = [0, 1, 2, 3].map((q) => toPoints(turn(SEGMENT, q)));
export const FORMATION_MICRO: string[] = [0, 1, 2, 3].map((q) => toPoints(turn(SEGMENT_MICRO, q)));

/**
 * THE WORDMARK
 * Custom lettering, not a typeface: heavy, condensed, drawn on a 100-unit
 * cap height with a 24-unit stem. Every terminal is cut on the same angle,
 * the O is an octagon, the R stands on a straight cut leg, and the whole
 * word leans forward 10°. No stencil gaps.
 */
const CAP = 100;
const LEAN = Math.tan((10 * Math.PI) / 180);

interface Glyph { w: number; outer: Pt[]; holes?: Pt[][] }

const GLYPHS: Record<string, Glyph> = {
  F: { w: 68, outer: [[0, 0], [68, 0], [61, 22], [24, 22], [24, 40], [56, 40], [49, 60], [24, 60], [24, 100], [0, 100]] },
  O: {
    w: 76,
    outer: [[14, 0], [62, 0], [76, 14], [76, 86], [62, 100], [14, 100], [0, 86], [0, 14]],
    holes: [[[28, 22], [48, 22], [52, 26], [52, 74], [48, 78], [28, 78], [24, 74], [24, 26]]],
  },
  R: {
    w: 78,
    outer: [[0, 0], [60, 0], [74, 14], [74, 48], [63, 59], [78, 100], [52, 100], [39, 63], [24, 63], [24, 100], [0, 100]],
    holes: [[[24, 22], [46, 22], [50, 26], [50, 38], [46, 42], [24, 42]]],
  },
  T: { w: 74, outer: [[0, 0], [74, 0], [67, 22], [49, 22], [49, 100], [25, 100], [25, 22], [7, 22]] },
  I: { w: 24, outer: [[0, 0], [24, 0], [24, 100], [0, 100]] },
  L: { w: 64, outer: [[0, 0], [24, 0], [24, 78], [64, 78], [57, 100], [0, 100]] },
};

/** Space after each letter. Optically corrected pair by pair, not one number. */
const WORD: [string, number][] = [['F', 5], ['O', 9], ['R', 4], ['T', 6], ['I', 9], ['R', 6], ['L', 0]];

const lean = ([x, y]: Pt, dx: number): Pt => [x + dx + (CAP - y) * LEAN, y];
const ring = (pts: Pt[], dx: number) => 'M' + pts.map((p) => lean(p, dx)).map(([x, y]) => `${round(x)} ${round(y)}`).join('L') + 'Z';

function buildWordmark(): { width: number; height: number; d: string } {
  let x = 0;
  const parts: string[] = [];
  for (const [ch, gap] of WORD) {
    const g = GLYPHS[ch];
    parts.push(ring(g.outer, x), ...(g.holes ?? []).map((h) => ring(h, x)));
    x += g.w + gap;
  }
  return { width: round(x + CAP * LEAN), height: CAP, d: parts.join('') };
}

/** One path for the whole word; fill it with `fillRule="evenodd"`. */
export const WORDMARK = buildWordmark();

export const BRAND = {
  name: 'FORTIRL',
  tagline: 'Survive together.',
  campaign: 'Real world. Real squad.',
} as const;
