import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { color, radius, space } from '../theme';
import { T } from './T';

/**
 * A button that only counts while it is held down. The bar along the bottom
 * shows how far the thing you are holding for has got.
 */
export function HoldButton({ label, detail, progress, tint, holding, onHold, testID, width = 248 }: {
  label: string; detail?: string; progress: number; tint: string; holding: boolean;
  onHold: (down: boolean) => void; testID?: string; width?: number;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: holding }}
      onPressIn={() => onHold(true)}
      onPressOut={() => onHold(false)}
      // Stay "pressed" if the thumb drifts while aiming.
      pressRetentionOffset={{ top: 60, bottom: 60, left: 60, right: 60 }}
      style={[styles.wrap, { width, borderColor: tint, transform: [{ scale: holding ? 0.97 : 1 }] }]}
    >
      <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: radius.lg }]}
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: holding ? 'rgba(255,255,255,0.16)' : color.glassStrong }]} />
      <T v="headline" c={tint} style={{ fontWeight: '700', letterSpacing: 0.4 }} numberOfLines={1}>{label}</T>
      {detail ? <T v="caption" c={color.ink2} numberOfLines={1}>{detail}</T> : null}
      <View style={styles.track}>
        <View style={{ height: 5, width: `${Math.max(0, Math.min(1, progress)) * 100}%`, backgroundColor: tint }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 64, borderRadius: radius.lg, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm + 5, gap: 2,
  },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: color.ink4 },
});
