import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useStore } from '../store';
import { colors, space } from '../theme';
import { Button } from '../ui/Button';
import { HudPanel } from '../ui/HudPanel';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { T } from '../ui/T';

/** After this long without the server, say so plainly and offer the way out. */
const GIVE_UP_HINT_S = 12;

/** Seconds the link has been down, 0 while it is up. Ticks once a second. */
export function useOutage(): number {
  const lostAt = useStore((s) => s.lostAt);
  const connection = useStore((s) => s.connection);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!lostAt) return;
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [lostAt]);
  return lostAt && connection !== 'open' ? Math.max(0, Date.now() / 1000 - lostAt) : 0;
}

/**
 * The lobby and results line: a quiet "reconnecting" that stays until the
 * link is back. The mission itself is safe on the server meanwhile.
 */
export function ConnectionBanner() {
  const down = useOutage();
  const connection = useStore((s) => s.connection);
  if (connection === 'open' || connection === 'idle') return null;
  return (
    <StatusChip busy tone="warn" testID="connection"
      label={down > GIVE_UP_HINT_S ? 'Still reconnecting. Check your Wi-Fi.' : 'Reconnecting to the server'} />
  );
}

/**
 * In a mission, a dropped link first shows as a status hint. If it stays
 * down, this takes the centre of the screen: the mission carries on without
 * this phone, it will rejoin where the mission is, and the player may leave.
 */
export function ConnectionOverlay({ onLeave }: { onLeave: () => void }) {
  const down = useOutage();
  if (down < GIVE_UP_HINT_S) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]} pointerEvents="box-none" testID="connection-lost">
      <HudPanel material="glass" accent={colors.brand.amber} contentStyle={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <Icon name="offline" size={30} color={colors.brand.amber} />
          <View style={{ flex: 1 }}>
            <T v="hudTitle">Connection lost</T>
            <T v="hudSecondary" c={colors.textSecondary}>Trying again. You will rejoin the mission where it is now.</T>
          </View>
          <Spinner size={24} color={colors.brand.amber} />
        </View>
        <Button label="Leave mission" size="md" icon="leave" onPress={onLeave} testID="connection-leave" />
      </HudPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: space[6] },
  card: { padding: space[4], gap: space[4], width: 420, maxWidth: '100%' },
});
