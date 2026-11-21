import React from 'react';
import { View } from 'react-native';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

export function HealthBar({ hp, max, label }: { hp: number; max: number; label?: string }) {
  const frac = max > 0 ? hp / max : 0;
  const fill = frac <= 0.2 ? color.danger : frac <= 0.45 ? color.warning : color.ink;
  return (
    <Glass radius={radius.md} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs, minWidth: 128 }} testID="healthbar">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T v="label" c={color.ink3}>{label ?? 'Health'}</T>
        <T v="mono" c={fill} testID="hp">{hp}<T v="caption" c={color.ink3}>/{max}</T></T>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: max }).map((_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < hp ? fill : color.ink4 }} />
        ))}
      </View>
    </Glass>
  );
}
