/**
 * Motion helpers. Movement here says something changed; it is never
 * decoration. Everything is a short timed ease, nothing springs, and when
 * the system asks for reduced motion the change simply happens.
 */
import { Easing, useReducedMotion, withTiming, type WithTimingConfig } from 'react-native-reanimated';
import { motion } from '../theme';

export const easeOut = Easing.bezier(...motion.easeOut);
export const easeIn = Easing.bezier(...motion.easeIn);

export const timing = (duration: number = motion.base, easing = easeOut): WithTimingConfig => ({ duration, easing });

/** `withTiming`, or an immediate jump when motion is reduced. */
export function settle(to: number, reduced: boolean, duration: number = motion.base) {
  'worklet';
  return reduced ? to : withTiming(to, { duration, easing: easeOut });
}

export { useReducedMotion };
