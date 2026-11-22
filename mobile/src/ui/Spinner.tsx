import React, { useEffect } from 'react';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';
import { Icon } from './Icon';
import { useReducedMotion } from './motion';

/** "Working on it." Turns steadily; stands still when motion is reduced. */
export function Spinner({ size = 20, color = colors.textPrimary }: { size?: number; color?: string }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View style={[{ width: size, height: size }, style]} accessibilityLabel="Loading">
      <Icon name="loading" size={size} color={color} />
    </Animated.View>
  );
}
