import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { distXY } from '../game/geo';
import { OFF_MAP_M, tracking, useTracking } from '../game/tracking';
import { useLandscape } from '../game/useLandscape';
import { useStayAwake } from '../game/useStayAwake';
import { net } from '../net/client';
import type { PlayerSnap } from '../net/types';
import { selectClass, selectMe, serverNow, useStore, zombies } from '../store';
import { color, radius, space } from '../theme';
import { AmmoPanel } from '../ui/AmmoPanel';
import { DamageFlash } from '../ui/DamageFlash';
import { DownedOverlay } from '../ui/DownedOverlay';
import { ExtractHold } from '../ui/ExtractHold';
import { FireButton } from '../ui/FireButton';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { HealthBar } from '../ui/HealthBar';
import { HitMarker } from '../ui/HitMarker';
import { KillFeed } from '../ui/KillFeed';
import { MapView, hasFloorPlan } from '../ui/MapView';
import { ObjectiveBar } from '../ui/ObjectiveBar';
import { Pill } from '../ui/Pill';
import { Radar } from '../ui/Radar';
import { Reticle } from '../ui/Reticle';
import { ReviveButton } from '../ui/ReviveButton';
import { Screen } from '../ui/Screen';
import { Squad } from '../ui/Squad';
import { T } from '../ui/T';
import { ZombieLayer, type AimState } from '../ui/ZombieLayer';

const RETICLE = 132;
// Mirrors the server's revive rule (Tuning.revive_range_m / revive_slack_cap_m).
const REVIVE_RANGE_M = 4;
const REVIVE_SLACK_CAP_M = 25;

const haptic = (kind: 'fire' | 'hit' | 'kill' | 'damage') => {
  if (Platform.OS === 'web') return;
  if (kind === 'fire') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else if (kind === 'hit') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  else if (kind === 'kill') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
};

/** The nearest knocked teammate close enough to revive, by the server's rule. */
function revivable(me: PlayerSnap | undefined, squad: PlayerSnap[]): PlayerSnap | null {
  if (!me || me.st !== 'alive') return null;
  let best: PlayerSnap | null = null, bestDist = Infinity;
  for (const p of squad) {
    if (p.id === me.id || p.st !== 'knocked') continue;
    if (p.rb && p.rb !== me.id) continue;                       // someone else already has them
    const d = distXY(me.x, me.y, p.x, p.y);
    if (d <= REVIVE_RANGE_M + Math.min(me.acc + p.acc, REVIVE_SLACK_CAP_M) && d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

export function Game() {
  const { width, height } = useWindowDimensions();
  const s = useStore();
  const me = selectMe(s);
  const cls = selectClass(s);
  const myId = s.session?.playerId;
  const isHost = s.hostId === myId;
  const [perm, requestPerm] = useCameraPermissions();
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm, requestPerm]);
  useStayAwake('loonie-mission');
  useLandscape();
  useTracking(true);

  const alive = me?.st === 'alive';
  const final = s.mission.phase === 'final';
  const heliQr = s.map?.helicopter.qr ?? '';

  // Clock for the HUD (reload sweep, feed expiry, QR freshness). The AR layer has its own.
  const [now, setNow] = useState(serverNow());
  const [qrInView, setQrInView] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(serverNow());
      setQrInView(!!heliQr && tracking.qrInView(heliQr));
    }, 200);
    return () => clearInterval(id);
  }, [heliQr]);

  // What the crosshair is on. The AR layer keeps this current every frame.
  const aimRef = useRef<AimState>({ ids: [], heading: 0 });
  const [onTarget, setOnTarget] = useState(false);

  // ---- hold to extract: only counts while the helicopter code is in view ----
  const [extractDown, setExtractDown] = useState(false);
  const extracting = final && alive && extractDown && qrInView;
  useEffect(() => { net.extract(extracting); }, [extracting]);
  useEffect(() => { if (!final || !alive) setExtractDown(false); }, [final, alive]);

  // ---- hold to revive ----
  const target = revivable(me, s.squad);
  const targetId = target?.id ?? null;
  const [reviveDown, setReviveDown] = useState(false);
  const reviving = reviveDown && targetId != null;
  useEffect(() => {
    if (!reviving || !targetId) return;
    net.revive(targetId, true);
    // Keep saying so while held: a bite cancels the revive on the server, and
    // this picks it straight back up without the player re-pressing.
    const id = setInterval(() => net.revive(targetId, true), 500);
    return () => { clearInterval(id); net.revive(targetId, false); };
  }, [reviving, targetId]);
  useEffect(() => { if (targetId == null) setReviveDown(false); }, [targetId]);

  // ---- trigger ----
  const [kick, setKick] = useState(0);
  const auto = useRef<ReturnType<typeof setInterval> | null>(null);
  const pull = useCallback(() => {
    const st = useStore.getState();
    if (selectMe(st)?.st !== 'alive') return;
    const aim = aimRef.current;
    net.fire(aim.ids, aim.heading);
    tracking.noteShot();
    setKick((k) => k + 1);
    haptic('fire');
  }, []);
  const down = useCallback(() => {
    pull();
    if (cls?.automatic) auto.current = setInterval(pull, cls.fire_interval_s * 1000);
  }, [pull, cls]);
  const up = useCallback(() => { if (auto.current) { clearInterval(auto.current); auto.current = null; } }, []);
  useEffect(() => up, [up]);

  // Feedback haptics.
  const lastShot = s.shots[s.shots.length - 1];
  const lastDamage = s.damages[s.damages.length - 1];
  useEffect(() => { if (lastShot?.kind === 'hit') haptic('hit'); if (lastShot?.kind === 'kill') haptic('kill'); }, [lastShot?.key, lastShot?.kind]);
  useEffect(() => { if (lastDamage) haptic('damage'); }, [lastDamage?.key, lastDamage]);

  // A refusal from the server ("Too far away to revive") shows briefly.
  useEffect(() => {
    if (!s.error) return;
    const id = setTimeout(() => useStore.getState().setError(null), 2500);
    return () => clearTimeout(id);
  }, [s.error]);

  const [confirmAbort, setConfirmAbort] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const plan = s.map && hasFloorPlan(s.map) ? s.map : null;     // null on the open arena
  const pose = tracking.pose();
  const hint = s.connection !== 'open' ? 'Reconnecting…'
    : s.error ? s.error
    : s.sensorError ? s.sensorError
    : pose.heading == null ? 'Waiting for compass'
    : !pose.hasFix ? 'Waiting for GPS'
    : Math.abs(pose.x) > OFF_MAP_M || Math.abs(pose.y) > OFF_MAP_M ? `GPS says you are not at ${s.map?.name ?? 'the map'}`
    : null;
  const nameOf = (id: string) => s.roster.find((p) => p.id === id)?.name ?? '···';

  if (!me || !cls) return <Screen><View testID="game" /></Screen>;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg, overflow: 'hidden' }} testID="game">
      {perm?.granted ? (
        // The camera is the background, and during the final wave it is also
        // what reads the helicopter's QR code. No separate scanning mode.
        <CameraView style={StyleSheet.absoluteFill} facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={final ? (r) => tracking.noteQr(r.data) : undefined} />
      ) : null}

      <ZombieLayer width={width} height={height} cls={cls} aimRef={aimRef} onAimChange={setOnTarget} />

      <LinearGradient colors={['rgba(6,8,13,0.7)', 'rgba(6,8,13,0)']} style={[styles.scrim, { top: 0, height: 110 }]} pointerEvents="none" />
      <LinearGradient colors={['rgba(6,8,13,0)', 'rgba(6,8,13,0.75)']} style={[styles.scrim, { bottom: 0, height: 130 }]} pointerEvents="none" />

      {/* The sight sits on the exact centre of the camera image. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ position: 'absolute', left: width / 2 - RETICLE / 2, top: height / 2 - RETICLE / 2 }}>
          <Reticle onTarget={onTarget && alive && !extracting} kick={kick} size={RETICLE} />
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 - 22, alignItems: 'center' }}>
          <HitMarker shot={lastShot} />
        </View>
        {hint && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 + RETICLE / 2 + space.sm, alignItems: 'center' }}>
            <Pill label={hint} tint={color.warning} testID="hint" />
          </View>
        )}
      </View>

      <Screen blobs={false} style={{ backgroundColor: 'transparent' }}>
        <View style={styles.top}>
          <View style={{ flex: 1, gap: space.sm, alignItems: 'flex-start' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <HealthBar hp={me.hp} max={me.max} label={cls.name} />
              {isHost && !confirmAbort && (
                <GlassButton label="Abort" variant="ghost" size="sm" onPress={() => setConfirmAbort(true)} testID="abort" />
              )}
            </View>
            {isHost && confirmAbort && (
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                <GlassButton label="Abort mission" variant="danger" size="sm" onPress={() => net.reset()} testID="abort-confirm" />
                <GlassButton label="Keep going" variant="ghost" size="sm" onPress={() => setConfirmAbort(false)} />
              </View>
            )}
            <Squad mates={s.squad.filter((p) => p.id !== myId)} nameOf={nameOf} />
            <KillFeed items={s.feed} now={Date.now() / 1000} />
          </View>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <ObjectiveBar mission={s.mission} extract={s.extract} me={pose} heli={s.map?.helicopter} nameOf={nameOf} />
            {isHost && s.mission.phase === 'journey' && (
              // GPS can refuse to admit the squad has arrived; the host can say so.
              <GlassButton label="We're here" size="sm" onPress={() => net.arrived()} testID="arrived" />
            )}
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end', gap: space.sm }}>
            {plan ? (
              // A building: the real floor plan around you. Tap for the whole floor.
              <Pressable onPress={() => setShowMap(true)} testID="minimap-open" accessibilityRole="button" accessibilityLabel="Open the map">
                <Glass radius={radius.lg} padding={4}>
                  <MapView map={plan} me={pose} myId={myId} squad={s.squad} zombies={zombies.latest()} width={116} height={104} mode="mini" />
                </Glass>
              </Pressable>
            ) : (
              <Glass radius={radius.lg} padding={4}>
                <Radar me={pose} myId={myId} squad={s.squad} zombies={zombies.latest()} heli={s.map?.helicopter} size={104} />
              </Glass>
            )}
            <Glass radius={radius.md} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4, minWidth: 132 }} testID="stats">
              <Row label="Wave" value={s.mission.wave ? String(s.mission.wave) : '–'} testID="wave" />
              <Row label="Zombies" value={String(s.mission.left)} tint={s.mission.left > 0 ? color.danger : undefined} testID="zombies-left" />
              <Row label="Kills" value={String(me.k)} testID="kills" />
            </Glass>
          </View>
        </View>

        <View style={{ flexGrow: 1, flexShrink: 1, minHeight: space.sm }} pointerEvents="none" />

        <View style={styles.bottom}>
          <AmmoPanel ammo={s.ammo} magazine={cls.magazine} reloadingUntil={s.reloadingUntil} reloadS={cls.reload_s} now={now} />
          <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="box-none">
            {target ? (
              <ReviveButton name={nameOf(target.id)} holding={reviving} onHold={setReviveDown}
                progress={target.rb === myId ? target.rv : 0} />
            ) : final && alive ? (
              <ExtractHold qrInView={qrInView} holding={extracting} progress={s.extract.progress}
                holders={s.extract.holders.length} need={s.extract.need} onHold={setExtractDown} />
            ) : null}
          </View>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: space.md }}>
            <GlassButton label="Reload" size="sm" onPress={() => net.reload()} testID="reload"
              disabled={!alive || s.reloadingUntil > now || s.ammo >= cls.magazine} />
            <FireButton ammo={s.ammo} magazine={cls.magazine} reloadingUntil={s.reloadingUntil} reloadS={cls.reload_s}
              onTarget={onTarget} disabled={!alive || extracting} onDown={down} onUp={up} now={now} />
          </View>
        </View>
      </Screen>

      <DamageFlash latest={lastDamage} anchorY={height / 2} />

      {showMap && plan && (
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,8,13,0.88)' }]} onPress={() => setShowMap(false)}
          testID="fullmap-close" accessibilityRole="button" accessibilityLabel="Close the map">
          <MapView map={plan} me={pose} myId={myId} squad={s.squad} zombies={zombies.latest()} nameOf={nameOf}
            width={width} height={height} mode="full" />
          <View style={{ position: 'absolute', left: space.lg, top: space.md, gap: 2 }} pointerEvents="none">
            <T v="label" c={color.ink3}>{plan.name}</T>
            <T v="caption" c={color.ink2}>Tap anywhere to close</T>
          </View>
        </Pressable>
      )}

      {!alive && (
        <DownedOverlay state={me.st === 'dead' ? 'dead' : 'knocked'} bleed={me.bl}
          reviveBy={me.rb ? nameOf(me.rb) : null} reviveProgress={me.rv} />
      )}
    </View>
  );
}

function Row({ label, value, tint, testID }: { label: string; value: string; tint?: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }} testID={testID}>
      <T v="label" c={color.ink3}>{label}</T>
      <T v="mono" c={tint ?? color.ink} style={{ fontSize: 15 }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0 },
  // If the top ever runs out of room it is clipped; it must never push the trigger off the screen.
  top: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm, flexShrink: 1, overflow: 'hidden' },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md, flexShrink: 0 },
});
