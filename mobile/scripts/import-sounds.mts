/**
 * Turn the recordings in the repo's sounds/ folder into the cues the app plays.
 *
 *   node scripts/import-sounds.mts      (or: npm run sounds:import)   needs ffmpeg
 *
 * A recording is rarely ready to play as it comes. It opens with a pause, it
 * trails off into one, and each is at its own level; a shot that sounds a
 * tenth of a second after the trigger feels broken. So each one is decoded,
 * cut to start where the sound starts, cut and faded where it has died away,
 * brought to the same peak, and written as 16-bit mono WAV to
 * assets/sounds/<cue>.wav, the format every platform plays without thinking.
 *
 * Which recording is which cue is in recorded-sounds.mts. Recordings nobody
 * has placed yet are listed at the end and left alone.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED } from './recorded-sounds.mts';

const RATE = 44100;
const PEAK = 0.9;
const here = dirname(fileURLToPath(import.meta.url));
const sources = join(here, '..', '..', 'sounds');
const out = join(here, '..', 'assets', 'sounds');

const db = (d: number) => 10 ** (d / 20);
const samples = (seconds: number) => Math.round(seconds * RATE);

/** Anything ffmpeg reads, as mono samples in -1..1. It goes by what is in the file, not by its name. */
function decode(file: string): Float32Array {
  // -map 0:a:0: the first audio stream only (some of these files carry cover art as a second stream).
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
    { maxBuffer: 256 * 1024 * 1024 });
  const s = new Float32Array(raw.length >> 1);
  for (let i = 0; i < s.length; i++) s[i] = raw.readInt16LE(i * 2) / 32768;
  return s;
}

/** The sound itself: from just before it starts to just after it has died away, at full level. */
function trim(s: Float32Array, maxSeconds?: number, restSeconds = 0): { cut: Float32Array; leadIn: number } {
  let peak = 0;
  for (const x of s) peak = Math.max(peak, Math.abs(x));
  if (peak < 1e-4) throw new Error('the recording is silent');
  let first = 0;
  while (Math.abs(s[first]) < peak * db(-30)) first++;
  let last = s.length - 1;
  while (last > first && Math.abs(s[last]) < peak * db(-45)) last--;
  const start = Math.max(0, first - samples(0.005));                   // keep the front edge of the attack
  let end = Math.min(s.length, last + samples(0.05));
  if (maxSeconds) end = Math.min(end, start + samples(maxSeconds));
  const sound = end - start;
  const cut = new Float32Array(sound + samples(restSeconds));          // any rest is left as silence
  const fadeIn = samples(0.001), fadeOut = Math.min(sound, samples(0.04));        // no click at either end
  for (let i = 0; i < sound; i++) {
    cut[i] = (s[start + i] / peak) * PEAK * Math.min(1, i / fadeIn, (sound - 1 - i) / fadeOut);
  }
  return { cut, leadIn: start / RATE };
}

function wav(s: Float32Array): Buffer {
  const data = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

let failed = false;
for (const [cue, { from, maxSeconds, restSeconds }] of Object.entries(RECORDED)) {
  const file = join(sources, from);
  if (!existsSync(file)) { console.error(`${cue}: sounds/${from} is missing`); failed = true; continue; }
  try {
    const { cut, leadIn } = trim(decode(file), maxSeconds, restSeconds);
    const bytes = wav(cut);
    writeFileSync(join(out, `${cue}.wav`), bytes);
    console.log(`${cue.padEnd(13)} <- ${from.padEnd(18)} ${(cut.length / RATE).toFixed(2)} s, ${Math.round(leadIn * 1000)} ms of lead-in removed, ${Math.round(bytes.length / 1024)} KB`);
  } catch (e) {
    console.error(`${cue}: could not read sounds/${from}: ${(e as Error).message}`);
    failed = true;
  }
}

const placed = new Set(Object.values(RECORDED).map((r) => r.from));
const spare = readdirSync(sources).filter((f) => !f.startsWith('.') && !placed.has(f));
if (spare.length) console.log(`not used by any cue: ${spare.join(', ')}`);
if (failed) process.exit(1);
