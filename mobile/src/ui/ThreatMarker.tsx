/**
 * Two different warnings, kept visibly different:
 *
 *   EdgeMarker    a zombie is close and out of view. A small chevron on the
 *                 screen edge nearest it, in the zombie's type colour. Quiet.
 *   HitDirection  you were just bitten. A red wedge on a ring round the
 *                 crosshair pointing at the source, and a short red band on
 *                 that edge of the screen. Never a full-screen flash: the
 *                 camera stays readable.
 *
 * Shape and position carry both; colour only backs them up.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { Damage } from '../store';
import { alpha, colors, hud } from '../theme';
import { useReducedMotion } from './motion';

export interface EdgeThreat { key: string; id: number; side: 'left' | 'right'; y: number; near: boolean; color: string }

export function EdgeMarker({ threat, inset }: { threat: EdgeThreat; inset: number }) {
  const size = threat.near ? 34 : 24;
  const flip = threat.side === 'left';
  return (
    <View testID={`threat-${threat.side}`} accessibilityLabel={`Zombie to your ${threat.side}`}
      style={[{ position: 'absolute', top: threat.y - size / 2, width: size, height: size }, flip ? { left: inset + 4 } : { right: inset + 4 }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
        {/* Dark edge first, so it holds on a bright wall. */}
        <Path d="M7 3.5 17 12 7 20.5" stroke={colors.camera.edge} strokeWidth={threat.near ? 8 : 7} fill="none" strokeLinejoin="miter" />
        <Path d="M7 3.5 17 12 7 20.5" stroke={threat.color} strokeWidth={threat.near ? 4.5 : 3.5} fill="none" strokeLinejoin="miter" />
        {threat.near ? <Path d="M2 7 8 12 2 17" stroke={threat.color} strokeWidth={3} fill="none" strokeLinejoin="miter" /> : null}
      </Svg>
    </View>
  );
}

const BAND = 84;

/** `latest.dir` is degrees clockwise from straight ahead. */
export function HitDirection({ latest, anchorY }: { latest: Damage | undefined; anchorY: number }) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!latest) return;
    // Up fast, down over half a second. With reduced motion it simply shows, then goes.
    opacity.value = reduced
      ? withSequence(withTiming(1, { duration: 0 }), withTiming(1, { duration: 500 }), withTiming(0, { duration: 0 }))
      : withSequence(withTiming(1, { duration: 50 }), withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [latest?.key, opacity, latest, reduced]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const dir = latest?.dir ?? null;
  const cx = width / 2, cy = anchorY, r = hud.crosshair / 2 + 26;
  const wedge = (deg: number) => {
    const a0 = ((deg - 24) * Math.PI) / 180, a1 = ((deg + 24) * Math.PI) / 180, am = (deg * Math.PI) / 180;
    const pt = (a: number, rad: number) => `${cx + Math.sin(a) * rad} ${cy - Math.cos(a) * rad}`;
    // A blunt arrowhead: arc on the ring, point further out.
    return `M ${pt(a0, r)} A ${r} ${r} 0 0 1 ${pt(a1, r)} L ${pt(am, r + 16)} Z`;
  };
  // Which screen edge the bite came from. Unknown direction: bottom, where the player is.
  const norm = dir == null ? 180 : ((dir % 360) + 360) % 360;
  const edge: 'top' | 'right' | 'bottom' | 'left' = norm < 45 || norm >= 315 ? 'top' : norm < 135 ? 'right' : norm < 225 ? 'bottom' : 'left';
  const red = alpha(colors.status.danger, 0.7), clear = alpha(colors.status.danger, 0);
  const band = {
    top: { style: { top: 0, left: 0, right: 0, height: BAND }, start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    bottom: { style: { bottom: 0, left: 0, right: 0, height: BAND }, start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
    left: { style: { left: 0, top: 0, bottom: 0, width: BAND }, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    right: { style: { right: 0, top: 0, bottom: 0, width: BAND }, start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
  }[edge];

  return (
    <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="none" testID="damage-flash">
      <LinearGradient colors={[red, clear]} start={band.start} end={band.end} style={[{ position: 'absolute' }, band.style]} />
      {dir != null ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Path d={wedge(dir)} fill={colors.status.danger} stroke={colors.camera.edge} strokeWidth={1.5} />
        </Svg>
      ) : null}
    </Animated.View>
  );
}
