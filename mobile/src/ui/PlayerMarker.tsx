import React from 'react';
import Svg, { Circle, Polygon, Rect, Text as SvgText } from 'react-native-svg';
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
 */
export function PlayerMarker({ identity, size = 28, numbered = size >= 22, dim }:
  { identity: Identity; size?: number; numbered?: boolean; dim?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={dim ? 0.4 : 1}
      accessibilityLabel={`Player ${identity.slot + 1}`}>
      {markerShape(identity.shape, identity.color)}
      {numbered ? (
        <SvgText x={12} y={identity.shape === 'triangle' ? 18.4 : 16.3} textAnchor="middle" fontFamily={fonts.displayBlack}
          fontSize={identity.shape === 'triangle' ? 10.5 : 12.5} fill={colors.background}>
          {identity.slot + 1}
        </SvgText>
      ) : null}
    </Svg>
  );
}
