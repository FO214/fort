import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { borders, colors, materials, radius as R } from '../theme';

/**
 * Surfaces for the gameplay HUD, where the camera has to stay visible.
 *
 *   backing  a dark plate behind one or two lines of critical text. No blur:
 *            it is cheap and it is always readable, on a white wall or in a
 *            dark corridor.
 *   glass    selective dark glass for the few panels with real area (the
 *            minimap, hold actions, the menu). Blurs what is behind it where
 *            the platform does that well, and falls back to an opaque plate
 *            where it does not.
 *
 * HUD framing is square. Nothing here is a rounded card.
 */
const CAN_BLUR = Platform.OS === 'ios' || Platform.OS === 'web';

export function HudPanel({ children, material = 'backing', strong, radius = R.xs, accent, style, contentStyle, ...rest }: ViewProps & {
  material?: 'backing' | 'glass';
  /** A heavier plate, for bright scenes and multi-line panels. */
  strong?: boolean;
  radius?: number;
  /** A coloured edge on the left: objective amber, danger red. */
  accent?: string;
  style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>;
}) {
  const glass = material === 'glass';
  const blur = glass && CAN_BLUR;
  return (
    <View {...rest}
      style={[
        styles.frame,
        { borderRadius: radius },
        glass ? { borderWidth: borders.thin, borderColor: materials.glass.borderColor } : null,
        !blur && { backgroundColor: glass ? materials.glass.fallback : strong ? colors.camera.backingStrong : colors.camera.backing },
        style,
      ]}>
      {blur ? (
        <>
          {/* The blur carries the radius itself: a parent's rounded clip does not always clip a backdrop blur. */}
          <BlurView intensity={materials.glass.intensity} tint={materials.glass.tint} style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: materials.glass.overlay, borderRadius: radius }]} />
        </>
      ) : null}
      {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
});
