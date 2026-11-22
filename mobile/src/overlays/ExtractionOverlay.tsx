import React from 'react';
import { colors } from '../theme';
import { HoldAction } from '../ui/HoldAction';
import { StatusChip } from '../ui/StatusChip';

/**
 * The way out, for whoever is at the helicopter. During the final wave the
 * camera reads the helicopter's code; while it is in view, holding here
 * counts. The bar belongs to the whole squad and lives in the objective
 * banner, where the defenders can see it too.
 *
 *   code not in view    "Aim at the helicopter code"
 *   some other code     "That is not the helicopter code"
 *   in view             "Hold to extract"
 *   holding, short      "1 of 2 holding. Need one more."
 *   holding, enough     "Extracting", the shared progress climbing
 *   paused              it had started and someone let go
 */
export function ExtractionOverlay({ qrInView, wrongCode, holding, progress, holders, need, onHold }: {
  qrInView: boolean;
  /** The camera is reading a code, and it is not the helicopter's. */
  wrongCode?: boolean;
  holding: boolean; progress: number; holders: number; need: number; onHold: (down: boolean) => void;
}) {
  if (!qrInView) {
    return wrongCode
      ? <StatusChip hud icon="warning" tone="warn" label="That is not the helicopter code" style={{ alignSelf: 'center' }} testID="extract-wrong" />
      : <StatusChip hud icon="scan" tone="objective" label="Aim at the helicopter code" style={{ alignSelf: 'center' }} testID="extract-aim" />;
  }
  const enough = holders >= need;
  const active = holding && enough;
  const short = need - holders;
  const title = active ? 'Extracting' : holding ? 'Holding' : 'Hold to extract';
  const detail = active ? 'Keep the code in view'
    : holding ? `${holders} of ${need} holding. Need ${short === 1 ? 'one' : short} more.`
    : progress > 0 ? 'Paused. Hold to carry on.'
    : 'Code in view. Press and hold.';
  return (
    <HoldAction testID="extract-hold" icon="scan" tint={colors.status.objective} holding={holding} progress={progress} onHold={onHold}
      title={title} detail={detail} reading={`${Math.round(progress * 100)}%`} />
  );
}
