/**
 * Free play: the host walks the area before the game, and the walk becomes
 * the map. Everyone else sees how much has been walked.
 *
 * While recording, the phone's own position (GPS plus steps, the same
 * tracking the game uses) is sampled a few times a second. That is all the
 * phone does; the server turns the walk into floor and routes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { tracking } from '../game/tracking';
import { MIN_WALK_M, WalkRecorder, walkLength } from '../game/walk';
import { net } from '../net/client';
import type { MapInfo } from '../net/types';
import { colors, space } from '../theme';
import { Button } from './Button';
import { T } from './T';

const SAMPLE_MS = 250;

export function WalkPanel({ isHost, map, mission }: { isHost: boolean; map: MapInfo | null; mission: boolean }) {
  const walked = map?.id === 'walked' ? walkLength(map.paths) : null;
  const [recording, setRecording] = useState(false);
  const [length, setLength] = useState(0);
  const [heli, setHeli] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const rec = useRef<WalkRecorder | null>(null);
  const origin = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const p = tracking.pose();
      if (!p.hasFix || !rec.current) return;
      rec.current.add(p.x, p.y);
      setLength((was) => (Math.abs(was - rec.current!.length) >= 1 ? rec.current!.length : was));
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [recording]);

  const begin = () => {
    const o = tracking.beginWalk();
    if (!o) { setWhy('Waiting for a GPS fix. Step outside or near a window for a moment.'); return; }
    setWhy(null);
    origin.current = o;
    rec.current = new WalkRecorder();
    setLength(0); setHeli(false); setRecording(true);
  };
  const markHeli = () => {
    const p = tracking.pose();
    rec.current?.markHelicopter(p.x, p.y);
    setHeli(true);
  };
  const finish = () => {
    const r = rec.current, o = origin.current;
    setRecording(false);
    if (!r || !o) return;
    const { paths, helicopter } = r.result();
    net.setArea(o, paths, helicopter);
  };

  if (!isHost) {
    return (
      <T v="label" c={colors.textSecondary} testID="walk-status">
        {walked != null ? `The host walked ${Math.round(walked)} m. Zombies stay where they walked.` : 'The host is walking the area.'}
      </T>
    );
  }

  if (recording) {
    return (
      <View style={{ gap: space[2] }} testID="walk-panel">
        <T v="bodyStrong" testID="walk-length">{Math.round(length)} m walked</T>
        <T v="label" c={colors.textSecondary}>
          Walk everywhere zombies may go: along corridors, through doorways, round the furniture.
          {mission ? (heli ? ' Helicopter marked.' : ' Stop where you will tape the helicopter sign and mark it.') : ''}
        </T>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          {mission ? <Button label={heli ? 'Move helicopter here' : 'Helicopter here'} icon="helicopter" size="md" onPress={markHeli} testID="walk-heli" /> : null}
          <Button label={length >= MIN_WALK_M ? 'Done' : `Walk ${Math.ceil(MIN_WALK_M - length)} m more`} variant="primary" size="md"
            disabled={length < MIN_WALK_M} onPress={finish} testID="walk-done" fill />
        </View>
        <Button label="Cancel" variant="tertiary" size="sm" onPress={() => setRecording(false)} testID="walk-cancel" />
      </View>
    );
  }

  return (
    <View style={{ gap: space[2] }} testID="walk-panel">
      <T v="label" c={colors.textSecondary}>
        {walked != null
          ? `${Math.round(walked)} m walked. Zombies appear and move only where you walked.`
          : 'Play anywhere: walk the area first. Zombies will only appear and move where you walked, so walls and furniture are left out.'}
      </T>
      {why ? <T v="label" c={colors.status.objective} testID="walk-why">{why}</T> : null}
      <Button label={walked != null ? 'Walk it again' : 'Walk the area'} icon="location" size="md" onPress={begin} testID="walk-start" />
    </View>
  );
}
