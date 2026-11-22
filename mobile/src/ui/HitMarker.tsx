import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Line, Polygon } from 'react-native-svg';
import type { ShotFeedback } from '../store';
import { colors, space } from '../theme';
import { useReducedMotion } from './motion';
import { StatusChip } from './StatusChip';

/** Misses worth explaining. A plain miss (nothing under the crosshair) says nothing. */
const REASON: Record<string, string> = { range: 'Out of range', reloading: 'Reloading', empty: 'Magazine empty' };

const SIZE = 52;
const TICKS = [[10, 10, 20, 20], [42, 10, 32, 20], [10, 42, 20, 32], [42, 42, 32, 32]];

/**
 * What the last shot did, at the crosshair.
 *   hit   four bone ticks, gone in under half a second
 *   kill  the same ticks in amber, wider, around a solid diamond, a little longer
 *   miss  nothing, unless the shot could not happen: then a line saying why
 */
export function HitMarker({ shot }: { shot: ShotFeedback | undefined }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(0);
  const s = useSharedValue(1);
  useEffect(() => {
    if (!shot || shot.reason === 'cooldown') return;
    const hold = shot.kind === 'kill' ? 620 : shot.kind === 'miss' ? 900 : 360;
    o.value = withSequence(withTiming(1, { duration: 30 }), withTiming(0, { duration: hold, easing: Easing.in(Easing.quad) }));
    if (!reduced) s.value = withSequence(withTiming(shot.kind === 'kill' ? 1.3 : 1.18, { duration: 30 }), withTiming(1, { duration: 170 }));
  }, [shot?.key, shot, o, s, reduced]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: s.value }] }));
  if (!shot || shot.reason === 'cooldown') return null;
  const kill = shot.kind === 'kill';
  const why = shot.kind === 'miss' ? REASON[shot.reason] : undefined;
  if (shot.kind === 'miss' && !why) return null;
  const tint = kill ? colors.brand.amber : colors.textPrimary;
  return (
    <Animated.View style={[{ alignItems: 'center', gap: space[3] }, anim]} pointerEvents="none" testID={`shot-${shot.kind}`}
      accessibilityLabel={kill ? 'Kill' : why ?? 'Hit'}>
      {shot.kind !== 'miss' ? (
        <Svg width={SIZE} height={SIZE}>
          {TICKS.map(([x1, y1, x2, y2], i) => (
            <React.Fragment key={i}>
              <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.camera.edge} strokeWidth={kill ? 6.5 : 5.5} strokeLinecap="square" />
              <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={tint} strokeWidth={kill ? 3.5 : 2.5} strokeLinecap="butt" />
            </React.Fragment>
          ))}
          {kill ? <Polygon points={`${SIZE / 2},${SIZE / 2 - 6} ${SIZE / 2 + 6},${SIZE / 2} ${SIZE / 2},${SIZE / 2 + 6} ${SIZE / 2 - 6},${SIZE / 2}`} fill={tint} stroke={colors.camera.edge} strokeWidth={1.5} /> : null}
        </Svg>
      ) : <View style={{ height: SIZE }} />}
      {why ? <StatusChip hud icon="warning" tone="warn" label={why} style={{ alignSelf: 'center' }} /> : null}
    </Animated.View>
  );
}
