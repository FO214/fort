import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';

/**
 * A ring that fills clockwise from twelve o'clock, with room in the middle
 * for the number it stands for. `value` is 0–1 and authoritative: the ring
 * draws exactly that, so a hold that the server has not started shows empty.
 */
export function ProgressRing({ value, size = 120, thickness = 6, color = colors.brand.amber, track = colors.borderStrong, children, testID }: {
  value: number; size?: number; thickness?: number; color?: string; track?: string; children?: React.ReactNode; testID?: string;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID={testID}
      accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={thickness} fill="none" />
        {v > 0 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={thickness} fill="none" strokeLinecap="butt"
            strokeDasharray={`${circumference * v} ${circumference}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}
