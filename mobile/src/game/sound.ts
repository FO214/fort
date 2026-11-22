/**
 * Short audio cues, played through expo-audio.
 *
 * One player per cue, made the first time it is needed. A cue that is asked
 * for again while it is still sounding restarts rather than stacking, and a
 * cue cannot fire faster than `MIN_GAP_MS`, so an SMG on full auto is a
 * rattle and not a wall of noise.
 *
 * Loudness follows what matters: being hurt or knocked is louder than your
 * own shots. Sound is never the only sign of anything: every cue here has
 * a caption on screen (a marker, a banner, a bar).
 *
 * The files are synthesised by scripts/make-sounds.mts.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { Cue } from './feedback';

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

const VOLUME: Record<Sound, number> = {
  'fire-pistol': 0.55, 'fire-smg': 0.45, 'fire-shotgun': 0.6, 'fire-rifle': 0.6, empty: 0.5,
  hit: 0.6, kill: 0.8, damage: 0.95, knocked: 1, revived: 0.85, wave: 0.9, win: 1, loss: 1,
};

/** Which shot each weapon makes. The first three are the names an older server uses. */
const SHOT: Record<string, Sound> = {
  regular: 'fire-pistol', light: 'fire-smg', heavy: 'fire-rifle',
  pistol: 'fire-pistol', smg: 'fire-smg', shotgun: 'fire-shotgun', rifle: 'fire-rifle',
};

const MIN_GAP_MS = 55;
const players = new Map<Sound, AudioPlayer>();
const lastPlayed = new Map<Sound, number>();
let modeSet = false;

function player(sound: Sound): AudioPlayer {
  let p = players.get(sound);
  if (!p) {
    p = createAudioPlayer(FILES[sound]);
    p.volume = VOLUME[sound];
    players.set(sound, p);
  }
  return p;
}

export function playSound(cue: Cue, weapon?: string): void {
  const sound: Sound = cue === 'fire' ? SHOT[weapon ?? ''] ?? 'fire-pistol' : cue;
  const now = Date.now();
  if (now - (lastPlayed.get(sound) ?? 0) < MIN_GAP_MS) return;
  lastPlayed.set(sound, now);
  try {
    if (!modeSet) {
      modeSet = true;
      // Play with the ringer switch off, and alongside whatever else is playing.
      setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    const p = player(sound);
    p.seekTo(0).catch(() => {});
    p.play();
  } catch { /* no audio on this device: the screen still says what happened */ }
}
