/**
 * Weapon silhouettes for the class cards. Custom-drawn as one family: side
 * view, muzzle to the right, flat fill, square geometry. Each one reads from
 * its outline alone: the pistol is an L, the SMG has a straight magazine and
 * a wire stock, the shotgun is two long tubes with a pump, the rifle has a
 * solid stock, a raked magazine and a tall front sight.
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle';

const SILHOUETTES: Record<WeaponKind, string> = {
  pistol:
    // slide, sights, frame, grip, trigger guard
    'M26 12h44l3 3v8H26z M28 9.5h4V12h-4z M65 9.5h3V12h-3z'
    + ' M29 23h16l-5 20H24z'
    + ' M45 23h13v4.5c0 4.7-3 7.5-7.5 7.5H43l.7-2.8h6.3c3 0 5-1.7 5-4.7V25.8H44.3z',
  smg:
    // wire stock, receiver, rail, barrel, muzzle, magazine, grip
    'M5 13h14v3H8v8H5z M19 12h46v11H19z M30 8.5h22V12H30z M58 7.5h3V12h-3z'
    + ' M65 15.5h14v4H65z M79 14h5v7h-5z'
    + ' M43 23h10l-2 20h-10z M25 23h10l-4 14h-10z',
  shotgun:
    // stock, receiver, barrel, magazine tube, pump, bead, grip
    'M24 12v12L6 32 3 20z M24 11h15v13H24z M39 12h51v3.5H39z M39 17.5h42V21H39z'
    + ' M53 16h17v8.5H53z M86.5 9.5h2.5V12h-2.5z'
    + ' M26 24h9l-2.5 7H25z',
  rifle:
    // stock, receiver, rear sight, handguard, barrel, flash hider, front sight, magazine, grip
    'M3 13h16v10L3 27z M19 12h31v11H19z M24 8h14v4H24z M50 13h23v9H50z'
    + ' M73 16h15v3.5H73z M88 14.5h5v6.5h-5z M77 8.5h3V16h-3z'
    + ' M36 23h11l4 14-10 3z M24 23h9l-3 13h-9z',
};

/** Server class ids → the silhouette that stands for them. Unknown ids get the pistol. */
const KIND_OF: Record<string, WeaponKind> = {
  pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle',
  // The original three-class table, still served by older servers.
  regular: 'pistol', light: 'smg', heavy: 'rifle',
};

export const weaponKind = (classId: string): WeaponKind => KIND_OF[classId] ?? 'pistol';

export function WeaponGlyph({ classId, width = 72, color = colors.textPrimary }: { classId: string; width?: number; color?: string }) {
  return (
    <Svg width={width} height={(width * 48) / 96} viewBox="0 0 96 48">
      <Path d={SILHOUETTES[weaponKind(classId)]} fill={color} />
    </Svg>
  );
}
