import React from 'react';
import { View } from 'react-native';
import type { PlayerSnap } from '../net/types';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

/** Teammates at a glance: name, health, and whether they are down. */
export function Squad({ mates, nameOf }: { mates: PlayerSnap[]; nameOf: (id: string) => string }) {
  if (mates.length === 0) return null;
  return (
    <View style={{ gap: space.xs }} testID="squad">
      {mates.map((p) => {
        const down = p.st !== 'alive';
        const frac = p.max > 0 ? p.hp / p.max : 0;
        const tint = p.st === 'knocked' ? color.warning : p.st === 'dead' ? color.ink4 : undefined;
        const bar = frac <= 0.25 ? color.danger : frac <= 0.5 ? color.warning : color.accent;
        return (
          <Glass key={p.id} radius={radius.pill} tint={tint} testID={`mate-${nameOf(p.id)}`}
            contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 10, height: 26, opacity: p.on ? 1 : 0.5 }}>
            <T v="caption" c={down ? tint : color.ink} style={{ fontWeight: '600', maxWidth: 84 }} numberOfLines={1}>{nameOf(p.id)}</T>
            {down ? (
              <T v="label" c={tint} style={{ fontSize: 10 }}>{p.st === 'knocked' ? 'down' : 'dead'}</T>
            ) : (
              <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: color.ink4, overflow: 'hidden' }}>
                <View style={{ width: `${frac * 100}%`, height: 4, backgroundColor: bar }} />
              </View>
            )}
          </Glass>
        );
      })}
    </View>
  );
}
