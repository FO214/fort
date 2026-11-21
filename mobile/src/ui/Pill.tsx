import React from 'react';
import { View, ViewStyle } from 'react-native';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

export function Pill({ label, value, tint, mono, style, testID }:
  { label?: string; value?: string; tint?: string; mono?: boolean; style?: ViewStyle; testID?: string }) {
  return (
    <Glass radius={radius.pill} tint={tint} style={style} testID={testID}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 30 }}>
      {label ? <T v="label" c={tint ?? color.ink3}>{label}</T> : null}
      {value ? <T v={mono ? 'mono' : 'caption'} c={tint ?? color.ink} style={{ fontWeight: '600' }}>{value}</T> : null}
    </Glass>
  );
}

export function Dot({ c, size = 8 }: { c: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c }} />;
}
