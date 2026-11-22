/**
 * What the player feels and hears when something happens. One call per
 * event; each channel checks its own preference, so sound and haptics can be
 * switched off independently. Neither is ever the only sign of an event:
 * everything here also has something on screen.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store';
import { playSound } from './sound';

export type Cue = 'fire' | 'empty' | 'hit' | 'kill' | 'damage' | 'knocked' | 'revived' | 'wave' | 'win' | 'loss';

const quiet = () => {};
const impact = (style: Haptics.ImpactFeedbackStyle) => Haptics.impactAsync(style).catch(quiet);
const notify = (type: Haptics.NotificationFeedbackType) => Haptics.notificationAsync(type).catch(quiet);
const later = (ms: number, fn: () => void) => { setTimeout(fn, ms); };

function haptic(cue: Cue): void {
  if (Platform.OS === 'web') return;
  const { Light, Medium, Heavy, Rigid } = Haptics.ImpactFeedbackStyle;
  switch (cue) {
    case 'fire': impact(Rigid); break;                                    // short, firm
    case 'empty': impact(Light); break;
    case 'hit': impact(Light); break;
    case 'kill': impact(Medium); break;
    case 'damage': notify(Haptics.NotificationFeedbackType.Warning); break;
    case 'knocked': impact(Heavy); later(140, () => impact(Heavy)); break; // strong and unlike anything else
    case 'revived': impact(Light); later(120, () => impact(Medium)); break; // two-part: up and back
    case 'wave': impact(Medium); break;
    case 'win': notify(Haptics.NotificationFeedbackType.Success); later(260, () => impact(Heavy)); break;
    case 'loss': notify(Haptics.NotificationFeedbackType.Error); break;
  }
}

/** `weapon` (a class id) picks the shot sound for `fire`. */
export function feedback(cue: Cue, weapon?: string): void {
  const { prefs } = useStore.getState();
  if (prefs.haptics) haptic(cue);
  if (prefs.sound) playSound(cue, weapon);
}
