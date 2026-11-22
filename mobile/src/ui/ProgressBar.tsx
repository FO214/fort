import React, { useEffect } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { colors, radius, space } from '../theme';
import { useReducedMotion } from './motion';

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/**
 * A bar with precise ends. `value` is 0–1 and comes from the server or a
 * clock; the fill follows it with a short linear ease so ten updates a
 * second read as one movement, and it never runs ahead of the real value.
 *
 * With `segments` the bar is cut into that many blocks (ammo, health), which
 * count as well as measure.
 */
export function ProgressBar({ value, color = colors.brand.amber, track = colors.surfaceElevated, height = 8, segments, style, testID, accessibilityLabel }: {
  value: number; color?: string; track?: string; height?: number; segments?: number;
  style?: StyleProp<ViewStyle>; testID?: string; accessibilityLabel?: string;
}) {
  const v = clamp01(value);
  const a11y = { accessibilityRole: 'progressbar' as const, accessibilityLabel, accessibilityValue: { min: 0, max: 100, now: Math.round(v * 100) } };

  if (segments && segments > 0) {
    const lit = Math.round(v * segments);
    return (
      <View style={[{ flexDirection: 'row', gap: segments > 16 ? 2 : 3, height }, style]} testID={testID} {...a11y}>
        {Array.from({ length: segments }).map((_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: i < lit ? color : track, borderRadius: radius.none }} />
        ))}
      </View>
    );
  }
  return (
    <View style={[{ height, backgroundColor: track, borderRadius: radius.xs, overflow: 'hidden' }, style]} testID={testID} {...a11y}>
      <Fill value={v} color={color} />
    </View>
  );
}

function Fill({ value, color }: { value: number; color: string }) {
  const reduced = useReducedMotion();
  const w = useSharedValue(value);
  useEffect(() => {
    w.value = reduced ? value : withTiming(value, { duration: 140, easing: Easing.linear });
  }, [value, reduced, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return <Animated.View style={[{ height: '100%', backgroundColor: color }, style]} />;
}

/** A labelled bar: what it measures on the left, the reading on the right. */
export function Meter({ label, reading, children }: { label: React.ReactNode; reading?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[1], alignSelf: 'stretch' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[3] }}>
        {label}{reading}
      </View>
      {children}
    </View>
  );
}
