/**
 * Short audio cues, played through expo-audio.
 *
 * Speed matters most for the shot: the sound is the trigger's answer. So the
 * files are copied onto the phone and their players made before the mission
 * needs them (`preloadSounds`), and a sound that repeats keeps a few copies:
 * one that has finished is wound back and waits, and playing it is a single
 * call with no seek in front. Only when every copy is still sounding (full
 * auto) is one restarted, and a cue cannot fire faster than `MIN_GAP_MS`, so
 * an SMG is a rattle and not a wall of noise.
 *
 * Loudness follows what matters: being hurt or knocked is louder than your
 * own shots. Sound is never the only sign of anything: every cue here has
 * a caption on screen (a marker, a banner, a bar).
 *
 * The shots, the hit marker, the knock, the revive and the zombie are
 * recordings (the repo's sounds/ folder, cut and levelled by
 * scripts/import-sounds.mts). The rest are synthesised by
 * scripts/make-sounds.mts.
 *
 * The zombie is the one sound that is not a cue: it loops for as long as one
 * is in earshot, and `setHorde` moves its loudness and pitch (see horde.ts).
 */
import { Asset } from 'expo-asset';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { Cue } from './feedback';
import type { Voice } from './horde';

const FILES = {
  'fire-pistol': require('../../assets/sounds/fire-pistol.wav'),
  'fire-smg': require('../../assets/sounds/fire-smg.wav'),
  'fire-shotgun': require('../../assets/sounds/fire-shotgun.wav'),
  'fire-rifle': require('../../assets/sounds/fire-rifle.wav'),
  empty: require('../../assets/sounds/empty.wav'),
  hit: require('../../assets/sounds/hit.wav'),
  kill: require('../../assets/sounds/kill.wav'),
  damage: require('../../assets/sounds/damage.wav'),
  knocked: require('../../assets/sounds/knocked.wav'),
  revived: require('../../assets/sounds/revived.wav'),
  wave: require('../../assets/sounds/wave.wav'),
  win: require('../../assets/sounds/win.wav'),
  loss: require('../../assets/sounds/loss.wav'),
} as const;
type Sound = keyof typeof FILES;

// The recorded shots are far denser than a synthesised blip at the same peak
// (the pistol by about 10 dB), so they are turned down by measurement to sit
// under `damage` and `knocked`: the automatic lowest, since it repeats.
const VOLUME: Record<Sound, number> = {
  'fire-pistol': 0.3, 'fire-smg': 0.23, 'fire-shotgun': 0.55, 'fire-rifle': 0.4, empty: 0.5,
  hit: 0.6, kill: 0.8, damage: 0.95, knocked: 1, revived: 0.7, wave: 0.9, win: 1, loss: 1,
};

/** Which shot each weapon makes. The first three are the names an older server uses. */
const SHOT: Record<string, Sound> = {
  regular: 'fire-pistol', light: 'fire-smg', heavy: 'fire-rifle',
  pistol: 'fire-pistol', smg: 'fire-smg', shotgun: 'fire-shotgun', rifle: 'fire-rifle',
};

/**
 * How many copies of a sound are kept. Enough that a single-shot weapon
 * fired as fast as it allows always finds one that has finished; the
 * automatic gets two, because it restarts them anyway.
 */
const COPIES: Partial<Record<Sound, number>> = {
  'fire-pistol': 3, 'fire-smg': 2, 'fire-shotgun': 4, 'fire-rifle': 4, hit: 3, kill: 2,
};

const MIN_GAP_MS = 55;
interface Copy { player: AudioPlayer; ready: boolean; startedAt: number }
const copiesOf = new Map<Sound, Copy[]>();
const lastPlayed = new Map<Sound, number>();
let modeSet = false;

function makeCopy(sound: Sound): Copy {
  const player = createAudioPlayer(FILES[sound]);
  player.volume = VOLUME[sound];
  const copy: Copy = { player, ready: true, startedAt: 0 };      // a new player sits at its start
  // Wind it back as soon as it finishes, while nobody is waiting on it.
  player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish) player.seekTo(0).then(() => { copy.ready = true; }).catch(() => {});
  });
  return copy;
}

function copies(sound: Sound): Copy[] {
  let list = copiesOf.get(sound);
  if (!list) {
    list = Array.from({ length: COPIES[sound] ?? 1 }, () => makeCopy(sound));
    copiesOf.set(sound, list);
  }
  return list;
}

/**
 * Get the sounds onto the phone, and their players made, before the first
 * shot needs them. Without this the first use of each sound makes its player
 * on the spot and, in Expo Go, fetches the file from the laptop over Wi-Fi.
 * Only this player's own weapon is readied; the rest are made if ever needed.
 * Safe to call more than once.
 */
export function preloadSounds(weapon?: string): Promise<void> {
  const shot = SHOT[weapon ?? ''] ?? 'fire-pistol';
  const wanted = (Object.keys(FILES) as Sound[]).filter((s) => !s.startsWith('fire-') || s === shot);
  return Asset.loadAsync([...wanted.map((s) => FILES[s] as number), HORDE_FILE as number])
    .then(() => undefined, () => undefined)       // could not copy them: the players fall back to where the bundle came from
    .then(() => {
      try { audioMode(); for (const s of wanted) copies(s); } catch { /* no audio on this device */ }
    });
}

function audioMode(): void {
  if (modeSet) return;
  modeSet = true;
  // Play with the ringer switch off, and alongside whatever else is playing.
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
}

export function playSound(cue: Cue, weapon?: string): void {
  const sound: Sound = cue === 'fire' ? SHOT[weapon ?? ''] ?? 'fire-pistol' : cue;
  const now = Date.now();
  if (now - (lastPlayed.get(sound) ?? 0) < MIN_GAP_MS) return;
  lastPlayed.set(sound, now);
  try {
    audioMode();
    const list = copies(sound);
    const waiting = list.find((c) => c.ready);
    // None has finished: restart the one that has been sounding longest.
    const c = waiting ?? list.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    if (!waiting) c.player.seekTo(0).catch(() => {});
    c.ready = false;
    c.startedAt = now;
    c.player.play();
  } catch { /* no audio on this device: the screen still says what happened */ }
}

// ---- the horde: one groan on a loop, steered by game/horde.ts ----

const HORDE_FILE = require('../../assets/sounds/zombie.wav');
/** A zombie at arm's length, at full: just under `damage`, so a bite still cuts through. */
const HORDE_VOLUME = 0.6;
let horde: AudioPlayer | null = null;
let hordeOn = false;
let hordeRate = 0;

/**
 * Set the zombie groan: how loud, and how high (a playback rate; the pitch
 * moves with it). `null` is silence. Made to be called several times a second.
 */
export function setHorde(voice: Voice | null): void {
  try {
    if (!voice || voice.volume < 0.01) {
      if (hordeOn) { hordeOn = false; horde?.pause(); }
      return;
    }
    audioMode();
    if (!horde) {
      horde = createAudioPlayer(HORDE_FILE);
      horde.loop = true;
      horde.shouldCorrectPitch = false;       // the pitch is the point: let it move with the speed
    }
    horde.volume = voice.volume * HORDE_VOLUME;
    if (Math.abs(voice.rate - hordeRate) >= 0.01) { hordeRate = voice.rate; horde.setPlaybackRate(voice.rate); }
    if (!hordeOn) { hordeOn = true; horde.play(); }
  } catch { /* no audio on this device: the zombies are still on screen */ }
}
