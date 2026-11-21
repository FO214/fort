import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { net } from '../net/client';
import { selectMe, useStore } from '../store';
import { color, radius, space, teamColor } from '../theme';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { Dot, Pill } from '../ui/Pill';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const DURATIONS = [120, 300, 600];
const RESPAWNS = [4, 8, 0];

function Choice({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={{ flex: 1 }} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Glass radius={radius.pill} tint={active ? color.accent : undefined} strong={active}
        contentStyle={{ height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <T v="caption" c={active ? color.accent : color.ink2} style={{ fontWeight: '600' }}>{label}</T>
      </Glass>
    </Pressable>
  );
}

export function Lobby() {
  const s = useStore();
  const me = selectMe(s);
  const isHost = s.hostId === s.session?.playerId;
  const settings = s.settings;
  const teams = settings?.mode === 'teams';
  const ready = s.players.filter((p) => p.ready).length;
  const canStart = isHost && s.players.length >= 2;
  const weapons = Object.values(s.weapons);

  const leave = () => { net.close(); s.leave(); };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ gap: space.xs }}>
            <T v="label" c={color.ink3}>Game code</T>
            <T v="display" testID="code" style={{ letterSpacing: 6 }}>{s.session?.code}</T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: space.xs }}>
            <Pill label={s.connection === 'open' ? 'online' : s.connection} tint={s.connection === 'open' ? color.accent : color.warning} />
            <T v="caption" c={color.ink3}>{s.players.length} of {settings?.max_players ?? 8} · {ready} ready</T>
          </View>
        </View>

        <Glass radius={radius.xl} padding={space.md} contentStyle={{ gap: space.xs }} testID="roster">
          {s.players.map((p) => {
            const w = s.weapons[p.weapon];
            return (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs }}
                testID={`player-${p.name}`}>
                <Dot c={p.ready ? color.accent : color.ink4} size={10} />
                <View style={{ flex: 1 }}>
                  <T v="headline" c={p.connected ? color.ink : color.ink3}>{p.name}{p.id === s.session?.playerId ? '  ·  you' : ''}</T>
                  <T v="caption" c={color.ink3}>{w?.name ?? p.weapon}{teams ? `  ·  ${p.team === 'alpha' ? 'Alpha' : 'Bravo'}` : ''}</T>
                </View>
                {teams && <Dot c={teamColor(p.team)} />}
                {p.id === s.hostId && <Pill label="host" />}
              </View>
            );
          })}
        </Glass>

        <View style={{ gap: space.sm }}>
          <T v="label" c={color.ink3}>Loadout</T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {weapons.map((w) => {
              const active = me?.weapon === w.id;
              return (
                <Pressable key={w.id} style={{ flex: 1 }} onPress={() => net.setWeapon(w.id)} testID={`weapon-${w.id}`}
                  accessibilityRole="button" accessibilityState={{ selected: active }}>
                  <Glass radius={radius.lg} tint={active ? color.accent : undefined} strong={active} padding={space.md} contentStyle={{ gap: space.sm }}>
                    <T v="headline" c={active ? color.accent : color.ink}>{w.name}</T>
                    <View style={{ gap: 2 }}>
                      <Stat k="HP" v={String(w.hp)} />
                      <Stat k="DMG" v={String(w.damage)} />
                      <Stat k="MAG" v={String(w.magazine)} />
                      <Stat k="RNG" v={`${w.range_m}m`} />
                      <Stat k="CONE" v={`${w.cone_deg}°`} />
                    </View>
                  </Glass>
                </Pressable>
              );
            })}
          </View>
        </View>

        {teams && (
          <View style={{ gap: space.sm }}>
            <T v="label" c={color.ink3}>Team</T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Choice label="Alpha" active={me?.team === 'alpha'} onPress={() => net.setTeam('alpha')} testID="team-alpha" />
              <Choice label="Bravo" active={me?.team === 'bravo'} onPress={() => net.setTeam('bravo')} testID="team-bravo" />
            </View>
          </View>
        )}

        {settings && (
          <View style={{ gap: space.sm, opacity: isHost ? 1 : 0.6 }} pointerEvents={isHost ? 'auto' : 'none'}>
            <T v="label" c={color.ink3}>Match{isHost ? '' : '  ·  host sets these'}</T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Choice label="Free for all" active={settings.mode === 'ffa'} onPress={() => net.settings({ ...settings, mode: 'ffa' })} testID="mode-ffa" />
              <Choice label="Teams" active={settings.mode === 'teams'} onPress={() => net.settings({ ...settings, mode: 'teams' })} testID="mode-teams" />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Choice label="Aim · GPS (outdoors)" active={settings.aim === 'gps'} onPress={() => net.settings({ ...settings, aim: 'gps' })} testID="aim-gps" />
              <Choice label="Aim · Tap (indoors)" active={settings.aim === 'manual'} onPress={() => net.settings({ ...settings, aim: 'manual' })} testID="aim-manual" />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {DURATIONS.map((d) => (
                <Choice key={d} label={`${d / 60} min`} active={settings.duration_s === d} onPress={() => net.settings({ ...settings, duration_s: d })} testID={`dur-${d}`} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {RESPAWNS.map((r) => (
                <Choice key={r} label={r ? `Respawn ${r}s` : 'No respawn'} active={settings.respawn_s === r} onPress={() => net.settings({ ...settings, respawn_s: r })} testID={`resp-${r}`} />
              ))}
            </View>
          </View>
        )}

        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <GlassButton label={me?.ready ? 'Ready' : 'Tap when ready'} variant={me?.ready ? 'primary' : 'glass'} size="lg"
            onPress={() => net.ready(!me?.ready)} testID="ready" />
          {isHost && (
            <GlassButton label={s.players.length < 2 ? 'Waiting for players…' : 'Start match'} variant="primary" size="lg"
              onPress={() => net.start()} disabled={!canStart} testID="start" />
          )}
          <GlassButton label="Leave" variant="ghost" onPress={leave} testID="leave" />
        </View>
        {s.error ? <T v="caption" c={color.danger} testID="error">{s.error}</T> : null}
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
