import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { alpha, borders, colors, touch } from '../theme';
import { HudPanel } from './HudPanel';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/**
 * Bottom-right: the fallback touch controls. The physical trigger and reload
 * button on the blaster are the real inputs; these are for when there is no
 * gun, so they are big, round, apart from each other and under the right
 * thumb. Pressing gives an immediate darkening; nothing bounces.
 */
function RoundControl({ size, icon, label, ring, ringColor, active, disabled, children, ...press }: {
  size: number; icon: IconName; label: string;
  /** 0–1 drawn round the rim: reload progress. */
  ring?: number; ringColor?: string; active?: boolean; disabled?: boolean; children?: React.ReactNode;
  testID: string; onPress?: () => void; onPressIn?: () => void; onPressOut?: () => void;
}) {
  const r = size / 2 - 3;
  const circumference = 2 * Math.PI * r;
  const fg = disabled ? colors.textMuted : active ? colors.brand.amber : colors.textPrimary;
  return (
    <Pressable {...press} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={{ width: size, height: size }}>
      {({ pressed }) => (
        <HudPanel material="glass" radius={size / 2}
          style={[{ width: size, height: size, borderWidth: borders.strong, borderColor: disabled ? colors.border : active ? colors.brand.amber : alpha(colors.textPrimary, 0.7) },
            pressed && { backgroundColor: alpha(colors.textPrimary, 0.24) }]}
          contentStyle={[styles.centre, { width: size - 3, height: size - 3 }]}>
          {ring != null && ring > 0 ? (
            <Svg width={size} height={size} style={styles.ring}>
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={ringColor ?? colors.textPrimary} strokeWidth={4} fill="none"
                strokeDasharray={`${circumference * Math.min(1, ring)} ${circumference}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            </Svg>
          ) : null}
          <Icon name={icon} size={Math.round(size * 0.34)} color={fg} weight={2} />
          <T v="hudMicro" c={fg} style={{ marginTop: 2 }}>{label}</T>
          {children}
        </HudPanel>
      )}
    </Pressable>
  );
}

/** The trigger. `onTarget` lights it amber, the same signal as the crosshair. */
export function FireControl({ onTarget, disabled, onDown, onUp }: { onTarget: boolean; disabled?: boolean; onDown: () => void; onUp: () => void }) {
  // react-native-web only raises onPressIn for a held pointer; an instant
  // click or tap arrives as onPress alone. Treat that as one trigger pull.
  const sawPressIn = useRef(false);
  return (
    <RoundControl testID="fire" size={touch.fire} icon="fire" label="Fire" active={onTarget && !disabled} disabled={disabled}
      onPressIn={() => { sawPressIn.current = true; onDown(); }}
      onPressOut={onUp}
      onPress={() => { if (!sawPressIn.current) { onDown(); onUp(); } sawPressIn.current = false; }} />
  );
}

/** Reload. The rim fills as the reload runs; it is off when the magazine is full. */
export function ReloadControl({ reloadingUntil, reloadS, now, disabled, onPress }:
  { reloadingUntil: number; reloadS: number; now: number; disabled?: boolean; onPress: () => void }) {
  const reloading = reloadingUntil > now;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reloading) return;
    const id = setInterval(() => tick((t) => t + 1), 60);
    return () => clearInterval(id);
  }, [reloading]);
  const progress = reloading ? 1 - Math.max(0, reloadingUntil - now) / Math.max(0.1, reloadS) : 0;
  return <RoundControl testID="reload" size={touch.reload} icon="reload" label="Reload" ring={progress} disabled={disabled} onPress={onPress} />;
}

/** The corner control that opens the mission menu. */
export function HudIconButton({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [styles.square, pressed && { backgroundColor: colors.surfaceElevated }]}>
      <View pointerEvents="none"><Icon name={icon} size={22} color={colors.textPrimary} weight={2} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', left: -1.5, top: -1.5 },
  square: {
    width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.camera.backingStrong, borderWidth: borders.thin, borderColor: alpha(colors.textPrimary, 0.3),
  },
});
