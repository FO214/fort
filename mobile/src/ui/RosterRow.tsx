import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Identity } from '../game/identity';
import type { GunLink } from '../store';
import { colors, space } from '../theme';
import { Icon } from './Icon';
import { PlayerMarker } from './PlayerMarker';
import { T } from './T';

/**
 * One player in the lobby: who they are, what they carry, and whether they
 * are ready. Readiness is a word and an icon as well as a colour.
 *
 * `gun` is only known for this phone's own player (the server does not share
 * anyone else's), so it is only shown on their own row.
 */
export function RosterRow({ name, identity, className, ready, connected, host, me, gun }: {
  name: string; identity: Identity; className: string; ready: boolean; connected: boolean; host: boolean; me: boolean; gun?: GunLink;
}) {
  const status = !connected ? { icon: 'offline' as const, label: 'Offline', tint: colors.status.danger, text: colors.status.dangerText }
    : ready ? { icon: 'ready' as const, label: 'Ready', tint: colors.status.health, text: colors.status.health }
    : { icon: 'notReady' as const, label: 'Not ready', tint: colors.status.neutral, text: colors.status.neutral };
  return (
    <View style={styles.row} testID={`player-${name}`}
      accessibilityLabel={`${name}${me ? ', you' : ''}${host ? ', host' : ''}, ${className}, ${status.label}`}>
      <PlayerMarker identity={identity} size={30} dim={!connected} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <T v="bodyStrong" c={connected ? colors.textPrimary : colors.textMuted} numberOfLines={1} style={{ flexShrink: 1 }}>{name}</T>
          {host ? <Icon name="host" size={18} color={colors.brand.amber} /> : null}
          {me ? <T v="label" c={colors.textMuted}>You</T> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <T v="label" c={colors.textSecondary}>{className}</T>
          {me && gun === 'paired' ? (
            <>
              <T v="label" c={colors.textMuted}>·</T>
              <Icon name="pairing" size={14} color={colors.textSecondary} />
              <T v="label" c={colors.textSecondary}>Gun paired</T>
            </>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <T v="overline" c={status.text}>{status.label}</T>
        <Icon name={status.icon} size={18} color={status.tint} />
      </View>
    </View>
  );
}

/** The places in the squad nobody has taken yet, as one line. */
export function OpenSlot({ identity, count = 1 }: { identity: Identity; count?: number }) {
  return (
    <View style={[styles.row, styles.open]} testID="open-slots">
      <PlayerMarker identity={{ ...identity, color: colors.border }} size={30} numbered={false} />
      <T v="label" c={colors.textMuted} style={{ flex: 1 }}>{count === 1 ? '1 open slot' : `${count} open slots`}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 54, paddingVertical: space[1] + 2 },
  open: { minHeight: 44, opacity: 0.6 },
});
