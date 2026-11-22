import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { alpha, borders, colors, space, touch } from '../theme';
import { HudPanel } from './HudPanel';
import { Icon, type IconName } from './Icon';
import { ProgressRing } from './ProgressRing';
import { T } from './T';

/**
 * A control that only counts while it is held: revive, extract.
 *
 * Large enough to find with a thumb while walking, and it stays "held" if
 * the thumb drifts. Progress is shown three ways at once (the ring, the
 * reading inside it, the fill behind the text) and all three draw the value
 * the server reports, so a hold that is blocked shows as empty rather than
 * pretending to move.
 */
export function HoldAction({ title, detail, icon, reading, progress, tint = colors.brand.amber, holding, blocked, onHold, testID, width = 340 }: {
  title: string;
  /** What to do, or why nothing is happening. */
  detail?: string;
  icon: IconName;
  /** Shown inside the ring while there is progress: "2.3s", "64%". */
  reading?: string;
  progress: number;
  tint?: string;
  holding: boolean;
  /** Held, but the server is not letting it count. */
  blocked?: boolean;
  onHold: (down: boolean) => void;
  testID?: string; width?: number;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const edge = blocked ? colors.status.danger : tint;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ selected: holding }}
      onPressIn={() => onHold(true)}
      onPressOut={() => onHold(false)}
      // Stay held if the thumb drifts while aiming.
      pressRetentionOffset={{ top: 70, bottom: 70, left: 70, right: 70 }}
      style={{ width, maxWidth: '100%' }}
    >
      <HudPanel material="glass" style={{ borderColor: edge, borderWidth: holding ? 2 : borders.strong }}
        contentStyle={styles.content}>
        {/* The fill behind the text: the same progress, as area. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: `${p * 100}%`, backgroundColor: alpha(tint, 0.2) }]} />
        <ProgressRing value={p} size={touch.hud} thickness={5} color={tint} track={alpha(colors.textPrimary, 0.22)}>
          {reading && p > 0
            ? <T v="hudSecondary" c={colors.textPrimary} style={styles.reading}>{reading}</T>
            : <Icon name={blocked ? 'warning' : icon} size={24} color={blocked ? colors.status.danger : colors.textPrimary} />}
        </ProgressRing>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="hudTitle" c={colors.textPrimary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{title}</T>
          {detail ? <T v="hudSecondary" c={blocked ? colors.textPrimary : colors.textSecondary} numberOfLines={1}>{detail}</T> : null}
        </View>
      </HudPanel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2], minHeight: touch.hud + space[4] },
  reading: { fontVariant: ['tabular-nums'] },
});
