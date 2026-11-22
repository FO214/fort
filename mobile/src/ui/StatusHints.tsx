import React from 'react';
import { View } from 'react-native';
import { space } from '../theme';
import type { IconName } from './Icon';
import { StatusChip, type ChipTone } from './StatusChip';

export interface Hint { id: string; icon: IconName; label: string; tone: ChipTone; busy?: boolean }

/**
 * Things the player needs to know about the kit, under the crosshair: no
 * GPS, weak GPS, reconnecting, the gun has dropped. Each stays for as long as
 * the problem does. The two most urgent are shown; the rest wait their turn.
 */
export function StatusHints({ hints }: { hints: Hint[] }) {
  if (hints.length === 0) return null;
  return (
    <View style={{ alignItems: 'center', gap: space[1] }} pointerEvents="none">
      {hints.slice(0, 2).map((h, i) => (
        <StatusChip key={h.id} hud icon={h.icon} label={h.label} tone={h.tone} busy={h.busy} style={{ alignSelf: 'center' }}
          testID={i === 0 ? 'hint' : `hint-${h.id}`} />
      ))}
    </View>
  );
}
