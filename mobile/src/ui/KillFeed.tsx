import React from 'react';
import { View } from 'react-native';
import type { FeedItem } from '../store';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

export function KillFeed({ items }: { items: FeedItem[] }) {
  return (
    <View style={{ gap: space.xs }} testID="killfeed">
      {items.slice(-4).map((it) => {
        const tint = it.mine === 'kill' ? color.accent : it.mine === 'death' ? color.danger : undefined;
        return (
          <Glass key={it.key} radius={radius.pill} tint={tint}
            contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 26 }}>
            <T v="caption" c={it.mine === 'kill' ? color.accent : color.ink} style={{ fontWeight: '600' }}>{it.shooter}</T>
            <T v="caption" c={color.ink3}>›</T>
            <T v="caption" c={it.mine === 'death' ? color.danger : color.ink2}>{it.target}</T>
          </Glass>
        );
      })}
    </View>
  );
}
