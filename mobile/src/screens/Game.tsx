import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { computeCandidates, stepLock, type Candidate, type LockState } from '../game/aim';
import { useGameLoop } from '../game/useGameLoop';
import { net } from '../net/client';
import { LANDSCAPE_LEFT_HEADING_OFFSET, setHeadingOffset } from '../sensors';
import { selectMe, selectWeapon, serverNow, useStore } from '../store';
import { color, radius, space } from '../theme';
import { DamageFlash } from '../ui/DamageFlash';
import { EnemyTag } from '../ui/EnemyTag';
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
import { AmmoPanel } from '../ui/AmmoPanel';
import { TargetStrip } from '../ui/TargetStrip';
import { isEnemy } from '../game/aim';
import { T } from '../ui/T';

const IDLE: LockState = { targetId: null, since: 0, progress: 0, locked: false };
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
  const weapon = selectWeapon(s);
  const isHost = s.hostId === s.session?.playerId;
  const [perm, requestPerm] = useCameraPermissions();
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm, requestPerm]);
  useGameLoop(true);

  // The match is played sideways. Lock it, and tell the compass which way is forward.
  useEffect(() => {
    setHeadingOffset(LANDSCAPE_LEFT_HEADING_OFFSET);
    if (Platform.OS !== 'web') ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT).catch(() => {});
    return () => {
      setHeadingOffset(0);
      if (Platform.OS !== 'web') ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Aim loop: 20 fps is plenty for brackets and a lock ring.
  const [cands, setCands] = useState<Candidate[]>([]);
  const [lock, setLock] = useState<LockState>(IDLE);
  const lockRef = useRef<LockState>(IDLE);
  const manualRef = useRef<string | null>(null);
  const [manualTarget, setManualTargetState] = useState<string | null>(null);
  const setManualTarget = (id: string | null) => { manualRef.current = id; setManualTargetState(id); };
  useEffect(() => {
    const id = setInterval(() => {
      const st = useStore.getState();
      const m = selectMe(st); const w = selectWeapon(st);
      if (st.settings?.aim === 'manual') {
        const tgt = st.players.find((p) => p.id === manualRef.current);
        const ok = !!m && m.alive && !!tgt && tgt.alive && isEnemy(m, tgt, st.settings.mode);
        lockRef.current = ok ? { targetId: tgt!.id, since: 0, progress: 1, locked: true } : IDLE;
        setCands([]); setLock({ ...lockRef.current });
        return;
      }
      if (!m || !w || !st.fix || !st.settings || !m.alive) { lockRef.current = IDLE; setCands([]); setLock(IDLE); return; }
      const c = computeCandidates(m, st.fix, st.players, w, st.settings.mode);
      lockRef.current = stepLock(lockRef.current, c.find((x) => x.lockable), Date.now(), w.acquire_ms);
      setCands(c); setLock({ ...lockRef.current });
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Clock.
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const id = setInterval(() => setNow(serverNow()), 200); return () => clearInterval(id); }, []);
  const left = Math.max(0, s.endsAt - now);
  const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
  const alive = s.players.filter((p) => p.alive).length;

  // Trigger.
  const [kick, setKick] = useState(0);
  const auto = useRef<ReturnType<typeof setInterval> | null>(null);
  const pull = useCallback(() => {
    const st = useStore.getState();
    const m = selectMe(st);
    if (!m?.alive) return;
    const l = lockRef.current;
    net.fire(l.locked ? l.targetId : null);
    setKick((k) => k + 1);
    haptic('fire');
  }, []);
  const down = useCallback(() => {
    pull();
    if (weapon?.automatic) auto.current = setInterval(pull, weapon.fire_interval_s * 1000);
  }, [pull, weapon]);
  const up = useCallback(() => { if (auto.current) { clearInterval(auto.current); auto.current = null; } }, []);
  useEffect(() => up, [up]);

  // Feedback haptics.
  const lastShot = s.shots[s.shots.length - 1];
  const lastDamage = s.damages[s.damages.length - 1];
  useEffect(() => { if (lastShot?.kind === 'hit') haptic('hit'); if (lastShot?.kind === 'kill') haptic('kill'); }, [lastShot?.key, lastShot?.kind]);
  useEffect(() => { if (lastDamage) haptic('damage'); }, [lastDamage?.key, lastDamage]);

  const [confirmEnd, setConfirmEnd] = useState(false);
  const dead = !!me && !me.alive;
  const respawnIn = s.deadUntil && s.deadUntil > 0 ? Math.max(0, Math.ceil(s.deadUntil - now)) : null;
  const protectedLeft = me ? me.invuln_until - now : 0;
  const manual = s.settings?.aim === 'manual';
  const hint = s.connection !== 'open' ? 'Reconnecting…'
    : protectedLeft > 0 ? `Protected ${Math.ceil(protectedLeft)}s`
    : manual ? (lock.locked ? null : 'Tap a target')
    : s.sensorError ? s.sensorError : !s.fix ? 'Waiting for GPS' : s.fix.heading == null ? 'Turn to calibrate compass' : null;
  const hintTint = (protectedLeft > 0 && s.connection === 'open') || (manual && !lock.locked) ? color.accent : color.warning;
  const locked = lock.locked;
  const teams = s.settings?.mode === 'teams';
  const primaryId = lock.targetId ?? cands.find((c) => c.lockable)?.id ?? cands[0]?.id;
  const landscape = width > height;
  const anchorY = height * (landscape ? 0.47 : 0.44);

  if (!me || !weapon) return <Screen><View /></Screen>;

  const hostControls = isHost ? (confirmEnd ? (
    <View style={{ flexDirection: 'row', gap: space.xs }}>
      <GlassButton label="End match" variant="danger" size="sm" onPress={() => net.end()} testID="end-confirm" />
      <GlassButton label="Keep going" variant="ghost" size="sm" onPress={() => setConfirmEnd(false)} />
    </View>
  ) : <GlassButton label="End" variant="ghost" size="sm" onPress={() => setConfirmEnd(true)} testID="end" />) : null;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg, overflow: 'hidden' }} testID="game">
      {perm?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : null}
      <LinearGradient colors={['rgba(6,8,13,0.75)', 'rgba(6,8,13,0)']} style={[styles.scrim, { top: 0, height: landscape ? 120 : 160 }]} pointerEvents="none" />
      <LinearGradient colors={['rgba(6,8,13,0)', 'rgba(6,8,13,0.8)']} style={[styles.scrim, { bottom: 0, height: landscape ? 150 : 240 }]} pointerEvents="none" />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {cands.filter((c) => Math.abs(c.off) < 75).map((c) => (
          <EnemyTag key={c.id} c={c} width={width} height={height} locked={locked && lock.targetId === c.id} teams={teams}
            primary={c.id === primaryId} anchorY={anchorY} />
        ))}
        <View style={{ position: 'absolute', left: 0, right: 0, top: anchorY - 88, alignItems: 'center' }}>
          <Reticle progress={lock.progress} locked={locked} lockable={!!lock.targetId} kick={kick} />
          <View style={{ marginTop: -space.md, minHeight: 80 }}><HitMarker shot={lastShot} /></View>
        </View>
        {hint && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: anchorY + 120, alignItems: 'center' }}>
            <Pill label={hint} tint={hintTint} testID="hint" />
          </View>
        )}
      </View>

      <Screen blobs={false} style={{ backgroundColor: 'transparent' }}>
        <View style={styles.top}>
          <View style={{ flex: 1, gap: space.sm, alignItems: 'flex-start' }}>
            <HealthBar hp={me.hp} max={me.max_hp} label={weapon.name} />
            <KillFeed items={s.feed} />
            {landscape && hostControls}
          </View>
          <View style={{ alignItems: 'flex-end', gap: space.sm }}>
            {!manual && (
              <Glass radius={radius.lg} padding={4}>
                <Radar me={me} fix={s.fix} players={s.players} rangeM={weapon.range_m} mode={s.settings?.mode ?? 'ffa'} size={landscape ? 104 : 124} />
              </Glass>
            )}
            <Glass radius={radius.md} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4, minWidth: 132 }} testID="stats">
              <Row label="Time" value={`${mm}:${ss.toString().padStart(2, '0')}`} tint={left < 30 ? color.danger : undefined} testID="timer" />
              <Row label="Kills" value={String(me.kills)} testID="kills" />
              <Row label="Alive" value={`${alive}/${s.players.length}`} testID="alive" />
            </Glass>
            {!landscape && hostControls}
          </View>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        <View style={styles.bottom}>
          <AmmoPanel ammo={s.ammo} magazine={weapon.magazine} reloadingUntil={s.reloadingUntil} reloadS={weapon.reload_s} now={now} />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: space.sm }}>
            {manual && (
              <TargetStrip
                enemies={s.players.filter((p) => isEnemy(me, p, s.settings?.mode ?? 'ffa'))}
                selected={manualTarget} onSelect={setManualTarget} teams={teams} />
            )}
          </View>
          <View style={{ alignItems: landscape ? 'center' : 'flex-end', flexDirection: landscape ? 'row' : 'column', gap: space.md }}>
            <GlassButton label="Reload" size="sm" onPress={() => net.reload()} testID="reload"
              disabled={s.reloadingUntil > now || s.ammo >= weapon.magazine} />
            <FireButton ammo={s.ammo} magazine={weapon.magazine} reloadingUntil={s.reloadingUntil} reloadS={weapon.reload_s}
              locked={locked} disabled={dead} onDown={down} onUp={up} now={now} />
          </View>
        </View>
      </Screen>

      <DamageFlash latest={lastDamage} anchorY={anchorY} />

      {dead && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center', padding: space.xl }]} testID="dead">
          <Glass radius={radius.xl} tint={color.danger} padding={space.xl} contentStyle={{ alignItems: 'center', gap: space.sm, minWidth: 240 }}>
            <T v="label" c={color.danger}>Eliminated</T>
            {lastDamage && <T v="headline" c={color.ink2}>by {lastDamage.shooter}</T>}
            {respawnIn != null ? (
              <>
                <T v="display" testID="respawn">{respawnIn}</T>
                <T v="caption" c={color.ink3}>Back in the fight in a moment</T>
              </>
            ) : <T v="body" c={color.ink2}>Spectating until the round ends</T>}
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
