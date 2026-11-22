import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { bearingXY, distXY } from '../game/geo';
import type { Identity } from '../game/identity';
import type { MapInfo, PlayerSnap, ZombieRow } from '../net/types';
import { alpha, colors } from '../theme';
import { HudPanel } from './HudPanel';
import { T } from './T';
import { HeliMark, MapView, MateMark, MeMark, ZombieMark, hasFloorPlan, type MapPose } from './MapView';

const RADAR_RANGE_M = 30;

/**
 * Top-right: where things are around you, gun pointing up.
 *
 * In a building this is the floor plan around you, and tapping it opens the
 * whole floor. On the open arena there is no plan, so it is a range ring:
 * anything further than the ring is pinned to its rim and faded.
 */
export function Minimap({ map, me, myId, squad, zombies, identityOf, size, onOpen, showHeli = true }: {
  map: MapInfo | null; me: MapPose; myId: string | undefined; squad: PlayerSnap[]; zombies: ZombieRow[];
  identityOf: (id: string) => Identity; size: number; onOpen?: () => void;
  /** False in endless mode: no helicopter to mark. */
  showHeli?: boolean;
}) {
  const plan = map && hasFloorPlan(map) ? map : null;
  const body = (
    <HudPanel material="glass" contentStyle={{ width: size, height: size }}>
      {plan
        ? <MapView map={plan} me={me} myId={myId} squad={squad} zombies={zombies} identityOf={identityOf} width={size} height={size} mode="mini" showHeli={showHeli} />
        : <Radar me={me} myId={myId} squad={squad} zombies={zombies} heli={showHeli ? map?.helicopter : null} identityOf={identityOf} size={size} />}
    </HudPanel>
  );
  if (!plan || !onOpen) return body;
  return (
    <Pressable onPress={onOpen} testID="minimap-open" accessibilityRole="button" accessibilityLabel="Open the map">{body}</Pressable>
  );
}

function Radar({ me, myId, squad, zombies, heli, identityOf, size }: {
  me: MapPose; myId: string | undefined; squad: PlayerSnap[]; zombies: ZombieRow[];
  heli?: { x: number; y: number } | null; identityOf: (id: string) => Identity; size: number;
}) {
  const c = size / 2;
  const rMax = c - 9;
  const heading = me.heading ?? 0;
  const place = (x: number, y: number) => {
    const dist = distXY(me.x, me.y, x, y);
    const rel = ((bearingXY(me.x, me.y, x, y) - heading) * Math.PI) / 180;
    const r = (Math.min(dist, RADAR_RANGE_M) / RADAR_RANGE_M) * rMax;
    return { x: c + Math.sin(rel) * r, y: c - Math.cos(rel) * r, far: dist > RADAR_RANGE_M };
  };
  const northA = (-heading * Math.PI) / 180;
  const nx = c + Math.sin(northA) * (rMax - 1), ny = c - Math.cos(northA) * (rMax - 1);
  const h = heli ? place(heli.x, heli.y) : null;
  const line = alpha(colors.textPrimary, 0.22);
  return (
    <View testID="radar">
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={rMax} fill={alpha(colors.textPrimary, 0.05)} stroke={alpha(colors.textPrimary, 0.4)} strokeWidth={1} />
        <Circle cx={c} cy={c} r={rMax / 2} fill="none" stroke={line} strokeWidth={1} />
        <Line x1={c} y1={c - rMax} x2={c} y2={c + rMax} stroke={line} strokeWidth={1} />
        <Line x1={c - rMax} y1={c} x2={c + rMax} y2={c} stroke={line} strokeWidth={1} />
        <Circle cx={nx} cy={ny} r={7} fill={colors.background} />
        {h ? <HeliMark x={h.x} y={h.y} scale={0.9} opacity={h.far ? 0.75 : 1} /> : null}
        {zombies.map((z) => {
          const d = place(z[2], z[3]);
          return <ZombieMark key={`z${z[0]}`} x={d.x} y={d.y} type={z[1]} scale={d.far ? 0.75 : 1} opacity={d.far ? 0.6 : 1} />;
        })}
        {squad.filter((p) => p.id !== myId).map((p) => {
          const d = place(p.x, p.y);
          return <MateMark key={p.id} x={d.x} y={d.y} identity={identityOf(p.id)} state={p.st} scale={0.9} opacity={d.far ? 0.65 : 1} />;
        })}
        <MeMark x={c} y={c} scale={0.85} />
      </Svg>
      {/* North and the range, as ordinary text over the drawing. */}
      <T v="hudMicro" style={[styles.north, { left: nx - 7, top: ny - 7 }]}>N</T>
      <T v="hudMicro" c={colors.textSecondary} style={styles.range}>{RADAR_RANGE_M} m</T>
    </View>
  );
}

const styles = StyleSheet.create({
  north: { position: 'absolute', width: 14, height: 14, lineHeight: 14, fontSize: 10, letterSpacing: 0, textAlign: 'center' },
  range: { position: 'absolute', right: 4, bottom: 2, fontSize: 10, letterSpacing: 0.4, textTransform: 'none' },
});
