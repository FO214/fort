import React from 'react';
import { StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color } from '../theme';

/** The colour field the glass reads through on menu screens. */
export function Blobs() {
  const { width, height } = useWindowDimensions();
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="teal" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color.blobTeal} stopOpacity="0.85" />
          <Stop offset="1" stopColor={color.blobTeal} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="violet" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color.blobViolet} stopOpacity="0.9" />
          <Stop offset="1" stopColor={color.blobViolet} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="blue" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color.blobBlue} stopOpacity="0.8" />
          <Stop offset="1" stopColor={color.blobBlue} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={width * 0.15} cy={height * 0.12} r={width * 0.7} fill="url(#teal)" />
      <Circle cx={width * 0.95} cy={height * 0.42} r={width * 0.8} fill="url(#violet)" />
      <Circle cx={width * 0.3} cy={height * 0.95} r={width * 0.75} fill="url(#blue)" />
    </Svg>
  );
}

export function Screen({ children, blobs = true, style, edges }:
  { children: React.ReactNode; blobs?: boolean; style?: ViewStyle; edges?: ('top' | 'bottom' | 'left' | 'right')[] }) {
  return (
    <View style={[styles.root, style]}>
      {blobs && <Blobs />}
      <SafeAreaView style={styles.safe} edges={edges}>{children}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  safe: { flex: 1 },
});
