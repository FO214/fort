import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { color, radius as R } from '../theme';

interface Props extends ViewProps {
  radius?: number;
  intensity?: number;
  strong?: boolean;
  padding?: number;
  tint?: string;            // border/highlight tint for state (accent, danger)
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * A pane of frosted glass: blur what's behind, tint it, hairline edge with a
 * specular highlight along the top. Everything in the UI sits on one of these.
 */
export function Glass({ children, style, radius = R.lg, intensity = 40, strong, padding, tint, contentStyle, ...rest }: Props) {
  const border = tint ?? color.glassBorder;
  return (
    <View {...rest} style={[styles.frame, { borderRadius: radius, borderColor: border }, style]}>
      <BlurView
        intensity={intensity}
        tint="dark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: strong ? color.glassStrong : color.glass }]} />
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
        style={[StyleSheet.absoluteFill, { height: '45%' }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(255,255,255,0)', tint ?? color.glassHighlight, 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.specular}
        pointerEvents="none"
      />
      <View style={[{ padding }, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: 1 },
  specular: { position: 'absolute', top: 0, left: '12%', right: '12%', height: 1 },
});
