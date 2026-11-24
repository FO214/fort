/**
 * How wide the camera preview sees, in degrees across the screen.
 *
 * Zombies are drawn with the same field of view as the camera image behind
 * them. If the two disagree, a zombie slides across the floor as the player
 * turns: too narrow and it races ahead of the background, too wide and it
 * lags behind. It also stands too big or too small for its distance.
 *
 * Three things set it:
 *
 * 1. The lens. Phone makers quote the main camera as a "35 mm-equivalent"
 *    focal length (24 mm, 26 mm...), which is a field of view in disguise.
 *    That is looked up from the phone model.
 * 2. The crop. The preview fills the screen (cover), so a 4:3 camera image on
 *    a long landscape screen keeps its full width and loses top and bottom;
 *    on a squarer screen (a tablet) it loses the sides instead.
 * 3. Zoom. A 2× zoom halves the tangent of the half-angle.
 *
 * The player can trim the result in Settings if a phone is not in the table.
 *
 * Pure maths; deviceCamera.ts applies it to the phone in hand.
 */
import { deg, rad } from './geo';

/** The camera image's long side over its short side. The preview asks for 4:3, the sensor's own shape. */
export const STREAM_ASPECT = 4 / 3;
/** The game does not zoom (yet). As a magnification: 1 is the main camera's own view. */
export const CAMERA_ZOOM = 1;
/** Diagonal of a 35 mm film frame, which "equivalent" focal lengths are quoted against. */
const FILM_DIAGONAL_MM = Math.hypot(36, 24);

/**
 * Main (1×) camera, 35 mm-equivalent focal length, by model name. First match wins.
 * iOS gives marketing names ("iPhone 15 Pro"); Android gives the model code ("SM-S921B", "Pixel 8").
 */
const LENSES: [RegExp, number][] = [
  [/^iPhone (1[4-9]|[2-9]\d) Pro/i, 24],          // 14 Pro onwards: 24 mm
  [/^iPhone (SE|[678]( Plus)?|X)$/i, 28],         // the older, narrower ones
  [/^iPhone/i, 26],                               // XS / XR to the current non-Pro: 26 mm
  [/^iPad/i, 29],
  [/^Pixel (Fold|Tablet)/i, 26],
  [/^Pixel/i, 25],
  [/^SM-S9\d\d/i, 24],                            // Galaxy S2x
  [/^SM-[AM]\d/i, 26],                            // Galaxy A and M series
];
const DEFAULT_LENS_MM = { ios: 26, android: 25 } as Record<string, number>;

/** 35 mm-equivalent focal length of this phone's main camera. */
export function lensMm(model: string | null | undefined, os: string): number {
  const name = (model ?? '').trim();
  for (const [re, mm] of LENSES) if (re.test(name)) return mm;
  return DEFAULT_LENS_MM[os] ?? 26;
}

/** Field of view across the long side of the camera image, from an equivalent focal length. */
export function sensorHfov(mm: number, aspect = STREAM_ASPECT): number {
  const width = FILM_DIAGONAL_MM * (aspect / Math.hypot(aspect, 1));
  return deg(2 * Math.atan(width / 2 / mm));
}

/**
 * Field of view across a `width` × `height` screen filled by the preview
 * (cover), at a zoom (magnification).
 */
export function screenHfov(sensorDeg: number, width: number, height: number, aspect = STREAM_ASPECT, zoom = 1): number {
  const screen = Math.max(width, height) / Math.max(1, Math.min(width, height));
  // A squarer screen than the image: the image's sides are cut off.
  const shown = screen >= aspect ? 1 : screen / aspect;
  return deg(2 * Math.atan((Math.tan(rad(sensorDeg / 2)) * shown) / Math.max(zoom, 1e-3)));
}
