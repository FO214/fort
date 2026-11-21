import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import type { PlayerPub, SensorFix } from '../net/types';
import { bearingDeg, haversineM } from '../game/geo';
import { color, teamColor } from '../theme';
import { isEnemy } from '../game/aim';

/** You at the centre pointing up; everyone else placed by bearing and range. */
export function Radar({ me, fix, players, rangeM, mode, size = 132 }:
  { me: PlayerPub; fix: SensorFix | null; players: PlayerPub[]; rangeM: number; mode: 'ffa' | 'teams'; size?: number }) {
  const c = size / 2;
  const rMax = c - 8;
  const heading = fix?.heading ?? 0;
  const dots = fix ? players.filter((p) => p.id !== me.id && p.lat != null && p.lon != null).map((p) => {
    const dist = haversineM(fix.lat, fix.lon, p.lat!, p.lon!);
    const rel = ((bearingDeg(fix.lat, fix.lon, p.lat!, p.lon!) - heading) * Math.PI) / 180;
    const r = (Math.min(dist, rangeM) / rangeM) * rMax;
    const enemy = isEnemy(me, p, mode);
    const col = !p.alive ? color.ink4 : mode === 'teams' ? teamColor(p.team) : enemy ? color.danger : color.accent;
    return { id: p.id, x: c + Math.sin(rel) * r, y: c - Math.cos(rel) * r, col, clamped: dist > rangeM, name: p.name };
  }) : [];
  const northA = ((-heading) * Math.PI) / 180;
  return (
    <View testID="radar">
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={rMax} fill="rgba(255,255,255,0.05)" stroke={color.glassBorder} strokeWidth={1} />
        <Circle cx={c} cy={c} r={rMax / 2} fill="none" stroke={color.ink4} strokeWidth={1} strokeDasharray="2 4" />
        <Line x1={c} y1={c - rMax} x2={c} y2={c + rMax} stroke={color.ink4} strokeWidth={0.5} />
        <Line x1={c - rMax} y1={c} x2={c + rMax} y2={c} stroke={color.ink4} strokeWidth={0.5} />
        <G transform={`translate(${c + Math.sin(northA) * (rMax - 7)} ${c - Math.cos(northA) * (rMax - 7)})`}>
          <SvgText fill={color.ink2} fontSize={9} fontWeight="700" textAnchor="middle" y={3}>N</SvgText>
        </G>
        {dots.map((d) => (
          <G key={d.id}>
            <Circle cx={d.x} cy={d.y} r={d.clamped ? 3 : 4.5} fill={d.col} opacity={d.clamped ? 0.5 : 1} />
            {!d.clamped && <Circle cx={d.x} cy={d.y} r={8} fill="none" stroke={d.col} strokeWidth={1} opacity={0.35} />}
          </G>
        ))}
        <Path d={`M ${c} ${c - 8} L ${c + 5.5} ${c + 6} L ${c} ${c + 3} L ${c - 5.5} ${c + 6} Z`} fill={color.ink} />
        <SvgText x={c} y={size - 3} fill={color.ink3} fontSize={9} textAnchor="middle" fontWeight="600">{Math.round(rangeM)} m</SvgText>
      </Svg>
    </View>
  );
}
