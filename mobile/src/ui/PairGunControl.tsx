import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PAIR_WINDOW_S, type GunLink } from '../store';
import { borders, colors, radius, space, touch } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { ProgressBar } from './ProgressBar';
import { T } from './T';

/**
 * Pairing a blaster to this phone.
 *
 *   none     → "Pair gun"
 *   pairing  → "Pull your trigger now", counting down the server's 10 s window
 *   paired   → "Gun paired", only once the gun itself has answered
 *   timeout  → nothing answered; try again
 *   lost     → a paired gun dropped off; it comes back by itself, or pair again
 *
 * Tapping the button only opens the window. Nothing here claims success:
 * that word comes from the hardware, through the server.
 */
export function PairGunControl({ gun, pairingUntil, onPair }: { gun: GunLink; pairingUntil: number; onPair: () => void }) {
  if (gun === 'pairing') return <Pairing until={pairingUntil} />;
  if (gun === 'paired') {
    return (
      <Row icon="check" tint={colors.status.health} title="Gun paired" detail="Trigger and reload are live." testID="pair-gun-state">
        <Button label="Pair again" variant="tertiary" size="sm" onPress={onPair} testID="pair-gun" />
      </Row>
    );
  }
  if (gun === 'timeout') {
    return (
      <Row icon="timeout" tint={colors.brand.amber} title="Pairing timed out" detail="No gun answered in 10 seconds." testID="pair-gun-state">
        <Button label="Retry" size="sm" icon="retry" onPress={onPair} testID="pair-gun" />
      </Row>
    );
  }
  if (gun === 'lost') {
    return (
      <Row icon="unpaired" tint={colors.status.danger} title="Gun disconnected" detail="It reconnects on its own when back in range." testID="pair-gun-state">
        <Button label="Re-pair" size="sm" icon="pairing" onPress={onPair} testID="pair-gun" />
      </Row>
    );
  }
  return <Button label="Pair gun" icon="pairing" onPress={onPair} testID="pair-gun" accessibilityHint="Opens a ten second window. Pull your blaster's trigger to pair it." />;
}

function Pairing({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 100);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, until - now);
  return (
    <View style={[styles.box, styles.live]} testID="pair-gun-state" accessibilityLiveRegion="polite"
      accessibilityLabel={`Pull your trigger now. ${Math.ceil(left)} seconds left.`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Icon name="trigger" size={26} color={colors.brand.amber} />
        <View style={{ flex: 1 }}>
          <T v="headingM" style={{ fontSize: 22, lineHeight: 24 }}>Pull your trigger now</T>
          <T v="label" c={colors.textSecondary}>The first blaster to fire pairs with this phone.</T>
        </View>
        <T v="technicalStrong" style={styles.count} testID="pair-countdown">{Math.ceil(left)}<T v="technical" c={colors.textSecondary}>s</T></T>
      </View>
      <ProgressBar value={left / PAIR_WINDOW_S} height={4} accessibilityLabel="Time left to pair" />
    </View>
  );
}

function Row({ icon, tint, title, detail, children, testID }: { icon: IconName; tint: string; title: string; detail: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.box} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={[styles.badge, { borderColor: tint }]}><Icon name={icon} size={18} color={tint} weight={2.2} /></View>
        <View style={{ flex: 1 }}>
          <T v="overline" c={colors.textPrimary}>{title}</T>
          <T v="label" c={colors.textSecondary} numberOfLines={2}>{detail}</T>
        </View>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: touch.comfortable + space[2], justifyContent: 'center', gap: space[2], paddingVertical: space[2], paddingHorizontal: space[3],
    backgroundColor: colors.surfaceOverlay, borderRadius: radius.sm, borderWidth: borders.thin, borderColor: colors.borderStrong,
  },
  live: { borderColor: colors.brand.amber, borderWidth: borders.strong, paddingVertical: space[3] },
  badge: { width: 30, height: 30, borderRadius: radius.xs, borderWidth: borders.strong, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 28, lineHeight: 30, minWidth: 44, textAlign: 'right' },
});
