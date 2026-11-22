import React, { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Lockup } from '../brand/Brand';
import { net } from '../net/client';
import { APP_VERSION, SettingsSheet } from '../overlays/SettingsSheet';
import { useStore } from '../store';
import { colors, space } from '../theme';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { StatusChip } from '../ui/StatusChip';
import { T } from '../ui/T';
import { FieldMessage, TextField } from '../ui/TextField';

/** What the player can do about a failure, not just that it happened. */
export function explain(message: string): string {
  if (/reach the server/i.test(message)) return 'Could not reach the server. Check your connection and try again.';
  return message;
}

/**
 * The front door: the brand, a call sign, and two ways in.
 * Create is the one amber action; everything else stays quiet.
 */
export function MainMenuScreen() {
  const { name, setName, serverUrl, setPhase, error, setError, connection, session } = useStore();
  const { height } = useWindowDimensions();
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  // Reopened mid-mission? Pick the session back up, into the same mission state.
  const resuming = !!session && connection !== 'closed';
  useEffect(() => {
    if (!session || connection !== 'idle') return;
    net.connect(serverUrl, { t: 'resume', code: session.code, player_id: session.playerId, token: session.token })
      .catch(() => useStore.getState().leave());
  }, [session, serverUrl, connection]);

  const busy = creating || resuming;
  const callSign = name.trim();
  const needName = () => {
    if (callSign) return false;
    setNameError('Enter a call sign first. Your squad sees it in the lobby.');
    return true;
  };

  const create = async () => {
    if (busy || needName()) return;
    setCreating(true);
    setError(null);
    try { await net.connect(serverUrl, { t: 'create', name: callSign, settings: {} }); setPhase('lobby'); }
    catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  };

  const join = () => {
    if (busy || needName()) return;
    setError(null);
    setPhase('join');
  };

  // On a short screen the lockup gives way before the actions do.
  const compact = height < 700;

  return (
    <>
      <Screen backdrop scroll contentStyle={{ paddingTop: space[6], paddingBottom: space[4] }}>
        <View style={{ flexGrow: 1, minHeight: compact ? 190 : 280, alignItems: 'center', justifyContent: 'center' }}>
          <Lockup tagline scale={compact ? 0.78 : 1} testID="wordmark" />
        </View>

        <View style={{ gap: space[3] }}>
          <TextField label="Call sign" value={name} placeholder="Your name in the squad" maxLength={20}
            onChangeText={(t) => { setName(t); if (nameError) setNameError(null); }}
            error={nameError} autoCapitalize="words" autoCorrect={false} returnKeyType="done" editable={!busy} testID="name" />

          <View style={{ gap: space[3], marginTop: space[2] }}>
            <Button label={creating ? 'Creating mission' : 'Create mission'} variant="primary" iconRight="forward"
              loading={creating} disabled={resuming} onPress={create} testID="create" />
            <Button label="Join with code" onPress={join} disabled={busy} testID="join" />
            <Button label="Settings" onPress={() => setSettings(true)} testID="settings-open" />
          </View>

          {/* One line of status, always in the same place, there until it is resolved. */}
          <View style={{ minHeight: 44, justifyContent: 'center' }}>
            {resuming ? <StatusChip busy label={`Rejoining mission ${session?.code ?? ''}`} tone="objective" style={{ alignSelf: 'center' }} testID="resuming" />
              : creating ? <StatusChip busy label="Connecting to the server" tone="objective" style={{ alignSelf: 'center' }} />
              : error ? <FieldMessage tone="error" text={explain(error)} testID="error" />
              : null}
          </View>
        </View>

        <T v="technical" c={colors.textMuted} center style={{ marginTop: space[2] }}>v{APP_VERSION}</T>
      </Screen>
      {settings ? <SettingsSheet onClose={() => setSettings(false)} /> : null}
    </>
  );
}
