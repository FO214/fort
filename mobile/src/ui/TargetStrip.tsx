import React from 'react';
import { Pressable, View } from 'react-native';
import type { PlayerPub } from '../net/types';
import { color, radius, space, teamColor } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

/** Indoors there's no bearing to aim by: pick who you're shooting at. */
export function TargetStrip({ enemies, selected, onSelect, teams }:
  { enemies: PlayerPub[]; selected: string | null; onSelect: (id: string) => void; teams: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' }} testID="targets">
      {enemies.map((p) => {
        const on = p.id === selected;
        return (
          <Pressable key={p.id} onPress={() => onSelect(p.id)} disabled={!p.alive} testID={`target-${p.name}`}
            accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Glass radius={radius.pill} tint={on ? color.accent : undefined} strong={on}
              contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 40, opacity: p.alive ? 1 : 0.4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: teams ? teamColor(p.team) : color.danger }} />
              <T v="headline" c={on ? color.accent : color.ink}>{p.name}</T>
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {Array.from({ length: p.max_hp }).map((_, i) => (
                  <View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: i < p.hp ? (on ? color.accent : color.ink2) : color.ink4 }} />
                ))}
              </View>
            </Glass>
          </Pressable>
        );
      })}
    </View>
  );
}
