/**
 * What a zombie looks like. Still the one component to replace when real art
 * arrives (sprite frames, or a 3D model): everything outside it only knows
 * the props below.
 *
 * Four types, told apart by outline before anything else:
 *
 *   walker  slumped, arms hanging, one leg dragging        pale stone
 *   runner  pitched forward, long arms out, mid-stride     rust
 *   brute   broad, heavy arms, low and wide                violet-grey
 *   boss    tall, lopsided, one huge arm, spined shoulder  crimson
 *
 * The figure is near-black so it reads on a white wall, and carries a rim in
 * its type colour so it reads in a dark corridor. Far away it is only
 * outline, pose and rim; close up it gains a face and torn cloth.
 */
import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { Z_ATTACK } from '../net/types';
import { colors } from '../theme';
import { SPRITE_ASPECT, VIEW } from './spriteBox';

export interface ZombieSpriteProps {
  /** Zombie type code from the server: 0 walker, 1 runner, 2 brute, 3 boss. */
  type: number;
  /** Zombie state code from the server (idle / chase / attack). */
  state: number;
  /** Rendered height in pixels; width is height × SPRITE_ASPECT. */
  size: number;
  /** Which frame of the gait to show: 0 or 1. */
  frame: number;
  /** Health left, 0–1. A bar appears once it has been hurt. */
  hp: number;
  /** True for the instant after a bullet lands. */
  hurt: boolean;
  /** True while the crosshair is on it. */
  aimed: boolean;
}

export type ZombieKind = 'walker' | 'runner' | 'brute' | 'boss';
export const ZOMBIE_KINDS: readonly ZombieKind[] = ['walker', 'runner', 'brute', 'boss'];
export const zombieKind = (type: number): ZombieKind => ZOMBIE_KINDS[type] ?? 'walker';

/**
 * How much bigger than a walker each type is drawn, standing on the same
 * floor. The layer applies it; the hit test stays the server's.
 */
export const ZOMBIE_SCALE: Record<ZombieKind, number> = { walker: 1, runner: 0.96, brute: 1.1, boss: 1.3 };
/** Gait frames per second: runners cycle fast, brutes heave. */
export const ZOMBIE_GAIT: Record<ZombieKind, number> = { walker: 2.2, runner: 5.5, brute: 1.6, boss: 1.9 };

const CUE: Record<ZombieKind, string> = colors.zombies;
const BODY = colors.zombies.body;
const FLASH = colors.textPrimary;
/** Below this many pixels tall there is no room for a face. */
const NEAR_PX = 110;

type Pt = [number, number];
interface Limb { pts: Pt[]; w: number }
interface Blob { cx: number; cy: number; r: number }
interface Head { cx: number; cy: number; rx: number; ry: number; tilt: number }
interface Pose { limbs: Limb[]; torso: string; head: Head; blobs?: Blob[]; spikes?: string[]; cloth?: string; slashes?: string; core?: Blob }

/** A leg and its foot. The foot is thinner than the shin, so it reads as a foot and not a club. */
function leg(pts: Pt[], toe: number, w: number): Limb[] {
  const [ax, ay] = pts[pts.length - 1];
  return [{ pts, w }, { pts: [[ax, ay + 1.5], [ax + toe, ay + 3.5]], w: w * 0.6 }];
}

/** Three thin claws fanning out from a hand. */
function claws([x, y]: Pt, towards: number, len = 10.5, w = 2.6): Limb[] {
  return [-32, 0, 32].map((spread) => {
    const a = ((towards + spread) * Math.PI) / 180;
    return { pts: [[x, y], [x + Math.sin(a) * len, y - Math.cos(a) * len]] as Pt[], w };
  });
}

/** Slumped: shoulders dropped, arms dead at the sides, the left leg dragged behind. */
function walker(attacking: boolean, frame: number): Pose {
  const f = frame ? 1 : -1;
  const head: Head = { cx: 56 + f, cy: 20, rx: 11, ry: 14, tilt: 16 + f * 3 };
  const torso = 'M 27 51 Q 46 35 75 43 L 71 76 L 67 99 l -4 8 l -4 -8 l -5 10 l -4 -9 l -5 8 l -5 -9 L 36 76 Z';
  const lHand: Pt = attacking ? [13, 32 + f * 4] : [22, 106 + f * 3];
  const rHand: Pt = attacking ? [93, 22 - f * 4] : [83, 98 - f * 3];
  const arms: Limb[] = attacking
    ? [
      { pts: [[31, 53], [9, 56 + f * 2], lHand], w: 12 },                 // both arms thrown up to grab
      { pts: [[73, 47], [96, 46 - f * 2], rHand], w: 12 },
      ...claws(lHand, -10), ...claws(rHand, 10),
    ]
    : [
      { pts: [[31, 53], [23, 80 + f * 2], lHand], w: 12 },                // hanging, swinging a little
      { pts: [[73, 47], [82, 72 - f * 2], rHand], w: 12 },
      ...claws(lHand, 185), ...claws(rHand, 172),
    ];
  const legs: Limb[] = [
    ...leg([[44, 100], [39 - f * 2, 140], [32 - f * 3, 171]], -12, 15),   // the dragged leg: straight, foot turned out
    ...leg([[60, 100], [71 + f * 3, 134], [66 + f * 4, 171]], 12, 15),
  ];
  return {
    limbs: [...legs, ...arms, { pts: [[54, 33], [51, 46]], w: 13 }], torso, head,
    cloth: 'M 33 53 Q 47 42 70 47 L 67 76 L 64 96 L 41 96 L 39 76 Z',
    slashes: 'M 39 60 l 13 7 M 42 70 l 12 6 M 63 54 l -7 11',
  };
}

/** Pitched forward: head low and ahead of the shoulders, long thin arms out wide, one knee driven up. */
function runner(attacking: boolean, frame: number): Pose {
  const f = frame ? 1 : -1;
  const head: Head = { cx: 52 + f * 2, cy: 32, rx: 10.5, ry: 13, tilt: f * 6 };
  const torso = 'M 33 45 Q 52 28 71 45 L 64 73 L 61 94 l -4 6 l -5 -6 l -5 6 l -4 -6 L 40 73 Z';
  const lHand: Pt = attacking ? [8, 22] : [3, 40 + f * 12];
  const rHand: Pt = attacking ? [96, 22] : [101, 40 - f * 12];
  const arms: Limb[] = [
    { pts: [[36, 47], [16, 55 + f * 5], lHand], w: 8.5 },
    { pts: [[68, 47], [88, 55 - f * 5], rHand], w: 8.5 },
    ...claws(lHand, attacking ? -20 : -70, 11, 3), ...claws(rHand, attacking ? 20 : 70, 11, 3),
  ];
  // One foot planted, the other snatched up behind the knee; the frames swap them.
  const planted = (hipX: number, side: number) => leg([[hipX, 94], [hipX + side * 7, 136], [hipX + side * 3, 172]], side * 11, 11);
  const lifted = (hipX: number, side: number) => leg([[hipX, 94], [hipX + side * 13, 124], [hipX + side * 4, 150]], side * 7, 11);
  const legs = f > 0 ? [...planted(46, -1), ...lifted(58, 1)] : [...lifted(46, -1), ...planted(58, 1)];
  return {
    limbs: [...legs, ...arms], torso, head,
    cloth: 'M 39 50 Q 52 40 65 50 L 60 73 L 58 90 L 46 90 L 44 73 Z',
    slashes: 'M 44 56 l 9 6 M 61 54 l -6 9',
  };
}

/** Broad and low: a head sunk between huge shoulders, arms like clubs, a wide planted stance. */
function brute(attacking: boolean, frame: number): Pose {
  const f = frame ? 1 : -1;
  const head: Head = { cx: 52, cy: 21 + f * 0.5, rx: 10, ry: 11.5, tilt: f * 2 };
  const torso = 'M 13 44 Q 30 22 52 26 Q 74 22 91 44 L 84 84 L 75 108 L 29 108 L 20 84 Z';
  const lFist: Pt = [7 - f * 2, 114 + f * 3];
  const rFist: Pt = attacking ? [97, 2] : [97 + f * 2, 114 - f * 3];
  const arms: Limb[] = [
    { pts: [[17, 48], [3 - f, 82], lFist], w: 19 },
    attacking
      ? { pts: [[87, 48], [106, 30], rFist], w: 19 }                      // one arm hauled up to smash
      : { pts: [[87, 48], [101 + f, 82], rFist], w: 19 },
  ];
  const legs: Limb[] = [
    ...leg([[38, 108], [31 - f, 142], [29 - f * 2, 170]], -12, 19),
    ...leg([[66, 108], [73 + f, 142], [75 + f * 2, 170]], 12, 19),
  ];
  return {
    limbs: [...legs, ...arms], torso, head,
    blobs: [{ cx: lFist[0], cy: lFist[1], r: 12 }, { cx: rFist[0], cy: rFist[1], r: 12 }],
    cloth: 'M 24 50 Q 52 34 80 50 L 76 84 L 69 102 L 35 102 L 28 84 Z',
    slashes: 'M 30 56 l 18 9 M 34 70 l 16 7 M 74 52 l -10 16 M 44 88 h 16',
  };
}

/** Tall and lopsided: one shoulder hunched high and spined, one arm a blade to the floor. */
function boss(attacking: boolean, frame: number): Pose {
  const f = frame ? 1 : -1;
  const head: Head = { cx: 35 + f, cy: 19, rx: 11, ry: 14, tilt: -10 + f * 2 };
  const torso = 'M 13 46 Q 30 26 54 30 L 84 24 L 89 52 L 75 86 L 66 110 L 26 110 L 20 82 Z';
  const blade: Pt = attacking ? [96, 10] : [90 + f * 2, 148];
  const hand: Pt = attacking ? [-2, 30] : [5 - f * 2, 100 + f * 3];
  const arms: Limb[] = [
    attacking
      ? { pts: [[84, 40], [99, 34], blade], w: 22 }                       // the great arm drawn back overhead
      : { pts: [[84, 40], [98 + f, 92], blade], w: 22 },
    // Three long talons off the great arm.
    ...claws(blade, attacking ? 5 : 180, attacking ? 20 : 26, 5),
    { pts: [[18, 50], [2, 72 + f * 2], hand], w: 12 },
    ...claws(hand, attacking ? -10 : 190, 11, 3.6),
  ];
  const legs: Limb[] = [
    ...leg([[35, 110], [28 - f * 2, 146], [26 - f * 3, 170]], -12, 17),
    ...leg([[57, 110], [65 + f * 2, 144], [64 + f * 3, 170]], 12, 17),
  ];
  return {
    limbs: [...legs, ...arms, { pts: [[37, 32], [37, 44]], w: 14 }], torso, head,
    spikes: ['58,31 63,6 71,29', '69,29 79,2 84,27', '81,28 96,12 91,36'],
    cloth: 'M 22 50 Q 36 38 56 40 L 78 38 L 70 84 L 62 104 L 30 104 L 26 82 Z',
    slashes: 'M 28 58 l 20 10 M 32 74 l 18 8 M 70 48 l -12 20 M 38 94 h 18',
    // What only the boss has: a core that glows through the chest.
    core: { cx: 50, cy: 66, r: 6 },
  };
}

const POSE: Record<ZombieKind, (attacking: boolean, frame: number) => Pose> = { walker, runner, brute, boss };

function Figure({ color, grow, p }: { color: string; grow: number; p: Pose }) {
  return (
    <>
      {p.limbs.map((l, i) => (
        <Polyline key={i} points={l.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke={color}
          strokeWidth={l.w + grow} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {p.blobs?.map((b, i) => <Circle key={`b${i}`} cx={b.cx} cy={b.cy} r={b.r + grow / 2} fill={color} />)}
      {p.spikes?.map((s, i) => <Polygon key={`s${i}`} points={s} fill={color} stroke={color} strokeWidth={grow} strokeLinejoin="round" />)}
      <Path d={p.torso} fill={color} stroke={color} strokeWidth={grow} strokeLinejoin="round" />
      <Ellipse cx={p.head.cx} cy={p.head.cy} rx={p.head.rx + grow / 2} ry={p.head.ry + grow / 2} fill={color}
        transform={`rotate(${p.head.tilt} ${p.head.cx} ${p.head.cy})`} />
    </>
  );
}

function ZombieSpriteImpl({ type, state, size, frame, hp, hurt, aimed }: ZombieSpriteProps) {
  const kind = zombieKind(type);
  const attacking = state === Z_ATTACK;
  const cue = CUE[kind];
  const p = POSE[kind](attacking, frame);
  const near = size >= NEAR_PX;
  const eye = attacking || kind === 'boss' ? colors.status.danger : colors.zombies.eye;
  const { cx, cy, tilt, rx } = p.head;
  const e = rx / 11;                                    // face features scale with the head
  const big = kind === 'brute' || kind === 'boss';
  return (
    <Svg width={size * SPRITE_ASPECT} height={size} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
      {/* Contact shadow so it stands on the floor instead of floating. */}
      <Ellipse cx={kind === 'boss' ? 46 : 52} cy={177} rx={big ? 46 : 34} ry={6} fill={colors.camera.edge} />
      {/*
        Four passes, back to front:
          a soft dark edge, so the type colour never sits straight on a bright wall
          a thin rim in the type colour all the way round, so nothing is lost in a dark corridor
          the same colour again, pushed up and to the left: light catching the top edges
          the body
      */}
      <G opacity={0.4}><Figure color={BODY} grow={9} p={p} /></G>
      <G opacity={hurt ? 1 : 0.55}><Figure color={hurt ? FLASH : cue} grow={aimed ? 6 : near ? 2.5 : 5} p={p} /></G>
      {hurt ? null : <G transform={near ? 'translate(-2.6 -3)' : 'translate(-3.4 -3.8)'}><Figure color={cue} grow={0} p={p} /></G>}
      <Figure color={hurt ? FLASH : BODY} grow={0} p={p} />
      {!hurt && (
        <>
          {near && p.cloth ? <Path d={p.cloth} fill={colors.zombies.cloth} /> : null}
          {near && p.slashes ? <Path d={p.slashes} stroke={cue} strokeWidth={1.6} opacity={0.6} strokeLinecap="round" fill="none" /> : null}
          {p.core ? (
            <>
              <Circle cx={p.core.cx} cy={p.core.cy} r={p.core.r * 1.9} fill={colors.status.danger} opacity={0.3} />
              <Circle cx={p.core.cx} cy={p.core.cy} r={p.core.r} fill={colors.status.danger} />
            </>
          ) : null}
          <G transform={`rotate(${tilt} ${cx} ${cy})`}>
            {/* Two points of light: they carry at any distance. Up close, a slack jaw under them. */}
            <Circle cx={cx - 4.4 * e} cy={cy - 1} r={(near ? 3.6 : 4.2) * e} fill={eye} opacity={0.28} />
            <Circle cx={cx + 4.4 * e} cy={cy - 1.4} r={(near ? 3.6 : 4.2) * e} fill={eye} opacity={0.28} />
            <Circle cx={cx - 4.4 * e} cy={cy - 1} r={(near ? 1.9 : 2.8) * e} fill={eye} />
            <Circle cx={cx + 4.4 * e} cy={cy - 1.4} r={(near ? 1.6 : 2.8) * e} fill={eye} />
            {near ? (
              // A slack, open jaw. Wider when it is about to bite.
              <Ellipse cx={cx + 0.5} cy={cy + 8.2 * e} rx={3.4 * e} ry={(attacking ? 4.4 : 2.3) * e}
                fill={colors.camera.edge} stroke={cue} strokeWidth={0.9} opacity={0.75} />
            ) : null}
          </G>
        </>
      )}
      {hp < 1 && (
        <>
          <Rect x={21} y={-14} width={62} height={8} fill={colors.camera.edge} />
          <Rect x={22} y={-13} width={60 * Math.max(0, hp)} height={6} fill={hp <= 0.34 ? colors.status.danger : colors.textPrimary} />
        </>
      )}
    </Svg>
  );
}

/** Re-renders only when what it shows changes, not on every camera frame. */
export const ZombieSprite = React.memo(ZombieSpriteImpl);
