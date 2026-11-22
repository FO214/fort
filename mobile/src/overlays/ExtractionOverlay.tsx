import React from 'react';
import { colors } from '../theme';
import { HoldAction } from '../ui/HoldAction';

/**
 * The way out. During the final wave anyone still standing can press and
 * hold here; while enough of the squad are holding, the extraction runs. The
 * bar belongs to the whole squad and lives in the objective banner, where
 * the defenders can see it too.
 *
 *   not holding         "Hold to extract"
 *   holding, short      "1 of 2 holding. Need one more."
 *   holding, enough     "Extracting", the shared progress climbing
 *   paused              it had started and someone let go
 */
export function ExtractionOverlay({ holding, progress, holders, need, onHold }: {
  holding: boolean; progress: number; holders: number; need: number; onHold: (down: boolean) => void;
}) {
  const enough = holders >= need;
  const active = holding && enough;
  const short = need - holders;
  const title = active ? 'Extracting' : holding ? 'Holding' : 'Hold to extract';
  const detail = active ? 'Keep holding'
    : holding ? `${holders} of ${need} holding. Need ${short === 1 ? 'one' : short} more.`
    : progress > 0 ? 'Paused. Hold to carry on.'
    : 'Press and hold.';
  return (
    <HoldAction testID="extract-hold" icon="helicopter" tint={colors.status.objective} holding={holding} progress={progress} onHold={onHold}
      title={title} detail={detail} reading={`${Math.round(progress * 100)}%`} />
  );
}
