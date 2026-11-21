import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { tracking, useTracking } from '../game/tracking';
import { useStayAwake } from '../game/useStayAwake';
import { net } from '../net/client';
import { selectMyLobby, useStore } from '../store';
import { color, radius, space } from '../theme';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { Dot, Pill } from '../ui/Pill';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

export function Lobby() {
  const s = useStore();
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 640;       // phone already on the gun, sideways
  const me = selectMyLobby(s);
  const isHost = s.hostId === s.session?.playerId;
  const ready = s.roster.filter((p) => p.ready).length;
  const classes = Object.values(s.classes);
  useStayAwake('loonie-lobby');
  useTracking(false);      // warm up GPS and the compass before the mission starts

  const leave = () => { net.close(); s.leave(); };
  // On the open arena the host's position becomes the map's (0, 0) for everyone.
  const start = () => net.start(tracking.lastFix);

  const gps = s.sensorError ? { label: s.sensorError, tint: color.danger }
    : s.gpsAcc == null ? { label: 'Finding GPS…', tint: color.warning }
    : { label: `GPS ±${Math.round(s.gpsAcc)} m`, tint: s.gpsAcc <= 15 ? color.accent : color.warning };

  const header = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <View style={{ gap: space.xs }}>
        <T v="label" c={color.ink3}>Squad code</T>
        <T v="display" testID="code" style={{ letterSpacing: 6 }}>{s.session?.code}</T>
      </View>
      <View style={{ alignItems: 'flex-end', gap: space.xs }}>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Pill label={gps.label} tint={gps.tint} testID="gps" />
          <Pill label={s.connection === 'open' ? 'online' : s.connection} tint={s.connection === 'open' ? color.accent : color.warning} />
        </View>
        <T v="caption" c={color.ink3}>{s.roster.length} of {s.settings?.max_players ?? 4} · {ready} ready</T>
      </View>
    </View>
  );

  const roster = (
    <Glass radius={radius.xl} padding={space.md} contentStyle={{ gap: space.xs }} testID="roster">
      {s.roster.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs }}
          testID={`player-${p.name}`}>
          <Dot c={p.ready ? color.accent : color.ink4} size={10} />
          <View style={{ flex: 1 }}>
            <T v="headline" c={p.connected ? color.ink : color.ink3}>{p.name}{p.id === s.session?.playerId ? '  ·  you' : ''}</T>
            <T v="caption" c={color.ink3}>{s.classes[p.cls]?.name ?? p.cls}</T>
          </View>
          {p.id === s.hostId && <Pill label="host" />}
        </View>
      ))}
    </Glass>
  );

  const loadout = (
    <View style={{ gap: space.sm }}>
      <T v="label" c={color.ink3}>Loadout</T>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {classes.map((w) => {
          const active = me?.cls === w.id;
          return (
            <Pressable key={w.id} style={{ flex: 1 }} onPress={() => net.setClass(w.id)} testID={`class-${w.id}`}
              accessibilityRole="button" accessibilityState={{ selected: active }}>
              <Glass radius={radius.lg} tint={active ? color.accent : undefined} strong={active} padding={space.md} contentStyle={{ gap: space.sm }}>
                <T v="headline" c={active ? color.accent : color.ink}>{w.name}</T>
                <View style={{ gap: 2 }}>
                  <Stat k="HP" v={String(w.hp)} />
                  <Stat k="DMG" v={String(w.damage)} />
                  <Stat k="MAG" v={String(w.magazine)} />
                  <Stat k="RATE" v={`${(1 / w.fire_interval_s).toFixed(1)}/s`} />
                  <Stat k="RNG" v={`${w.range_m}m`} />
                </View>
              </Glass>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const briefing = (
    <Glass radius={radius.lg} padding={space.md} contentStyle={{ gap: space.xs }}>
      <T v="label" c={color.ink3}>Mission</T>
      <T v="caption" c={color.ink2}>
        Fight through the waves. The crosshair is your gun sight: put it on a zombie and fire.
        {s.map ? `  Map: ${s.map.name}.` : ''}
      </T>
    </Glass>
  );

  const actions = (
    <View style={{ gap: space.sm }}>
      <GlassButton label={me?.ready ? 'Ready' : 'Tap when ready'} variant={me?.ready ? 'primary' : 'glass'} size="lg"
        onPress={() => net.ready(!me?.ready)} testID="ready" />
      {isHost
        ? <GlassButton label="Start mission" variant="primary" size="lg" onPress={start} testID="start" />
        : <T v="caption" c={color.ink3} style={{ textAlign: 'center' }}>The host starts the mission</T>}
      <GlassButton label="Leave" variant="ghost" onPress={leave} testID="leave" />
      {s.error ? <T v="caption" c={color.danger} testID="error">{s.error}</T> : null}
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
        {header}
        {wide ? (
          <View style={{ flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: space.lg }}>{roster}{briefing}</View>
            <View style={{ flex: 1, gap: space.lg }}>{loadout}{actions}</View>
          </View>
        ) : (
          <>{roster}{loadout}{briefing}{actions}</>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <T v="label" c={color.ink3} style={{ fontSize: 10 }}>{k}</T>
      <T v="mono" c={color.ink2} style={{ fontSize: 12, lineHeight: 13 }}>{v}</T>
    </View>
  );
}
