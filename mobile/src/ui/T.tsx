import React from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';
import { colors, type, type TypeVariant } from '../theme';

/**
 * All text in the app. `v` picks a step of the type scale, `c` a colour
 * token. Weight comes from the font file each step names, never from
 * `fontWeight`, so every platform draws the same face.
 *
 * Strings stay in normal case in the source; steps that are set in capitals
 * transform them, so screen readers still hear words.
 *
 * Portrait text follows the system text size, up to a point. HUD steps do
 * not: the HUD has its own scale setting, tuned to the landscape layout.
 */
export function T({ v = 'body', c = colors.textPrimary, center, style, children, ...rest }:
  TextProps & { v?: TypeVariant; c?: string; center?: boolean; style?: StyleProp<TextStyle> }) {
  return (
    <Text allowFontScaling={!v.startsWith('hud')} maxFontSizeMultiplier={1.3} {...rest}
      style={[type[v] as TextStyle, { color: c }, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}
