import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { HudPanel } from './HudPanel';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { T } from './T';

/**
 * Bottom-left: rounds in the magazine, big enough to read off the blaster.
 *
 *   normal     the count over the magazine size, and a bar with one block per round
 *   low        an amber LOW AMMO tag joins it (a fifth of the magazine or less)
 *   empty      the count goes red and the tag reads EMPTY — RELOAD
 *   reloading  the bar becomes the reload's progress and the tag says so
 */
export function AmmoReadout({ ammo, magazine, reloadingUntil, reloadS, now }:
  { ammo: number; magazine: number; reloadingUntil: number; reloadS: number; now: number }) {
  const reloading = reloadingUntil > now;
  // The reload bar needs finer steps than the HUD clock gives it.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reloading) return;
    const id = setInterval(() => tick((t) => t + 1), 60);
    return () => clearInterval(id);
  }, [reloading]);
  const progress = reloading ? 1 - Math.max(0, reloadingUntil - now) / Math.max(0.1, reloadS) : 0;
  const empty = !reloading && ammo <= 0;
  const low = !reloading && !empty && ammo <= Math.max(1, Math.floor(magazine * 0.2));
  const tint = empty ? colors.status.danger : low ? colors.brand.amber : colors.status.ammo;
  const tag = reloading ? { label: 'Reloading', color: colors.textPrimary, icon: 'reload' as const }
    : empty ? { label: 'Empty. Reload.', color: colors.status.danger, icon: 'warning' as const }
    : low ? { label: 'Low ammo', color: colors.brand.amber, icon: 'warning' as const }
    : null;
  return (
    <HudPanel strong contentStyle={styles.panel} testID="ammo-panel"
      accessibilityLabel={reloading ? 'Reloading' : `${ammo} of ${magazine} rounds${empty ? ', empty' : low ? ', low' : ''}`}>
      <View style={styles.tag}>
        {tag ? (
          <>
            <Icon name={tag.icon} size={14} color={tag.color} />
            <T v="hudMicro" c={colors.textPrimary}>{tag.label}</T>
          </>
        ) : <T v="hudMicro" c={colors.textSecondary}>Ammo</T>}
      </View>
      <View style={styles.count}>
        <T v="hudAmmo" c={reloading ? colors.textSecondary : tint} testID="ammo">{ammo}</T>
        <T v="hudValue" c={colors.textSecondary} style={{ marginBottom: 5 }}>/ {magazine}</T>
      </View>
      {reloading
        ? <ProgressBar value={progress} color={colors.textPrimary} track={colors.border} height={7} accessibilityLabel="Reload progress" testID="reload-bar" />
        : <ProgressBar value={magazine ? ammo / magazine : 0} segments={magazine} color={tint} track={colors.border} height={7} accessibilityLabel="Magazine" />}
    </HudPanel>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2], minWidth: 168, gap: 3 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: space[1], height: 16 },
  count: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
});
