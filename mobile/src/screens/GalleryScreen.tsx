/**
 * The design system on one screen: palette, type, components, icons,
 * weapons, zombies, player identities, brand marks. For checking the system
 * against itself on a real device.
 *
 * Reached from Settings → Advanced → Design system, or `?gallery=1` on the
 * web build. Not part of the game.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormationMark, Lockup, Wordmark } from '../brand/Brand';
import { BRAND } from '../brand/geometry';
import { identityForSlot } from '../game/identity';
import type { GunClass } from '../net/types';
import { borders, colors, contrast, materials, radius, space, type, type TypeVariant } from '../theme';
import { Button, IconButton } from '../ui/Button';
import { ClassCard } from '../ui/ClassCard';
import { Segmented, ToggleRow } from '../ui/Controls';
import { HudPanel } from '../ui/HudPanel';
import { ICON_NAMES, Icon } from '../ui/Icon';
import { MissionCodeInput } from '../ui/MissionCodeInput';
import { PairGunControl } from '../ui/PairGunControl';
import { Panel, SectionRule } from '../ui/Panel';
import { PlayerMarker } from '../ui/PlayerMarker';
import { ProgressBar } from '../ui/ProgressBar';
import { ProgressRing } from '../ui/ProgressRing';
import { RosterRow } from '../ui/RosterRow';
import { Backdrop } from '../ui/Screen';
import { StatusChip } from '../ui/StatusChip';
import { T } from '../ui/T';
import { FieldMessage, TextField } from '../ui/TextField';
import { WeaponGlyph } from '../ui/WeaponGlyph';
import { ZOMBIE_KINDS, ZOMBIE_SCALE, ZombieSprite } from '../ui/ZombieSprite';

const SWATCHES: [string, string][] = [
  ['Obsidian', colors.background], ['Graphite', colors.surface], ['Bone', colors.textPrimary], ['Amber', colors.brand.amber],
  ['Olive', colors.status.health], ['Red', colors.status.danger], ['Blue', colors.players.two], ['Silver', colors.status.neutral],
];
const TYPE_STEPS: TypeVariant[] = ['displayXL', 'displayL', 'headingM', 'overline', 'button', 'bodyStrong', 'body', 'label', 'technical',
  'hudHero', 'hudPrimary', 'hudTitle', 'hudValue', 'hudLabel', 'hudSecondary', 'hudMicro'];
const DEMO_CLASSES: GunClass[] = [
  { id: 'pistol', name: 'Pistol', damage: 2, fire_interval_s: 0.4, magazine: 10, reload_s: 2.6, spread_deg: 2, range_m: 35, automatic: false, hp: 8 },
  { id: 'smg', name: 'SMG', damage: 1, fire_interval_s: 0.12, magazine: 24, reload_s: 2.2, spread_deg: 3, range_m: 25, automatic: true, hp: 6 },
  { id: 'shotgun', name: 'Shotgun', damage: 3, fire_interval_s: 0.7, magazine: 6, reload_s: 3, spread_deg: 5, range_m: 12, automatic: false, hp: 9 },
  { id: 'rifle', name: 'Rifle', damage: 4, fire_interval_s: 0.9, magazine: 5, reload_s: 3.4, spread_deg: 1, range_m: 50, automatic: false, hp: 10 },
];

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[4] }} testID={`gallery-${n}`}>
      <SectionRule><T v="overline" c={colors.textSecondary}>{n}. {title}</T></SectionRule>
      {children}
    </View>
  );
}

export function GalleryScreen({ onClose }: { onClose?: () => void }) {
  const [cls, setCls] = useState('rifle');
  const [code, setCode] = useState('7F');
  const [toggle, setToggle] = useState(true);
  const [seg, setSeg] = useState('b');
  return (
    <View style={styles.root} testID="gallery">
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <T v="displayL">Blacksite</T>
              <T v="technical" c={colors.textSecondary}>DESIGN SYSTEM v1.0</T>
            </View>
            {onClose ? <IconButton icon="close" label="Close" onPress={onClose} testID="gallery-close" /> : null}
          </View>

          <Section n="01" title="Brand">
            <View style={{ alignItems: 'center', paddingVertical: space[4] }}><Lockup tagline /></View>
            <View style={styles.row}>
              <FormationMark size={64} /><FormationMark size={64} color={colors.textPrimary} />
              <View style={{ backgroundColor: colors.textPrimary, padding: space[2] }}><FormationMark size={48} color={colors.background} /></View>
              <FormationMark size={32} /><FormationMark size={20} /><FormationMark size={14} />
            </View>
            <View style={styles.row}><Wordmark height={30} /><Wordmark height={18} color={colors.brand.amber} /></View>
            <T v="tagline" c={colors.brand.amber}>{BRAND.campaign}</T>
          </Section>

          <Section n="02" title="Colour">
            <View style={[styles.row, { gap: space[3] }]}>
              {SWATCHES.map(([name, hex]) => (
                <View key={name} style={{ width: 74, gap: 4 }}>
                  <View style={{ height: 52, backgroundColor: hex, borderRadius: radius.xs, borderWidth: borders.thin, borderColor: colors.border }} />
                  <T v="label">{name}</T>
                  <T v="stat" c={colors.textSecondary}>{hex}  {contrast(hex, colors.background).toFixed(1)}:1</T>
                </View>
              ))}
            </View>
          </Section>

          <Section n="03" title="Type">
            {TYPE_STEPS.map((v) => (
              <View key={v} style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[3] }}>
                <T v="stat" c={colors.textMuted} style={{ width: 92 }}>{v} {type[v].fontSize}</T>
                <T v={v} numberOfLines={1} style={{ flex: 1 }}>{v.startsWith('hud') || v === 'technical' ? 'Wave 3  142 m  30/90' : 'Reach the helicopter'}</T>
              </View>
            ))}
          </Section>

          <Section n="04" title="Buttons">
            <View style={styles.row}>
              <Button label="Primary" variant="primary" fill /><Button label="Secondary" fill /><Button label="Tertiary" variant="tertiary" fill />
            </View>
            <View style={styles.row}>
              <Button label="Loading" variant="primary" loading fill /><Button label="Disabled" variant="primary" disabled fill />
            </View>
            <View style={styles.row}>
              <Button label="Abort mission" variant="destructive" fill /><Button label="Ready" icon="check" accent={colors.status.health} fill />
            </View>
            <View style={styles.row}>
              <Button label="Copy" size="md" icon="copy" /><Button label="Retry" size="sm" icon="retry" />
              <IconButton icon="settings" label="Settings" /><IconButton icon="back" label="Back" tone="tertiary" />
            </View>
          </Section>

          <Section n="05" title="Fields and controls">
            <TextField label="Call sign" value="Fahmi" onChangeText={() => {}} />
            <TextField label="Call sign" value="" placeholder="Your name in the squad" onChangeText={() => {}} error="Enter a call sign first." />
            <MissionCodeInput value={code} onChange={setCode} />
            <FieldMessage tone="error" text="No game with that code. Check it with the host and try again." />
            <ToggleRow icon="haptics" label="Haptics" detail="Vibration on fire, hits and damage" value={toggle} onChange={setToggle} />
            <Segmented value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Compact' }, { value: 'b', label: 'Standard' }, { value: 'c', label: 'Large' }]} />
            <View style={[styles.row, { gap: space[2] }]}>
              <StatusChip icon="location" label="GPS ±3 m" tone="ok" /><StatusChip icon="online" label="Online" tone="ok" />
              <StatusChip busy label="Finding GPS" tone="warn" /><StatusChip icon="signalWeak" label="Weak GPS ±32 m" tone="warn" />
              <StatusChip icon="offline" label="Offline" tone="danger" />
            </View>
          </Section>

          <Section n="06" title="Progress">
            <ProgressBar value={0.23} />
            <ProgressBar value={0.6} color={colors.status.health} segments={10} />
            <ProgressBar value={0.2} color={colors.status.danger} segments={10} />
            <View style={styles.row}>
              <ProgressRing value={0.25} size={96}><T v="hudValue">2.3s</T></ProgressRing>
              <ProgressRing value={0.7} size={72} color={colors.status.health}><Icon name="revive" size={26} /></ProgressRing>
              <ProgressRing value={0} size={72}><Icon name="scan" size={26} /></ProgressRing>
            </View>
          </Section>

          <Section n="07" title="Roster and classes">
            <RosterRow name="Fahmi" identity={identityForSlot(0)} className="Pistol" ready connected host me gun="paired" />
            <RosterRow name="alexis" identity={identityForSlot(1)} className="SMG" ready connected host={false} me={false} />
            <RosterRow name="milo" identity={identityForSlot(2)} className="Shotgun" ready={false} connected host={false} me={false} />
            <RosterRow name="jordan" identity={identityForSlot(3)} className="Rifle" ready connected={false} host={false} me={false} />
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              {DEMO_CLASSES.map((w) => <ClassCard key={w.id} cls={w} selected={cls === w.id} onPress={() => setCls(w.id)} />)}
            </View>
            <View style={styles.row}>
              {DEMO_CLASSES.map((w) => <WeaponGlyph key={w.id} classId={w.id} width={150} />)}
            </View>
          </Section>

          <Section n="08" title="Gun pairing">
            <PairGunControl gun="none" pairingUntil={0} onPair={() => {}} />
            <PairGunControl gun="pairing" pairingUntil={Date.now() / 1000 + 7.4} onPair={() => {}} />
            <PairGunControl gun="paired" pairingUntil={0} onPair={() => {}} />
            <PairGunControl gun="timeout" pairingUntil={0} onPair={() => {}} />
            <PairGunControl gun="lost" pairingUntil={0} onPair={() => {}} />
          </Section>

          <Section n="09" title="Icon set">
            <View style={[styles.row, { gap: space[2] }]}>
              {ICON_NAMES.map((name) => (
                <View key={name} style={styles.icon}>
                  <Icon name={name} size={28} />
                  <T v="stat" c={colors.textMuted} numberOfLines={1}>{name}</T>
                </View>
              ))}
            </View>
          </Section>

          <Section n="10" title="Zombie types">
            {/* On dark and on light: the outline has to carry both. */}
            {[colors.background, colors.sample.bright].map((bg) => (
              <View key={bg} style={[styles.zombies, { backgroundColor: bg }]}>
                {ZOMBIE_KINDS.map((kind, i) => (
                  <View key={kind} style={styles.zombie}>
                    <ZombieSprite type={i} clip="move" frame={3} row={0} mirror={false} size={150 * ZOMBIE_SCALE[kind]} hp={1} hurt={false} aimed={false} />
                    <T v="overline" c={bg === colors.background ? colors.textPrimary : colors.background}>{kind}</T>
                  </View>
                ))}
              </View>
            ))}
            <T v="label" c={colors.textSecondary}>From the side, the quarter and behind. Under the crosshair, biting, hit, falling, and far away.</T>
            {ZOMBIE_KINDS.map((kind, i) => {
              const size = 96 * ZOMBIE_SCALE[kind];
              const pose = { type: i, size, hp: 1, hurt: false, aimed: false, mirror: false } as const;
              return (
                <View key={kind} style={[styles.zombies, styles.zombieStates, { backgroundColor: colors.sample.dim }]}>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="move" frame={2} row={2} /></View>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="move" frame={5} row={1} mirror /></View>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="move" frame={8} row={3} /></View>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="move" frame={0} row={4} /></View>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="move" frame={6} row={0} hp={0.4} aimed /></View>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="attack" frame={4} row={1} hp={0.2} /></View>
                  <View style={styles.zombieCell}><ZombieSprite {...pose} clip="move" frame={1} row={0} hp={0.8} hurt /></View>
                  <View style={[styles.zombieCell, { width: 200 }]}><ZombieSprite {...pose} clip="die" frame={4} row={2} /></View>
                  <View style={[styles.zombieCell, { width: 48 }]}><ZombieSprite {...pose} clip="move" frame={4} row={0} size={34} /></View>
                </View>
              );
            })}
          </Section>

          <Section n="11" title="Player identities">
            <View style={styles.row}>
              {[0, 1, 2, 3].map((slot) => {
                const id = identityForSlot(slot);
                return (
                  <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                    <PlayerMarker identity={id} size={30} /><PlayerMarker identity={id} size={16} />
                    <T v="technicalStrong" c={id.color}>{id.label}</T>
                  </View>
                );
              })}
            </View>
          </Section>

          <Section n="12" title="Materials">
            <View style={styles.row}>
              <Panel style={{ flex: 1 }}><T v="label">Solid</T></Panel>
              <Panel elevated style={{ flex: 1 }}><T v="label">Elevated</T></Panel>
              <Panel selected style={{ flex: 1 }}><T v="label">Selected</T></Panel>
            </View>
            <View style={[styles.row, { backgroundColor: colors.sample.mid, padding: space[3] }]}>
              <HudPanel contentStyle={{ padding: space[3] }}><T v="hudLabel">Backing</T></HudPanel>
              <HudPanel strong accent={colors.status.objective} contentStyle={{ padding: space[3] }}><T v="hudLabel">Strong</T></HudPanel>
              <HudPanel material="glass" contentStyle={{ padding: space[3] }}><T v="hudLabel">Glass</T></HudPanel>
            </View>
            <T v="stat" c={colors.textMuted}>blur {materials.glass.intensity} · radius {radius.xs}/{radius.sm}/{radius.md} · border {borders.thin}/{borders.strong}</T>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space[6], gap: space[8], maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[4] },
  icon: { width: 74, alignItems: 'center', gap: 4, paddingVertical: space[2] },
  zombies: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingTop: space[10], paddingBottom: space[4], paddingHorizontal: space[6], borderRadius: radius.xs, overflow: 'hidden' },
  // The sprite is only as wide as the body; arms reach past it, so give each one room.
  zombie: { alignItems: 'center', justifyContent: 'flex-end', gap: space[2], marginHorizontal: space[5] },
  zombieStates: { flexWrap: 'wrap', justifyContent: 'flex-start', rowGap: space[10] },
  zombieCell: { width: 132, alignItems: 'center', justifyContent: 'flex-end' },
});
