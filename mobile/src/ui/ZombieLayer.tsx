/**
 * Draws the zombies over the camera. Every frame it asks "where am I, where
 * is the gun pointing, where are the zombies" and places a sprite for each
 * one in view. It also works out what the crosshair is on, with the very
 * same numbers, and leaves that in `aimRef` for the trigger to use.
 *
 * Zombies that are close but out of view get a marker on the screen edge
 * nearest them, so a player knows to turn before they are bitten.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { angleDiffDeg, bearingXY } from '../game/geo';
import { tracking } from '../game/tracking';
import { CAMERA_HFOV_DEG, pickTargets, project, type Camera } from '../game/zombies';
import type { GunClass } from '../net/types';
import { serverNow, zombies } from '../store';
import { colors } from '../theme';
import { SPRITE_ASPECT, spriteBox } from './spriteBox';
import { EdgeMarker, type EdgeThreat } from './ThreatMarker';
import { ZOMBIE_GAIT, ZOMBIE_SCALE, ZombieSprite, zombieKind } from './ZombieSprite';

const FRAME_MS = 33;                               // ~30 fps is plenty for shambling
const MAX_DRAW_M = 70;
const SIZES = [48, 96, 192, 384, 768];             // sprite render sizes; scaled down to fit, never up much
/** An unseen zombie this close gets an edge marker. */
const THREAT_RANGE_M = 14;
const THREATS_PER_SIDE = 3;

export interface AimState {
  /** Zombies under the crosshair, nearest first. */
  ids: number[];
  /** Map heading the gun pointed along when that was worked out. */
  heading: number;
}

interface Item {
  key: string; id: number; type: number; state: number; frame: number; hp: number; hurt: boolean; aimed: boolean;
  left: number; top: number; size: number; scale: number; opacity: number; tilt: number; squash: number; dist: number;
}

/** What the last frame drew, for tests and on-device debugging. */
export const arDebug: { items: { id: number; x: number; y: number; h: number; dist: number; aimed: boolean }[]; aim: number[]; threats: number[] } = { items: [], aim: [], threats: [] };
if (typeof window !== 'undefined') (window as unknown as { __loonieAR?: unknown }).__loonieAR = arDebug;

export function ZombieLayer({ width, height, cls, aimRef, onAimChange, inset = 0 }: {
  width: number; height: number; cls: GunClass | undefined;
  aimRef: React.MutableRefObject<AimState>; onAimChange: (onTarget: boolean) => void;
  /** How far in from the left and right edges the threat markers sit (safe areas). */
  inset?: number;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [threats, setThreats] = useState<EdgeThreat[]>([]);
  const dims = useRef({ width, height, cls, onAimChange });
  dims.current = { width, height, cls, onAimChange };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let wasOnTarget = false;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < FRAME_MS) return;
      last = ts;
      const { width: w, height: h, cls: gun, onAimChange: notify } = dims.current;
      const pose = tracking.pose();
      const now = serverNow();
      const out: Item[] = [];
      const unseen: (EdgeThreat & { dist: number })[] = [];
      let ids: number[] = [];

      if (pose.heading != null) {
        const cam: Camera = { x: pose.x, y: pose.y, heading: pose.heading, pitch: pose.pitch, width: w, height: h, hfov: CAMERA_HFOV_DEG };
        const live = zombies.sample(now);
        if (gun) ids = pickTargets(live, cam, gun);
        const aimed = ids[0];
        const place = (x: number, y: number, grow = 1) => {
          const p = project(x, y, cam);
          if (!p || p.dist > MAX_DRAW_M) return null;
          // Bigger types stand on the same floor and rise from it.
          const box = spriteBox(p.sx, p.bottom - (p.bottom - p.top) * grow, p.bottom);
          if (box.left > w || box.left + box.width < 0 || box.top > h || box.top + box.height < 0 || box.height < 8) return null;
          const size = SIZES.find((s) => s >= box.height) ?? SIZES[SIZES.length - 1];
          const scale = box.height / size;
          // Centre the fixed-size sprite on the box, then scale it to fit.
          return {
            p, size, scale,
            left: box.left + box.width / 2 - (size * SPRITE_ASPECT) / 2,
            top: box.top + box.height / 2 - size / 2,
            far: Math.max(0.6, Math.min(1, 1.25 - p.dist / 60)),
          };
        };
        for (const z of live) {
          const kind = zombieKind(z.type);
          const q = place(z.x, z.y, ZOMBIE_SCALE[kind]);
          if (!q) {
            const dist = Math.hypot(z.x - cam.x, z.y - cam.y);
            if (dist <= THREAT_RANGE_M) {
              const off = angleDiffDeg(bearingXY(cam.x, cam.y, z.x, z.y), cam.heading);
              // Just out of view sits high on the edge; directly behind sits low.
              const behind = Math.min(1, Math.max(0, (Math.abs(off) - CAMERA_HFOV_DEG / 2) / (180 - CAMERA_HFOV_DEG / 2)));
              unseen.push({
                key: `t${z.id}`, id: z.id, side: off >= 0 ? 'right' : 'left', y: h * (0.3 + 0.42 * behind),
                near: dist <= THREAT_RANGE_M / 2.5, color: colors.zombies[kind], dist,
              });
            }
            continue;
          }
          const t = now * ZOMBIE_GAIT[kind] + z.id * 0.37;
          out.push({
            key: `z${z.id}`, id: z.id, type: z.type, state: z.state, frame: Math.floor(t) % 2,
            hp: z.maxHp > 0 ? z.hp / z.maxHp : 1, hurt: z.hitAge < 0.09, aimed: z.id === aimed,
            left: q.left, top: q.top, size: q.size, scale: q.scale,
            opacity: Math.min(1, z.age / 0.45) * q.far, tilt: Math.sin(t * Math.PI) * (kind === 'runner' ? 1.5 : 2.5), squash: 1, dist: q.p.dist,
          });
        }
        for (const c of zombies.dying(now)) {
          const q = place(c.x, c.y, ZOMBIE_SCALE[zombieKind(c.type)]);
          if (!q) continue;
          // Dying: flash, pitch over, sink and fade. Unmistakably gone.
          out.push({
            key: `d${c.id}`, id: c.id, type: c.type, state: 0, frame: 0, hp: 1, hurt: c.age < 0.2, aimed: false,
            left: q.left, top: q.top + (q.size * q.scale * c.age) / 2, size: q.size, scale: q.scale,
            opacity: (1 - c.age) * q.far, tilt: c.age * 24, squash: 1 - c.age * 0.85, dist: q.p.dist,
          });
        }
        out.sort((a, b) => b.dist - a.dist);       // far ones first so near ones overlap them
        aimRef.current = { ids, heading: pose.heading };
      } else {
        aimRef.current = { ids: [], heading: 0 };
      }

      // Nearest few per side; a wall of markers would say nothing.
      unseen.sort((a, b) => a.dist - b.dist);
      const shown: EdgeThreat[] = [];
      for (const side of ['left', 'right'] as const) shown.push(...unseen.filter((t) => t.side === side).slice(0, THREATS_PER_SIDE));

      arDebug.aim = ids;
      arDebug.threats = shown.map((t) => t.id);
      arDebug.items = out.filter((i) => i.key[0] === 'z').map((i) => ({
        id: i.id, x: i.left + (i.size * SPRITE_ASPECT) / 2, y: i.top + i.size / 2, h: i.size * i.scale, dist: i.dist, aimed: i.aimed,
      }));
      const onTarget = ids.length > 0;
      if (onTarget !== wasOnTarget) { wasOnTarget = onTarget; notify(onTarget); }
      setItems(out);
      setThreats((prev) => (prev.length === 0 && shown.length === 0 ? prev : shown));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [aimRef]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="zombie-layer">
      {items.map((i) => (
        <View key={i.key} testID={i.key[0] === 'z' ? `zombie-${i.id}` : undefined}
          style={{
            position: 'absolute', left: i.left, top: i.top, width: i.size * SPRITE_ASPECT, height: i.size, opacity: i.opacity,
            transform: [{ scale: i.scale }, { rotate: `${i.tilt}deg` }, { scaleY: i.squash }],
          }}>
          <ZombieSprite type={i.type} state={i.state} size={i.size} frame={i.frame} hp={i.hp} hurt={i.hurt} aimed={i.aimed} />
        </View>
      ))}
      {threats.map((t) => <EdgeMarker key={t.key} threat={t} inset={inset} />)}
    </View>
  );
}
