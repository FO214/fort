import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { angleDiffDeg, bearingXY, distXY } from '../game/geo';
import type { MissionState } from '../net/types';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

/**
 * What the squad should be doing right now, top centre.
 *   journey  → which way the helicopter is and how far
 *   holdout  → which wave of the hold this is
 *   final    → the extraction bar and how many are on the helicopter
 */
export function ObjectiveBar({ mission, extract, me, heli, nameOf }: {
  mission: MissionState;
  extract: { progress: number; need: number; holders: string[] };
  me: { x: number; y: number; heading: number | null };
  heli: { x: number; y: number } | null | undefined;
  nameOf: (id: string) => string;
}) {
  if (mission.phase === 'journey') {
    const dist = heli ? distXY(me.x, me.y, heli.x, heli.y) : null;
    // How far to turn: 0 is straight ahead, positive is to the right.
    const turn = heli && me.heading != null ? angleDiffDeg(bearingXY(me.x, me.y, heli.x, heli.y), me.heading) : null;
    return (
      <Glass radius={radius.pill} tint={color.warning} testID="objective"
        contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 38 }}>
        {turn != null && (
          <View style={{ transform: [{ rotate: `${turn}deg` }] }} testID="heli-arrow">
            <Svg width={18} height={18} viewBox="0 0 18 18">
              <Path d="M 9 1.5 L 15 14 L 9 11 L 3 14 Z" fill={color.warning} />
            </Svg>
          </View>
        )}
        <T v="label" c={color.warning}>Helicopter</T>
        <T v="mono" c={color.ink} testID="heli-dist" style={{ fontSize: 15 }}>{dist == null ? '–' : `${Math.round(dist)} m`}</T>
      </Glass>
    );
  }

  if (mission.phase === 'holdout') {
    const [done, total] = mission.hold ?? [0, 2];
    return (
      <Glass radius={radius.pill} tint={color.accent} testID="objective"
        contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 38 }}>
        <T v="label" c={color.accent}>Hold the helicopter</T>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={{ width: 18, height: 6, borderRadius: 3, backgroundColor: i < done ? color.accent : color.ink4 }} />
          ))}
        </View>
        <T v="mono" c={color.ink} testID="hold-count" style={{ fontSize: 15 }}>{Math.min(done + 1, total)}/{total}</T>
      </Glass>
    );
  }

  const holding = extract.holders.length;
  const enough = holding >= extract.need;
  const who = extract.holders.map(nameOf).join(' + ');
  return (
    <Glass radius={radius.lg} tint={enough ? color.accent : color.danger} testID="objective"
      contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: 6, minWidth: 260 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }}>
        <T v="label" c={enough ? color.accent : color.danger}>{enough ? 'Extracting' : 'Final wave · extract'}</T>
        <T v="mono" c={color.ink} testID="extract-holders" style={{ fontSize: 13 }}>{holding}/{extract.need} holding</T>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: color.ink4, overflow: 'hidden' }} testID="extract-bar"
        accessibilityLabel={`extraction ${Math.round(extract.progress * 100)} percent`}>
        <View style={{ height: 6, width: `${extract.progress * 100}%`, backgroundColor: enough ? color.accent : color.ink2 }} />
      </View>
      <T v="caption" c={color.ink2} numberOfLines={1}>
        {holding === 0 ? `${extract.need > 1 ? `${extract.need} players` : 'Someone'} must aim at the helicopter code and hold`
          : enough ? `${who} on the helicopter. Cover them.`
          : `${who} is holding. One more needed.`}
      </T>
    </Glass>
  );
}
