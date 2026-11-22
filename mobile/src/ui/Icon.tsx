/**
 * The icon family: one set, drawn here, on a 24-unit grid.
 *
 * Geometric outlines with a single stroke weight, square ends and mitred
 * corners, to sit next to the condensed type. A few icons carry a filled
 * part (`fill`) for the states that need weight: knocked, the fire control.
 * Nothing here is an emoji and nothing is borrowed from another style.
 */
import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, stroke as strokeTokens } from '../theme';

type Shape =
  | { d: string; fill?: boolean; o?: number }
  | { c: [number, number, number]; fill?: boolean; dash?: string; o?: number }
  | { r: [number, number, number, number]; fill?: boolean; o?: number };

const p = (d: string, extra: Partial<{ fill: boolean; o: number }> = {}): Shape => ({ d, ...extra });
const c = (cx: number, cy: number, r: number, extra: Partial<{ fill: boolean; dash: string; o: number }> = {}): Shape => ({ c: [cx, cy, r], ...extra });
const r = (x: number, y: number, w: number, h: number, extra: Partial<{ fill: boolean; o: number }> = {}): Shape => ({ r: [x, y, w, h], ...extra });

const CROSS = 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z';

const ICONS = {
  // ---- navigation
  back: [p('M20 12H5M11 5.5 4.5 12l6.5 6.5')],
  forward: [p('M4 12h15M13 5.5l6.5 6.5-6.5 6.5')],
  close: [p('M5.5 5.5l13 13M18.5 5.5l-13 13')],
  check: [p('M4 12.5l5.5 5.5L20 6.5')],
  chevronDown: [p('M5.5 9l6.5 6.5L18.5 9')],
  chevronRight: [p('M9 5.5l6.5 6.5L9 18.5')],
  settings: [p('M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z'), c(12, 12, 3.2)],
  copy: [r(9, 9, 11.5, 11.5), p('M5.5 15H3.5V3.5H15v2')],
  info: [c(12, 12, 9), p('M12 11v6M12 7v1')],
  menu: [p('M4 6.5h16M4 12h16M4 17.5h16')],
  plus: [p('M12 5v14M5 12h14')],
  minus: [p('M5 12h14')],

  // ---- connectivity
  online: [p('M2.5 9.5a13.5 13.5 0 0 1 19 0M5.8 13a9 9 0 0 1 12.4 0M9 16.4a4.4 4.4 0 0 1 6 0'), c(12, 19.6, 0.9, { fill: true })],
  offline: [p('M2.5 9.5a13.5 13.5 0 0 1 19 0M5.8 13a9 9 0 0 1 12.4 0M9 16.4a4.4 4.4 0 0 1 6 0', { o: 0.4 }), c(12, 19.6, 0.9, { fill: true }), p('M4 3.5l16 17')],
  reconnecting: [p('M20 11.5A8 8 0 0 0 5.6 7.3L4 9M4 4v5h5M4 12.5a8 8 0 0 0 14.4 4.2L20 15M20 20v-5h-5')],
  signalWeak: [p('M5 20v-3.5'), p('M10 20v-7', { o: 0.38 }), p('M15 20V9.5', { o: 0.38 }), p('M20 20V5', { o: 0.38 })],

  // ---- hardware
  phone: [r(7, 2.5, 10, 19), p('M10.5 18.5h3')],
  pairing: [p('M10 14.2a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 9.8a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2')],
  unpaired: [p('M13.2 5.3A4 4 0 0 1 18.7 11l-1.6 1.6M10.8 18.7A4 4 0 0 1 5.3 13l1.6-1.6M4 4l16 16')],
  timeout: [c(12, 13.5, 7.5), p('M12 9.5v4l2.6 2.6M9.5 2.5h5')],
  trigger: [r(3, 4.5, 18, 4.5), p('M7 9v3.5a5 5 0 0 0 10 0V9M12.8 9c0 2.6-.9 4-2.2 4.8')],
  reload: [p('M20 11.5A8 8 0 0 0 5.6 7.3L4 9M4 4v5h5M4 12.5a8 8 0 0 0 14.4 4.2L20 15M20 20v-5h-5')],
  blaster: [p('M2.5 7.5h17l2 2v3H13l-1.5 2.5H9.5L8 19.5H3.5L5.5 12.5h-3z'), p('M13 12.5v1.5a2 2 0 0 1-2 2')],
  rotate: [r(8.5, 6.5, 7, 12), p('M3 13a9 9 0 0 1 4-7.5M3 5v4.5h4.5M21 11a9 9 0 0 1-4 7.5M21 19v-4.5h-4.5')],

  // ---- combat
  crosshair: [c(12, 12, 7.5), p('M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6')],
  hit: [p('M4.5 4.5l4.5 4.5M19.5 4.5L15 9M4.5 19.5L9 15M19.5 19.5L15 15')],
  kill: [p('M4.5 4.5l3.5 3.5M19.5 4.5L16 8M4.5 19.5L8 16M19.5 19.5L16 16'), p('M12 8l4 4-4 4-4-4z', { fill: true })],
  ammo: [p('M4 20.5v-9.5c0-2.8.8-4.6 2-6 1.2 1.4 2 3.2 2 6v9.5zM10 20.5v-9.5c0-2.8.8-4.6 2-6 1.2 1.4 2 3.2 2 6v9.5zM16 20.5v-9.5c0-2.8.8-4.6 2-6 1.2 1.4 2 3.2 2 6v9.5z')],
  health: [p(CROSS)],
  /** Four-point burst: the fallback trigger. */
  fire: [p('M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z', { fill: true })],
  damage: [p('M4 15.5 12 7l8 8.5M7.5 19.5 12 14.5l4.5 5')],
  warning: [p('M12 3.5 22 20.5H2z'), p('M12 10v5M12 17.5v.5')],

  // ---- squad
  player: [c(12, 8, 3.6), p('M5 20.5c0-4 3-6.5 7-6.5s7 2.5 7 6.5')],
  squad: [c(9, 8.500, 3.200), p('M2.5 20c0-3.7 2.8-6 6.5-6s6.5 2.3 6.5 6'), p('M15.5 5.5a3.2 3.2 0 0 1 0 6.2M18 14.5c2.2.8 3.5 2.7 3.5 5.5')],
  host: [p('M3.5 8.5 8 12.5l4-7.5 4 7.5 4.5-4-1.5 10h-14z')],
  ready: [c(12, 12, 9), p('M7.8 12.3l2.9 2.9L16.2 9.5')],
  notReady: [c(12, 12, 9, { dash: '3.2 3.87' })],
  knocked: [p(CROSS, { fill: true })],
  dead: [c(12, 12, 9), p('M8.5 8.5l7 7M15.5 8.5l-7 7')],
  revive: [p('M7 12.5V5.8a1.5 1.5 0 0 1 3 0V11M10 10.5V3.8a1.5 1.5 0 0 1 3 0v6.7M13 10.5V4.8a1.5 1.5 0 0 1 3 0V11.5M16 11.5V7.8a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1.3a6 6 0 0 1-5-2.7l-2.8-4.2a1.6 1.6 0 0 1 2.6-1.9L7 14')],
  spectate: [p('M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12z'), c(12, 12, 3)],
  leave: [p('M9.5 20.5H4v-17h5.5M15 16.5l4.5-4.5L15 7.5M19.5 12H9')],

  // ---- mission
  map: [p('M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20')],
  waypoint: [p('M12 3l7 17.5-7-4.5-7 4.5z')],
  helicopter: [p('M2.5 4.5h19M12 4.5V8M3 9.5v3h5l3.5 3.5H20.5v-1.5A6.5 6.5 0 0 0 14 8H8.5l-1.5 1.5zM14 8v4.5h6M9 20h11.5M12 16v4M17.5 16v4')],
  scan: [p('M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5'), r(7, 7, 4, 4), r(13, 7, 4, 4), r(7, 13, 4, 4), p('M13 13h4v4')],
  objective: [p('M5 21.5V3.5M5 4h14l-3.5 4.5L19 13H5')],
  wave: [p('M4 9.5l8-5.5 8 5.5M4 14.5l8-5.5 8 5.5M4 19.5l8-5.5 8 5.5')],

  // ---- system
  camera: [p('M3 7.5h4L8.5 5h7L17 7.5h4V19.5H3z'), c(12, 13.200, 3.500)],
  location: [p('M12 21.5S5 15.5 5 10a7 7 0 0 1 14 0c0 5.5-7 11.5-7 11.5z'), c(12, 10, 2.500)],
  motion: [p('M2 12h4.5L9.5 4.5l4.5 15 3-7.5H22')],
  permission: [r(5, 10.500, 14, 10.500), p('M8 10.5V7a4 4 0 0 1 8 0v3.5M12 14.5v3')],
  error: [c(12, 12, 9), p('M12 7v6M12 16v1')],
  retry: [p('M4 12a8 8 0 1 0 2.6-5.9L4 8.5M4 3.5v5h5')],
  loading: [p('M12 3a9 9 0 1 0 9 9')],
  sound: [p('M3.5 9.5h4L12 5.5v13L7.5 14.5h-4zM15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.2a8.2 8.2 0 0 1 0 11.6')],
  soundOff: [p('M3.5 9.5h4L12 5.5v13L7.5 14.5h-4zM16 9.5l5 5M21 9.5l-5 5')],
  haptics: [r(8, 4, 8, 16), p('M4.5 9v6M19.5 9v6M1.5 10.5v3M22.5 10.5v3')],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon({ name, size = 24, color = colors.textPrimary, weight = strokeTokens.icon, testID }:
  { name: IconName; size?: number; color?: string; weight?: number; testID?: string }) {
  const shapes: Shape[] = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" testID={testID}>
      {shapes.map((s, i) => {
        const common = {
          opacity: s.o, stroke: color, strokeWidth: weight, fill: s.fill ? color : 'none',
          strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const,
        };
        if ('d' in s) return <Path key={i} {...common} d={s.d} />;
        if ('c' in s) return <Circle key={i} {...common} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} strokeDasharray={s.dash} strokeLinecap={s.dash ? 'butt' : 'square'} />;
        return <Rect key={i} {...common} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} />;
      })}
    </Svg>
  );
}
