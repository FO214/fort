/**
 * The ammo count, shown ahead of the server.
 *
 * The server owns the magazine: every pull gets a `fired` answer carrying the
 * true count. Waiting for that answer to move the number puts a trip to the
 * server and back between the trigger and the readout, so a pull the phone
 * believes will fire is taken off the readout at once and remembered here
 * until its answer comes.
 *
 *   shown = the server's last count - pulls still waiting for an answer
 *
 * A pull whose answer never comes (the link dropped, the player was knocked
 * that instant) stops counting after `PENDING_SHOT_S`, so the readout cannot
 * stay wrong.
 */

export interface PendingShot { seq: number; at: number }

/** How long an unanswered pull stays off the readout, in seconds. */
export const PENDING_SHOT_S = 1.5;

/** What the readout shows. */
export function shownAmmo(serverAmmo: number, pending: readonly PendingShot[]): number {
  return Math.max(0, serverAmmo - pending.length);
}

/** The server answered pull `seq`: it and anything sent before it are settled. */
export function settle(pending: readonly PendingShot[], seq: number): PendingShot[] {
  return pending.filter((p) => p.seq > seq);
}

/** Drop pulls that have waited too long for an answer. Returns the same array when nothing changed. */
export function expire(pending: readonly PendingShot[], now: number): readonly PendingShot[] {
  return pending.some((p) => now - p.at >= PENDING_SHOT_S) ? pending.filter((p) => now - p.at < PENDING_SHOT_S) : pending;
}

/**
 * Will the server let this pull fire? Its own rule, checked on the phone:
 * rounds in the magazine, not reloading, and not sooner after the last shot
 * than the weapon allows. Only such a pull is taken off the readout early.
 */
export function willFire(o: { ammo: number; reloading: boolean; sinceLastShotS: number; fireIntervalS: number }): boolean {
  return o.ammo > 0 && !o.reloading && o.sinceLastShotS >= o.fireIntervalS * 0.85;
}
