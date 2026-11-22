import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors, hud } from '../theme';
import { useReducedMotion } from './motion';

/**
 * The gun sight. The centre of this view is the centre of the camera image.
 *
 *   idle       four ticks and a dot, bone on a dark edge so it holds on a
 *              white wall as well as in a dark corridor
 *   on target  the ticks close in and turn amber, with corner brackets
 *   fired      a quick kick outward and back (`kick` changes on every pull)
 *   empty      the ticks open out and go hollow; the ammo readout says why
 *
 * Nothing here is thinner than 2 points once its edge is counted.
 */
export function Crosshair({ onTarget, empty, kick, size = hud.crosshair }: { onTarget: boolean; empty?: boolean; kick: number; size?: number }) {
  const reduced = useReducedMotion();
  const c = size / 2;
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!kick || reduced) return;
    scale.value = withSequence(withTiming(1.14, { duration: 35 }), withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }));
  }, [kick, scale, reduced]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const gap = onTarget ? 9 : empty ? 20 : 14;            // from the centre to where a tick starts
  const len = onTarget ? 15 : 17;
  const tint = onTarget ? colors.brand.amber : colors.textPrimary;
  const weight = onTarget ? 3 : 2.25;
  const ticks = [0, 90, 180, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x1 = c + Math.sin(a) * gap, y1 = c - Math.cos(a) * gap;
    const x2 = c + Math.sin(a) * (gap + len), y2 = c - Math.cos(a) * (gap + len);
    return (
      <React.Fragment key={deg}>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.camera.edge} strokeWidth={weight + 2.5} strokeLinecap="square" />
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={tint} strokeWidth={weight} strokeLinecap="butt" strokeDasharray={empty && !onTarget ? '4 3' : undefined} />
      </React.Fragment>
    );
  });
  // Corner brackets: the "locked" confirmation. Shape, not just colour.
  const b = 30, arm = 8;
  const bracket = (sx: number, sy: number) => `M ${c + sx * b} ${c + sy * (b - arm)} V ${c + sy * b} H ${c + sx * (b - arm)}`;
  return (
    <Animated.View style={anim} pointerEvents="none" testID="reticle" accessibilityLabel={onTarget ? 'on target' : 'no target'}>
      <Svg width={size} height={size}>
        {onTarget ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => (
          <React.Fragment key={`${sx}${sy}`}>
            <Path d={bracket(sx, sy)} stroke={colors.camera.edge} strokeWidth={4.5} fill="none" strokeLinecap="square" />
            <Path d={bracket(sx, sy)} stroke={tint} strokeWidth={2} fill="none" strokeLinecap="square" />
          </React.Fragment>
        )) : null}
        {ticks}
        <Circle cx={c} cy={c} r={3.6} fill={colors.camera.edge} />
        <Circle cx={c} cy={c} r={onTarget ? 2.4 : 2} fill={tint} />
      </Svg>
    </Animated.View>
  );
}
