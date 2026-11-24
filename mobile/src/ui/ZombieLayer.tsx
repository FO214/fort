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
import { cameraHfov } from '../game/deviceCamera';
import { EYE_M, ZOMBIE_HEIGHT_M, pickTargets, project, type Camera } from '../game/zombies';
import { Z_ATTACK, Z_IDLE, type GunClass } from '../net/types';
import { serverNow, useStore, zombies } from '../store';
import { colors } from '../theme';
import { FIGURE_ASPECT, ZOMBIE_SCALE, facing, frameAt, spriteBox, turnOf, zombieKind, type Facing } from './spriteBox';
import { EdgeMarker, type EdgeThreat } from './ThreatMarker';
import { ZombiePreload, ZombieSprite } from './ZombieSprite';
import { ZOMBIE_SHEETS, type ZombieClip, type ZombieKind } from './zombieSheets';

const FRAME_MS = 33;                               // ~30 fps is plenty for shambling
const MAX_DRAW_M = 70;
const SIZES = [48, 96, 192, 384, 768];             // body heights the sprite is laid out at; scaled down to fit, never up much
/** Arms and a falling body reach outside the body box, by up to this much of its height. */
const REACH = 0.5;
/**
 * The tallest a zombie is drawn, in screen heights. One that is biting stands
 * about this big already; any nearer and it would only be a wall of pixels.
 */
const MAX_TALL = 2.4;
/** With nobody to chase a zombie only sways: its walk, slowed right down. */
const IDLE_PACE = 0.3;
/** The last part of the fall is spent fading out. */
const FADE_FROM = 0.7;
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
  key: string; id: number; type: number; clip: ZombieClip; frame: number; row: number; mirror: boolean;
  hp: number; hurt: boolean; aimed: boolean;
  left: number; top: number; size: number; scale: number; opacity: number; dist: number;
}

/** What the last frame drew, for tests and on-device debugging. */
export const arDebug: {
  /** `x`, `y`: the centre of the body on screen; `h`: its height. Then which frame it shows. */
  items: { id: number; x: number; y: number; h: number; dist: number; aimed: boolean; clip: ZombieClip; row: number; mirror: boolean; frame: number }[];
  aim: number[]; threats: number[];
} = { items: [], aim: [], threats: [] };
if (typeof window !== 'undefined') (window as unknown as { __loonieAR?: unknown }).__loonieAR = arDebug;

export function ZombieLayer({ width, height, cls, aimRef, onAimChange, inset = 0 }: {
  width: number; height: number; cls: GunClass | undefined;
  aimRef: React.MutableRefObject<AimState>; onAimChange: (onTarget: boolean) => void;
  /** How far in from the left and right edges the threat markers sit (safe areas). */
  inset?: number;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [threats, setThreats] = useState<EdgeThreat[]>([]);
  // The camera's sideways tilt. The zombies are placed for a level camera and the lot turned by this.
  const [roll, setRoll] = useState(0);
  // Walkers are always coming; anything else is loaded when the first one turns up.
  const [kinds, setKinds] = useState<ZombieKind[]>(['walker']);
  const dims = useRef({ width, height, cls, onAimChange });
  dims.current = { width, height, cls, onAimChange };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let wasOnTarget = false;
    // The angle each zombie was last drawn from, so one that hovers between two does not flicker.
    let facings = new Map<string, Facing>();
    const seen = new Set<ZombieKind>(['walker']);
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < FRAME_MS) return;
      last = ts;
      const { width: w, height: h, cls: gun, onAimChange: notify } = dims.current;
      const hfov = cameraHfov(w, h, useStore.getState().prefs.fovTrim);
      const pose = tracking.pose();
      const now = serverNow();
      const out: Item[] = [];
      const unseen: (EdgeThreat & { dist: number })[] = [];
      const turned = new Map<string, Facing>();
      let ids: number[] = [];
      // Turned by the roll, the corners of the screen reach this much further out.
      const spill = Math.abs(Math.sin((pose.roll * Math.PI) / 180)) * Math.max(w, h);

      if (pose.heading != null) {
        const cam: Camera = { x: pose.x, y: pose.y, heading: pose.heading, pitch: pose.pitch, width: w, height: h, hfov };
        const live = zombies.sample(now);
        if (gun) ids = pickTargets(live, cam, gun);
        const aimed = ids[0];
        const me = useStore.getState().session?.playerId;
        // Which of the drawn angles this phone sees it from.
        const look = (key: string, heading: number | null, x: number, y: number, was = key) => {
          const f = facing(heading == null ? 0 : turnOf(heading, x, y, cam.x, cam.y), facings.get(key) ?? facings.get(was));
          turned.set(key, f);
          return f;
        };
        const place = (x: number, y: number, grow = 1) => {
          const p = project(x, y, cam);
          if (!p || p.dist > MAX_DRAW_M) return null;
          // Nearer than arm's length it stops growing: drawn as if it stood a step back, about eye level.
          let top = p.top, bottom = p.bottom;
          if (bottom - top > h * MAX_TALL) {
            const eye = top + (bottom - top) * ((ZOMBIE_HEIGHT_M - EYE_M) / ZOMBIE_HEIGHT_M), k = (h * MAX_TALL) / (bottom - top);
            top = eye - (eye - top) * k; bottom = eye + (bottom - eye) * k;
          }
          // Bigger types stand on the same floor and rise from it.
          const box = spriteBox(p.sx, bottom - (bottom - top) * grow, bottom);
          const reach = box.height * REACH;
          if (box.left - reach > w + spill || box.left + box.width + reach < -spill || box.top - reach > h + spill || box.top + box.height < -spill || box.height < 8) return null;
          const size = SIZES.find((s) => s >= box.height) ?? SIZES[SIZES.length - 1];
          const scale = box.height / size;
          // Centre the fixed-size sprite on the box, then scale it to fit.
          return {
            p, size, scale,
            // Its body is on screen, not just a reaching arm.
            inView: box.left <= w + spill && box.left + box.width >= -spill && box.top <= h + spill && box.top + box.height >= -spill,
            left: box.left + box.width / 2 - (size * FIGURE_ASPECT) / 2,
            top: box.top + box.height / 2 - size / 2,
            far: Math.max(0.6, Math.min(1, 1.25 - p.dist / 60)),
          };
        };
        for (const z of live) {
          const kind = zombieKind(z.type);
          const q = place(z.x, z.y, ZOMBIE_SCALE[kind]);
          if (!q?.inView) {
            const dist = Math.hypot(z.x - cam.x, z.y - cam.y);
            if (dist <= THREAT_RANGE_M) {
              const off = angleDiffDeg(bearingXY(cam.x, cam.y, z.x, z.y), cam.heading);
              // Just out of view sits high on the edge; directly behind sits low.
              const behind = Math.min(1, Math.max(0, (Math.abs(off) - hfov / 2) / (180 - hfov / 2)));
              unseen.push({
                key: `t${z.id}`, id: z.id, side: off >= 0 ? 'right' : 'left', y: h * (0.3 + 0.42 * behind),
                near: dist <= THREAT_RANGE_M / 2.5, color: colors.zombies[kind], dist,
              });
            }
          }
          if (!q) continue;
          seen.add(kind);
          const clip: ZombieClip = z.state === Z_ATTACK ? 'attack' : 'move';
          // Each keeps its own step: a crowd marching in time would look like one zombie copied.
          const clock = now * (z.state === Z_IDLE ? IDLE_PACE : 1) + z.id * 0.37;
          // Biting this player: it is looking straight at them, whichever way it walked up.
          const key = `z${z.id}`;
          const f = look(key, z.state === Z_ATTACK && z.target === me ? null : z.heading, z.x, z.y);
          out.push({
            key, id: z.id, type: z.type, clip, frame: frameAt(ZOMBIE_SHEETS[kind][clip], clock), row: f.row, mirror: f.mirror,
            hp: z.maxHp > 0 ? z.hp / z.maxHp : 1, hurt: z.hitAge < 0.09, aimed: z.id === aimed,
            left: q.left, top: q.top, size: q.size, scale: q.scale,
            opacity: Math.min(1, z.age / 0.45) * q.far, dist: q.p.dist,
          });
        }
        for (const c of zombies.dying(now)) {
          const kind = zombieKind(c.type);
          const q = place(c.x, c.y, ZOMBIE_SCALE[kind]);
          if (!q) continue;
          // Dying: a flash, then it topples over and fades where it fell. Unmistakably gone.
          const sheet = ZOMBIE_SHEETS[kind].die;
          const key = `d${c.id}`;
          const f = look(key, c.heading, c.x, c.y, `z${c.id}`);
          out.push({
            key, id: c.id, type: c.type, clip: 'die', frame: frameAt(sheet, c.age * sheet.seconds), row: f.row, mirror: f.mirror,
            hp: 1, hurt: c.age < 0.12, aimed: false,
            left: q.left, top: q.top, size: q.size, scale: q.scale,
            opacity: (c.age < FADE_FROM ? 1 : Math.max(0, (1 - c.age) / (1 - FADE_FROM))) * q.far, dist: q.p.dist,
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
        id: i.id, x: i.left + (i.size * FIGURE_ASPECT) / 2, y: i.top + i.size / 2, h: i.size * i.scale, dist: i.dist, aimed: i.aimed,
        clip: i.clip, row: i.row, mirror: i.mirror, frame: i.frame,
      }));
      facings = turned;
      setKinds((prev) => (prev.length === seen.size ? prev : [...seen]));
      const onTarget = ids.length > 0;
      if (onTarget !== wasOnTarget) { wasOnTarget = onTarget; notify(onTarget); }
      setItems(out);
      setRoll((prev) => (Math.abs(prev - pose.roll) < 0.2 ? prev : pose.roll));
      setThreats((prev) => (prev.length === 0 && shown.length === 0 ? prev : shown));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [aimRef]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="zombie-layer">
      <ZombiePreload kinds={kinds} />
      {/* Turned about the screen centre, which is where the crosshair is, so aiming is unchanged. */}
      <View style={[StyleSheet.absoluteFill, roll ? { transform: [{ rotate: `${roll}deg` }] } : null]}>
      {items.map((i) => (
        <View key={i.key} testID={i.key[0] === 'z' ? `zombie-${i.id}` : `corpse-${i.id}`}
          style={{
            position: 'absolute', left: i.left, top: i.top, width: i.size * FIGURE_ASPECT, height: i.size, opacity: i.opacity,
            transform: [{ scale: i.scale }],
          }}>
          <ZombieSprite type={i.type} clip={i.clip} frame={i.frame} row={i.row} mirror={i.mirror} size={i.size} hp={i.hp} hurt={i.hurt} aimed={i.aimed} />
        </View>
      ))}
      </View>
      {threats.map((t) => <EdgeMarker key={t.key} threat={t} inset={inset} />)}
    </View>
  );
}
