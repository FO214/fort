import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { GunClass } from '../net/types';
import { borders, colors, radius, space } from '../theme';
import { Icon } from './Icon';
import { T } from './T';
import { WeaponGlyph } from './WeaponGlyph';

/** The four numbers a class is chosen by, as the card shows them. */
export function classStats(w: GunClass): { key: string; label: string; value: string }[] {
  return [
    { key: 'DMG', label: 'Damage', value: String(w.damage) },
    { key: 'MAG', label: 'Magazine', value: String(w.magazine) },
    { key: 'RATE', label: 'Fire rate', value: `${(1 / w.fire_interval_s).toFixed(1)}/s` },
    { key: 'RNG', label: 'Range', value: `${w.range_m} m` },
  ];
}

/**
 * One loadout: its silhouette, its name, and its numbers. The numbers are
 * written out; nothing is left to the length of a bar. The chosen card has
 * an amber border and says "Selected".
 */
export function ClassCard({ cls, selected, onPress, disabled }: { cls: GunClass; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const stats = classStats(cls);
  return (
    <Pressable onPress={onPress} disabled={disabled} testID={`class-${cls.id}`}
      accessibilityRole="radio" aria-checked={selected} aria-disabled={!!disabled}
      accessibilityLabel={`${cls.name}. ${stats.map((s) => `${s.label} ${s.value}`).join(', ')}`}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && !selected && styles.pressed]}>
      <View style={styles.tag}>
        {selected ? (
          <>
            <Icon name="check" size={11} color={colors.brand.amber} weight={2.4} />
            <T v="stat" c={colors.brand.amber}>Selected</T>
          </>
        ) : null}
      </View>
      <WeaponGlyph classId={cls.id} width={60} color={selected ? colors.textPrimary : colors.textSecondary} />
      <T v="overline" c={colors.textPrimary} numberOfLines={1} style={styles.name}>{cls.name}</T>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.key} style={styles.stat}>
            <T v="stat" c={colors.textMuted}>{s.key}</T>
            <T v="statValue" c={colors.textPrimary}>{s.value}</T>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1, alignItems: 'center', paddingTop: space[1], paddingBottom: space[2], paddingHorizontal: 6,
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: borders.strong, borderColor: colors.border,
  },
  selected: { borderColor: colors.brand.amber, backgroundColor: colors.surfaceElevated },
  pressed: { backgroundColor: colors.surfaceElevated },
  tag: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 3 },
  name: { marginTop: 2 },
  stats: { alignSelf: 'stretch', marginTop: space[1], gap: 1 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
