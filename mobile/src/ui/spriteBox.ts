/**
 * Geometry of the zombie sprite's drawing, kept apart from the drawing
 * itself so the placement maths can be tested without a renderer. New art
 * with different proportions only needs new numbers here.
 *
 * Drawing space, 1 unit = 1 cm of zombie. The figure stands on y = 180 with
 * the top of its head at y = 5; the view box adds room around it for the
 * glow and the health bar.
 */
export const VIEW = { x: -12, y: -16, w: 124, h: 204 };
const HEAD_TOP = 5, FEET = 180, CENTRE_X = 52;

/** Width ÷ height of the rendered sprite. */
export const SPRITE_ASPECT = VIEW.w / VIEW.h;

/**
 * The screen rectangle the sprite must fill so that its head top lands on
 * `top`, its feet on `bottom` and its centre line on `sx`.
 */
export function spriteBox(sx: number, top: number, bottom: number): { left: number; top: number; width: number; height: number } {
  const u = (bottom - top) / (FEET - HEAD_TOP);
  return { left: sx - (CENTRE_X - VIEW.x) * u, top: top - (HEAD_TOP - VIEW.y) * u, width: VIEW.w * u, height: VIEW.h * u };
}
