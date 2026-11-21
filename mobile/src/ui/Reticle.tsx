import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { color } from '../theme';

/**
 * The gun sight. Four ticks around a centre dot; they close in and go mint
 * when a zombie is under the crosshair. `kick` bumps it on every trigger pull.
 * The centre of this view is the centre of the camera image.
 */
export function Reticle({ onTarget, kick, size = 132 }: { onTarget: boolean; kick: number; size?: number }) {
  const c = size / 2;
  const outer = c - 6;
  const tickLen = 12;
  const tickAt = onTarget ? 26 : outer - 8;
  const stroke = onTarget ? color.accent : color.ink2;
  const scale = useSharedValue(1);
  useEffect(() => {
    if (kick) scale.value = withSequence(withTiming(1.1, { duration: 40 }), withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }));
  }, [kick, scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ticks = [0, 90, 180, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x1 = c + Math.sin(a) * tickAt, y1 = c - Math.cos(a) * tickAt;
    const x2 = c + Math.sin(a) * (tickAt - tickLen), y2 = c - Math.cos(a) * (tickAt - tickLen);
    return (
      <React.Fragment key={deg}>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.45)" strokeWidth={onTarget ? 4.5 : 3.5} strokeLinecap="round" />
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={onTarget ? 2.5 : 1.75} strokeLinecap="round" />
      </React.Fragment>
    );
  });
  return (
    <Animated.View style={anim} pointerEvents="none" testID="reticle" accessibilityLabel={onTarget ? 'on target' : 'no target'}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={outer} stroke={onTarget ? color.accent : color.ink4} strokeWidth={1} fill="none" opacity={onTarget ? 0.55 : 1} />
        {ticks}
        <Circle cx={c} cy={c} r={3.5} fill="rgba(0,0,0,0.45)" />
        <Circle cx={c} cy={c} r={onTarget ? 2.5 : 2} fill={onTarget ? color.accent : color.ink} />
      </Svg>
    </Animated.View>
  );
}
