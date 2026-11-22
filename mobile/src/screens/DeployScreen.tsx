import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useStore } from '../store';
import { colors, fonts, space } from '../theme';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { T } from '../ui/T';

type Step = 'rotate' | 'mount' | 'position' | 'countdown';

const GOOD_GPS_M = 15;
/** How long "GPS acquired" stays up before the countdown, so it can be read. */
const READ_MS = 1100;
/** After this long with no fix, offer to go on without one. */
const NO_FIX_OFFER_MS = 6000;
const COUNT_FROM = 3;

/**
 * From phone-in-hand to phone-on-blaster, one thing at a time:
 * turn it, mount it, find the position, count in.
 *
 * Nothing here advances on a timer the player cannot see. Turning the phone
 * moves on by itself; mounting waits for a tap; the position step waits for
 * a real fix (or says there is none and lets the player decide); and only
 * then does the count run.
 */
export function DeployScreen({ onRotated, onDone }: {
  /** The phone is sideways: lock it there. */
  onRotated: () => void;
  onDone: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const gpsAcc = useStore((s) => s.gpsAcc);
  const sensorError = useStore((s) => s.sensorError);
  const [step, setStep] = useState<Step>('mount');
  const [count, setCount] = useState(COUNT_FROM);
  const [offerSkip, setOfferSkip] = useState(false);
  // Turned back upright part-way through: go back to asking for the turn.
  const at: Step = landscape ? step : 'rotate';
  // The parent re-renders several times a second; the timers below must not restart with it.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => { if (landscape) onRotated(); }, [landscape, onRotated]);

  // Position: move on shortly after a fix arrives.
  const hasFix = gpsAcc != null;
  useEffect(() => {
    if (at !== 'position') return;
    if (hasFix && !sensorError) {
      const id = setTimeout(() => setStep('countdown'), READ_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setOfferSkip(true), NO_FIX_OFFER_MS);
    return () => clearTimeout(id);
  }, [at, hasFix, sensorError]);

  // Countdown.
  useEffect(() => {
    if (at !== 'countdown') return;
    if (count <= 0) { done.current(); return; }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [at, count]);

  const stepNo = { rotate: 1, mount: 2, position: 3, countdown: 3 }[at];
  const gps = sensorError ? { label: sensorError, tone: 'danger' as const, icon: 'location' as const, busy: false }
    : !hasFix ? { label: 'Waiting for location', tone: 'warn' as const, icon: 'location' as const, busy: true }
    : gpsAcc! <= GOOD_GPS_M ? { label: `GPS acquired ±${Math.round(gpsAcc!)} m`, tone: 'ok' as const, icon: 'location' as const, busy: false }
    : { label: `Weak GPS ±${Math.round(gpsAcc!)} m`, tone: 'warn' as const, icon: 'signalWeak' as const, busy: false };

  const copy: Record<Step, { title: string; body: string }> = {
    rotate: { title: 'Rotate your phone', body: 'The mission is played sideways. Turn your phone on its side.' },
    mount: { title: 'Mount your phone', body: 'Clip it onto your blaster with the screen facing you and the camera clear.' },
    position: {
      title: sensorError ? 'Location is off' : 'Getting your position',
      body: sensorError ? 'Without it the squad cannot see where you are. Turn location on for FortIRL in Settings, or carry on from the start point.'
        : hasFix && gpsAcc! > GOOD_GPS_M ? 'The fix is loose. It tightens as you move; you can start.'
        : 'Hold still for a moment while GPS finds you in the building.',
    },
    countdown: { title: 'Deploying', body: 'Blaster up. The crosshair is your sight.' },
  };

  const art = at === 'rotate' ? <RotateArt /> : at === 'mount' ? <MountArt /> : at === 'position' ? <PositionArt found={hasFix && !sensorError} /> : <CountArt n={Math.max(1, count)} />;

  const text = (
    <View style={{ gap: space[2], alignItems: landscape ? 'flex-start' : 'center' }}>
      <T v="technical" c={colors.brand.amber} testID="deploy-step">DEPLOY {stepNo}/3</T>
      <T v="displayL" center={!landscape} accessibilityRole="header" testID="deploy-title">{copy[at].title}</T>
      <T v="body" c={colors.textSecondary} center={!landscape} style={{ maxWidth: 360 }}>{copy[at].body}</T>
    </View>
  );

  const action = (
    <View style={{ gap: space[3], alignSelf: 'stretch', minHeight: 56, justifyContent: 'flex-end' }}>
      {at === 'rotate' && Platform.OS !== 'web' ? (
        <Button label="It is sideways" onPress={onRotated} testID="deploy-rotated" accessibilityHint="Locks the screen sideways if it did not turn by itself" />
      ) : null}
      {at === 'mount' ? <Button label="Mounted" variant="primary" iconRight="forward" onPress={() => setStep('position')} testID="deploy-mounted" /> : null}
      {at === 'position' ? (
        <>
          <StatusChip icon={gps.icon} label={gps.label} tone={gps.tone} busy={gps.busy} style={{ alignSelf: landscape ? 'flex-start' : 'center' }} testID="deploy-gps" />
          {sensorError || (offerSkip && !hasFix)
            ? <Button label="Continue without GPS" onPress={() => setStep('countdown')} testID="deploy-skip-gps" />
            : null}
        </>
      ) : null}
      {at === 'countdown' ? <StatusChip icon="crosshair" tone="objective" label="Get ready" style={{ alignSelf: landscape ? 'flex-start' : 'center' }} /> : null}
    </View>
  );

  return (
    <View style={styles.root} testID="deploy">
      <SafeAreaView style={{ flex: 1 }}>
        {landscape ? (
          <View style={styles.wide}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{art}</View>
            <View style={{ flex: 1, justifyContent: 'center', gap: space[6], maxWidth: 380 }}>{text}{action}</View>
          </View>
        ) : (
          <View style={styles.tall}>
            {text}
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{art}</View>
            {action}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

// ------------------------------------------------------------------ illustrations
// One family: bone outlines at one weight, amber for the part to act on.

const W = 240, H = 200;
const line = { stroke: colors.textPrimary, strokeWidth: 2, fill: 'none', strokeLinejoin: 'miter' as const, strokeLinecap: 'square' as const };
const accent = { ...line, stroke: colors.brand.amber };
const faint = { ...line, stroke: colors.borderStrong };

function Frame({ children }: { children: React.ReactNode }) {
  return <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>{children}</Svg>;
}

/** Upright phone, ghosted; sideways phone, solid; the turn between them. */
function RotateArt() {
  return (
    <Frame>
      <Rect x={92} y={20} width={56} height={108} rx={6} {...faint} strokeDasharray="5 5" />
      <Rect x={50} y={104} width={140} height={72} rx={6} {...line} fill={colors.surface} />
      <Circle cx={176} cy={140} r={3} {...line} />
      <Path d="M168 34 a58 58 0 0 1 40 54" {...accent} strokeWidth={2.5} />
      <Path d="M196 78 l12 12 11 -13" {...accent} strokeWidth={2.5} />
    </Frame>
  );
}

/** The phone, sideways, clamped onto the top of a blaster. */
function MountArt() {
  return (
    <Frame>
      {/* phone */}
      <Rect x={44} y={14} width={152} height={78} rx={7} {...line} fill={colors.surface} />
      <Rect x={58} y={24} width={124} height={58} {...faint} strokeWidth={1.5} />
      <Circle cx={51} cy={53} r={2.5} {...line} strokeWidth={1.5} />
      {/* clamp and neck */}
      <Path d="M96 92 v10 h48 v-10" {...accent} />
      <Path d="M110 102 v20 h20 v-20" {...accent} />
      {/* blaster: rail, body, grip, barrel */}
      <Path d="M30 122 h172 v12 h18 v14 h-18 v10 H128 l-6 14 h-24 l6 -14 H62 l-10 28 H28 l10 -28 H30 z" {...line} fill={colors.surfaceOverlay} />
      <Path d="M30 134 h172" {...faint} strokeWidth={1.5} />
    </Frame>
  );
}

/** A pin inside range rings; the rings firm up once there is a fix. */
function PositionArt({ found }: { found: boolean }) {
  const ring = found ? accent : faint;
  return (
    <Frame>
      <Circle cx={120} cy={128} r={64} {...ring} strokeDasharray={found ? undefined : '6 6'} strokeWidth={1.5} />
      <Circle cx={120} cy={128} r={36} {...ring} strokeDasharray={found ? undefined : '6 6'} strokeWidth={1.5} />
      <Path d="M120 128 S86 92 86 64 a34 34 0 0 1 68 0 c0 28 -34 64 -34 64 z" {...line} fill={colors.surface} />
      <Circle cx={120} cy={64} r={11} {...(found ? accent : line)} />
    </Frame>
  );
}

/** Bracket frame and one large numeral: the last three seconds. */
function CountArt({ n }: { n: number }) {
  const c = 26;
  return (
    <View style={{ width: W, height: H, alignItems: 'center', justifyContent: 'center' }} testID="deploy-count" accessibilityLabel={`${n}`}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={StyleSheet.absoluteFill}>
        <Path d={`M30 ${10 + c} V10 H${30 + c} M${210 - c} 10 H210 V${10 + c} M210 ${190 - c} V190 H${210 - c} M${30 + c} 190 H30 V${190 - c}`} {...accent} />
        <Path d="M30 100 h10 M200 100 h10" {...accent} />
      </Svg>
      <T style={{ fontFamily: fonts.displayBlack, fontSize: 132, lineHeight: 136, color: colors.textPrimary }}>{n}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.background, zIndex: 30 },
  wide: { flex: 1, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: space[8], paddingVertical: space[4], gap: space[6] },
  tall: { flex: 1, paddingHorizontal: space[6], paddingTop: space[10], paddingBottom: space[5], alignItems: 'center' },
});
