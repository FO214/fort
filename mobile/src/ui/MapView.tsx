/**
 * The building, drawn from the map file: outline, walls, room names, the
 * helicopter, zombies, and every player as a live marker.
 *
 * Two modes:
 *   mini  a small window around you with the gun pointing up, so "ahead on
 *         the map" is "ahead through the camera"
 *   full  the whole floor, plan way up, everyone named
 *
 * Only what helps you move is drawn. Players keep their identity colour and
 * shape; zombies have a shape per type; the helicopter is the amber H.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { fitFull, mapExtent } from './mapFrame';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect } from 'react-native-svg';
import type { Identity } from '../game/identity';
import type { MapInfo, PlayerSnap, ZombieRow } from '../net/types';
import { alpha, colors } from '../theme';
import { markerShape } from './PlayerMarker';
import { T } from './T';
import { zombieKind, type ZombieKind } from './ZombieSprite';

export interface MapPose { x: number; y: number; heading: number | null }

interface Props {
  map: MapInfo;
  me: MapPose;
  myId: string | undefined;
  squad: PlayerSnap[];
  zombies: ZombieRow[];
  identityOf: (id: string) => Identity;
  nameOf?: (id: string) => string;
  width: number;
  height: number;
  mode: 'mini' | 'full';
  /** Mini only: metres from you to the edge of the window. */
  rangeM?: number;
  /** False in endless mode, where there is no helicopter to walk to. */
  showHeli?: boolean;
}

/** Does this map have anything to draw beyond dots? The open arena does not. */
export const hasFloorPlan = (map: MapInfo | null | undefined): boolean =>
  !!map && ((map.outline?.length ?? 0) >= 3 || (map.walls?.length ?? 0) > 0 || (map.paths?.length ?? 0) > 0);

/** How wide the walked floor is drawn, in metres: the server opens 0.9 m either side of the walk. */
const WALK_WIDTH_M = 1.8;

/**
 * The walked floor and the furniture, as SVG in map metres. Built once per
 * map; every frame only the transform that places it changes, so a long walk
 * costs the minimap nothing extra.
 */
function Floor({ map, mini }: { map: MapInfo; mini: boolean }) {
  return useMemo(() => {
    const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
    return (
      <>
        {(map.paths ?? []).map((p, i) => (
          <Path key={`w${i}`} d={line(p)} fill="none" stroke={alpha(colors.textPrimary, mini ? 0.16 : 0.22)}
            strokeWidth={WALK_WIDTH_M} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {(map.obstacles ?? []).map((p, i) => (
          <Path key={`o${i}`} d={`${line(p)} Z`} fill={alpha(colors.textPrimary, 0.35)} />
        ))}
      </>
    );
  }, [map, mini]);
}

const EDGE = colors.camera.edge;

/** A zombie on a map: a different shape for each type, in its type colour. */
export function ZombieMark({ x, y, type, scale = 1, opacity = 1 }: { x: number; y: number; type: number; scale?: number; opacity?: number }) {
  const kind: ZombieKind = zombieKind(type);
  const fill = colors.zombies[kind];
  const s = scale;
  const common = { fill, stroke: EDGE, strokeWidth: 1, opacity };
  switch (kind) {
    case 'runner': return <Polygon points={`${x},${y - 4.4 * s} ${x + 3.4 * s},${y + 3.4 * s} ${x - 3.4 * s},${y + 3.4 * s}`} {...common} />;
    case 'brute': return <Rect x={x - 3.8 * s} y={y - 3.8 * s} width={7.6 * s} height={7.6 * s} {...common} />;
    case 'boss': return (
      <G opacity={opacity}>
        <Polygon points={`${x},${y - 7 * s} ${x + 7 * s},${y} ${x},${y + 7 * s} ${x - 7 * s},${y}`} fill={fill} stroke={colors.textPrimary} strokeWidth={1.4} />
        <Circle cx={x} cy={y} r={1.8 * s} fill={colors.textPrimary} />
      </G>
    );
    default: return <Circle cx={x} cy={y} r={2.9 * s} {...common} />;
  }
}

/** A teammate on a map: their identity shape. A ring means knocked; hollow means dead. */
export function MateMark({ x, y, identity, state, scale = 1, opacity = 1 }:
  { x: number; y: number; identity: Identity; state: PlayerSnap['st']; scale?: number; opacity?: number }) {
  const k = (0.46 * scale);
  return (
    <G opacity={opacity}>
      {state === 'knocked' ? <Circle cx={x} cy={y} r={9.5 * scale} fill="none" stroke={colors.status.danger} strokeWidth={1.8} /> : null}
      <G transform={`translate(${x - 12 * k} ${y - 12 * k}) scale(${k})`}>
        {state === 'dead'
          ? markerShape(identity.shape, colors.background, identity.color, 4)
          : markerShape(identity.shape, identity.color, EDGE, 2.4)}
      </G>
    </G>
  );
}

/** The helicopter: an amber disc with an H. The same mark on every map. */
export function HeliMark({ x, y, scale = 1, opacity = 1 }: { x: number; y: number; scale?: number; opacity?: number }) {
  const r = 7.5 * scale;
  return (
    <G opacity={opacity}>
      <Circle cx={x} cy={y} r={r} fill={colors.status.objective} stroke={EDGE} strokeWidth={1} />
      <Path d={`M ${x - 2.6 * scale} ${y - 3.4 * scale} v ${6.8 * scale} M ${x + 2.6 * scale} ${y - 3.4 * scale} v ${6.8 * scale} M ${x - 2.6 * scale} ${y} h ${5.2 * scale}`}
        stroke={colors.brand.onAmber} strokeWidth={1.9 * scale} fill="none" />
    </G>
  );
}

/** You: a bone arrow pointing where the blaster points. */
export function MeMark({ x, y, turn = 0, scale = 1 }: { x: number; y: number; turn?: number; scale?: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${turn}) scale(${scale})`}>
      <Path d="M 0 -9.5 L 6.5 7.5 L 0 3.8 L -6.5 7.5 Z" fill={colors.textPrimary} stroke={EDGE} strokeWidth={1.4} strokeLinejoin="miter" />
    </G>
  );
}

const WORD_W = 140;
const styles = StyleSheet.create({
  word: { position: 'absolute', width: WORD_W },
  // A name sits on a small plate so it holds over walls and markers.
  name: { backgroundColor: colors.camera.backingStrong, paddingHorizontal: 5, overflow: 'hidden' },
});

export function MapView({ map, me, myId, squad, zombies, identityOf, nameOf, width, height, mode, rangeM = 22, showHeli = true }: Props) {
  const heading = me.heading ?? 0;
  const mini = mode === 'mini';

  // World metres → screen pixels.
  // The same mapping as an SVG matrix, for drawing whole shapes in metres.
  let to: (x: number, y: number) => [number, number];
  let matrix: string;
  // The extent of a full map, worked out once per map (a walk can be thousands of points).
  const extent = useMemo(() => mapExtent(map), [map]);
  if (mini) {
    const s = Math.min(width, height) / 2 / rangeM;
    const h = (heading * Math.PI) / 180, cos = Math.cos(h), sin = Math.sin(h);
    to = (x, y) => {
      const dx = x - me.x, dy = y - me.y;
      return [width / 2 + (dx * cos - dy * sin) * s, height / 2 - (dx * sin + dy * cos) * s];
    };
    matrix = `matrix(${s * cos} ${-s * sin} ${-s * sin} ${-s * cos} ${width / 2 - s * (cos * me.x - sin * me.y)} ${height / 2 + s * (sin * me.x + cos * me.y)})`;
  } else {
    const fit = fitFull(extent, width, height);
    to = fit.to;
    matrix = fit.matrix;
  }

  const outline = (map.outline ?? []).map(([x, y]) => to(x, y).join(',')).join(' ');
  const [hx, hy] = to(map.helicopter.x, map.helicopter.y);
  const [mx, my] = to(me.x, me.y);
  const k = mini ? 0.9 : 1.15;

  return (
    <View testID={mini ? 'minimap' : 'fullmap'}>
      <Svg width={width} height={height}>
        <Defs>
          <ClipPath id={`clip-${mode}`}><Rect x={0} y={0} width={width} height={height} /></ClipPath>
        </Defs>
        <G clipPath={`url(#clip-${mode})`}>
          <G transform={matrix}><Floor map={map} mini={mini} /></G>
          {outline ? <Polygon points={outline} fill={mini ? alpha(colors.textPrimary, 0.1) : colors.surface} stroke={colors.borderStrong} strokeWidth={1} /> : null}
          {(map.walls ?? []).map((w, i) => {
            const [x1, y1] = to(w[0], w[1]), [x2, y2] = to(w[2], w[3]);
            return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={alpha(colors.textPrimary, 0.82)} strokeWidth={mini ? 1.5 : 2} strokeLinecap="square" />;
          })}
          {showHeli ? <HeliMark x={hx} y={hy} scale={mini ? 0.95 : 1.5} /> : null}
          {zombies.map((z) => {
            const [zx, zy] = to(z[2], z[3]);
            return <ZombieMark key={`z${z[0]}`} x={zx} y={zy} type={z[1]} scale={k} />;
          })}
          {squad.filter((p) => p.id !== myId).map((p) => {
            const [px, py] = to(p.x, p.y);
            const identity = identityOf(p.id);
            return <MateMark key={p.id} x={px} y={py} identity={identity} state={p.st} scale={mini ? 0.9 : 1.2} />;
          })}
          {/* Mini: the map turns, the arrow always points up. Full: the arrow turns. */}
          <MeMark x={mx} y={my} turn={mini ? 0 : heading} scale={mini ? 0.9 : 1.2} />
        </G>
      </Svg>
      {/* Words are ordinary text laid over the drawing, so they are set in the interface face everywhere. */}
      {mini ? null : (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {(map.labels ?? []).map((lb, i) => {
            const [lx, ly] = to(lb.x, lb.y);
            return <T key={i} v="label" c={colors.textSecondary} center numberOfLines={1} style={[styles.word, { left: lx - WORD_W / 2, top: ly - 9 }]}>{lb.text}</T>;
          })}
          {nameOf ? squad.filter((p) => p.id !== myId).map((p) => {
            const [px, py] = to(p.x, p.y);
            return (
              <View key={p.id} style={[styles.word, { left: px - WORD_W / 2, top: py - 31, alignItems: 'center' }]}>
                <T v="label" c={colors.textPrimary} numberOfLines={1} style={styles.name}>{nameOf(p.id)}</T>
              </View>
            );
          }) : null}
        </View>
      )}
    </View>
  );
}
