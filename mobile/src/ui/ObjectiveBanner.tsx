import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { FormationMark } from '../brand/Brand';
import { extractionLine } from '../game/format';
import { angleDiffDeg, bearingXY, distXY } from '../game/geo';
import type { MissionState } from '../net/types';
import { useStore, type Banner } from '../store';
import { colors, motion, space } from '../theme';
import { HudPanel } from './HudPanel';
import { Icon } from './Icon';
import { easeOut, useReducedMotion } from './motion';
import { ProgressBar } from './ProgressBar';
import { T } from './T';

/** Narrower than this and "Reach the helicopter" will not fit at HUD size. */
const TIGHT_BELOW = 262;

/**
 * What the squad should be doing right now, top centre, always in the same
 * place. Amber is the objective's colour.
 *
 *   journey  → reach the helicopter: which way, and how far
 *   holdout  → hold the zone: which wave of the hold this is
 *   final    → extract now: the squad's shared progress and how many are
 *              holding, so defenders can see it is not their own action
 */
export function ObjectiveBanner({ mission, extract, me, heli, maxWidth, children }: {
  mission: MissionState;
  extract: { progress: number; need: number; holders: string[] };
  me: { x: number; y: number; heading: number | null };
  heli: { x: number; y: number } | null | undefined;
  /** The room there is between the corners. Short on it, the wording shortens; the type does not. */
  maxWidth: number;
  /** A control that belongs to the objective (the host's "We're here"). */
  children?: React.ReactNode;
}) {
  const tight = maxWidth < TIGHT_BELOW;
  let title: string;
  let body: React.ReactNode;

  if (mission.phase === 'journey') {
    const dist = heli ? distXY(me.x, me.y, heli.x, heli.y) : null;
    // How far to turn: 0 is straight ahead, positive is to the right.
    const turn = heli && me.heading != null ? angleDiffDeg(bearingXY(me.x, me.y, heli.x, heli.y), me.heading) : null;
    title = tight ? 'To helicopter' : 'Reach the helicopter';
    body = (
      <View style={styles.line}>
        {turn != null ? (
          <View style={{ transform: [{ rotate: `${turn}deg` }] }} testID="heli-arrow" accessibilityLabel={`Helicopter ${Math.abs(Math.round(turn))} degrees to your ${turn >= 0 ? 'right' : 'left'}`}>
            <Icon name="waypoint" size={22} color={colors.status.objective} weight={2.2} />
          </View>
        ) : null}
        <T v="hudValue" testID="heli-dist">{dist == null ? '–' : `${Math.round(dist)} m`}</T>
      </View>
    );
  } else if (mission.phase === 'holdout') {
    const [done, total] = mission.hold ?? [0, 2];
    title = 'Hold the zone';
    body = (
      <View style={styles.line}>
        <T v="hudLabel" testID="hold-count">Wave {Math.min(done + 1, total)} of {total}</T>
        <ProgressBar value={total ? done / total : 0} segments={total} color={colors.status.objective} track={colors.borderStrong} height={7} style={{ width: 24 * total }} />
      </View>
    );
  } else {
    const holding = extract.holders.length;
    title = 'Extract now';
    body = (
      <View style={{ gap: space[1], alignSelf: 'stretch' }}>
        <ProgressBar value={extract.progress} color={colors.status.objective} track={colors.borderStrong} height={9} testID="extract-bar"
          accessibilityLabel={`extraction ${Math.round(extract.progress * 100)} percent`} />
        <T v="hudSecondary" center testID="extract-holders">{extractionLine(holding, extract.need, extract.progress)}</T>
      </View>
    );
  }

  return (
    <View>
      <HudPanel strong accent={colors.status.objective} testID="objective"
        contentStyle={[styles.panel, { maxWidth }, mission.phase === 'final' && { width: Math.min(330, maxWidth) }]}>
        <View style={styles.line}>
          <FormationMark size={18} />
          <T v="hudTitle" numberOfLines={1}>{title}</T>
        </View>
        {body}
      </HudPanel>
      {/* Hangs off the right-hand side, so the objective itself stays centred. Where there is no side, it goes underneath. */}
      {children ? <View style={tight ? styles.below : styles.aside}>{children}</View> : null}
    </View>
  );
}

/**
 * A mission moment, shown once and briefly under the objective: a wave
 * starting, a wave cleared, the objective changing. It doubles as the caption
 * for the audio cue. Slides in a few points and fades; with reduced motion it
 * just appears and goes.
 */
export function EventBanner() {
  const banner = useStore((s) => s.banner);
  const reduced = useReducedMotion();
  const shown = useSharedValue(0);
  const [live, setLive] = React.useState<Banner | null>(null);
  useEffect(() => {
    if (!banner) { setLive(null); return; }
    setLive(banner);
    shown.value = reduced ? 1 : withTiming(1, { duration: motion.base, easing: easeOut });
    const out = setTimeout(() => { shown.value = reduced ? 0 : withTiming(0, { duration: motion.slow }); }, motion.banner);
    const gone = setTimeout(() => setLive((b) => (b?.key === banner.key ? null : b)), motion.banner + motion.slow + 40);
    return () => { clearTimeout(out); clearTimeout(gone); };
  }, [banner, reduced, shown]);
  const anim = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * -6 }] }));
  if (!live) return null;
  const tint = live.tone === 'danger' ? colors.status.danger : live.tone === 'objective' ? colors.status.objective : colors.textSecondary;
  return (
    <Animated.View style={anim} pointerEvents="none" testID="banner" accessibilityLiveRegion="polite">
      <HudPanel strong contentStyle={styles.event}>
        <View style={[styles.eventRule, { backgroundColor: tint }]} />
        <T v="hudHero" center numberOfLines={1} style={styles.eventTitle}>{live.title}</T>
        {live.detail ? <T v="hudSecondary" c={colors.textSecondary} center numberOfLines={1}>{live.detail}</T> : null}
      </HudPanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingLeft: space[4], paddingRight: space[3], paddingVertical: space[2], alignItems: 'center', gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  aside: { position: 'absolute', left: '100%', top: 0, bottom: 0, marginLeft: space[2], justifyContent: 'center' },
  below: { alignItems: 'center', marginTop: space[1] },
  event: { paddingHorizontal: space[5], paddingTop: space[1] + 3, paddingBottom: space[1], alignItems: 'center', minWidth: 200 },
  eventTitle: { fontSize: 36, lineHeight: 36 },
  eventRule: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
});
