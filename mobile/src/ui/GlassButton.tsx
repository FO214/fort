import React from 'react';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { color, radius, space } from '../theme';
import { Glass } from './Glass';
import { T } from './T';

type Variant = 'primary' | 'glass' | 'danger' | 'ghost';
type Size = 'lg' | 'md' | 'sm';

const H: Record<Size, number> = { lg: 56, md: 46, sm: 36 };

export function GlassButton({ label, onPress, variant = 'glass', size = 'md', disabled, style, testID, fill }:
  { label: string; onPress?: () => void; variant?: Variant; size?: Size; disabled?: boolean; style?: ViewStyle; testID?: string; fill?: boolean }) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const h = H[size];
  const filled = variant === 'primary' || variant === 'danger';
  const bg = variant === 'primary' ? color.accent : variant === 'danger' ? color.danger : undefined;
  const fg = filled ? color.onAccent : variant === 'ghost' ? color.ink2 : color.ink;
  const inner = (
    <T v={size === 'sm' ? 'caption' : 'headline'} c={fg} style={{ fontWeight: '600', letterSpacing: 0.2 }}>{label}</T>
  );
  return (
    <Animated.View style={[anim, fill && { flex: 1 }, disabled && { opacity: 0.4 }, style]}>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.96, { damping: 18, stiffness: 320 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 18, stiffness: 320 }); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [{ opacity: pressed && filled ? 0.9 : 1 }]}
      >
        {filled ? (
          <Animated.View style={[styles.filled, { height: h, backgroundColor: bg, borderRadius: radius.pill }]}>{inner}</Animated.View>
        ) : variant === 'ghost' ? (
          <Animated.View style={[styles.filled, { height: h }]}>{inner}</Animated.View>
        ) : (
          <Glass radius={radius.pill} contentStyle={[styles.filled, { height: h }]} strong>{inner}</Glass>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  filled: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
});
