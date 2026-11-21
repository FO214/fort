import React from 'react';
import { ScrollView, View } from 'react-native';
import { net } from '../net/client';
import { useStore } from '../store';
import { color, radius, space, teamColor } from '../theme';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { Dot } from '../ui/Pill';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

export function Summary() {
  const s = useStore();
  const isHost = s.hostId === s.session?.playerId;
  const results = s.results ?? [];
  const winner = results[0];
  const mine = s.session?.playerId;
  const teams = s.teamsResult;
  const teamWinner = teams ? (teams.alpha === teams.bravo ? null : teams.alpha > teams.bravo ? 'alpha' : 'bravo') : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
        <View style={{ gap: space.xs, paddingTop: space.lg }}>
          <T v="label" c={color.ink3}>Match over</T>
          {teams ? (
            <T v="display" c={teamWinner ? teamColor(teamWinner) : color.ink} testID="winner">
              {teamWinner ? `${teamWinner === 'alpha' ? 'Alpha' : 'Bravo'} wins` : 'Draw'}
            </T>
          ) : (
            <T v="display" testID="winner">{winner ? `${winner.name} wins` : 'No result'}</T>
          )}
          {teams && <T v="mono" c={color.ink2}>Alpha {teams.alpha}  ·  Bravo {teams.bravo}</T>}
        </View>

        <Glass radius={radius.xl} padding={space.md} contentStyle={{ gap: space.xs }} testID="results">
          {results.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs }}
              testID={`result-${r.name}`}>
              <T v="mono" c={r.place === 1 ? color.accent : color.ink3} style={{ width: 24 }}>{r.place}</T>
              {teams && <Dot c={teamColor(r.team)} />}
              <T v="headline" c={r.id === mine ? color.accent : color.ink} style={{ flex: 1 }}>{r.name}</T>
              <T v="mono" c={color.ink}>{r.kills}<T v="caption" c={color.ink3}> K</T></T>
              <T v="mono" c={color.ink2}>{r.deaths}<T v="caption" c={color.ink3}> D</T></T>
            </View>
          ))}
        </Glass>

        <View style={{ gap: space.sm }}>
          {isHost
            ? <GlassButton label="Play again" variant="primary" size="lg" onPress={() => net.send({ t: 'reset' })} testID="again" />
            : <T v="caption" c={color.ink3} style={{ textAlign: 'center' }}>Waiting for the host to start another round</T>}
          <GlassButton label="Leave" variant="ghost" onPress={() => { net.close(); s.leave(); }} testID="leave" />
        </View>
      </ScrollView>
    </Screen>
  );
}
