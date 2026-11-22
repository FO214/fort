/**
 * The FORTIRL marks as components. Geometry lives in geometry.ts.
 * One flat colour each: no gradient, bevel, shadow or outline.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';
import { colors, space } from '../theme';
import { T } from '../ui/T';
import { BRAND, FORMATION, FORMATION_MICRO, MARK_SIZE, WORDMARK } from './geometry';

/** Below this the blades close up, so the simplified mark takes over. */
const MICRO_BELOW = 22;

/** The Formation insignia. */
export function FormationMark({ size = 48, color = colors.brand.amber, testID }: { size?: number; color?: string; testID?: string }) {
  const segments = size < MICRO_BELOW ? FORMATION_MICRO : FORMATION;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`} testID={testID}
      accessibilityRole="image" accessibilityLabel={`${BRAND.name} insignia`}>
      {segments.map((points, i) => <Polygon key={i} points={points} fill={color} />)}
    </Svg>
  );
}

/** The FORTIRL lettering. `height` is the cap height. */
export function Wordmark({ height = 44, color = colors.textPrimary, testID }: { height?: number; color?: string; testID?: string }) {
  return (
    <Svg height={height} width={(height * WORDMARK.width) / WORDMARK.height} viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}
      testID={testID} accessibilityRole="image" accessibilityLabel={BRAND.name}>
      <Path d={WORDMARK.d} fill={color} fillRule="evenodd" />
    </Svg>
  );
}

/** Primary lockup: insignia over wordmark, tagline optional. */
export function Lockup({ scale = 1, tagline = false, testID }: { scale?: number; tagline?: boolean; testID?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space[4] * scale }} testID={testID}>
      <FormationMark size={92 * scale} />
      <Wordmark height={50 * scale} />
      {tagline ? <T v="tagline" c={colors.textPrimary} style={{ marginTop: -space[1] }}>{BRAND.tagline}</T> : null}
    </View>
  );
}
