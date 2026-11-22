import React from 'react';
import { StyleSheet, View } from 'react-native';
import { healthPct } from '../game/format';
import type { Identity } from '../game/identity';
import type { PlayerSnap } from '../net/types';
import type { FeedItem } from '../store';
import { colors, space } from '../theme';
import { HudPanel } from './HudPanel';
import { Icon, type IconName } from './Icon';
import { PlayerMarker } from './PlayerMarker';
import { ProgressBar } from './ProgressBar';
import { T } from './T';

const LOW = 0.5, CRITICAL = 0.25;
export const SQUAD_PANEL_W = 212;
/** On a narrow screen, where the objective needs the room. */
export const SQUAD_PANEL_W_COMPACT = 172;

/**
 * Top-left of the HUD: the player's own health, then the rest of the squad.
 *
 * Own health is a number and a bar cut into one block per hit point. The
 * bar turns red when it is critical, and the label says so too.
 * Teammates are a marker, a name and a number. A teammate who is knocked or
 * dead swaps the number for the word, and that never gets compacted away.
 */
export function SquadPanel({ me, name, identity, mates, identityOf, nameOf, compact, width = SQUAD_PANEL_W }: {
  me: PlayerSnap; name: string; identity: Identity; mates: PlayerSnap[];
  identityOf: (id: string) => Identity; nameOf: (id: string) => string;
  /** Small screens drop teammates' bars and keep name and state. */
  compact?: boolean;
  width?: number;
}) {
  const frac = me.max > 0 ? me.hp / me.max : 0;
  const state = me.st !== 'alive' ? 'down' : frac <= CRITICAL ? 'critical' : frac <= LOW ? 'low' : 'ok';
  const tint = state === 'ok' ? colors.status.health : state === 'low' ? colors.brand.amber : colors.status.danger;
  return (
    <View style={{ gap: space[1], alignItems: 'flex-start' }}>
      <HudPanel strong contentStyle={[styles.own, { width }]} testID="healthbar"
        accessibilityLabel={`Your health ${healthPct(me.hp, me.max)} percent${state === 'critical' ? ', critical' : ''}`}>
        <View style={styles.line}>
          <PlayerMarker identity={identity} size={20} numbered={false} />
          <T v="hudLabel" numberOfLines={1} style={{ flex: 1 }}>{name}</T>
          {state === 'critical' || state === 'low' ? <Icon name="warning" size={16} color={tint} /> : null}
          <T v="hudValue" c={state === 'ok' ? colors.textPrimary : tint} testID="hp">{healthPct(me.hp, me.max)}</T>
        </View>
        <ProgressBar value={frac} segments={me.max} color={tint} track={colors.border} height={7} accessibilityLabel="Health" />
      </HudPanel>

      {mates.length > 0 ? (
        <View style={{ gap: 3 }} testID="squad">
          {mates.map((p) => <Mate key={p.id} p={p} name={nameOf(p.id)} identity={identityOf(p.id)} compact={compact} width={width} />)}
        </View>
      ) : null}
    </View>
  );
}

function Mate({ p, name, identity, compact, width }: { p: PlayerSnap; name: string; identity: Identity; compact?: boolean; width: number }) {
  const frac = p.max > 0 ? p.hp / p.max : 0;
  // Knocked and dead say so in words, with an icon, in red. Never compacted.
  const down: { icon: IconName; label: string } | null = p.st === 'dead' ? { icon: 'dead', label: 'Dead' }
    : p.st === 'knocked' ? { icon: 'knocked', label: p.rb ? 'Reviving' : 'Knocked' }
    : null;
  return (
    // A teammate who is down carries red marks, which need the darker plate.
    <HudPanel strong={!!down} contentStyle={[styles.mate, { width }, !p.on && { opacity: 0.55 }]} testID={`mate-${name}`} accent={down ? colors.status.danger : undefined}
      accessibilityLabel={`${name}, ${down ? down.label : `${healthPct(p.hp, p.max)} percent`}${p.on ? '' : ', offline'}`}>
      <PlayerMarker identity={identity} size={16} numbered={false} dim={p.st === 'dead'} />
      <T v="hudSecondary" c={p.st === 'dead' ? colors.textSecondary : colors.textPrimary} numberOfLines={1} style={styles.mateName}>{name}</T>
      {down ? (
        <>
          <Icon name={down.icon} size={15} color={colors.status.danger} />
          <T v="hudMicro" c={colors.textPrimary}>{down.label}</T>
          {p.st === 'knocked' ? (
            // Along the bottom edge, so the name keeps its room. Being revived: the revive
            // filling. Otherwise: the bleed-out draining.
            <View style={styles.underline}>
              <ProgressBar value={p.rb ? p.rv : p.bl} color={p.rb ? colors.status.health : colors.status.danger} track={colors.border} height={3}
                accessibilityLabel={p.rb ? 'Revive progress' : 'Bleed-out'} />
            </View>
          ) : null}
        </>
      ) : !p.on ? (
        <><Icon name="offline" size={15} color={colors.textSecondary} /><T v="hudMicro" c={colors.textSecondary}>Offline</T></>
      ) : (
        <>
          {compact ? null : (
            <ProgressBar value={frac} color={frac <= CRITICAL ? colors.status.danger : frac <= LOW ? colors.brand.amber : colors.status.health}
              track={colors.border} height={5} style={{ width: 34 }} />
          )}
          <T v="hudSecondary" style={styles.mateHp}>{healthPct(p.hp, p.max)}</T>
        </>
      )}
    </HudPanel>
  );
}

/**
 * Squad news under the list: who was knocked, revived, lost. Two lines at
 * most, each gone after a few seconds.
 */
export function SquadFeed({ items, now, max = 2, width = 260 }: { items: FeedItem[]; now: number; max?: number; width?: number }) {
  const live = items.filter((it) => now - it.at < 6).slice(-max);
  return (
    <View style={{ gap: 3 }} testID="feed">
      {live.map((it) => (
        <HudPanel key={it.key} strong contentStyle={[styles.news, { maxWidth: width }]} accent={it.tone === 'bad' ? colors.status.danger : it.tone === 'good' ? colors.status.health : undefined}>
          <Icon name={it.tone === 'bad' ? 'warning' : it.tone === 'good' ? 'check' : 'info'} size={15}
            color={it.tone === 'bad' ? colors.status.danger : it.tone === 'good' ? colors.status.health : colors.textSecondary} />
          <T v="hudSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>{it.text}{it.detail ? ` ${it.detail}` : ''}</T>
        </HudPanel>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  own: { paddingHorizontal: space[3], paddingTop: space[1] + 2, paddingBottom: space[2], gap: space[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  mate: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[3], paddingRight: space[2], minHeight: 28 },
  mateName: { flex: 1, minWidth: 48 },
  underline: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  mateHp: { minWidth: 30, textAlign: 'right', fontVariant: ['tabular-nums'] },
  news: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[3], paddingRight: space[3], minHeight: 28 },
});
