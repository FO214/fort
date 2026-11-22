import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { alpha, colors, space } from '../theme';

/** Portrait content never runs wider than this, so it holds on a tablet or a phone turned sideways. */
export const CONTENT_MAX = 480;

/**
 * The structural bands behind the menu screens: two flat diagonals cut on the
 * wordmark's angle. One tone lighter than the background, no gradient.
 */
export function Backdrop() {
  const { width: w, height: h } = useWindowDimensions();
  const band = alpha(colors.textPrimary, 0.022);
  const run = h * 0.9;                       // how far a band travels across as it climbs
  const poly = (x: number, bw: number) => `${x},${h} ${x + bw},${h} ${x + bw + run},0 ${x + run},0`;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Polygon points={poly(-run * 0.72, w * 0.36)} fill={band} />
      <Polygon points={poly(-run * 0.16, w * 0.14)} fill={band} />
      <Polygon points={poly(w * 0.34 - run * 0.1, w * 0.5)} fill={alpha(colors.textPrimary, 0.014)} />
    </Svg>
  );
}

/**
 * The frame every portrait screen sits in: obsidian background, safe areas,
 * a centred column. `scroll` makes the column scrollable and keeps the
 * focused field above the keyboard.
 */
export function Screen({ children, backdrop, scroll, edges, style, contentStyle, testID }: {
  children: React.ReactNode; backdrop?: boolean; scroll?: boolean; edges?: Edge[];
  style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; testID?: string;
}) {
  const column = [styles.column, contentStyle];
  return (
    <View style={[styles.root, style]} testID={testID}>
      {backdrop ? <Backdrop /> : null}
      <SafeAreaView style={styles.safe} edges={edges}>
        {scroll ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={column}>{children}</View>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : <View style={[styles.safe, column]}>{children}</View>}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  safe: { flex: 1 },
  scroll: { flexGrow: 1 },
  column: { flexGrow: 1, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: space[6] },
});
