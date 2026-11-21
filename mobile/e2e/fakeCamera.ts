/**
 * A stand-in for the phone's camera. Chrome's built-in fake camera is a
 * bright green test pattern, which says nothing about how the HUD and the
 * zombies read over a real room. This draws a plain indoor corridor in
 * perspective and writes it as a short .y4m clip that Chrome plays in a loop
 * as the "camera".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const W = 1280, H = 720, FRAMES = 2;
const VX = 640, VY = 345;                    // vanishing point
const FAR_HALF_W = 135, FAR_HALF_H = 100;    // the far wall, as seen from here

function pixel(x: number, y: number): [number, number, number] {
  const dx = x - VX, dy = y - VY;
  const sx = Math.abs(dx) / FAR_HALF_W, sy = Math.abs(dy) / FAR_HALF_H;
  let r: number, g: number, b: number;

  if (sx <= 1 && sy <= 1) {
    // Far wall with a door and a lit sign above it.
    [r, g, b] = [74, 76, 80];
    if (Math.abs(dx) < 46 && dy > -52) [r, g, b] = Math.abs(dx) > 40 || dy < -46 ? [44, 42, 40] : [58, 50, 44];
    if (Math.abs(dx) < 20 && dy > -74 && dy < -62) [r, g, b] = [70, 210, 120];
  } else {
    const s = Math.max(sx, sy);               // 1 at the far wall, bigger toward the camera
    const depth = 6 / s;                      // evenly spaced in real distance
    const light = 0.5 + 0.5 * Math.min(1, (s - 1) / 2.6);
    if (sx > sy) {
      // Side wall: doors at regular intervals, a darker skirting board.
      const v = dy / s;                       // height on the wall
      [r, g, b] = [148, 146, 136];
      const cell = depth % 1.5;
      if (cell < 0.5 && v > -62) [r, g, b] = cell < 0.04 || cell > 0.46 || v < -58 ? [70, 64, 58] : [104, 88, 74];
      if (v > 86) [r, g, b] = [62, 60, 58];
      const side = dx < 0 ? 0.92 : 1;         // light falls a little unevenly
      r *= light * side; g *= light * side; b *= light * side;
    } else if (dy < 0) {
      // Ceiling with light panels down the middle.
      const u = dx / s;
      [r, g, b] = [158, 158, 152];
      if (Math.abs(u) < 40 && depth % 1.5 > 0.55 && depth % 1.5 < 1.05) [r, g, b] = [250, 248, 236];
      else { r *= light; g *= light; b *= light; }
    } else {
      // Floor tiles, with a soft sheen under the lights.
      const u = dx / s;
      [r, g, b] = [96, 90, 82];
      const seam = depth % 0.5 < 0.03 || Math.abs(((u % 45) + 45) % 45) < 1.1;
      if (seam) [r, g, b] = [70, 66, 60];
      const sheen = Math.max(0, 1 - Math.abs(u) / 60) * 26;
      r = r * light + sheen; g = g * light + sheen; b = b * light + sheen;
    }
  }
  // Lens vignette and a little sensor grain.
  const vig = 1 - 0.28 * ((dx / 640) ** 2 + (dy / 380) ** 2);
  const grain = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 6;
  return [r * vig + grain, g * vig + grain, b * vig + grain];
}

/** Writes the clip if it is not there yet and returns its absolute path. */
export function ensureFakeCamera(dir: string): string {
  const file = path.join(dir, 'corridor.y4m');
  if (fs.existsSync(file) && fs.statSync(file).size > W * H) return file;
  fs.mkdirSync(dir, { recursive: true });
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixel(x, y);
      Y[y * W + x] = clamp(0.299 * r + 0.587 * g + 0.114 * b);
      if (x % 2 === 0 && y % 2 === 0) {
        const i = (y / 2) * (W / 2) + x / 2;
        U[i] = clamp(-0.169 * r - 0.331 * g + 0.5 * b + 128);
        V[i] = clamp(0.5 * r - 0.419 * g - 0.081 * b + 128);
      }
    }
  }
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F5:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < FRAMES; i++) parts.push(Buffer.from('FRAME\n'), Y, U, V);
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}
