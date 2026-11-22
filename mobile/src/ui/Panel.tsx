import React from 'react';
import { StyleProp, View, ViewProps, ViewStyle } from 'react-native';
import { borders, colors, materials, radius, space } from '../theme';

/**
 * A solid surface that groups related information. Used sparingly, and
 * never inside another panel: most of a screen is separated by space and
 * hairlines, not by boxes.
 */
export function Panel({ children, elevated, selected, padding = space[4], style, ...rest }:
  ViewProps & { elevated?: boolean; selected?: boolean; padding?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View {...rest}
      style={[
        elevated ? materials.elevated : materials.solid,
        { borderRadius: radius.md, padding },
        selected && { borderColor: colors.brand.amber, borderWidth: borders.strong },
        style,
      ]}>
      {children}
    </View>
  );
}

/** A hairline rule between rows. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: borders.thin, backgroundColor: colors.border, alignSelf: 'stretch' }, style]} />;
}

/** A section header with a rule running out to the edge. */
export function SectionRule({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
      {children}
      <View style={{ flex: 1, height: borders.thin, backgroundColor: colors.border }} />
    </View>
  );
}
