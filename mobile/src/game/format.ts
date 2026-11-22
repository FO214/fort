/**
 * The small rules for how game values are written on screen. Pure, so they
 * can be tested without a renderer.
 */

export const CODE_LENGTH = 4;

/** Whatever was typed or pasted, as a mission code: capitals and digits, four at most. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

/** Health as a whole percentage: what the squad list and the player's own readout show. */
export const healthPct = (hp: number, max: number) => (max > 0 ? Math.round((Math.max(0, hp) / max) * 100) : 0);

/** Seconds as m:ss. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

/** "one", "two"… for the short counts the extraction line speaks in. */
const WORD = ['no', 'one', 'two', 'three', 'four'];
const count = (n: number) => WORD[n] ?? String(n);

/**
 * What the extraction line says, for holders and defenders alike: how many
 * are holding, and what is still missing.
 */
export function extractionLine(holding: number, need: number, progress: number): string {
  const tally = `${holding} of ${need} holding`;
  if (holding >= need) return `${tally}. Cover them.`;
  if (holding === 0) return progress > 0 ? `Paused. ${tally}.` : `${tally}. Press and hold to extract.`;
  return `${progress > 0 ? 'Paused. ' : ''}${tally}. Need ${count(need - holding)} more.`;
}

/** The two modes, as the lobby, the HUD and the results name and explain them. */
export const MODES = {
  mission: { name: 'Mission', line: 'Reach the helicopter, hold it for two waves, then extract together.' },
  endless: { name: 'Endless', line: 'No helicopter and no way out. Waves keep coming, each one tougher, until nobody is standing.' },
} as const;
