import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { CameraView } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { feedback } from '../game/feedback';
import { distXY } from '../game/geo';
import { identityOf } from '../game/identity';
import { permissionsReady, usePermissions } from '../game/permissions';
import { OFF_MAP_M, tracking, useTracking } from '../game/tracking';
import { useLandscape } from '../game/useLandscape';
import { useStayAwake } from '../game/useStayAwake';
import { net } from '../net/client';
import type { PlayerSnap } from '../net/types';
import { ConnectionOverlay } from '../overlays/ConnectionOverlay';
import { DeadOverlay } from '../overlays/DeadOverlay';
import { ExtractionOverlay } from '../overlays/ExtractionOverlay';
import { FullMapOverlay } from '../overlays/FullMapOverlay';
import { HudMenu } from '../overlays/HudMenu';
import { KnockedOverlay } from '../overlays/KnockedOverlay';
import { PermissionOverlay } from '../overlays/PermissionOverlay';
import { RevivePrompt } from '../overlays/RevivePrompt';
import { selectClass, selectMe, serverNow, useStore, zombies } from '../store';
import { alpha, borders, colors, hud, space, touch } from '../theme';
import { AmmoReadout } from '../ui/AmmoReadout';
import { Crosshair } from '../ui/Crosshair';
import { HitMarker } from '../ui/HitMarker';
import { FireControl, HudIconButton, ReloadControl } from '../ui/HudControls';
import { HudPanel } from '../ui/HudPanel';
import { Icon } from '../ui/Icon';
import { hasFloorPlan } from '../ui/MapView';
import { Minimap } from '../ui/Minimap';
import { EventBanner, ObjectiveBanner } from '../ui/ObjectiveBanner';
import { SQUAD_PANEL_W, SQUAD_PANEL_W_COMPACT, SquadFeed, SquadPanel } from '../ui/SquadPanel';
import { StatusHints, type Hint } from '../ui/StatusHints';
import { T } from '../ui/T';
import { HitDirection } from '../ui/ThreatMarker';
import { ZombieLayer, type AimState } from '../ui/ZombieLayer';
import { DeployScreen } from './DeployScreen';

// Mirrors the server's revive rule (Tuning.revive_range_m / revive_slack_cap_m).
const REVIVE_RANGE_M = 4;
const REVIVE_SLACK_CAP_M = 25;
/** A position estimate looser than this is worth telling the player about. */
const WEAK_GPS_M = 25;
/** This close to the helicopter, the host is offered "We're here" on the HUD itself. */
const ARRIVAL_PROMPT_M = 20;

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

/**
 * The match. Everything is laid out for a phone on a blaster, sideways, read
 * at arm's length while walking:
 *
 *   top-left      own health, then the squad
 *   top-centre    the objective, and under it the moment's banner
 *   top-right     wave and zombies left, the minimap, the mission menu
 *   centre        the crosshair, and nothing else
 *   bottom-left   ammo and reload
 *   bottom-centre the hold action that is available: revive, extract
 *   bottom-right  fallback Reload and Fire, under the right thumb
 *   edges         unseen zombies and where the last bite came from
 *
 * On a smaller screen the lower-priority detail goes first; nothing critical
 * is ever shrunk to fit.
 */
export function MatchScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const me = selectMe(s);
  const cls = selectClass(s);
  const myId = s.session?.playerId;
  const isHost = s.hostId === myId;
  const deployed = s.deployed;

  const perms = usePermissions();
  const permsOk = permissionsReady(perms.state);
  const [turned, setTurned] = useState(false);
  const onRotated = useCallback(() => setTurned(true), []);
  useStayAwake('loonie-mission');
  useLandscape(deployed || turned);
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
    if (selectMe(st)?.st !== 'alive' || !st.deployed) return;
    const aim = aimRef.current;
    net.fire(aim.ids, aim.heading);
    tracking.noteShot();
    const loaded = st.ammo > 0 && st.reloadingUntil <= serverNow();
    if (loaded) setKick((k) => k + 1);
    feedback(loaded ? 'fire' : 'empty', selectClass(st)?.id);
  }, []);
  const down = useCallback(() => {
    pull();
    if (cls?.automatic) auto.current = setInterval(pull, cls.fire_interval_s * 1000);
  }, [pull, cls]);
  const up = useCallback(() => { if (auto.current) { clearInterval(auto.current); auto.current = null; } }, []);
  useEffect(() => up, [up]);

  // A paired gun's buttons act exactly like the on-screen ones.
  const pad = useRef({ down, up });
  pad.current = { down, up };
  useEffect(() => net.onGun((m) => {
    if (m.t === 'reload_btn') net.reload();
    else if (m.down) { if (!auto.current) pad.current.down(); }
    else pad.current.up();
  }), []);

  // ---- what the player feels and hears ----
  const lastShot = s.shots[s.shots.length - 1];
  const lastDamage = s.damages[s.damages.length - 1];
  useEffect(() => { if (lastShot?.kind === 'hit') feedback('hit'); if (lastShot?.kind === 'kill') feedback('kill'); }, [lastShot?.key, lastShot?.kind]);
  useEffect(() => { if (lastDamage) feedback('damage'); }, [lastDamage?.key, lastDamage]);
  const wasState = useRef(me?.st);
  useEffect(() => {
    if (me?.st === 'knocked' && wasState.current === 'alive') feedback('knocked');
    if (me?.st === 'alive' && wasState.current === 'knocked') feedback('revived');
    wasState.current = me?.st;
  }, [me?.st]);
  const bannerKey = s.banner?.key;
  useEffect(() => { if (bannerKey && s.banner?.tone !== 'neutral') feedback('wave'); }, [bannerKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A refusal from the server ("Too far away to revive") shows briefly.
  useEffect(() => {
    if (!s.error) return;
    const id = setTimeout(() => useStore.getState().setError(null), 2500);
    return () => clearTimeout(id);
  }, [s.error]);

  const [menu, setMenu] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const plan = s.map && hasFloorPlan(s.map) ? s.map : null;     // null on the open arena
  const pose = tracking.pose();
  const nameOf = (id: string) => s.roster.find((p) => p.id === id)?.name ?? '···';
  const idOf = (id: string) => identityOf(id, s.roster);
  const leave = () => { net.close(); s.leave(); };

  if (!me || !cls) return <View style={styles.root} testID="game" />;

  // ---- how much room there is, after safe areas and the HUD size setting ----
  const scale = s.prefs.hudScale;
  const padL = Math.max(insets.left, hud.margin), padR = Math.max(insets.right, hud.margin);
  const padT = Math.max(insets.top, hud.margin - 4), padB = Math.max(insets.bottom, hud.margin);
  const usableW = (width - padL - padR) / scale, usableH = (height - padT - padB) / scale;
  const short = usableH < hud.compactHeight;
  const narrow = usableW < hud.compactWidth;
  const portrait = height > width;
  const mapSize = short || narrow ? 84 : hud.minimap;
  const showMinimap = usableW >= 560 && !portrait;
  // The corners give way to the objective on a narrow screen, not the other way round.
  const sideW = narrow ? SQUAD_PANEL_W_COMPACT : SQUAD_PANEL_W;
  const centreMax = Math.max(170, usableW - 2 * (sideW + space[3]));

  // ---- what is wrong with the kit, most urgent first ----
  const hints: Hint[] = [];
  if (s.connection !== 'open') hints.push({ id: 'net', icon: 'reconnecting', label: 'Reconnecting', tone: 'warn', busy: true });
  if (perms.state && perms.state.camera !== 'granted') hints.push({ id: 'cam', icon: 'camera', label: 'Camera is off', tone: 'danger' });
  if (s.sensorError) hints.push({ id: 'sensor', icon: 'location', label: s.sensorError, tone: 'danger' });
  if (s.error) hints.push({ id: 'server', icon: 'info', label: s.error, tone: 'warn' });
  if (s.gun === 'lost') hints.push({ id: 'gun', icon: 'unpaired', label: 'Gun disconnected. Touch controls are live.', tone: 'danger' });
  if (!s.sensorError) {
    if (pose.heading == null) hints.push({ id: 'compass', icon: 'motion', label: 'Waiting for compass', tone: 'warn', busy: true });
    else if (!pose.hasFix) hints.push({ id: 'gps', icon: 'location', label: 'Waiting for GPS', tone: 'warn', busy: true });
    else if (Math.abs(pose.x) > OFF_MAP_M || Math.abs(pose.y) > OFF_MAP_M) hints.push({ id: 'offmap', icon: 'map', label: `GPS says you are not at ${s.map?.name ?? 'the map'}`, tone: 'warn' });
    else if (pose.acc > WEAK_GPS_M) hints.push({ id: 'weak', icon: 'signalWeak', label: `Weak GPS ±${Math.round(pose.acc)} m`, tone: 'warn' });
  }
  if (portrait) hints.push({ id: 'turn', icon: 'rotate', label: 'Turn your phone sideways', tone: 'neutral' });

  const canArrive = isHost && s.mission.phase === 'journey';
  const heliDist = s.map ? distXY(pose.x, pose.y, s.map.helicopter.x, s.map.helicopter.y) : Infinity;
  const mates = s.squad.filter((p) => p.id !== myId);
  const standing = mates.filter((p) => p.st === 'alive').map((p) => ({ name: nameOf(p.id), dist: distXY(me.x, me.y, p.x, p.y) })).sort((a, b) => a.dist - b.dist);
  const reloading = s.reloadingUntil > now;
  const corner = (origin: ViewStyle['transformOrigin']): ViewStyle => (scale === 1 ? {} : { transform: [{ scale }], transformOrigin: origin });

  if (!deployed) {
    // Nothing of the HUD exists yet: the phone is still being turned and mounted.
    return (
      <View style={styles.root} testID="game">
        <DeployScreen onRotated={onRotated} onDone={() => s.setDeployed(true)} />
      </View>
    );
  }

  return (
    <View style={styles.root} testID="game">
      {(perms.state?.camera ?? 'granted') === 'granted' ? (
        // The camera is the background, and during the final wave it is also
        // what reads the helicopter's QR code. No separate scanning mode.
        <CameraView style={StyleSheet.absoluteFill} facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={final ? (r) => tracking.noteQr(r.data) : undefined} />
      ) : null}

      <ZombieLayer width={width} height={height} cls={cls} aimRef={aimRef} onAimChange={setOnTarget} inset={Math.max(insets.left, insets.right)} />

      {/* Local scrims where the HUD sits, top and bottom. The middle of the camera is left alone. */}
      <LinearGradient colors={[colors.camera.scrimFrom, colors.camera.scrimTo]} style={[styles.scrim, { top: 0, height: 96 }]} pointerEvents="none" />
      <LinearGradient colors={[colors.camera.scrimTo, colors.camera.scrimFrom]} style={[styles.scrim, { bottom: 0, height: 110 }]} pointerEvents="none" />
      <HudFrame width={width} height={height} l={padL} r={padR} t={padT} b={padB} />

      {me.st === 'knocked' ? (
        <KnockedOverlay bleed={me.bl} reviver={me.rb ? nameOf(me.rb) : null} reviveProgress={me.rv} nearest={standing[0] ?? null} />
      ) : null}

      {/* The sight sits on the exact centre of the camera image. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {alive ? (
          <>
            <View style={{ position: 'absolute', left: width / 2 - hud.crosshair / 2, top: height / 2 - hud.crosshair / 2 }}>
              <Crosshair onTarget={onTarget && !extracting} empty={s.ammo <= 0 && !reloading} kick={kick} />
            </View>
            <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 - 26, alignItems: 'center' }}>
              <HitMarker shot={lastShot} />
            </View>
          </>
        ) : null}
        <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 + hud.crosshair / 2 + space[1], alignItems: 'center' }}>
          <StatusHints hints={hints} />
        </View>
      </View>

      <View style={[StyleSheet.absoluteFill, { paddingLeft: padL, paddingRight: padR, paddingTop: padT, paddingBottom: padB }]} pointerEvents="box-none">
        {/* ---- top ---- */}
        <View style={styles.top} pointerEvents="box-none">
          <View style={[{ gap: space[1], alignItems: 'flex-start' }, corner('top left')]} pointerEvents="box-none">
            <SquadPanel me={me} name={nameOf(me.id)} identity={idOf(me.id)} mates={mates} identityOf={idOf} nameOf={nameOf}
              compact={short || narrow} width={sideW} />
            {short && mates.length > 2 ? null : <SquadFeed items={s.feed} now={Date.now() / 1000} max={short ? 1 : 2} width={sideW + 48} />}
          </View>

          <View style={[{ alignItems: 'flex-end', gap: space[1] }, corner('top right')]} pointerEvents="box-none">
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
              <HudPanel strong contentStyle={styles.wave} testID="stats">
                {narrow ? null : <T v="hudTitle" testID="wave">Wave {s.mission.wave || '–'}</T>}
                <T v="hudTitle" c={s.mission.left > 0 ? colors.textPrimary : colors.textSecondary} testID="zombies-left">
                  {s.mission.left} {s.mission.left === 1 ? 'zombie' : 'zombies'}
                </T>
              </HudPanel>
              <HudIconButton icon="menu" label="Mission menu" onPress={() => setMenu(true)} testID="hud-menu" />
            </View>
            {showMinimap ? (
              <Minimap map={s.map} me={pose} myId={myId} squad={s.squad} zombies={zombies.latest()} identityOf={idOf} size={mapSize}
                onOpen={plan ? () => setShowMap(true) : undefined} />
            ) : null}
          </View>

          {/* Centred on the screen, whatever the corners are doing. */}
          <View style={[styles.topCentre, corner('top')]} pointerEvents="box-none">
            <View style={{ maxWidth: centreMax, alignItems: 'center', gap: space[1] }} pointerEvents="box-none">
              <ObjectiveBanner mission={s.mission} extract={s.extract} me={pose} heli={s.map?.helicopter} maxWidth={centreMax}>
                {canArrive && heliDist <= ARRIVAL_PROMPT_M ? (
                  // GPS can refuse to admit the squad has arrived; the host can say so.
                  // Always in the mission menu; offered here once they are close.
                  <Pressable onPress={() => net.arrived()} testID="arrived" accessibilityRole="button" accessibilityLabel="We're here"
                    accessibilityHint="Tells the game the squad has reached the helicopter"
                    style={({ pressed }) => [styles.arrived, pressed && { backgroundColor: colors.surfaceElevated }]}>
                    <Icon name="helicopter" size={20} color={colors.brand.amber} />
                    <T v="hudMicro">We're{'\n'}here</T>
                  </Pressable>
                ) : null}
              </ObjectiveBanner>
              <EventBanner />
            </View>
          </View>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        {/* ---- bottom ---- */}
        <View style={styles.bottom} pointerEvents="box-none">
          {alive ? (
            <View style={corner('bottom left')}>
              <AmmoReadout ammo={s.ammo} magazine={cls.magazine} reloadingUntil={s.reloadingUntil} reloadS={cls.reload_s} now={now} />
            </View>
          ) : <View style={{ width: touch.fire }} />}
          <View style={[{ flex: 1, alignItems: 'center' }, corner('bottom')]} pointerEvents="box-none">
            {target ? (
              <RevivePrompt name={nameOf(target.id)} holding={reviving} onHold={setReviveDown} progress={target.rb === myId ? target.rv : 0} />
            ) : final && alive ? (
              <ExtractionOverlay qrInView={qrInView} holding={extracting} progress={s.extract.progress}
                holders={s.extract.holders.length} need={s.extract.need} onHold={setExtractDown} />
            ) : null}
          </View>
          {alive ? (
            <View style={[{ flexDirection: 'row', alignItems: 'flex-end', gap: space[4] }, corner('bottom right')]}>
              <ReloadControl reloadingUntil={s.reloadingUntil} reloadS={cls.reload_s} now={now} onPress={() => net.reload()}
                disabled={reloading || s.ammo >= cls.magazine} />
              <FireControl onTarget={onTarget} disabled={extracting} onDown={down} onUp={up} />
            </View>
          ) : <View style={{ width: touch.fire }} />}
        </View>
      </View>

      <HitDirection latest={lastDamage} anchorY={height / 2} />

      {me.st === 'dead' ? <DeadOverlay /> : null}

      {showMap && plan ? (
        <FullMapOverlay map={plan} me={pose} myId={myId} squad={s.squad} zombies={zombies.latest()} identityOf={idOf} nameOf={nameOf}
          onClose={() => setShowMap(false)} />
      ) : null}

      <ConnectionOverlay onLeave={leave} />

      {menu ? (
        <HudMenu isHost={isHost} canMarkArrived={canArrive}
          onArrived={() => net.arrived()} onAbort={() => { setMenu(false); net.reset(); }} onLeave={leave} onClose={() => setMenu(false)} />
      ) : null}

      {perms.state && !permsOk ? (
        <PermissionOverlay state={perms.state} onAllow={perms.request} onOpenSettings={perms.openSettings} />
      ) : null}
    </View>
  );
}

/** Four fine corners marking the edge of the HUD's safe area. */
function HudFrame({ width, height, l, r, t, b }: { width: number; height: number; l: number; r: number; t: number; b: number }) {
  const c = 14, x0 = l - 6, x1 = width - r + 6, y0 = t - 5, y1 = height - b + 6;
  const d = `M ${x0} ${y0 + c} V ${y0} H ${x0 + c} M ${x1 - c} ${y0} H ${x1} V ${y0 + c} M ${x1} ${y1 - c} V ${y1} H ${x1 - c} M ${x0 + c} ${y1} H ${x0} V ${y1 - c}`;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={d} stroke={colors.camera.edge} strokeWidth={3} fill="none" />
      <Path d={d} stroke={alpha(colors.textPrimary, 0.6)} strokeWidth={1} fill="none" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, overflow: 'hidden' },
  scrim: { position: 'absolute', left: 0, right: 0 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  topCentre: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center' },
  wave: { paddingHorizontal: space[3], paddingVertical: space[1] + 1, alignItems: 'flex-end', minHeight: touch.min, justifyContent: 'center' },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', gap: space[3] },
  arrived: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], minHeight: touch.min,
    backgroundColor: colors.camera.backingStrong, borderWidth: borders.thin, borderColor: alpha(colors.textPrimary, 0.4),
  },
});
