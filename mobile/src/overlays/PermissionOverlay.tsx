import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Grant, PermissionKey, PermissionState } from '../game/permissions';
import { borders, colors, radius, space } from '../theme';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { T } from '../ui/T';

const ITEMS: { key: PermissionKey; icon: IconName; name: string; why: string; optional?: boolean }[] = [
  { key: 'camera', icon: 'camera', name: 'Camera', why: 'Shows the room behind the display, so zombies appear where you are standing.' },
  { key: 'location', icon: 'location', name: 'Location', why: 'Places you on the building map, so the squad and the zombies line up for everyone.' },
  { key: 'motion', icon: 'motion', name: 'Motion', why: 'Follows where your blaster points and counts your steps between GPS fixes.', optional: true },
];

const STATUS: Record<Grant, { label: string; icon: IconName; tint: string }> = {
  granted: { label: 'Allowed', icon: 'check', tint: colors.status.health },
  denied: { label: 'Blocked', icon: 'close', tint: colors.status.danger },
  undetermined: { label: 'Needed', icon: 'notReady', tint: colors.status.neutral },
};

/**
 * The briefing before the OS asks. Says what each permission is for, then
 * asks, one after another. If something was refused for good, it says so and
 * sends the player to Settings, which is the only place that can undo it.
 */
export function PermissionOverlay({ state, onAllow, onOpenSettings, onLeave }: {
  state: PermissionState; onAllow: () => Promise<void>; onOpenSettings: () => void; onLeave?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const allow = async () => { setAsking(true); try { await onAllow(); } finally { setAsking(false); } };
  return (
    <Sheet title="Before you deploy" testID="permissions">
      <T v="body" c={colors.textSecondary}>FortIRL plays in the room you are standing in. It needs three things from your phone to do that.</T>
      <View style={{ gap: space[3] }}>
        {ITEMS.map((it) => {
          const st = STATUS[state[it.key]];
          return (
            <View key={it.key} style={styles.item} testID={`perm-${it.key}`}>
              <Icon name={it.icon} size={24} color={colors.textPrimary} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                  <T v="overline" style={{ flex: 1 }}>{it.name}{it.optional ? '  ·  optional' : ''}</T>
                  <Icon name={st.icon} size={14} color={st.tint} weight={2.2} />
                  <T v="label" c={colors.textPrimary}>{st.label}</T>
                </View>
                <T v="caption" c={colors.textSecondary}>{it.why}</T>
              </View>
            </View>
          );
        })}
      </View>
      {state.blocked ? (
        <View style={{ gap: space[3] }}>
          <T v="body" c={colors.textPrimary}>Access was turned off for FortIRL, so your phone will not ask again. Turn it back on in Settings, then come back.</T>
          <Button label="Open Settings" variant="primary" icon="settings" onPress={onOpenSettings} testID="perm-settings" />
        </View>
      ) : (
        <Button label={asking ? 'Waiting for your answer' : 'Allow access'} variant="primary" loading={asking} onPress={allow} testID="perm-allow" />
      )}
      {onLeave ? <Button label="Leave lobby" variant="tertiary" size="md" onPress={onLeave} testID="perm-leave" /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row', gap: space[3], padding: space[3],
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: borders.thin, borderColor: colors.border,
  },
});
