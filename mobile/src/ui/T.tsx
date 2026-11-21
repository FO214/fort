import React from 'react';
import { Text, TextProps, TextStyle } from 'react-native';
import { color, font, type } from '../theme';

type Variant = keyof typeof type;

export function T({ v = 'body', c = color.ink, style, children, ...rest }:
  TextProps & { v?: Variant; c?: string; style?: TextStyle | TextStyle[] }) {
  const base = type[v];
  const isMono = v === 'mono' || v === 'monoBig';
  return (
    <Text {...rest} style={[{ fontFamily: isMono ? font.mono : font.family, color: c }, base as TextStyle, style]}>
      {children}
    </Text>
  );
}
