import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormationMark } from '../brand/Brand';
import { feedback } from '../game/feedback';
import { clock } from '../game/format';
import { identityOf } from '../game/identity';
import { net } from '../net/client';
import { ConnectionBanner } from '../overlays/ConnectionOverlay';
import type { PlayerState } from '../net/types';
import { useStore } from '../store';
import { borders, colors, space } from '../theme';
import { Button } from '../ui/Button';
import { Divider, SectionRule } from '../ui/Panel';
import { PlayerMarker } from '../ui/PlayerMarker';
import { Backdrop, CONTENT_MAX } from '../ui/Screen';
import { StatusChip } from '../ui/StatusChip';
import { T } from '../ui/T';

/**
 * How it ended. The outcome is the biggest thing on the screen; the squad's
 * numbers and each player's part in them follow. The host can run it again.
 */
export function ResultsScreen() {
  const s = useStore();
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 640;       // straight off the blaster, still sideways
  const myId = s.session?.playerId;
  const isHost = s.hostId === myId;
  const host = s.roster.find((p) => p.id === s.hostId);
  const e = s.ended;
  const results = e?.results ?? [];
  const won = e?.outcome === 'extracted';
  // The outcome's own cue, once, when the screen arrives.
  useEffect(() => { if (e) feedback(won ? 'win' : 'loss'); }, [e, won]);
  const sum = (pick: (r: (typeof results)[number]) => number) => results.reduce((n, r) => n + pick(r), 0);
  // Whoever was still down when the helicopter left did not make it.
  const fate = (state: PlayerState) =>
    state === 'dead' ? 'Dead' : state === 'knocked' ? (won ? 'Left behind' : 'Knocked') : won ? 'Extracted' : 'Standing';

  const outcome = (
    <View style={{ alignItems: 'center', gap: space[3] }}>
      <FormationMark size={wide ? 44 : 60} color={won ? colors.brand.amber : colors.textSecondary} />
      <T v="displayXL" c={won ? colors.textPrimary : colors.status.danger} center testID="outcome" accessibilityRole="header"
        adjustsFontSizeToFit numberOfLines={1}>
        {won ? 'Extracted' : 'Squad wiped'}
      </T>
      <T v="body" c={colors.textSecondary} center>
        {won ? 'Everyone still standing made it onto the helicopter.' : 'Nobody was left standing.'}
      </T>
      <T v="technical" c={colors.textMuted} center testID="mission-id">
        MISSION {s.session?.code ?? '····'} · {(s.map?.name ?? '').toUpperCase()}
      </T>
    </View>
  );

  const squadStats = (
    <View style={{ gap: space[1] }}>
      <SectionRule><T v="overline" c={colors.textSecondary}>Squad stats</T></SectionRule>
      <StatLine label="Kills" value={String(e?.kills ?? 0)} testID="sum-kills" />
      <StatLine label="Revives" value={String(sum((r) => r.revives))} testID="sum-revives" />
      <StatLine label="Times knocked" value={String(sum((r) => r.knocks))} testID="sum-knocks" />
      <StatLine label="Waves" value={String(e?.wave ?? 0)} testID="sum-wave" />
      <StatLine label="Time" value={clock(e?.duration_s ?? 0)} testID="sum-time" last />
    </View>
  );

  const operators = (
    <View testID="results">
      <View style={styles.columns}>
        <View style={{ flex: 1 }}><SectionRule><T v="overline" c={colors.textSecondary}>Squad</T></SectionRule></View>
        <T v="stat" c={colors.textMuted} style={styles.cell}>Kills</T>
        <T v="stat" c={colors.textMuted} style={styles.cell}>Down</T>
        <T v="stat" c={colors.textMuted} style={styles.cell}>Revs</T>
      </View>
      {results.map((r) => (
        <View key={r.id} style={styles.operator} testID={`result-${r.name}`}
          accessibilityLabel={`${r.name}, ${fate(r.state)}, ${r.kills} kills, knocked ${r.knocks} times, ${r.revives} revives`}>
          <PlayerMarker identity={identityOf(r.id, s.roster)} size={28} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{r.name}</T>
              {r.id === myId ? <T v="label" c={colors.textMuted}>You</T> : null}
            </View>
            <T v="label" c={colors.textSecondary}>
              {s.classes[r.cls]?.name ?? r.cls} · <T v="label" c={r.state === 'alive' ? colors.textPrimary : colors.status.dangerText} testID={`fate-${r.name}`}>{fate(r.state)}</T>
            </T>
          </View>
          <T v="technicalStrong" style={styles.cell} testID={`kills-${r.name}`}>{r.kills}</T>
          <T v="technicalStrong" style={styles.cell} testID={`knocks-${r.name}`}>{r.knocks}</T>
          <T v="technicalStrong" style={styles.cell} testID={`revives-${r.name}`}>{r.revives}</T>
        </View>
      ))}
    </View>
  );

  const actions = (
    <View style={{ gap: space[3] }}>
      <ConnectionBanner />
      {isHost ? (
        <Button label="Play again" variant="primary" onPress={() => net.reset()} testID="again" />
      ) : host && !host.connected ? (
        <StatusChip icon="offline" tone="warn" label="Host disconnected. Waiting for them to return." style={{ alignSelf: 'center' }} testID="host-away" />
      ) : (
        <StatusChip busy tone="neutral" label="Waiting for the host to start another run" style={{ alignSelf: 'center' }} testID="waiting-host" />
      )}
      <Button label="Leave" onPress={() => { net.close(); s.leave(); }} testID="leave" />
    </View>
  );

  return (
    <View style={styles.root} testID="results-screen">
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }}>
        {wide ? (
          <View style={{ flex: 1, flexDirection: 'row', gap: space[8], paddingHorizontal: space[6], paddingVertical: space[4] }}>
            <View style={{ flex: 1, justifyContent: 'space-between' }}>{outcome}{actions}</View>
            <ScrollView style={{ flex: 1.15 }} contentContainerStyle={{ gap: space[5] }} showsVerticalScrollIndicator={false}>
              {squadStats}{operators}
            </ScrollView>
          </View>
        ) : (
          <View style={[styles.column, { flex: 1 }]}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: space[6], paddingBottom: space[5], gap: space[5] }} showsVerticalScrollIndicator={false}>
              {outcome}{squadStats}{operators}
            </ScrollView>
            <View style={styles.footer}>{actions}</View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function StatLine({ label, value, testID, last }: { label: string; value: string; testID?: string; last?: boolean }) {
  return (
    <>
      <View style={styles.statLine}>
        <T v="body" c={colors.textPrimary}>{label}</T>
        <T v="technicalStrong" testID={testID}>{value}</T>
      </View>
      {last ? null : <Divider />}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  column: { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: space[6] },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  columns: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  operator: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, borderBottomWidth: borders.thin, borderBottomColor: colors.border },
  cell: { width: 44, textAlign: 'right' },
  footer: { paddingTop: space[3], paddingBottom: space[3], borderTopWidth: borders.thin, borderTopColor: colors.border },
});
