/**
 * Synthesise the game's audio cues.
 *
 *   node scripts/make-sounds.mts        (or: npm run sounds)
 *
 * Every cue is a few lines of arithmetic: tones, noise and envelopes, written
 * as 16-bit mono WAV into assets/sounds/. They are placeholders in the same
 * sense as the code-drawn zombies: short, distinct from one another, and
 * ranked so that what matters most is loudest.
 *
 * A cue with a recording (see recorded-sounds.mts) is skipped here: its file
 * comes from import-sounds.mts instead, and this script must not write over it.
 *
 *   fire-*    one per weapon: pistol crack, SMG tick, shotgun boom, rifle crack and tail
 *   empty     a dry double click
 *   hit       a crisp tick          kill     a short rising pair
 *   damage    a low thud            knocked  a falling drone
 *   revived   two notes up          wave     a low swell into a note
 *   win       three notes up        loss     three notes down
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED } from './recorded-sounds.mts';

const RATE = 22050;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
mkdirSync(out, { recursive: true });

type Voice = (t: number) => number;

// A fixed seed: the files come out the same every time.
let seed = 0x2f6e2b1;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x7fffffff - 1; };

const sine = (hz: number | ((t: number) => number)): Voice => {
  let phase = 0, last = 0;
  return (t) => { const f = typeof hz === 'number' ? hz : hz(t); phase += 2 * Math.PI * f * (t - last); last = t; return Math.sin(phase); };
};
const hiss = (): Voice => () => noise();
/** Fast attack, exponential fall to nothing by `length`. */
const pluck = (length: number, sharp = 5): Voice => (t) => (t < 0 || t > length ? 0 : Math.min(1, t / 0.002) * Math.exp((-sharp * t) / length));
/** A voice that starts `at` seconds in. */
const at = (start: number, v: Voice): Voice => (t) => (t < start ? 0 : v(t - start));
const mix = (...parts: [number, Voice, Voice][]): Voice => {
  return (t) => parts.reduce((sum, [gain, tone, env]) => sum + gain * tone(t) * env(t), 0);
};
const glide = (from: number, to: number, length: number) => (t: number) => from + (to - from) * Math.min(1, t / length);

let written = 0;
function write(name: string, seconds: number, voice: Voice, peak = 0.85): void {
  const n = Math.round(seconds * RATE);
  const samples = new Float64Array(n);
  let max = 1e-9;
  for (let i = 0; i < n; i++) { samples[i] = voice(i / RATE); max = Math.max(max, Math.abs(samples[i])); }
  // A recording has this cue. Skipped only now, after drawing its noise, so
  // the cues after it come out the same as they always have.
  if (name in RECORDED) return;
  written++;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (n - i) / (0.004 * RATE));           // no click at the end
    data.writeInt16LE(Math.round((samples[i] / max) * peak * fade * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(join(out, `${name}.wav`), Buffer.concat([head, data]));
}

const note = (hz: number, start: number, length: number, gain = 1): [number, Voice, Voice] => [gain, at(start, sine(hz)), at(start, pluck(length, 4))];

// ---- weapons: noise for the crack, a falling tone for the body
write('fire-pistol', 0.16, mix([1, hiss(), pluck(0.07, 7)], [0.8, sine(glide(240, 70, 0.1)), pluck(0.14, 5)]));
write('fire-smg', 0.09, mix([1, hiss(), pluck(0.04, 8)], [0.6, sine(glide(320, 110, 0.05)), pluck(0.07, 6)]), 0.7);
write('fire-shotgun', 0.34, mix([1, hiss(), pluck(0.2, 5)], [1, sine(glide(150, 42, 0.2)), pluck(0.32, 4)]));
write('fire-rifle', 0.28, mix([1, hiss(), pluck(0.06, 8)], [0.9, sine(glide(300, 60, 0.12)), pluck(0.16, 5)], [0.25, hiss(), at(0.05, pluck(0.22, 3))]));
write('empty', 0.12, mix([1, hiss(), pluck(0.012, 6)], [0.8, hiss(), at(0.06, pluck(0.012, 6))], [0.3, sine(2400), pluck(0.02, 6)]), 0.5);

// ---- combat feedback
write('hit', 0.07, mix([1, sine(1900), pluck(0.05, 6)], [0.3, hiss(), pluck(0.015, 6)]), 0.6);
write('kill', 0.2, mix(note(880, 0, 0.09), note(1320, 0.07, 0.13)), 0.7);
write('damage', 0.22, mix([1, sine(glide(130, 60, 0.15)), pluck(0.2, 4)], [0.5, hiss(), pluck(0.05, 6)]), 0.9);
write('knocked', 0.7, mix([1, sine(glide(220, 82, 0.6)), pluck(0.7, 2.2)], [0.5, sine(glide(110, 41, 0.6)), pluck(0.7, 2)]), 0.95);
write('revived', 0.36, mix(note(523.25, 0, 0.16), note(783.99, 0.13, 0.22)), 0.75);

// ---- mission
write('wave', 0.6, mix([0.8, sine(110), (t) => Math.min(1, t / 0.25) * Math.exp(-3 * Math.max(0, t - 0.25))], note(329.63, 0.24, 0.34, 0.9), note(440, 0.24, 0.34, 0.5)), 0.85);
write('win', 0.75, mix(note(523.25, 0, 0.2), note(659.25, 0.16, 0.2), note(783.99, 0.32, 0.42), note(1046.5, 0.32, 0.42, 0.4)), 0.85);
write('loss', 0.9, mix(note(311.13, 0, 0.26), note(261.63, 0.22, 0.26), note(196, 0.44, 0.46), note(98, 0.44, 0.46, 0.6)), 0.85);

console.log(`wrote ${written} cues to assets/sounds; ${Object.keys(RECORDED).length} more are recordings (npm run sounds:import)`);
