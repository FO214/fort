/**
 * The building, drawn from the map file: outline, walls, room names, the
 * helicopter, zombies, and every player as a live dot.
 *
 * Two modes:
 *   mini  a small window around you with the gun pointing up, so "ahead on
 *         the map" is "ahead through the camera"
 *   full  the whole floor, plan way up, everyone named
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { MapInfo, PlayerSnap, ZombieRow } from '../net/types';
import { color, font } from '../theme';

export interface MapPose { x: number; y: number; heading: number | null }

interface Props {
  map: MapInfo;
  me: MapPose;
  myId: string | undefined;
  squad: PlayerSnap[];
  zombies: ZombieRow[];
  nameOf?: (id: string) => string;
  width: number;
  height: number;
  mode: 'mini' | 'full';
  /** Mini only: metres from you to the edge of the window. */
  rangeM?: number;
}

/** Does this map have anything to draw beyond dots? The open arena does not. */
export const hasFloorPlan = (map: MapInfo | null | undefined): boolean =>
  !!map && ((map.outline?.length ?? 0) >= 3 || (map.walls?.length ?? 0) > 0);

const WALL = 'rgba(245,247,250,0.85)';
const FLOOR = 'rgba(255,255,255,0.07)';

export function MapView({ map, me, myId, squad, zombies, nameOf, width, height, mode, rangeM = 22 }: Props) {
  const heading = me.heading ?? 0;
  const mini = mode === 'mini';

  // World metres → screen pixels.
  let to: (x: number, y: number) => [number, number];
  if (mini) {
    const s = Math.min(width, height) / 2 / rangeM;
    const h = (heading * Math.PI) / 180, cos = Math.cos(h), sin = Math.sin(h);
    to = (x, y) => {
      const dx = x - me.x, dy = y - me.y;
      return [width / 2 + (dx * cos - dy * sin) * s, height / 2 - (dx * sin + dy * cos) * s];
    };
  } else {
    const pts: [number, number][] = [...(map.outline ?? []), ...(map.walls ?? []).flatMap((w) => [[w[0], w[1]], [w[2], w[3]]] as [number, number][]),
      [map.helicopter.x, map.helicopter.y], map.start];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 28;
    const s = Math.min((width - pad * 2) / Math.max(maxX - minX, 1), (height - pad * 2) / Math.max(maxY - minY, 1));
    const ox = (width - (maxX - minX) * s) / 2, oy = (height - (maxY - minY) * s) / 2;
    to = (x, y) => [ox + (x - minX) * s, oy + (maxY - y) * s];
  }

  const outline = (map.outline ?? []).map(([x, y]) => to(x, y).join(',')).join(' ');
  const [hx, hy] = to(map.helicopter.x, map.helicopter.y);
  const [mx, my] = to(me.x, me.y);
  // Mini: the map turns, the arrow always points up. Full: the arrow turns.
  const arrowTurn = mini ? 0 : heading;
  const dot = mini ? 3 : 4;

  return (
    <View testID={mini ? 'minimap' : 'fullmap'}>
      <Svg width={width} height={height}>
        <Defs>
          <ClipPath id={`clip-${mode}`}><Rect x={0} y={0} width={width} height={height} rx={mini ? 14 : 0} /></ClipPath>
        </Defs>
        <G clipPath={`url(#clip-${mode})`}>
          <Rect x={0} y={0} width={width} height={height} fill="rgba(6,8,13,0.35)" />
          {outline ? <Polygon points={outline} fill={FLOOR} stroke={color.ink3} strokeWidth={1} /> : null}
          {(map.walls ?? []).map((w, i) => {
            const [x1, y1] = to(w[0], w[1]), [x2, y2] = to(w[2], w[3]);
            return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={WALL} strokeWidth={mini ? 1.5 : 2} strokeLinecap="round" />;
          })}
          {!mini && (map.labels ?? []).map((lb, i) => {
            const [lx, ly] = to(lb.x, lb.y);
            return <SvgText key={i} x={lx} y={ly} fill={color.ink3} fontSize={11} fontWeight="600" fontFamily={font.family} textAnchor="middle">{lb.text}</SvgText>;
          })}

          <Rect x={hx - 7} y={hy - 7} width={14} height={14} rx={3} fill={color.warning} />
          <SvgText x={hx} y={hy + 3.6} fill={color.onAccent} fontSize={10} fontWeight="800" fontFamily={font.family} textAnchor="middle">H</SvgText>

          {zombies.map((z) => {
            const [zx, zy] = to(z[2], z[3]);
            return <Circle key={`z${z[0]}`} cx={zx} cy={zy} r={dot} fill={color.danger} />;
          })}
          {squad.filter((p) => p.id !== myId).map((p) => {
            const [px, py] = to(p.x, p.y);
            const col = p.st === 'alive' ? color.accent : p.st === 'knocked' ? color.warning : color.ink4;
            return (
              <G key={p.id}>
                <Circle cx={px} cy={py} r={dot + 1.5} fill={col} />
                {p.st === 'knocked' && <Circle cx={px} cy={py} r={dot + 5} fill="none" stroke={col} strokeWidth={1.2} />}
                {!mini && nameOf && (
                  <SvgText x={px} y={py - 9} fill={col} fontSize={11} fontWeight="700" fontFamily={font.family} textAnchor="middle">{nameOf(p.id)}</SvgText>
                )}
              </G>
            );
          })}

          <G transform={`translate(${mx} ${my}) rotate(${arrowTurn})`}>
            <Path d="M 0 -9 L 6 7 L 0 3.5 L -6 7 Z" fill={color.ink} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
          </G>
        </G>
      </Svg>
    </View>
  );
}
