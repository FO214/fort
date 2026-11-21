import React from 'react';
import { View } from 'react-native';
import type { FeedItem } from '../store';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

/** Short-lived squad news: waves, knocks, revives. Two lines at most, so the
 * column never grows into the ammo panel on a short landscape screen. */
export function KillFeed({ items, now }: { items: FeedItem[]; now: number }) {
  return (
    <View style={{ gap: space.xs }} testID="feed">
      {items.filter((it) => now - it.at < 6).slice(-2).map((it) => {
        const tint = it.tone === 'good' ? color.accent : it.tone === 'bad' ? color.danger : undefined;
        return (
          <Glass key={it.key} radius={radius.pill} tint={tint}
            contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 26 }}>
            <T v="caption" c={tint ?? color.ink} style={{ fontWeight: '600' }}>{it.text}</T>
            {it.detail ? <T v="caption" c={color.ink2}>{it.detail}</T> : null}
          </Glass>
        );
      })}
    </View>
  );
}
