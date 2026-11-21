import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { color } from '../theme';

/**
 * Four ticks that close inward as the lock acquires; ring and dot go mint
 * when the server would honour the shot. `kick` bumps it on every trigger pull.
 */
export function Reticle({ progress, locked, lockable, kick, size = 176 }:
  { progress: number; locked: boolean; lockable: boolean; kick: number; size?: number }) {
  const c = size / 2;
  const outer = c - 6;
  const tickLen = 14;
  const tickAt = outer - 10 - (outer - 34) * progress;    // travel inward
  const stroke = locked ? color.accent : lockable ? color.ink : color.ink3;
  const scale = useSharedValue(1);
  useEffect(() => {
    if (kick) scale.value = withSequence(withTiming(1.08, { duration: 40 }), withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }));
  }, [kick, scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ticks = [0, 90, 180, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x1 = c + Math.sin(a) * tickAt, y1 = c - Math.cos(a) * tickAt;
    const x2 = c + Math.sin(a) * (tickAt - tickLen), y2 = c - Math.cos(a) * (tickAt - tickLen);
    return <Line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={locked ? 2.5 : 1.75} strokeLinecap="round" />;
  });
  return (
    <Animated.View style={anim} pointerEvents="none" testID="reticle" accessibilityLabel={locked ? 'locked' : lockable ? 'acquiring' : 'no target'}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={outer} stroke={locked ? color.accent : color.ink4} strokeWidth={1} fill="none" opacity={locked ? 0.6 : 1} />
        {locked && <Circle cx={c} cy={c} r={outer + 6} stroke={color.accent} strokeWidth={1} fill="none" opacity={0.25} />}
        {ticks}
        <Circle cx={c} cy={c} r={locked ? 3 : 2} fill={stroke} />
      </Svg>
    </Animated.View>
  );
}
