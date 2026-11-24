import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormationMark } from '../brand/Brand';
import { MODES } from '../game/format';
import { identityForSlot, identityOf } from '../game/identity';
import { permissionsReady, usePermissions } from '../game/permissions';
import { tracking, useTracking } from '../game/tracking';
import { useStayAwake } from '../game/useStayAwake';
import { net } from '../net/client';
import { ConnectionBanner } from '../overlays/ConnectionOverlay';
import { PermissionOverlay } from '../overlays/PermissionOverlay';
import { selectMyLobby, useStore } from '../store';
import { borders, colors, space } from '../theme';
import { Button } from '../ui/Button';
import { ClassCard } from '../ui/ClassCard';
import { Segmented } from '../ui/Controls';
import { PairGunControl } from '../ui/PairGunControl';
import { Divider } from '../ui/Panel';
import { OpenSlot, RosterRow } from '../ui/RosterRow';
import { CONTENT_MAX } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { StatusChip } from '../ui/StatusChip';
import { T } from '../ui/T';
import { WalkPanel } from '../ui/WalkPanel';
import { FieldMessage } from '../ui/TextField';

/** GPS this tight or better is good enough to place a player in a room. */
const GOOD_GPS_M = 15;

/**
 * Squad assembly. Top to bottom: the code to share, who is here, what each
 * player carries, the blaster, and then the two buttons that move things on.
 * Ready and Start stay pinned at the bottom so they never scroll away.
 */
export function LobbyScreen() {
  const s = useStore();
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 640;       // phone already on the blaster, sideways
  const me = selectMyLobby(s);
  const myId = s.session?.playerId;
  const isHost = s.hostId === myId;
  const code = s.session?.code ?? '';
  const classes = Object.values(s.classes);
  const mine = me ? s.classes[me.cls] : undefined;
  const capacity = s.settings?.max_players ?? 4;

  const perms = usePermissions();
  const permsOk = permissionsReady(perms.state);
  useStayAwake('loonie-lobby');
  useTracking(false, permsOk);      // warm up GPS and the compass before the mission starts

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = async () => { try { await Clipboard.setStringAsync(code); setCopied(true); } catch { /* clipboard unavailable */ } };

  // Leaving a lobby you host hands it to someone else, so ask first if anyone is in it.
  const [confirmLeave, setConfirmLeave] = useState(false);
  const others = s.roster.filter((p) => p.id !== myId && p.connected).length;
  const reallyLeave = () => { net.close(); s.leave(); };
  const leave = () => (isHost && others > 0 ? setConfirmLeave(true) : reallyLeave());

  // On the open arena the host's position becomes the map's (0, 0) for everyone.
  const start = () => net.start(tracking.lastFix);

  // ---- what stands between the squad and Start
  const online = s.connection === 'open';
  const present = s.roster.filter((p) => p.connected);
  const waiting = present.filter((p) => !p.ready);
  const blocker = !online ? 'Waiting for the connection to come back.'
    : waiting.length === 0 ? null
    : waiting.length === 1 ? (waiting[0].id === myId ? 'You are not ready yet.' : `Waiting for ${waiting[0].name} to ready up.`)
    : `Waiting for ${waiting.length} players to ready up.`;

  const gps = s.sensorError ? { label: s.sensorError, tone: 'danger' as const, icon: 'location' as const, busy: false }
    : s.gpsAcc == null ? { label: 'Finding GPS', tone: 'warn' as const, icon: 'location' as const, busy: true }
    : s.gpsAcc <= GOOD_GPS_M ? { label: `GPS ±${Math.round(s.gpsAcc)} m`, tone: 'ok' as const, icon: 'location' as const, busy: false }
    : { label: `Weak GPS ±${Math.round(s.gpsAcc)} m`, tone: 'warn' as const, icon: 'signalWeak' as const, busy: false };

  const header = (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: space[1] }}>
        <T v="overline" c={colors.textSecondary}>Mission code</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
          <T v="code" testID="code" selectable accessibilityLabel={`Mission code ${code.split('').join(' ')}`}>{code}</T>
          <Button label={copied ? 'Copied' : 'Copy'} icon={copied ? 'check' : 'copy'} size="md" onPress={copy} testID="copy"
            accent={copied ? colors.status.health : undefined} accessibilityHint="Copies the mission code" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <StatusChip icon={s.mode === 'endless' ? 'wave' : 'helicopter'} label={MODES[s.mode].name} tone="objective" testID="mode-chip" />
        <StatusChip icon={gps.icon} label={gps.label} tone={gps.tone} busy={gps.busy} testID="gps" />
        {online ? <StatusChip icon="online" label="Online" tone="ok" testID="connection" /> : <ConnectionBanner />}
      </View>
    </View>
  );

  // How the run is played. Everyone sees it; the host chooses it.
  const mode = (
    <View style={{ gap: space[2] }} testID="mode-row">
      <T v="overline" c={colors.textSecondary}>Mode</T>
      {isHost ? (
        <Segmented testID="mode" value={s.mode} onChange={(m) => net.setMode(m)}
          options={[{ value: 'mission' as const, label: MODES.mission.name }, { value: 'endless' as const, label: MODES.endless.name }]} />
      ) : null}
      <T v="label" c={colors.textSecondary} testID="mode-line">
        {isHost ? '' : `${MODES[s.mode].name}. `}{MODES[s.mode].line}
      </T>
    </View>
  );

  const roster = (
    <View testID="roster">
      <Divider />
      {s.roster.slice(0, capacity).map((p) => (
        <React.Fragment key={p.id}>
          <RosterRow name={p.name} identity={identityOf(p.id, s.roster)} className={s.classes[p.cls]?.name ?? p.cls}
            ready={p.ready} connected={p.connected} host={p.id === s.hostId} me={p.id === myId} gun={p.id === myId ? s.gun : undefined} />
          <Divider />
        </React.Fragment>
      ))}
      {/* One line for the places nobody has taken, however many there are. */}
      {s.roster.length < capacity ? (
        <>
          <OpenSlot identity={identityForSlot(s.roster.length)} count={capacity - s.roster.length} />
          <Divider />
        </>
      ) : null}
    </View>
  );

  const loadout = (
    <View style={{ gap: space[2] }}>
      <T v="overline" c={colors.textSecondary}>Select class</T>
      <View style={{ flexDirection: 'row', gap: space[2] }} accessibilityRole="radiogroup">
        {classes.map((w) => <ClassCard key={w.id} cls={w} selected={me?.cls === w.id} onPress={() => net.setClass(w.id)} />)}
      </View>
      {mine ? (
        <T v="label" c={colors.textSecondary} testID="class-summary">
          {mine.name}: {mine.hp} health, {mine.reload_s.toFixed(1)} s reload, {mine.automatic ? 'automatic' : 'one shot per pull'}.
        </T>
      ) : null}
    </View>
  );

  const map = (
    <View style={{ gap: space[2] }} testID="map-row">
      <T v="overline" c={colors.textSecondary}>Map</T>
      {isHost && s.maps.length > 1
        ? <Segmented testID="map" value={s.settings?.map ?? s.map?.id ?? ''} onChange={(id) => net.setMap(id)} options={s.maps.map((m) => ({ value: m.id, label: m.name }))} />
        : <T v="bodyStrong" testID="map-name">{s.settings?.map === 'walked' ? 'Walked area' : s.map?.name ?? '···'}</T>}
      {s.settings?.map === 'walked' ? <WalkPanel isHost={isHost} map={s.map} mission={s.mode === 'mission'} /> : null}
    </View>
  );

  const gun = (
    <PairGunControl gun={s.gun} pairingUntil={s.pairingUntil} onPair={() => { net.pairGun(); s.startPairing(); }} />
  );

  // Beside Start (the host) it is a fixed width; on its own (everyone else) it takes the row.
  const readyStyle = isHost ? { width: 136 } : undefined;
  const ready = me?.ready
    ? <Button label="Ready" icon="check" accent={colors.status.health} onPress={() => net.ready(false)} testID="ready" style={readyStyle}
        accessibilityHint="You are ready. Tap to stand down." />
    : <Button label="Ready up" variant="primary" disabled={!permsOk} onPress={() => net.ready(true)} testID="ready" style={readyStyle}
        accessibilityHint={permsOk ? undefined : 'Allow camera and location first'} />;

  // The host has two things to press, side by side: their own Ready, then Start.
  // Start only lights up once it would work, so there is one amber button at a time.
  const footer = (
    <View style={styles.footer}>
      {s.error ? <FieldMessage tone="error" text={s.error} testID="error" /> : null}
      {s.hostNote ? <FieldMessage tone="info" text={s.hostNote} testID="host-note" /> : null}
      {isHost ? (
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          {ready}
          <Button label={s.mode === 'endless' ? 'Start endless' : 'Start mission'} variant="primary" disabled={!!blocker} onPress={start} testID="start" fill />
        </View>
      ) : ready}
      <T v="label" c={colors.textSecondary} center testID="start-why">
        {isHost ? blocker ?? 'Everyone is ready.' : `${blocker ?? 'Everyone is ready.'} The host starts the mission.`}
      </T>
    </View>
  );

  return (
    <View style={styles.root} testID="lobby">
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[styles.column, wide && styles.columnWide, { flex: 1 }]}>
          <View style={styles.topBar}>
            <FormationMark size={30} />
            <Button label="Leave" variant="tertiary" size="sm" icon="leave" onPress={leave} testID="leave" />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space[4], gap: space[4] }} showsVerticalScrollIndicator={false}>
            {wide ? (
              <View style={{ flexDirection: 'row', gap: space[8], alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: space[4] }}>{header}{mode}{roster}</View>
                <View style={{ flex: 1, gap: space[5] }}>{loadout}{gun}{map}</View>
              </View>
            ) : (
              <>{header}{mode}{roster}{loadout}{gun}{map}</>
            )}
          </ScrollView>
          {footer}
        </View>
      </SafeAreaView>

      {perms.state && !permsOk ? (
        <PermissionOverlay state={perms.state} onAllow={perms.request} onOpenSettings={perms.openSettings} onLeave={reallyLeave} />
      ) : null}

      {confirmLeave ? (
        <Sheet title="Leave your mission?" onClose={() => setConfirmLeave(false)} testID="leave-confirm">
          <T v="body" c={colors.textSecondary}>
            You are hosting {others === 1 ? 'one other player' : `${others} other players`}. If you leave, the lobby stays open and one of them becomes host.
          </T>
          <View style={{ gap: space[3] }}>
            <Button label="Leave mission" variant="destructive" icon="leave" onPress={reallyLeave} testID="leave-yes" />
            <Button label="Stay" onPress={() => setConfirmLeave(false)} testID="leave-no" />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  column: { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: space[6] },
  // Sideways (a phone already on its blaster): two columns need twice the room.
  columnWide: { maxWidth: CONTENT_MAX * 2 + space[8] },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, marginRight: -space[3] },
  footer: { gap: space[2], paddingTop: space[3], paddingBottom: space[2], borderTopWidth: borders.thin, borderTopColor: colors.border },
});
