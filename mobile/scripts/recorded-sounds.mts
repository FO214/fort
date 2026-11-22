/**
 * The sounds that are recordings rather than synthesised: name -> the file
 * in the repo's top-level sounds/ folder it is made from.
 *
 * import-sounds.mts builds these into assets/sounds/; make-sounds.mts leaves
 * them alone. To use a new recording, drop it in sounds/, add a line here and
 * run `npm run sounds:import`.
 *
 *   maxSeconds   cut it off (with a fade) if it runs longer than this
 *   restSeconds  silence added after it: for a loop, the pause between repeats
 */
export const RECORDED: Record<string, { from: string; maxSeconds?: number; restSeconds?: number }> = {
  'fire-pistol': { from: 'pistol_shot.mp3' },
  // By what the weapon does, not by name: the game's SMG is its automatic,
  // and its Rifle is the slow, hard-hitting, long-range one.
  'fire-smg': { from: 'rifle_shot.mp3' },
  'fire-shotgun': { from: 'shotgun_shot.mp3' },
  'fire-rifle': { from: 'sniper_shot.mp3' },
  hit: { from: 'hitmarker.mp3' },
  knocked: { from: 'knocked.mp3' },
  revived: { from: 'revive.mp3' },
  // Not a cue: the horde's voice, looped by game/sound.ts. A groan, then a breath.
  zombie: { from: 'zombie.mp3', restSeconds: 0.5 },
};
