import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { HUD_SCALES, useStore, type GunLink } from '../store';
import { colors, space } from '../theme';
import { Button } from '../ui/Button';
import { Segmented, ToggleRow } from '../ui/Controls';
import { PairGunControl } from '../ui/PairGunControl';
import { Divider } from '../ui/Panel';
import { Sheet } from '../ui/Sheet';
import { T } from '../ui/T';

const SCALE_LABEL: Record<number, string> = { [HUD_SCALES[0]]: 'Compact', [HUD_SCALES[1]]: 'Standard', [HUD_SCALES[2]]: 'Large' };

/**
 * The mission menu: the handful of things that are worth a touch mid-match.
 * Ending the mission for everyone, or leaving it, asks twice.
 */
export function HudMenu({ isHost, canMarkArrived, gun, pairingUntil, onPair, onArrived, onAbort, onLeave, onClose }: {
  isHost: boolean;
  /** Host, on the journey: GPS can refuse to admit the squad has arrived. */
  canMarkArrived: boolean;
  gun: GunLink; pairingUntil: number; onPair: () => void;
  onArrived: () => void; onAbort: () => void; onLeave: () => void; onClose: () => void;
}) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [confirm, setConfirm] = useState<null | 'abort' | 'leave'>(null);
  const { width, height } = useWindowDimensions();
  const wide = width > height;

  if (confirm) {
    const abort = confirm === 'abort';
    return (
      <Sheet title={abort ? 'Abort the mission?' : 'Leave the mission?'} onClose={() => setConfirm(null)} testID="hud-confirm">
        <T v="body" c={colors.textSecondary}>
          {abort ? 'This ends the mission for the whole squad and sends everyone back to the lobby.'
            : 'Your squad carries on without you. You will not be able to rejoin this mission.'}
        </T>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <Button label="Keep going" fill onPress={() => setConfirm(null)} testID="confirm-no" />
          <Button label={abort ? 'Abort mission' : 'Leave mission'} variant="destructive" fill onPress={abort ? onAbort : onLeave}
            testID={abort ? 'abort-confirm' : 'leave-confirm'} />
        </View>
      </Sheet>
    );
  }

  const arrived = canMarkArrived ? (
    <View style={{ gap: space[2] }}>
      <Button label="We're here" variant="primary" icon="helicopter" onPress={() => { onArrived(); onClose(); }} testID="arrived-menu" />
      <T v="caption" c={colors.textSecondary}>Standing at the helicopter but the game has not noticed? Tell it.</T>
    </View>
  ) : null;
  const exits = (
    <View style={{ gap: space[3] }}>
      {/* A blaster that dropped off, or was never paired, can be paired from here. */}
      <PairGunControl gun={gun} pairingUntil={pairingUntil} onPair={onPair} />
      <Button label="Leave mission" size="md" icon="leave" onPress={() => setConfirm('leave')} testID="leave" />
      {isHost ? <Button label="Abort mission" size="md" icon="close" onPress={() => setConfirm('abort')} testID="abort" /> : null}
    </View>
  );
  const prefsBlock = (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: space[2] }}>
        <T v="overline" c={colors.textSecondary}>HUD size</T>
        <Segmented testID="pref-hud" value={prefs.hudScale} onChange={(hudScale) => setPrefs({ hudScale })}
          options={HUD_SCALES.map((v) => ({ value: v, label: SCALE_LABEL[v] }))} />
      </View>
      <View>
        <ToggleRow icon={prefs.sound ? 'sound' : 'soundOff'} label="Sound" value={prefs.sound} onChange={(sound) => setPrefs({ sound })} testID="pref-sound" />
        <ToggleRow icon="haptics" label="Haptics" value={prefs.haptics} onChange={(haptics) => setPrefs({ haptics })} testID="pref-haptics" />
      </View>
    </View>
  );

  // Sideways there is width but no height: two columns, everything on screen at once.
  return (
    <Sheet title="Mission menu" onClose={onClose} testID="hud-menu-sheet">
      {wide ? (
        <View style={{ flexDirection: 'row', gap: space[6] }}>
          <View style={{ flex: 1, gap: space[4], justifyContent: 'space-between' }}>{arrived}{exits}</View>
          <View style={{ flex: 1 }}>{prefsBlock}</View>
        </View>
      ) : (
        <>{arrived}{prefsBlock}<Divider />{exits}</>
      )}
    </Sheet>
  );
}
