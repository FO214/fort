import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon, Rect } from 'react-native-svg';
import type { Identity, MarkerShape } from '../game/identity';
import { colors, fonts } from '../theme';

/** The shape on a 24-unit grid, as an SVG element. Also used inside map drawings. */
export function markerShape(shape: MarkerShape, fill: string, stroke?: string, strokeWidth = 0) {
  const common = { fill, stroke, strokeWidth, strokeLinejoin: 'miter' as const };
  switch (shape) {
    case 'diamond': return <Polygon points="12,2 22,12 12,22 2,12" {...common} />;
    case 'circle': return <Circle cx={12} cy={12} r={9.5} {...common} />;
    case 'square': return <Rect x={3.5} y={3.5} width={17} height={17} {...common} />;
    default: return <Polygon points="12,2.5 22.5,20.5 1.5,20.5" {...common} />;
  }
}

/**
 * A player's identity marker: their colour in their shape, with their slot
 * number inside once it is big enough to read. `dim` is for a player who is
 * not connected.
 *
 * The number is ordinary text laid over the drawing, not text inside the
 * SVG, so it is set in the display face on every platform.
 */
export function PlayerMarker({ identity, size = 28, numbered = size >= 22, dim }:
  { identity: Identity; size?: number; numbered?: boolean; dim?: boolean }) {
  const triangle = identity.shape === 'triangle';
  return (
    <View style={{ width: size, height: size, opacity: dim ? 0.4 : 1 }} accessibilityLabel={`Player ${identity.slot + 1}`}>
      <Svg width={size} height={size} viewBox="0 0 24 24">{markerShape(identity.shape, identity.color)}</Svg>
      {numbered ? (
        <View style={[StyleSheet.absoluteFill, styles.centre, triangle && { paddingTop: size * 0.2 }]} pointerEvents="none">
          <Text allowFontScaling={false} style={{ fontFamily: fonts.displayBlack, fontSize: size * (triangle ? 0.44 : 0.52), lineHeight: size * 0.6, color: colors.background }}>
            {identity.slot + 1}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
