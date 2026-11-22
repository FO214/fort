import React, { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { borders, colors, radius, space, touch } from '../theme';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { T } from './T';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'lg' | 'md' | 'sm';

const HEIGHT: Record<ButtonSize, number> = { lg: 56, md: 48, sm: 40 };

interface Look { bg: string; bgPressed: string; border: string; fg: string }

const LOOK: Record<ButtonVariant, Look> = {
  // The one main action on a screen.
  primary: { bg: colors.brand.amber, bgPressed: colors.brand.amberPressed, border: colors.brand.amber, fg: colors.brand.onAmber },
  // Back, Join, Leave.
  secondary: { bg: colors.surfaceOverlay, bgPressed: colors.surfaceElevated, border: colors.borderStrong, fg: colors.textPrimary },
  // Copy and other minor actions: text only, still a full hit area.
  tertiary: { bg: 'transparent', bgPressed: colors.surface, border: 'transparent', fg: colors.textSecondary },
  // Only ever behind an explicit label.
  destructive: { bg: colors.status.dangerSurface, bgPressed: colors.status.dangerPressed, border: colors.status.dangerSurface, fg: colors.status.onDanger },
};

/** A button that cannot be used must not look like one that can. */
const DISABLED: Look = { bg: colors.surface, bgPressed: colors.surface, border: colors.border, fg: colors.textMuted };

export function Button({ label, onPress, variant = 'secondary', size = 'lg', icon, iconRight, accent, loading, disabled, fill, style, testID, accessibilityHint }: {
  label: string; onPress?: () => void; variant?: ButtonVariant; size?: ButtonSize;
  icon?: IconName; iconRight?: IconName;
  /** Tints the border and icon of a secondary button that is showing a confirmed state ("Ready"). */
  accent?: string;
  /** Busy: shows a spinner and ignores presses. */
  loading?: boolean; disabled?: boolean; fill?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string; accessibilityHint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const off = !!disabled || !!loading;
  const look = disabled ? DISABLED : LOOK[variant];
  const h = HEIGHT[size];
  const iconSize = size === 'sm' ? 18 : 20;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: !!loading }}
      // Small buttons keep a full-size target.
      hitSlop={h < touch.min ? (touch.min - h) / 2 : undefined}
      style={({ pressed }) => [
        styles.base,
        {
          height: h, backgroundColor: pressed ? look.bgPressed : look.bg, borderColor: (!disabled && accent) || look.border,
          paddingHorizontal: size === 'sm' ? space[3] : space[5],
        },
        fill && { flex: 1 },
        focused && !off && styles.focused,
        style,
      ]}
    >
      {loading ? <Spinner size={iconSize} color={look.fg} /> : icon ? <Icon name={icon} size={iconSize} color={(!disabled && accent) || look.fg} /> : null}
      <T v={size === 'sm' ? 'buttonSmall' : 'button'} c={look.fg} numberOfLines={1}>{label}</T>
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} color={look.fg} /> : null}
    </Pressable>
  );
}

/** A square icon-only control. Always has a spoken label. */
export function IconButton({ icon, label, onPress, size = touch.min, tone = 'secondary', disabled, testID }: {
  icon: IconName; label: string; onPress?: () => void; size?: number; tone?: 'secondary' | 'tertiary'; disabled?: boolean; testID?: string;
}) {
  const look = disabled ? DISABLED : LOOK[tone];
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.base, { width: size, height: size, backgroundColor: pressed ? look.bgPressed : look.bg, borderColor: look.border }]}>
      <View pointerEvents="none"><Icon name={icon} size={Math.round(size * 0.46)} color={look.fg} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    borderRadius: radius.sm, borderWidth: borders.thin,
  },
  focused: { borderColor: colors.textPrimary, borderWidth: borders.strong },
});
