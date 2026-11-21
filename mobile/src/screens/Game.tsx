import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { tracking, useTracking } from '../game/tracking';
import { useStayAwake } from '../game/useStayAwake';
import { useLandscape } from '../game/useLandscape';
import { net } from '../net/client';
import { selectClass, selectMe, serverNow, useStore, zombies } from '../store';
import { color, radius, space } from '../theme';
import { AmmoPanel } from '../ui/AmmoPanel';
import { DamageFlash } from '../ui/DamageFlash';
import { FireButton } from '../ui/FireButton';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { HealthBar } from '../ui/HealthBar';
import { HitMarker } from '../ui/HitMarker';
import { KillFeed } from '../ui/KillFeed';
import { Pill } from '../ui/Pill';
import { Radar } from '../ui/Radar';
import { Reticle } from '../ui/Reticle';
import { Screen } from '../ui/Screen';
import { Squad } from '../ui/Squad';
import { T } from '../ui/T';
import { ZombieLayer, type AimState } from '../ui/ZombieLayer';

const RETICLE = 132;
const haptic = (kind: 'fire' | 'hit' | 'kill' | 'damage') => {
  if (Platform.OS === 'web') return;
  if (kind === 'fire') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else if (kind === 'hit') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  else if (kind === 'kill') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
};

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

  // Clock for the HUD (reload sweep, feed expiry). The AR layer has its own.
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const id = setInterval(() => setNow(serverNow()), 200); return () => clearInterval(id); }, []);

  // What the crosshair is on. The AR layer keeps this current every frame.
  const aimRef = useRef<AimState>({ ids: [], heading: 0 });
  const [onTarget, setOnTarget] = useState(false);

  // Trigger.
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

  const [confirmAbort, setConfirmAbort] = useState(false);
  const pose = tracking.pose();
  const down_ = !!me && me.st !== 'alive';
  const hint = s.connection !== 'open' ? 'Reconnecting…'
    : s.sensorError ? s.sensorError
    : pose.heading == null ? 'Waiting for compass'
    : !pose.hasFix ? 'Waiting for GPS'
    : null;
  const nameOf = (id: string) => s.roster.find((p) => p.id === id)?.name ?? '···';

  if (!me || !cls) return <Screen><View testID="game" /></Screen>;

  const hostControls = isHost ? (confirmAbort ? (
    <View style={{ flexDirection: 'row', gap: space.xs }}>
      <GlassButton label="Abort mission" variant="danger" size="sm" onPress={() => net.reset()} testID="abort-confirm" />
      <GlassButton label="Keep going" variant="ghost" size="sm" onPress={() => setConfirmAbort(false)} />
    </View>
  ) : <GlassButton label="Abort" variant="ghost" size="sm" onPress={() => setConfirmAbort(true)} testID="abort" />) : null;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg, overflow: 'hidden' }} testID="game">
      {perm?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : null}

      <ZombieLayer width={width} height={height} cls={cls} aimRef={aimRef} onAimChange={setOnTarget} />

      <LinearGradient colors={['rgba(6,8,13,0.7)', 'rgba(6,8,13,0)']} style={[styles.scrim, { top: 0, height: 110 }]} pointerEvents="none" />
      <LinearGradient colors={['rgba(6,8,13,0)', 'rgba(6,8,13,0.75)']} style={[styles.scrim, { bottom: 0, height: 130 }]} pointerEvents="none" />

      {/* The sight sits on the exact centre of the camera image. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ position: 'absolute', left: width / 2 - RETICLE / 2, top: height / 2 - RETICLE / 2 }}>
          <Reticle onTarget={onTarget && !down_} kick={kick} size={RETICLE} />
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
            <HealthBar hp={me.hp} max={me.max} label={cls.name} />
            <Squad mates={s.squad.filter((p) => p.id !== myId)} nameOf={nameOf} />
            <KillFeed items={s.feed} now={Date.now() / 1000} />
            {hostControls}
          </View>
          <View style={{ alignItems: 'flex-end', gap: space.sm }}>
            <Glass radius={radius.lg} padding={4}>
              <Radar me={pose} myId={myId} squad={s.squad} zombies={zombies.latest()} heli={s.map?.helicopter} size={104} />
            </Glass>
            <Glass radius={radius.md} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4, minWidth: 132 }} testID="stats">
              <Row label="Wave" value={s.mission.wave ? String(s.mission.wave) : '–'} testID="wave" />
              <Row label="Zombies" value={String(s.mission.left)} tint={s.mission.left > 0 ? color.danger : undefined} testID="zombies-left" />
              <Row label="Kills" value={String(me.k)} testID="kills" />
            </Glass>
          </View>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        <View style={styles.bottom}>
          <AmmoPanel ammo={s.ammo} magazine={cls.magazine} reloadingUntil={s.reloadingUntil} reloadS={cls.reload_s} now={now} />
          <View style={{ flex: 1 }} pointerEvents="none" />
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: space.md }}>
            <GlassButton label="Reload" size="sm" onPress={() => net.reload()} testID="reload"
              disabled={down_ || s.reloadingUntil > now || s.ammo >= cls.magazine} />
            <FireButton ammo={s.ammo} magazine={cls.magazine} reloadingUntil={s.reloadingUntil} reloadS={cls.reload_s}
              onTarget={onTarget} disabled={down_} onDown={down} onUp={up} now={now} />
          </View>
        </View>
      </Screen>

      <DamageFlash latest={lastDamage} anchorY={height / 2} />

      {down_ && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center', padding: space.xl }]}
          pointerEvents="none" testID="knocked">
          <Glass radius={radius.xl} tint={color.danger} padding={space.xl} contentStyle={{ alignItems: 'center', gap: space.sm, minWidth: 240 }}>
            <T v="label" c={color.danger}>Knocked</T>
            <T v="body" c={color.ink2}>You're down. The squad has to finish this.</T>
          </Glass>
        </View>
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
  top: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
});
