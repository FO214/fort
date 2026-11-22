import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { borders, colors, radius, space, touch } from '../theme';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/**
 * An on/off setting as one full-width row. The state is spelled out next to
 * the switch, so it does not hang on the knob's position or colour.
 */
export function ToggleRow({ icon, label, detail, value, onChange, testID }: {
  icon: IconName; label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityLabel={label}
      aria-checked={value} style={styles.row}>
      <Icon name={icon} size={22} color={colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{label}</T>
        {detail ? <T v="caption" c={colors.textSecondary}>{detail}</T> : null}
      </View>
      <T v="technical" c={value ? colors.textPrimary : colors.textMuted} style={{ width: 30, textAlign: 'right' }}>{value ? 'On' : 'Off'}</T>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

/** One choice out of a few, side by side. The chosen one is filled and ticked. */
export function Segmented<V extends string | number>({ options, value, onChange, testID }: {
  options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; testID?: string;
}) {
  return (
    <View style={styles.segments} accessibilityRole="radiogroup" testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityLabel={o.label}
            aria-checked={on} testID={testID ? `${testID}-${o.value}` : undefined}
            style={[styles.segment, on && styles.segmentOn]}>
            {on ? <Icon name="check" size={16} color={colors.brand.amber} /> : null}
            <T v="buttonSmall" c={on ? colors.textPrimary : colors.textSecondary}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: touch.comfortable },
  track: {
    width: 46, height: 26, borderRadius: radius.pill, borderWidth: borders.thin, borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceOverlay, justifyContent: 'center', paddingHorizontal: 3,
  },
  trackOn: { borderColor: colors.brand.amber },
  knob: { width: 18, height: 18, borderRadius: radius.pill },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.brand.amber },
  knobOff: { alignSelf: 'flex-start', backgroundColor: colors.textMuted },
  segments: { flexDirection: 'row', gap: space[2] },
  segment: {
    flex: 1, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1],
    borderRadius: radius.sm, borderWidth: borders.thin, borderColor: colors.border, backgroundColor: colors.surfaceOverlay,
  },
  segmentOn: { borderColor: colors.brand.amber, borderWidth: borders.strong, backgroundColor: colors.surface },
});
