import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { borders, colors, elevation, materials, motion, radius, space } from '../theme';
import { IconButton } from './Button';
import { settle, useReducedMotion } from './motion';
import { CONTENT_MAX } from './Screen';
import { T } from './T';

/**
 * A surface that floats over the screen: settings, confirmations, the
 * permission briefing. The one place the system uses elevation.
 *
 * In portrait it rises from the bottom edge; in landscape there is no room
 * for that, so it sits centred. Tapping outside closes it when `onClose` is
 * given; a sheet that needs an answer leaves it out.
 */
export function Sheet({ title, onClose, children, testID }: { title: string; onClose?: () => void; children: React.ReactNode; testID?: string }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const wide = width > height;
  const shown = useSharedValue(0);
  useEffect(() => { shown.value = settle(1, reduced, motion.base); }, [reduced, shown]);
  const dim = useAnimatedStyle(() => ({ opacity: shown.value }));
  const rise = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 16 }] }));
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer, wide ? styles.centre : styles.bottom]} testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={onClose ? 'Close' : undefined}
          accessibilityRole={onClose ? 'button' : undefined} disabled={!onClose} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet, rise,
          wide
            ? { maxHeight: height - space[4], borderRadius: radius.lg, width: Math.min(width - space[12], 640), maxWidth: 640 }
            : { maxHeight: height - insets.top - space[6], paddingBottom: Math.max(insets.bottom, space[5]), borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
        ]}>
        <View style={styles.header}>
          <T v="headingM" style={{ flex: 1 }} accessibilityRole="header">{title}</T>
          {onClose ? <IconButton icon="close" label="Close" tone="tertiary" onPress={onClose} testID="sheet-close" /> : null}
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 50 },
  bottom: { justifyContent: 'flex-end', alignItems: 'center' },
  centre: { justifyContent: 'center', alignItems: 'center' },
  dim: { backgroundColor: colors.dim.sheet },
  sheet: {
    ...materials.elevated, ...elevation.sheet, width: '100%', maxWidth: CONTENT_MAX + space[12],
    borderBottomWidth: 0, borderColor: colors.borderStrong, borderWidth: borders.thin, overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: space[5], paddingRight: space[2], paddingTop: space[2], minHeight: 52 },
  body: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], gap: space[5] },
});
