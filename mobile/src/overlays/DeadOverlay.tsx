import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { Button } from '../ui/Button';
import { HudPanel } from '../ui/HudPanel';
import { Icon } from '../ui/Icon';
import { T } from '../ui/T';

/**
 * Out for this mission. First it says so, plainly, in the middle of the
 * screen; Spectate folds it down to a tag so the player can watch the squad
 * through their own camera. There is nothing to shoot or revive with from
 * here, so no weapon controls are shown.
 */
export function DeadOverlay() {
  const [spectating, setSpectating] = useState(false);
  if (spectating) {
    return (
      <View style={styles.tagWrap} pointerEvents="none" testID="dead">
        <HudPanel strong accent={colors.textSecondary} contentStyle={styles.tag}>
          <Icon name="spectate" size={20} color={colors.textPrimary} />
          <T v="hudLabel">You're out. Spectating.</T>
        </HudPanel>
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]} testID="dead">
      <View style={styles.card}>
        <Icon name="dead" size={40} color={colors.textSecondary} />
        <T v="hudHero" accessibilityRole="header">You're out</T>
        <T v="hudLabel" c={colors.textSecondary} center>Out for this mission. You cannot shoot or revive.{'\n'}Watch your squad until the end.</T>
        <Button label="Spectate" icon="spectate" onPress={() => setSpectating(true)} testID="spectate" style={{ alignSelf: 'stretch', marginTop: space[3] }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.dim.dead, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  card: { alignItems: 'center', gap: space[2], width: 360, maxWidth: '100%' },
  tagWrap: { position: 'absolute', left: 0, right: 0, bottom: space[5], alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], minHeight: 40 },
});
