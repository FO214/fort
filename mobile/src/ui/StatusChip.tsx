import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { borders, colors, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { T } from './T';

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'objective';

const TONE: Record<ChipTone, string> = {
  neutral: colors.status.neutral,
  ok: colors.status.health,
  warn: colors.brand.amber,
  danger: colors.status.danger,
  objective: colors.status.objective,
};

/**
 * A short status: an icon and a few words. The icon and the words carry the
 * meaning; the tint only backs them up.
 *
 * `hud` is the over-camera version: larger, on a dark plate.
 */
export function StatusChip({ icon, label, tone = 'neutral', busy, hud, style, testID }: {
  icon?: IconName; label: string; tone?: ChipTone; busy?: boolean; hud?: boolean; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const tint = TONE[tone];
  const size = hud ? 20 : 16;
  return (
    <View testID={testID} accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: space[2], alignSelf: 'flex-start',
          paddingHorizontal: hud ? space[3] : space[2], minHeight: hud ? 36 : 26, borderRadius: radius.xs,
        },
        hud
          ? { backgroundColor: colors.camera.backingStrong, borderLeftWidth: 3, borderLeftColor: tint }
          : { backgroundColor: colors.surface, borderWidth: borders.thin, borderColor: colors.border },
        style,
      ]}>
      {busy ? <Spinner size={size} color={tint} /> : icon ? <Icon name={icon} size={size} color={tint} /> : null}
      <T v={hud ? 'hudSecondary' : 'label'} c={colors.textPrimary} numberOfLines={1}>{label}</T>
    </View>
  );
}
