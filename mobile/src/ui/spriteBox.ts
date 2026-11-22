/**
 * Where a zombie's sprite goes and which frame it shows, kept apart from the
 * drawing so the maths can be tested without a renderer or an image.
 *
 * The art is a set of sprite sheets rendered from a 3D model (see
 * scripts/make-zombie-sprites.mts): each animation, seen from five angles. Everything here
 * is about picking the right frame from the right angle and putting it on
 * screen so the feet land on the floor.
 */
import { angleDiffDeg, bearingXY, rad } from '../game/geo';
import { ZOMBIE_ANGLES, ZOMBIE_SHEET_HEIGHT_M, type ZombieKind, type ZombieSheet } from './zombieSheets';

export const ZOMBIE_KINDS: readonly ZombieKind[] = ['walker', 'runner', 'brute', 'boss'];
/** The server's type code as a name: 0 walker, 1 runner, 2 brute, 3 boss. */
export const zombieKind = (type: number): ZombieKind => ZOMBIE_KINDS[type] ?? 'walker';

/**
 * How much bigger than a walker each type is drawn, standing on the same
 * floor. The layer applies it; the hit test stays the server's.
 */
export const ZOMBIE_SCALE: Record<ZombieKind, number> = { walker: 1, runner: 0.96, brute: 1.1, boss: 1.3 };

/**
 * Width ÷ height of the box a standing zombie's body fills, head to feet.
 * Arms and a falling body reach outside it; the box is what gets placed.
 */
export const FIGURE_ASPECT = 0.4;

/**
 * The screen rectangle of a zombie's body: head top on `top`, feet on
 * `bottom`, centre line on `sx`.
 */
export function spriteBox(sx: number, top: number, bottom: number): { left: number; top: number; width: number; height: number } {
  const height = bottom - top, width = height * FIGURE_ASPECT;
  return { left: sx - width / 2, top, width, height };
}

/**
 * How far a zombie is turned away from whoever is looking at it, in degrees.
 * 0: it faces them. Positive: it is turned towards their right. ±180: they
 * see its back.
 */
export function turnOf(heading: number, x: number, y: number, viewerX: number, viewerY: number): number {
  return angleDiffDeg(bearingXY(x, y, viewerX, viewerY), heading);
}

/** Which angle of the sheet to show, and whether to flip it. */
export interface Facing { row: number; mirror: boolean }

/** Past the halfway point between two angles, how much further it must turn before the sprite changes. */
const HOLD_DEG = 7;

/**
 * The drawn angle nearest to `turn`. The sheets only hold turns to the right;
 * a turn to the left is the same frame mirrored. `previous` keeps a zombie
 * that hovers between two angles from flickering between them.
 */
export function facing(turn: number, previous?: Facing): Facing {
  const away = Math.abs(turn), step = 180 / (ZOMBIE_ANGLES.length - 1);
  let row = Math.round(away / step);
  if (previous && Math.abs(away - ZOMBIE_ANGLES[previous.row]) < step / 2 + HOLD_DEG) row = previous.row;
  // Square on from the front or the back there is no side to mirror.
  return { row, mirror: turn < 0 && row > 0 && row < ZOMBIE_ANGLES.length - 1 };
}

/**
 * Which frame of an animation to show. For one that loops, `seconds` is any
 * running clock; for one that plays once, it is the time since it started.
 */
export function frameAt(sheet: Pick<ZombieSheet, 'frames' | 'seconds' | 'loop'>, seconds: number): number {
  const f = Math.floor((seconds / sheet.seconds) * sheet.frames);
  return sheet.loop ? ((f % sheet.frames) + sheet.frames) % sheet.frames : Math.max(0, Math.min(sheet.frames - 1, f));
}

export interface CellPlace {
  /** The frame's rectangle, relative to the top left of the body box. */
  left: number; top: number; width: number; height: number;
  /** Which frame of the grid: column and line. */
  col: number; line: number;
  /** Screen pixels per sheet pixel. */
  scale: number;
}

/**
 * Where one frame goes, for a body box `size` pixels tall. Frames are wider
 * than the body and are not centred on it: a walker's arms reach ahead of its
 * feet, so its frame is centred ahead of them too, by `sheet.forward` metres;
 * one that has fallen over lies to one side, by `sheet.side`. Which of those
 * is a shift across the screen depends on the angle it is seen from.
 */
export function cellPlace(sheet: ZombieSheet, size: number, frame: number, f: Facing): CellPlace {
  const scale = size / (ZOMBIE_SHEET_HEIGHT_M * sheet.ppm);
  const i = f.row * sheet.frames + frame;
  const turn = rad(ZOMBIE_ANGLES[f.row]);
  const ahead = (sheet.side * Math.cos(turn) + sheet.forward * Math.sin(turn)) * (f.mirror ? -1 : 1) * sheet.ppm * scale;
  const width = sheet.cw * scale, height = sheet.ch * scale;
  return {
    left: (size * FIGURE_ASPECT) / 2 + ahead - width / 2, top: size - sheet.floorY * scale, width, height,
    col: i % sheet.cols, line: Math.floor(i / sheet.cols), scale,
  };
}
