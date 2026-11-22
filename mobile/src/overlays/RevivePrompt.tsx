import React, { useEffect, useRef, useState } from 'react';
import { colors } from '../theme';
import { HoldAction } from '../ui/HoldAction';

/**
 * Seconds until a 0–1 progress reaches 1, worked out from how fast the
 * server has been moving it. Null until there is a rate to go on.
 */
export function useEta(progress: number): number | null {
  const last = useRef<{ p: number; t: number } | null>(null);
  const rate = useRef(0);
  const now = Date.now() / 1000;
  if (progress <= 0) { last.current = null; rate.current = 0; }
  else if (!last.current) last.current = { p: progress, t: now };
  else if (progress > last.current.p && now > last.current.t) {
    const r = (progress - last.current.p) / (now - last.current.t);
    rate.current = rate.current ? rate.current * 0.6 + r * 0.4 : r;
    last.current = { p: progress, t: now };
  }
  return rate.current > 0 ? Math.max(0, (1 - progress) / rate.current) : null;
}

/**
 * Shown to a helper who is close enough to a knocked teammate.
 *
 *   available    "Hold to revive NAME"
 *   holding      the ring fills over the revive time, with the seconds left
 *   blocked      held, but zombies are on the teammate: "Clear the zombies first"
 *   interrupted  it was filling and the server reset it: said so, keep holding
 *
 * When it completes, or the teammate dies, the prompt goes because its
 * target does; the squad list and the feed say which.
 */
export function RevivePrompt({ name, holding, progress, onHold }: {
  name: string; holding: boolean; progress: number; onHold: (down: boolean) => void;
}) {
  const eta = useEta(holding ? progress : 0);
  // A reset while the thumb is still down is an interruption, not a fresh start.
  const peak = useRef(0);
  const [interrupted, setInterrupted] = useState(false);
  useEffect(() => {
    if (!holding) { peak.current = 0; setInterrupted(false); return; }
    if (progress > peak.current) { peak.current = progress; setInterrupted(false); }
    else if (progress <= 0 && peak.current > 0.05) { peak.current = 0; setInterrupted(true); }
  }, [holding, progress]);
  useEffect(() => {
    if (!interrupted) return;
    const id = setTimeout(() => setInterrupted(false), 1800);
    return () => clearTimeout(id);
  }, [interrupted]);

  const blocked = holding && progress <= 0;
  const detail = !holding ? 'Down next to you. Press and hold.'
    : interrupted ? 'Interrupted. Keep holding.'
    : blocked ? 'Clear the zombies first'
    : 'Stay close and keep holding';
  return (
    <HoldAction testID="revive" icon="revive" tint={colors.status.objective} holding={holding} blocked={blocked} progress={progress} onHold={onHold}
      title={holding && !blocked ? `Reviving ${name}` : `Hold to revive ${name}`}
      detail={detail}
      reading={eta != null ? `${eta.toFixed(1)}s` : `${Math.round(progress * 100)}%`} />
  );
}
