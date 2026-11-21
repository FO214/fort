import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { color } from '../theme';
import { T } from './T';

const SIZE = 100;
const R = SIZE / 2 - 5;
const CIRC = 2 * Math.PI * R;

/** The trigger. Ring = magazine; sweeps back while reloading. */
export function FireButton({ ammo, magazine, reloadingUntil, reloadS, locked, disabled, onDown, onUp, now }:
  { ammo: number; magazine: number; reloadingUntil: number; reloadS: number; locked: boolean; disabled?: boolean;
    onDown: () => void; onUp: () => void; now: number }) {
  const reloading = reloadingUntil > now;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reloading) return;
    const id = setInterval(() => tick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [reloading]);
  const frac = reloading ? 1 - Math.max(0, reloadingUntil - now) / Math.max(0.1, reloadS) : magazine ? ammo / magazine : 0;
  const ring = reloading ? color.accent : locked ? color.accent : color.ink;
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // react-native-web only raises onPressIn for a held pointer; an instant
  // click or tap arrives as onPress alone. Treat that as one trigger pull.
  const sawPressIn = useRef(false);
  return (
    <Animated.View style={[anim, disabled && { opacity: 0.45 }]}>
      <Pressable
        testID="fire"
        accessibilityRole="button"
        accessibilityLabel="Fire"
        disabled={disabled}
        onPressIn={() => { sawPressIn.current = true; scale.value = withSpring(0.92, { damping: 16, stiffness: 400 }); onDown(); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 16, stiffness: 400 }); onUp(); }}
        onPress={() => { if (!sawPressIn.current) { onDown(); onUp(); } sawPressIn.current = false; }}
        style={styles.wrap}
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: locked ? color.accentDim : color.glassStrong }]} />
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={color.ink4} strokeWidth={3} fill="none" />
          <Circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={ring} strokeWidth={3} fill="none" strokeLinecap="round"
            strokeDasharray={`${CIRC * frac} ${CIRC}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <T v="headline" c={locked ? color.accent : color.ink} style={{ fontSize: 20, letterSpacing: 2, fontWeight: '700' }}>
          {reloading ? '···' : 'FIRE'}
        </T>
        <T v="label" c={locked ? color.accent : color.ink3} style={{ marginTop: 2 }}>{locked ? 'locked' : reloading ? 'reload' : ' '}</T>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: color.glassBorder },
});
