import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import type { Damage } from '../store';
import { color } from '../theme';

/** Red vignette + a wedge on the compass ring pointing at the shooter. */
export function DamageFlash({ latest, anchorY }: { latest: Damage | undefined; anchorY: number }) {
  const { width, height } = useWindowDimensions();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!latest) return;
    opacity.value = withSequence(withTiming(0.9, { duration: 50 }), withTiming(0, { duration: 650, easing: Easing.out(Easing.cubic) }));
  }, [latest?.key, opacity, latest]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cx = width / 2, cy = anchorY, r = Math.min(150, height * 0.36);
  const dir = latest?.dir ?? 0;
  const a0 = ((dir - 28) * Math.PI) / 180, a1 = ((dir + 28) * Math.PI) / 180;
  const arc = `M ${cx + Math.sin(a0) * r} ${cy - Math.cos(a0) * r} A ${r} ${r} 0 0 1 ${cx + Math.sin(a1) * r} ${cy - Math.cos(a1) * r}`;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="none" testID="damage-flash">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="vig" cx="50%" cy="50%" r="70%">
            <Stop offset="0.45" stopColor={color.danger} stopOpacity="0" />
            <Stop offset="1" stopColor={color.danger} stopOpacity="0.75" />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={height / 2} r={Math.max(width, height)} fill="url(#vig)" />
        {latest?.dir != null && <Path d={arc} stroke={color.danger} strokeWidth={7} strokeLinecap="round" fill="none" />}
      </Svg>
    </Animated.View>
  );
}
