import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { Identity } from '../game/identity';
import type { MapInfo, PlayerSnap, ZombieRow } from '../net/types';
import { colors, space } from '../theme';
import { Button } from '../ui/Button';
import { HeliMark, MapView, MateMark, MeMark, ZombieMark, type MapPose } from '../ui/MapView';
import { zombieKind, type ZombieKind } from '../ui/ZombieSprite';
import { T } from '../ui/T';

/**
 * The whole floor. Plan way up, everyone named, a key for the marks, and one
 * large Close. Nothing decorative: the plan, the people, the way out.
 */
export function FullMapOverlay({ map, me, myId, squad, zombies, identityOf, nameOf, onClose, showHeli = true }: {
  map: MapInfo; me: MapPose; myId: string | undefined; squad: PlayerSnap[]; zombies: ZombieRow[];
  identityOf: (id: string) => Identity; nameOf: (id: string) => string; onClose: () => void;
  /** False in endless mode: no helicopter on the plan or in the key. */
  showHeli?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const side = 176;                                    // the key and Close, on the right
  const pad = { l: Math.max(insets.left, space[4]), r: Math.max(insets.right, space[4]), t: Math.max(insets.top, space[3]), b: Math.max(insets.bottom, space[3]) };
  const mapW = width - pad.l - pad.r - side - space[4];
  const mapH = height - pad.t - pad.b;
  const c = 18;                                        // framing corner length
  const mate = squad.find((p) => p.id !== myId);
  const kinds = [...new Set([0, ...zombies.map((z) => z[1])])].sort();
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { paddingLeft: pad.l, paddingRight: pad.r, paddingTop: pad.t, paddingBottom: pad.b }]}>
      <View style={{ width: mapW, height: mapH }}>
        <MapView map={map} me={me} myId={myId} squad={squad} zombies={zombies} identityOf={identityOf} nameOf={nameOf}
          width={mapW} height={mapH} mode="full" showHeli={showHeli} />
        {/* Framing corners. */}
        <Svg width={mapW} height={mapH} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={`M 1 ${c} V 1 H ${c} M ${mapW - c} 1 H ${mapW - 1} V ${c} M ${mapW - 1} ${mapH - c} V ${mapH - 1} H ${mapW - c} M ${c} ${mapH - 1} H 1 V ${mapH - c}`}
            stroke={colors.brand.amber} strokeWidth={1.5} fill="none" />
        </Svg>
      </View>
      <View style={{ width: side, justifyContent: 'space-between' }}>
        <View style={{ gap: space[3] }}>
          <View>
            <T v="hudMicro" c={colors.textSecondary}>Map</T>
            <T v="hudTitle" numberOfLines={2}>{map.name}</T>
          </View>
          <View style={{ gap: space[2] }} accessibilityLabel="Map key">
            <Key label="You"><MeMark x={11} y={11} scale={0.85} /></Key>
            {mate ? <Key label="Squad"><MateMark x={11} y={11} identity={identityOf(mate.id)} state="alive" scale={1.2} /></Key> : null}
            {showHeli ? <Key label="Helicopter"><HeliMark x={11} y={11} scale={1.1} /></Key> : null}
            {/* One line per kind of zombie that is on the map right now. */}
            {kinds.map((type) => (
              <Key key={type} label={KIND_LABEL[zombieKind(type)]}><ZombieMark x={11} y={11} type={type} scale={type === 3 ? 1.1 : 1.45} /></Key>
            ))}
          </View>
        </View>
        <Button label="Close" icon="close" onPress={onClose} testID="fullmap-close" />
      </View>
    </View>
  );
}

const KIND_LABEL: Record<ZombieKind, string> = { walker: 'Walker', runner: 'Runner', brute: 'Brute', boss: 'Boss' };

function Key({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <Svg width={22} height={22}>{children}</Svg>
      <T v="hudSecondary">{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexDirection: 'row', gap: space[4], zIndex: 40 },
});
