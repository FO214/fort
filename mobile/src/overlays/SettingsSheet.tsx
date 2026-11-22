import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { HUD_SCALES, useStore } from '../store';
import { colors, space, touch } from '../theme';
import { Button } from '../ui/Button';
import { ToggleRow, Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Divider } from '../ui/Panel';
import { Sheet } from '../ui/Sheet';
import { T } from '../ui/T';
import { TextField } from '../ui/TextField';

export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

const SCALE_LABEL: Record<number, string> = { [HUD_SCALES[0]]: 'Compact', [HUD_SCALES[1]]: 'Standard', [HUD_SCALES[2]]: 'Large' };

/**
 * Preferences. Sound and haptics are separate switches; the HUD has its own
 * size setting because it is read at arm's length, not in the hand.
 * The server address is for whoever runs the server, so it lives under
 * Advanced and stays out of the way.
 */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const serverUrl = useStore((s) => s.serverUrl);
  const setServerUrl = useStore((s) => s.setServerUrl);
  const [advanced, setAdvanced] = useState(false);
  return (
    <Sheet title="Settings" onClose={onClose} testID="settings">
      <View style={{ gap: space[2] }}>
        <ToggleRow icon={prefs.sound ? 'sound' : 'soundOff'} label="Sound" detail="Shots, hits and mission cues"
          value={prefs.sound} onChange={(sound) => setPrefs({ sound })} testID="pref-sound" />
        <ToggleRow icon="haptics" label="Haptics" detail="Vibration on fire, hits and damage"
          value={prefs.haptics} onChange={(haptics) => setPrefs({ haptics })} testID="pref-haptics" />
      </View>

      <View style={{ gap: space[2] }}>
        <T v="overline" c={colors.textSecondary}>HUD size</T>
        <Segmented testID="pref-hud" value={prefs.hudScale} onChange={(hudScale) => setPrefs({ hudScale })}
          options={HUD_SCALES.map((v) => ({ value: v, label: SCALE_LABEL[v] }))} />
        <T v="caption" c={colors.textSecondary}>How large the in-mission display is drawn. It is read from the blaster, at arm's length.</T>
      </View>

      <Divider />

      <View style={{ gap: space[3] }}>
        <Pressable onPress={() => setAdvanced((v) => !v)} testID="server-toggle" accessibilityRole="button"
          accessibilityLabel="Advanced" accessibilityState={{ expanded: advanced }}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: touch.min, gap: space[2] }}>
          <T v="overline" c={colors.textSecondary} style={{ flex: 1 }}>Advanced</T>
          <View style={{ transform: [{ rotate: advanced ? '180deg' : '0deg' }] }}>
            <Icon name="chevronDown" size={20} color={colors.textSecondary} />
          </View>
        </Pressable>
        {advanced ? (
          <>
            <TextField label="Server address" value={serverUrl} onChangeText={setServerUrl} mono autoCapitalize="none" autoCorrect={false}
              keyboardType="url" testID="server" hint="For whoever is running the game server. Leave it alone otherwise." />
            <Button label="Design system" size="md" variant="tertiary" iconRight="chevronRight"
              onPress={() => { onClose(); useStore.getState().setGallery(true); }} testID="open-gallery" />
          </>
        ) : null}
      </View>

      <T v="technical" c={colors.textMuted} center testID="version">v{APP_VERSION}</T>
    </Sheet>
  );
}
