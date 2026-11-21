/**
 * What a zombie looks like. This is the one component to replace when real
 * art arrives (sprite frames cut from video, or a 3D model): everything
 * outside it only knows the props below.
 *
 * For now it is drawn in code: a dark, hunched figure with a glowing edge
 * that reads against any camera image.
 */
import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Polyline, Rect } from 'react-native-svg';
import { Z_ATTACK } from '../net/types';
import { SPRITE_ASPECT, VIEW } from './spriteBox';

export interface ZombieSpriteProps {
  /** Zombie type code from the server (0 = walker). */
  type: number;
  /** Zombie state code from the server (idle / chase / attack). */
  state: number;
  /** Rendered height in pixels; width is height × SPRITE_ASPECT. */
  size: number;
  /** Which frame of the shamble to show: 0 or 1. */
  frame: number;
  /** Health left, 0–1. A bar appears once it has been hurt. */
  hp: number;
  /** True for the instant after a bullet lands. */
  hurt: boolean;
  /** True while the crosshair is on it. */
  aimed: boolean;
}

const GLOW: Record<number, string> = { 0: '#A8FF5E' };
const BODY = '#06120C';
const BODY_HURT = '#F4FFE9';
const EYE_ATTACK = '#FF5A4D';

type Pt = [number, number];
interface Limb { pts: Pt[]; w: number }
interface Pose { limbs: Limb[]; torso: string; head: { cx: number; cy: number; tilt: number } }

/** Three short claws fanning out from a hand. */
function claws([x, y]: Pt, towards: number): Limb[] {
  return [-32, 0, 32].map((spread) => {
    const a = ((towards + spread) * Math.PI) / 180;
    return { pts: [[x, y], [x + Math.sin(a) * 9, y - Math.cos(a) * 9]] as Pt[], w: 3.6 };
  });
}

/**
 * Head, torso and limbs for one pose. Limbs are thick round-capped lines.
 * The figure lurches: head cocked to one side, one shoulder dropped, knees
 * bent, a ragged hem, arms out in front with the hands hanging.
 */
function pose(attacking: boolean, frame: number): Pose {
  const f = frame ? 1 : -1;
  const head = { cx: 57 + f, cy: 21, tilt: 14 + f * 3 };
  const torso = 'M 27 48 Q 46 31 73 39 L 69 72 L 65 99 l -4 8 l -4 -8 l -5 10 l -4 -9 l -5 8 l -5 -9 Z';
  const lHand: Pt = attacking ? [15, 30 + f * 4] : [19, 94 + f * 4];
  const rHand: Pt = attacking ? [91, 20 - f * 4] : [85, 78 - f * 5];
  const arms: Limb[] = attacking
    ? [
      { pts: [[30, 50], [9, 54 + f * 2], lHand], w: 10 },             // both arms thrown up to grab
      { pts: [[71, 43], [95, 44 - f * 2], rHand], w: 10 },
      ...claws(lHand, -10), ...claws(rHand, 10),
    ]
    : [
      { pts: [[30, 50], [13, 71 + f * 3], lHand], w: 10 },            // reaching, hands hanging
      { pts: [[71, 43], [92, 57 - f * 3], rHand], w: 10 },
      ...claws(lHand, 190), ...claws(rHand, 170),
    ];
  const lFoot: Pt = [37 - f * 4, 175], rFoot: Pt = [65 + f * 5, 175];
  const legs: Limb[] = [
    { pts: [[44, 100], [33 - f * 3, 138], lFoot, [lFoot[0] - 11, 177]], w: 12 },   // knees out, feet splayed
    { pts: [[59, 100], [71 + f * 3, 135], rFoot, [rFoot[0] + 12, 177]], w: 12 },
  ];
  return { limbs: [...legs, ...arms, { pts: [[54, 33], [51, 44]], w: 10 }], torso, head };
}

function Figure({ color, grow, p }: { color: string; grow: number; p: Pose }) {
  return (
    <>
      {p.limbs.map((l, i) => (
        <Polyline key={i} points={l.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke={color}
          strokeWidth={l.w + grow} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <Path d={p.torso} fill={color} stroke={color} strokeWidth={grow} strokeLinejoin="round" />
      <Ellipse cx={p.head.cx} cy={p.head.cy} rx={11.5 + grow / 2} ry={14 + grow / 2} fill={color}
        transform={`rotate(${p.head.tilt} ${p.head.cx} ${p.head.cy})`} />
    </>
  );
}

function ZombieSpriteImpl({ type, state, size, frame, hp, hurt, aimed }: ZombieSpriteProps) {
  const attacking = state === Z_ATTACK;
  const glow = GLOW[type] ?? GLOW[0];
  const p = pose(attacking, frame);
  const eye = attacking ? EYE_ATTACK : glow;
  const { cx, cy, tilt } = p.head;
  return (
    <Svg width={size * SPRITE_ASPECT} height={size} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
      {/* Contact shadow so it stands on the floor instead of floating. */}
      <Ellipse cx={52} cy={178} rx={36} ry={6} fill="#000" opacity={0.4} />
      <G opacity={aimed ? 0.34 : 0.2}><Figure color={glow} grow={16} p={p} /></G>
      <G opacity={aimed ? 1 : 0.9}><Figure color={hurt ? '#FFFFFF' : glow} grow={aimed ? 6.5 : 4.5} p={p} /></G>
      <G opacity={hurt ? 1 : 0.95}><Figure color={hurt ? BODY_HURT : BODY} grow={0} p={p} /></G>
      {!hurt && (
        <>
          {/* Torn flesh: slashes across the chest. */}
          <Path d="M 38 58 l 13 7 M 41 68 l 12 6 M 62 52 l -7 11" stroke={glow} strokeWidth={1.6} opacity={0.45} strokeLinecap="round" fill="none" />
          <G transform={`rotate(${tilt} ${cx} ${cy})`}>
            {/* Sunken, uneven eyes and a jagged mouth. */}
            <Path d={`M ${cx - 9} ${cy - 5} l 7 3`} stroke={eye} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />
            <Path d={`M ${cx + 9} ${cy - 6} l -7 3`} stroke={eye} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />
            <Circle cx={cx - 5} cy={cy - 0.5} r={2.9} fill={eye} />
            <Circle cx={cx + 5} cy={cy - 1} r={2} fill={eye} />
            <Path d={`M ${cx - 6} ${cy + 7} l 2.4 3.2 l 2.4 -3 l 2.4 3.4 l 2.4 -3.2 l 2.4 2.6`}
              stroke={eye} strokeWidth={1.5} fill="none" opacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
          </G>
        </>
      )}
      {hp < 1 && (
        <>
          <Rect x={22} y={-12} width={60} height={5} rx={2.5} fill="rgba(0,0,0,0.55)" />
          <Rect x={22} y={-12} width={60 * Math.max(0, hp)} height={5} rx={2.5} fill={hp <= 0.34 ? EYE_ATTACK : glow} />
        </>
      )}
    </Svg>
  );
}

/** Re-renders only when what it shows changes, not on every camera frame. */
export const ZombieSprite = React.memo(ZombieSpriteImpl);
