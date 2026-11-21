import React from 'react';
import { color } from '../theme';
import { HoldButton } from './HoldButton';
import { Pill } from './Pill';

/**
 * The way out. During the final wave, point the camera at the helicopter's
 * QR code; while it is in view, hold this to extract. At least two players
 * have to be holding at the same time (one if playing solo).
 */
export function ExtractHold({ qrInView, holding, progress, holders, need, onHold }: {
  qrInView: boolean; holding: boolean; progress: number; holders: number; need: number; onHold: (down: boolean) => void;
}) {
  if (!qrInView) return <Pill label="Aim at the helicopter code" tint={color.warning} testID="extract-aim" />;
  const active = holding && holders >= need;
  return (
    <HoldButton testID="extract-hold" tint={color.accent} holding={holding} progress={progress} onHold={onHold}
      label={active ? 'Extracting…' : holding ? 'Holding' : 'Hold to extract'}
      detail={holding && !active ? `Waiting for ${need - holders} more on the code` : holding ? 'Keep it in view' : 'Helicopter code in view'} />
  );
}
