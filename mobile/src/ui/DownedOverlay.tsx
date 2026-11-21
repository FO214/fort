import React from 'react';
import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

/**
 * Covers the view when this player is out of the fight.
 * Knocked: the bleed-out bar drains each time a zombie bites, and a
 * teammate's revive shows as it progresses. Dead: out for the mission.
 */
export function DownedOverlay({ state, bleed, reviveBy, reviveProgress }: {
  state: 'knocked' | 'dead'; bleed: number; reviveBy: string | null; reviveProgress: number;
}) {
  const dead = state === 'dead';
  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" testID={dead ? 'dead' : 'knocked'}>
      <Glass radius={radius.xl} tint={dead ? color.ink3 : color.danger} padding={space.lg}
        contentStyle={{ alignItems: 'center', gap: space.sm, width: 320 }}>
        <T v="label" c={dead ? color.ink2 : color.danger}>{dead ? 'Dead' : 'Knocked'}</T>
        {dead ? (
          <T v="body" c={color.ink2} style={{ textAlign: 'center' }}>You're out for this mission. The squad carries on.</T>
        ) : (
          <>
            <T v="body" c={color.ink} style={{ textAlign: 'center' }} testID="knocked-status">
              {reviveBy ? `${reviveBy} is reviving you` : 'A teammate must clear the zombies and revive you'}
            </T>
            <View style={{ alignSelf: 'stretch', gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="label" c={color.ink3}>Bleed-out</T>
                <T v="mono" c={bleed <= 0.34 ? color.danger : color.ink2} testID="bleed" style={{ fontSize: 13 }}>{Math.round(bleed * 100)}%</T>
              </View>
              <View style={styles.track}><View style={{ height: 6, width: `${bleed * 100}%`, backgroundColor: color.danger }} /></View>
            </View>
            {reviveBy ? (
              <View style={{ alignSelf: 'stretch', gap: 4 }}>
                <T v="label" c={color.accent}>Revive</T>
                <View style={styles.track}><View style={{ height: 6, width: `${reviveProgress * 100}%`, backgroundColor: color.accent }} /></View>
              </View>
            ) : null}
          </>
        )}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(40,6,6,0.5)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  track: { height: 6, borderRadius: 3, backgroundColor: color.ink4, overflow: 'hidden' },
});
