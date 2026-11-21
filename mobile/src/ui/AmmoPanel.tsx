import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

/** Rounds left in the magazine, big enough to read at arm's length. */
export function AmmoPanel({ ammo, magazine, reloadingUntil, reloadS, now }:
  { ammo: number; magazine: number; reloadingUntil: number; reloadS: number; now: number }) {
  const reloading = reloadingUntil > now;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reloading) return;
    const id = setInterval(() => tick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [reloading]);
  const frac = reloading ? 1 - Math.max(0, reloadingUntil - now) / Math.max(0.1, reloadS) : 0;
  const low = !reloading && ammo <= Math.max(1, Math.floor(magazine * 0.2));
  const c = reloading ? color.accent : low ? color.warning : color.ink;
  return (
    <Glass radius={radius.lg} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs, minWidth: 128 }} testID="ammo-panel">
      <T v="label" c={color.ink3}>{reloading ? 'Reloading' : 'Ammo'}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
        <T v="monoBig" c={c} testID="ammo" style={{ fontSize: 34, lineHeight: 36 }}>{reloading ? '··' : ammo}</T>
        <T v="mono" c={color.ink3}>/{magazine}</T>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: color.ink4, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${(reloading ? frac : magazine ? ammo / magazine : 0) * 100}%`, backgroundColor: c }} />
      </View>
    </Glass>
  );
}
