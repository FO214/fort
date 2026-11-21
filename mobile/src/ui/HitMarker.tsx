import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import type { ShotFeedback } from '../store';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

const REASON: Record<string, string> = {
  no_target: 'No lock', off_target: 'Off target', range: 'Out of range', reloading: 'Reloading',
  empty: 'Empty', cooldown: '', friendly: 'Friendly', protected: 'Protected', no_fix: 'No GPS fix',
};

/** Centre X on a hit, brighter and labelled on a kill; a reason chip on a miss. */
export function HitMarker({ shot }: { shot: ShotFeedback | undefined }) {
  const o = useSharedValue(0);
  const s = useSharedValue(1);
  useEffect(() => {
    if (!shot || shot.reason === 'cooldown') return;
    o.value = withSequence(withTiming(1, { duration: 30 }), withTiming(0, { duration: shot.kind === 'kill' ? 900 : 420, easing: Easing.out(Easing.quad) }));
    s.value = withSequence(withTiming(1.25, { duration: 30 }), withTiming(1, { duration: 200 }));
  }, [shot?.key, shot, o, s]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: s.value }] }));
  if (!shot || shot.reason === 'cooldown') return null;
  const col = shot.kind === 'kill' ? color.accent : color.ink;
  const detail = shot.kind === 'miss'
    ? `${REASON[shot.reason] ?? shot.reason}${shot.reason === 'off_target' && shot.off != null ? ` ${Math.round(shot.off)}°` : ''}${shot.reason === 'range' && shot.dist != null ? ` ${Math.round(shot.dist)} m` : ''}`
    : shot.kind === 'kill' ? 'Eliminated' : '';
  return (
    <Animated.View style={[{ alignItems: 'center', gap: space.md }, anim]} pointerEvents="none" testID={`shot-${shot.kind}`}>
      {shot.kind !== 'miss' ? (
        <Svg width={44} height={44}>
          {[[8, 8, 17, 17], [36, 8, 27, 17], [8, 36, 17, 27], [36, 36, 27, 27]].map(([x1, y1, x2, y2], i) => (
            <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={2.5} strokeLinecap="round" />
          ))}
        </Svg>
      ) : <View style={{ height: 44 }} />}
      {detail ? (
        <Glass radius={radius.pill} tint={shot.kind === 'kill' ? color.accent : undefined} contentStyle={{ paddingHorizontal: 12, height: 26, justifyContent: 'center' }}>
          <T v="label" c={col}>{detail}</T>
        </Glass>
      ) : null}
    </Animated.View>
  );
}
