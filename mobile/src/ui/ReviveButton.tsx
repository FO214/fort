import React from 'react';
import { color } from '../theme';
import { HoldButton } from './HoldButton';

/**
 * Shown when a knocked teammate is close enough. Hold for three seconds to
 * get them up. It will not start while a zombie is standing over them.
 */
export function ReviveButton({ name, holding, progress, onHold }: {
  name: string; holding: boolean; progress: number; onHold: (down: boolean) => void;
}) {
  const blocked = holding && progress <= 0;
  return (
    <HoldButton testID="revive" tint={color.warning} holding={holding} progress={progress} onHold={onHold}
      label={holding ? `Reviving ${name}…` : `Hold to revive ${name}`}
      detail={blocked ? 'Clear the zombies off them first' : holding ? 'Stay close, keep holding' : 'They are down next to you'} />
  );
}
