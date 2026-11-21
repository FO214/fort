import React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { net } from '../net/client';
import { useStore } from '../store';
import { color, radius, space } from '../theme';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';


export function Summary() {
  const s = useStore();
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 640;
  const isHost = s.hostId === s.session?.playerId;
  const e = s.ended;
  const results = e?.results ?? [];
  const mine = s.session?.playerId;
  const won = e?.outcome === 'extracted';
  // Whoever was still down when the helicopter left did not make it.
  const fate = (state: 'alive' | 'knocked' | 'dead') =>
    state === 'dead' ? 'dead' : state === 'knocked' ? (won ? 'left behind' : 'knocked') : won ? 'extracted' : 'standing';
  const mm = Math.floor((e?.duration_s ?? 0) / 60), ss = Math.floor((e?.duration_s ?? 0) % 60);

  const headline = (
    <View style={{ gap: space.xs }}>
      <T v="label" c={color.ink3}>Mission over</T>
      <T v="display" c={won ? color.accent : color.danger} testID="outcome">{won ? 'Extracted' : 'Squad wiped'}</T>
      <T v="body" c={color.ink2}>{won ? 'Everyone still standing made it onto the helicopter.' : 'Nobody was left standing.'}</T>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Tile k="Wave" v={String(e?.wave ?? 0)} testID="sum-wave" />
        <Tile k="Kills" v={String(e?.kills ?? 0)} testID="sum-kills" />
        <Tile k="Time" v={`${mm}:${ss.toString().padStart(2, '0')}`} />
      </View>
    </View>
  );

  const table = (
    <Glass radius={radius.xl} padding={space.md} contentStyle={{ gap: space.xs }} testID="results">
      {results.map((r, i) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs }}
          testID={`result-${r.name}`}>
          <T v="mono" c={i === 0 ? color.accent : color.ink3} style={{ width: 20 }}>{i + 1}</T>
          <View style={{ flex: 1 }}>
            <T v="headline" c={r.id === mine ? color.accent : color.ink}>{r.name}</T>
            <T v="caption" c={r.state === 'alive' ? color.ink3 : color.danger}>
              {s.classes[r.cls]?.name ?? r.cls}  ·  {fate(r.state)}{r.revives ? `  ·  ${r.revives} revive${r.revives > 1 ? 's' : ''}` : ''}
            </T>
          </View>
          <T v="mono" c={color.ink}>{r.kills}<T v="caption" c={color.ink3}> kills</T></T>
          <T v="mono" c={color.ink2} style={{ minWidth: 64, textAlign: 'right' }}>{r.damage}<T v="caption" c={color.ink3}> dmg</T></T>
        </View>
      ))}
    </Glass>
  );

  const actions = (
    <View style={{ gap: space.sm }}>
      {isHost
        ? <GlassButton label="Play again" variant="primary" size="lg" onPress={() => net.reset()} testID="again" />
        : <T v="caption" c={color.ink3} style={{ textAlign: 'center' }}>Waiting for the host to start another run</T>}
      <GlassButton label="Leave" variant="ghost" onPress={() => { net.close(); s.leave(); }} testID="leave" />
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
        {wide ? (
          <View style={{ flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: space.lg }}>{headline}{actions}</View>
            <View style={{ flex: 1.2 }}>{table}</View>
          </View>
        ) : (
          <>
            <View style={{ paddingTop: space.lg }}>{headline}</View>
            {table}
            {actions}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Tile({ k, v, testID }: { k: string; v: string; testID?: string }) {
  return (
    <Glass radius={radius.md} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, minWidth: 84, gap: 2 }} testID={testID}>
      <T v="label" c={color.ink3}>{k}</T>
      <T v="monoBig" style={{ fontSize: 24, lineHeight: 28 }}>{v}</T>
    </Glass>
  );
}
