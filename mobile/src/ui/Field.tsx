import React from 'react';
import { Platform, StyleSheet, TextInput, TextInputProps, TextStyle } from 'react-native';
import { color, font, radius, space } from '../theme';
import { Glass } from './Glass';

export function Field({ big, mono, center, style, ...rest }: TextInputProps & { big?: boolean; mono?: boolean; center?: boolean }) {
  return (
    <Glass radius={big ? radius.xl : radius.md} strong>
      <TextInput
        placeholderTextColor={color.ink3}
        selectionColor={color.accent}
        {...rest}
        style={[
          styles.input,
          { fontFamily: mono ? font.mono : font.family },
          big && styles.big,
          center && { textAlign: 'center' },
          style,
        ]}
      />
    </Glass>
  );
}

const styles = StyleSheet.create({
  input: { color: color.ink, fontSize: 17, paddingHorizontal: space.lg, height: 50, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}) },
  big: { fontSize: 40, height: 84, letterSpacing: 12, fontWeight: '600' },
});
