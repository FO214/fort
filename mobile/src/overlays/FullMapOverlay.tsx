import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { Identity } from '../game/identity';
import type { MapInfo, PlayerSnap, ZombieRow } from '../net/types';
import { colors, space } from '../theme';
import { Button } from '../ui/Button';
import { HeliMark, MapView, MateMark, MeMark, ZombieMark, type MapPose } from '../ui/MapView';
import { fitFull, mapExtent } from '../ui/mapFrame';
import { zombieKind, type ZombieKind } from '../ui/ZombieSprite';
import { T } from '../ui/T';

type Step = 'idle' | 'where' | 'facing';
const CALIBRATED_SHOWN_MS = 3000;

/**
 * The whole floor. Plan way up, everyone named, a key for the marks, and one
 * large Close. Nothing decorative: the plan, the people, the way out.
 *
 * It is also where a player puts GPS right: "Set my position", tap where you
 * stand, then tap what the blaster is pointing at (or skip that).
 */
export function FullMapOverlay({ map, me, myId, squad, zombies, identityOf, nameOf, onClose, onCalibrate, showHeli = true }: {
  map: MapInfo; me: MapPose; myId: string | undefined; squad: PlayerSnap[]; zombies: ZombieRow[];
  identityOf: (id: string) => Identity; nameOf: (id: string) => string; onClose: () => void;
  /** Where the player says they stand and, if they said, what they are aiming at, in map metres. */
  onCalibrate?: (at: [number, number], facing: [number, number] | null) => void;
  /** False in endless mode: no helicopter on the plan or in the key. */
  showHeli?: boolean;
}) {
  const [step, setStep] = useState<Step>('idle');
  const [at, setAt] = useState<[number, number] | null>(null);
  const [doneAt, setDoneAt] = useState(0);
  useEffect(() => {
    if (!doneAt) return;
    const id = setTimeout(() => setDoneAt(0), CALIBRATED_SHOWN_MS);
    return () => clearTimeout(id);
  }, [doneAt]);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const side = 176;                                    // the key and Close, on the right
  const pad = { l: Math.max(insets.left, space[4]), r: Math.max(insets.right, space[4]), t: Math.max(insets.top, space[3]), b: Math.max(insets.bottom, space[3]) };
  const mapW = width - pad.l - pad.r - side - space[4];
  const mapH = height - pad.t - pad.b;
  const c = 18;                                        // framing corner length
  const mate = squad.find((p) => p.id !== myId);
  const kinds = [...new Set([0, ...zombies.map((z) => z[1])])].sort();
  const fit = useMemo(() => fitFull(mapExtent(map), mapW, mapH), [map, mapW, mapH]);
  const finish = (facing: [number, number] | null) => {
    if (at) onCalibrate?.(at, facing);
    setStep('idle'); setAt(null); setDoneAt(Date.now());
  };
  const cancel = () => { setStep('idle'); setAt(null); };
  const onTap = (px: number, py: number) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    const p = fit.from(px, py);
    if (step === 'where') { setAt(p); setStep('facing'); } else if (step === 'facing') finish(p);
  };
  const pin = at ? fit.to(at[0], at[1]) : null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { paddingLeft: pad.l, paddingRight: pad.r, paddingTop: pad.t, paddingBottom: pad.b }]}>
      <View style={{ width: mapW, height: mapH }}>
        <MapView map={map} me={me} myId={myId} squad={squad} zombies={zombies} identityOf={identityOf} nameOf={nameOf}
          width={mapW} height={mapH} mode="full" showHeli={showHeli} />
        {step !== 'idle' ? (
          // A plain responder, not Pressable: its events say where on the map the finger lifted, on phones and on the web alike.
          <View style={StyleSheet.absoluteFill} testID="calibrate-tap" accessible
            accessibilityLabel={step === 'where' ? 'Tap where you are standing' : 'Tap what your blaster is pointing at'}
            onStartShouldSetResponder={() => true}
            onResponderRelease={(e) => onTap(e.nativeEvent.locationX, e.nativeEvent.locationY)} />
        ) : null}
        {pin ? (
          <Svg width={mapW} height={mapH} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Circle cx={pin[0]} cy={pin[1]} r={11} fill="none" stroke={colors.brand.amber} strokeWidth={2} />
            <Circle cx={pin[0]} cy={pin[1]} r={3} fill={colors.brand.amber} />
            <Line x1={pin[0] - 16} y1={pin[1]} x2={pin[0] + 16} y2={pin[1]} stroke={colors.brand.amber} strokeWidth={1} />
            <Line x1={pin[0]} y1={pin[1] - 16} x2={pin[0]} y2={pin[1] + 16} stroke={colors.brand.amber} strokeWidth={1} />
          </Svg>
        ) : null}
        {/* Framing corners. */}
        <Svg width={mapW} height={mapH} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={`M 1 ${c} V 1 H ${c} M ${mapW - c} 1 H ${mapW - 1} V ${c} M ${mapW - 1} ${mapH - c} V ${mapH - 1} H ${mapW - c} M ${c} ${mapH - 1} H 1 V ${mapH - c}`}
            stroke={colors.brand.amber} strokeWidth={1.5} fill="none" />
        </Svg>
      </View>
      <View style={{ width: side, justifyContent: 'space-between' }}>
        {step !== 'idle' ? (
          <View style={{ gap: space[3] }} testID="calibrate-steps">
            <T v="hudMicro" c={colors.brand.amber}>{step === 'where' ? 'Step 1 of 2' : 'Step 2 of 2'}</T>
            <T v="hudTitle">{step === 'where' ? 'Tap where you are standing' : 'Tap what your blaster points at'}</T>
            <T v="caption" c={colors.textSecondary}>
              {step === 'where' ? 'Be as exact as you can: a doorway, a corner, a pillar.'
                : 'Keep it aimed at something you can see, like a door, and tap that spot. This fixes the compass.'}
            </T>
          </View>
        ) : (
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
          {doneAt ? <T v="caption" c={colors.brand.amber} testID="calibrated">Position set.</T> : null}
        </View>
        )}
        <View style={{ gap: space[2] }}>
          {step === 'facing' ? <Button label="Skip" size="md" onPress={() => finish(null)} testID="calibrate-skip" /> : null}
          {step !== 'idle' ? <Button label="Cancel" size="md" icon="close" onPress={cancel} testID="calibrate-cancel" />
            : onCalibrate ? <Button label="Set my position" size="md" icon="location" onPress={() => setStep('where')} testID="calibrate" /> : null}
          {step === 'idle' ? <Button label="Close" icon="close" onPress={onClose} testID="fullmap-close" /> : null}
        </View>
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
