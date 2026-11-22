import React, { useState } from 'react';
import { View } from 'react-native';
import { FormationMark } from '../brand/Brand';
import { net } from '../net/client';
import { useStore } from '../store';
import { colors, space } from '../theme';
import { Button, IconButton } from '../ui/Button';
import { CODE_LENGTH, MissionCodeInput } from '../ui/MissionCodeInput';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';
import { FieldMessage } from '../ui/TextField';
import { explain } from './MainMenuScreen';

/**
 * Four characters and a button. The code stays put when a join fails, so a
 * one-letter slip is a one-letter fix.
 */
export function JoinMissionScreen() {
  const { name, serverUrl, setPhase, error, setError } = useStore();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const complete = code.length === CODE_LENGTH;
  // "No game with that code" is about the code; anything else is about the connection.
  const badCode = !!error && /code/i.test(error);

  const back = () => { setError(null); setPhase('menu'); };
  const join = async () => {
    if (!complete || joining) return;
    setJoining(true);
    setError(null);
    try { await net.connect(serverUrl, { t: 'join', code, name: name.trim() || 'Player' }); setPhase('lobby'); }
    catch (e) { setError((e as Error).message); }
    finally { setJoining(false); }
  };

  return (
    <Screen backdrop scroll contentStyle={{ paddingTop: space[2], paddingBottom: space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -space[2] }}>
        <IconButton icon="back" label="Back" tone="tertiary" onPress={back} testID="back-top" />
      </View>

      <View style={{ alignItems: 'center', gap: space[10], paddingTop: space[6], flexGrow: 1 }}>
        <FormationMark size={56} />
        <T v="displayL" accessibilityRole="header">Enter code</T>
      </View>

      <View style={{ gap: space[4], paddingTop: space[8], flexGrow: 2 }}>
        <MissionCodeInput value={code} onChange={(c) => { setCode(c); if (error) setError(null); }} onSubmit={join}
          invalid={badCode} autoFocus testID="code" />
        <View style={{ minHeight: 44, justifyContent: 'center' }}>
          {error
            ? <FieldMessage tone="error" text={badCode ? `${error}. Check it with the host and try again.` : explain(error)} testID="error" />
            : <T v="body" c={colors.textSecondary} center>Ask the host for their mission code.</T>}
        </View>
      </View>

      <View style={{ gap: space[3] }}>
        <Button label={joining ? 'Joining' : 'Join'} variant="primary" loading={joining} disabled={!complete} onPress={join} testID="join-go"
          accessibilityHint={complete ? undefined : 'Enter all four characters first'} />
        <Button label="Back" onPress={back} disabled={joining} testID="back" />
      </View>
    </Screen>
  );
}
