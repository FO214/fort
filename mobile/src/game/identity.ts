/**
 * Who is who. Each player gets a slot (P1–P4) from their place in the
 * server's roster, and with it a colour and a shape that stay the same on the
 * roster, the minimap, the squad list and the results.
 *
 * Colour and shape say which player, never how they are doing.
 */
import { PLAYER_COLORS } from '../theme';

export type MarkerShape = 'diamond' | 'circle' | 'square' | 'triangle';
export const MARKER_SHAPES: readonly MarkerShape[] = ['diamond', 'circle', 'square', 'triangle'];

export interface Identity {
  /** 0–3. */
  slot: number;
  /** "P1" … "P4". */
  label: string;
  color: string;
  shape: MarkerShape;
}

export function identityForSlot(slot: number): Identity {
  const i = ((slot % 4) + 4) % 4;
  return { slot: i, label: `P${i + 1}`, color: PLAYER_COLORS[i], shape: MARKER_SHAPES[i] };
}

/** The slot comes from the roster's order, which the server keeps stable for a room. */
export function identityOf(id: string | undefined | null, roster: readonly { id: string }[]): Identity {
  const i = id ? roster.findIndex((p) => p.id === id) : -1;
  return identityForSlot(Math.max(0, i));
}
