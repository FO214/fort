import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Candidate } from '../game/aim';
import { color, radius, space, teamColor } from '../theme';
import { Glass } from './Glass';
import { T } from './T';


/**
 * Bracket over where an enemy should be in the viewfinder, sized by range.
 * Only the primary target gets the full name pill; others get a small label
 * above the bracket so two enemies on one bearing don't stack labels.
 */
export function EnemyTag({ c, width, height, locked, teams, primary, anchorY }:
  { c: Candidate; width: number; height: number; locked: boolean; teams: boolean; primary: boolean; anchorY: number }) {
  const HFOV = width > height ? 72 : 55;    // phone main camera: wide side vs narrow side
  const half = HFOV / 2;
  const offClamped = Math.max(-half, Math.min(half, c.off));
  const edge = Math.abs(c.off) > half;
  const box = Math.max(40, Math.min(96, 1500 / Math.max(c.dist, 8)));
  const raw = width / 2 + (Math.tan((offClamped * Math.PI) / 180) / Math.tan((half * Math.PI) / 180)) * (width / 2);
  const x = Math.max(box / 2 + 16, Math.min(width - box / 2 - 16, raw));   // keep the whole bracket on screen
  const col = locked ? color.accent : c.lockable ? color.ink : edge ? color.ink3 : color.ink2;
  const team = teams ? teamColor(c.team) : color.danger;
  const y = anchorY;
  const cornerLen = Math.max(10, box * 0.22);
  const corner = (pos: 'tl' | 'tr' | 'bl' | 'br') => (
    <View key={pos} style={[styles.corner, { width: cornerLen, height: cornerLen, borderColor: col },
      pos === 'tl' && { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
      pos === 'tr' && { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 },
      pos === 'bl' && { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
      pos === 'br' && { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 }]} />
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - box / 2, top: y - box / 2, width: box, alignItems: 'center' }}
      testID={`tag-${c.name}`} accessibilityLabel={`${c.name} ${Math.round(c.dist)} m ${locked ? 'locked' : c.lockable ? 'lockable' : 'out'}`}>
      <View style={{ width: box, height: box, opacity: edge ? 0.5 : 1 }}>
        {(['tl', 'tr', 'bl', 'br'] as const).map(corner)}
        {edge && (
          <T v="headline" c={col} style={{ position: 'absolute', top: box / 2 - 11, [c.off < 0 ? 'left' : 'right']: 4 }}>
            {c.off < 0 ? '‹' : '›'}
          </T>
        )}
      </View>
      {primary ? (
        // Sits just below the reticle's outer ring regardless of bracket size.
        <Glass radius={radius.pill} tint={locked ? color.accent : undefined} style={{ marginTop: Math.max(space.md, 92 - box / 2) }}
          contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 24 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: team }} />
          <T v="caption" c={col} style={{ fontWeight: '600' }}>{c.name}</T>
          <T v="mono" c={color.ink3} style={{ fontSize: 12, lineHeight: 14 }}>{Math.round(c.dist)}m</T>
        </Glass>
      ) : (
        <View style={{ position: 'absolute', top: -18, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: team }} />
          <T v="caption" c={col} style={{ fontSize: 11, lineHeight: 13, fontWeight: '600' }}>{c.name}</T>
          <T v="mono" c={color.ink3} style={{ fontSize: 11, lineHeight: 13 }}>{Math.round(c.dist)}m</T>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ corner: { position: 'absolute' } });
