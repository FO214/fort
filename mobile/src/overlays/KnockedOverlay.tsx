import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { alpha, colors, space } from '../theme';
import { Icon } from '../ui/Icon';
import { Meter, ProgressBar } from '../ui/ProgressBar';
import { T } from '../ui/T';

const CRITICAL = 0.34;
const EDGE = alpha(colors.status.danger, 0.55), CLEAR = alpha(colors.status.danger, 0);

/**
 * You are down. The world is dimmed and tinted, not blurred: you can still
 * see what is coming and where your squad is. The bleed-out bar drains with
 * every bite, and the line under the heading says who is on their way, or
 * that someone has started the revive.
 */
export function KnockedOverlay({ bleed, reviver, reviveProgress, nearest }: {
  /** 1 full, 0 dead. */
  bleed: number;
  /** Name of the teammate reviving, once the server says a revive is under way. */
  reviver: string | null;
  reviveProgress: number;
  /** The closest teammate still standing, if there is one. */
  nearest: { name: string; dist: number } | null;
}) {
  const critical = bleed <= CRITICAL;
  const status = reviver ? `${reviver} is reviving you`
    : nearest ? `Teammate coming. ${nearest.name} is ${Math.round(nearest.dist)} m away.`
    : 'No one is standing. Hold on.';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="knocked">
      {/* The scene dims, and red closes in from the two sides. The middle stays readable. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.dim.knocked }]} />
      <LinearGradient colors={[EDGE, CLEAR]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[styles.side, { left: 0 }]} />
      <LinearGradient colors={[CLEAR, EDGE]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[styles.side, { right: 0 }]} />

      <View style={styles.centre}>
        <Icon name="knocked" size={46} color={colors.status.danger} />
        <T v="hudHero" c={colors.status.danger} accessibilityRole="header">Knocked</T>
        <T v="hudLabel" center testID="knocked-status" style={{ marginBottom: space[2] }}>{status}</T>

        <View style={styles.bars}>
          <Meter
            label={<T v="hudMicro" c={colors.textPrimary}>{critical ? 'Bleed-out critical' : 'Bleed-out'}</T>}
            reading={<T v="hudSecondary" testID="bleed" style={{ fontVariant: ['tabular-nums'] }}>{Math.round(bleed * 100)}%</T>}>
            <ProgressBar value={bleed} color={colors.status.danger} track={alpha(colors.textPrimary, 0.2)} height={10} accessibilityLabel="Bleed-out" />
          </Meter>
          {reviver ? (
            <Meter
              label={<T v="hudMicro" c={colors.textPrimary}>Revive</T>}
              reading={<T v="hudSecondary" style={{ fontVariant: ['tabular-nums'] }}>{Math.round(reviveProgress * 100)}%</T>}>
              <ProgressBar value={reviveProgress} color={colors.status.health} track={alpha(colors.textPrimary, 0.2)} height={10} accessibilityLabel="Revive progress" testID="revive-bar" />
            </Meter>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space[1], paddingHorizontal: space[6] },
  bars: { width: 340, maxWidth: '100%', gap: space[3] },
  // Each band is its own strip: a quarter of the screen, fading inward.
  side: { position: 'absolute', top: 0, bottom: 0, width: '24%' },
});
