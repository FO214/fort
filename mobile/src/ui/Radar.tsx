import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { bearingXY, distXY } from '../game/geo';
import type { PlayerSnap, ZombieRow } from '../net/types';
import { color, font } from '../theme';

export interface RadarView { x: number; y: number; heading: number | null }

/**
 * The minimap for now: you at the centre with the gun pointing up, zombies in
 * red, the squad in mint, the helicopter as a yellow H. Anything further than
 * `rangeM` is pinned to the rim. A real floor plan replaces this in step 5.
 */
export function Radar({ me, myId, squad, zombies, heli, rangeM = 30, size = 132 }: {
  me: RadarView; myId: string | undefined; squad: PlayerSnap[]; zombies: ZombieRow[];
  heli?: { x: number; y: number } | null; rangeM?: number; size?: number;
}) {
  const c = size / 2;
  const rMax = c - 8;
  const heading = me.heading ?? 0;
  const place = (x: number, y: number) => {
    const dist = distXY(me.x, me.y, x, y);
    const rel = ((bearingXY(me.x, me.y, x, y) - heading) * Math.PI) / 180;
    const r = (Math.min(dist, rangeM) / rangeM) * rMax;
    return { x: c + Math.sin(rel) * r, y: c - Math.cos(rel) * r, far: dist > rangeM };
  };
  const northA = (-heading * Math.PI) / 180;
  const h = heli ? place(heli.x, heli.y) : null;
  return (
    <View testID="radar">
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={rMax} fill="rgba(255,255,255,0.05)" stroke={color.glassBorder} strokeWidth={1} />
        <Circle cx={c} cy={c} r={rMax / 2} fill="none" stroke={color.ink4} strokeWidth={1} strokeDasharray="2 4" />
        <Line x1={c} y1={c - rMax} x2={c} y2={c + rMax} stroke={color.ink4} strokeWidth={0.5} />
        <Line x1={c - rMax} y1={c} x2={c + rMax} y2={c} stroke={color.ink4} strokeWidth={0.5} />
        <G transform={`translate(${c + Math.sin(northA) * (rMax - 7)} ${c - Math.cos(northA) * (rMax - 7)})`}>
          <SvgText fill={color.ink2} fontSize={9} fontWeight="700" fontFamily={font.family} textAnchor="middle" y={3}>N</SvgText>
        </G>
        {h && (
          <G opacity={h.far ? 0.7 : 1}>
            <Rect x={h.x - 6} y={h.y - 6} width={12} height={12} rx={3} fill={color.warning} />
            <SvgText x={h.x} y={h.y + 3.2} fill={color.onAccent} fontSize={9} fontWeight="800" fontFamily={font.family} textAnchor="middle">H</SvgText>
          </G>
        )}
        {zombies.map((z) => {
          const d = place(z[2], z[3]);
          return <Circle key={`z${z[0]}`} cx={d.x} cy={d.y} r={d.far ? 2.2 : 3.2} fill={color.danger} opacity={d.far ? 0.55 : 1} />;
        })}
        {squad.filter((p) => p.id !== myId).map((p) => {
          const d = place(p.x, p.y);
          const col = p.st === 'alive' ? color.accent : p.st === 'knocked' ? color.warning : color.ink4;
          return (
            <G key={p.id}>
              <Circle cx={d.x} cy={d.y} r={4.5} fill={col} opacity={d.far ? 0.6 : 1} />
              {p.st === 'knocked' && <Circle cx={d.x} cy={d.y} r={8} fill="none" stroke={col} strokeWidth={1.2} opacity={0.7} />}
            </G>
          );
        })}
        <Path d={`M ${c} ${c - 8} L ${c + 5.5} ${c + 6} L ${c} ${c + 3} L ${c - 5.5} ${c + 6} Z`} fill={color.ink} />
        <SvgText x={c} y={size - 3} fill={color.ink3} fontSize={9} fontFamily={font.family} textAnchor="middle" fontWeight="600">{Math.round(rangeM)} m</SvgText>
      </Svg>
    </View>
  );
}
