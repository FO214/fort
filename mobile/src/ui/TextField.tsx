import React, { useState } from 'react';
import { Platform, StyleSheet, TextInput, TextInputProps, TextStyle, View } from 'react-native';
import { borders, colors, fonts, radius, space, touch } from '../theme';
import { Icon } from './Icon';
import { T } from './T';

/**
 * A labelled text field: solid dark surface, hairline border that
 * strengthens on focus, and the error on the line below where it stays put
 * until the problem is fixed.
 */
export function TextField({ label, error, hint, mono, style, ...rest }:
  TextInputProps & { label: string; error?: string | null; hint?: string; mono?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space[2] }}>
      <T v="overline" c={colors.textSecondary}>{label}</T>
      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.brand.amber}
        accessibilityLabel={label}
        {...rest}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        style={[
          styles.input,
          { fontFamily: mono ? fonts.technical : fonts.interfaceMedium },
          focused && styles.focused,
          !!error && styles.invalid,
          style,
        ]}
      />
      {error ? <FieldMessage tone="error" text={error} /> : hint ? <T v="caption" c={colors.textSecondary}>{hint}</T> : null}
    </View>
  );
}

/** An inline status line: an icon and a sentence. Used under fields and above actions. */
export function FieldMessage({ tone, text, testID }: { tone: 'error' | 'info'; text: string; testID?: string }) {
  const error = tone === 'error';
  return (
    <View style={[styles.message, error && styles.messageError]} accessibilityRole={error ? 'alert' : undefined}>
      <Icon name={error ? 'error' : 'info'} size={18} color={error ? colors.status.danger : colors.textSecondary} />
      <T v="label" c={colors.textPrimary} style={{ flex: 1 }} testID={testID}>{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: touch.comfortable, paddingHorizontal: space[4], fontSize: 17, color: colors.textPrimary,
    backgroundColor: colors.surfaceOverlay, borderRadius: radius.sm, borderWidth: borders.thin, borderColor: colors.border,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}),
  },
  focused: { borderColor: colors.brand.amber, borderWidth: borders.strong },
  invalid: { borderColor: colors.status.danger, borderWidth: borders.strong },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  messageError: {
    paddingVertical: space[2], paddingHorizontal: space[3], borderLeftWidth: 3, borderLeftColor: colors.status.danger,
    backgroundColor: colors.surface, borderRadius: radius.xs,
  },
});
