import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, TextStyle, View } from 'react-native';
import { CODE_LENGTH, normalizeCode } from '../game/format';
import { borders, colors, radius, space } from '../theme';
import { T } from './T';

export { CODE_LENGTH, normalizeCode };

/**
 * Four large cells for the mission code.
 *
 * One real text input sits invisibly over the cells, so typing moves cell to
 * cell on its own, backspace walks back, and a pasted code fills all four at
 * once. The cells only draw what the input holds. The input has no length
 * limit of its own: a paste with a stray space or dash is cleaned up first
 * and cut to four afterwards, not the other way round.
 */
export function MissionCodeInput({ value, onChange, onSubmit, invalid, autoFocus, testID }: {
  value: string; onChange: (code: string) => void; onSubmit?: () => void; invalid?: boolean; autoFocus?: boolean; testID?: string;
}) {
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <Pressable onPress={() => input.current?.focus()} accessible={false} style={styles.row}>
      {Array.from({ length: CODE_LENGTH }).map((_, i) => {
        const ch = value[i];
        const here = focused && i === active;
        return (
          <View key={i} style={[styles.cell, !!ch && styles.filled, here && styles.active, invalid && styles.invalid]}>
            <T v="code" c={invalid ? colors.status.danger : colors.textPrimary} style={styles.glyph}>{ch ?? ''}</T>
            {/* The caret: a bar under the cell being typed into. */}
            {here && !ch ? <View style={styles.caret} /> : null}
          </View>
        );
      })}
      <TextInput
        ref={input}
        testID={testID}
        value={value}
        onChangeText={(t) => onChange(normalizeCode(t))}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        returnKeyType="join"
        caretHidden
        accessibilityLabel="Mission code, four characters"
        style={styles.input}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3], alignSelf: 'stretch' },
  cell: {
    flex: 1, aspectRatio: 0.7, maxHeight: 104, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: borders.thin, borderColor: colors.border,
  },
  filled: { borderColor: colors.borderStrong },
  active: { borderColor: colors.brand.amber, borderWidth: borders.strong },
  invalid: { borderColor: colors.status.danger, borderWidth: borders.strong },
  glyph: { letterSpacing: 0 },
  caret: { position: 'absolute', bottom: space[4], width: 22, height: 3, backgroundColor: colors.brand.amber },
  // Covers the cells and takes the taps, but draws nothing itself.
  input: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0, color: 'transparent', fontSize: 16,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}),
  },
});
