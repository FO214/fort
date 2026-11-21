import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { net } from '../net/client';
import { useStore } from '../store';
import { color, radius, space } from '../theme';
import { Field } from '../ui/Field';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

export function Menu() {
  const { name, setName, serverUrl, setServerUrl, setPhase, error, setError, connection, session } = useStore();
  const [editServer, setEditServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyNow = busy || connection === 'connecting';

  // Reload mid-match? Pick the session back up.
  useEffect(() => {
    if (!session || connection !== 'idle') return;
    net.connect(serverUrl, { t: 'resume', code: session.code, player_id: session.playerId, token: session.token })
      .catch(() => useStore.getState().leave());
  }, [session, serverUrl, connection]);

  const create = async () => {
    if (!name.trim()) { setError('Pick a call sign first'); return; }
    setBusy(true);
    try { await net.connect(serverUrl, { t: 'create', name: name.trim(), settings: {} }); setPhase('lobby'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: space.xl, justifyContent: 'space-between', paddingBottom: space.xl }}>
          <View style={{ paddingTop: space.xxxl, gap: space.sm }}>
            <T v="label" c={color.accent}>Real-world laser tag</T>
            <T v="display" testID="wordmark">LOONIE</T>
            <T v="body" c={color.ink2} style={{ maxWidth: 300 }}>
              Point your phone, pull the trigger. Their phone takes the hit.
            </T>
          </View>

          <Glass radius={radius.xl} padding={space.lg} contentStyle={{ gap: space.md }}>
            <T v="label" c={color.ink3}>Call sign</T>
            <Field value={name} onChangeText={setName} placeholder="e.g. Ada" autoCapitalize="words" maxLength={20}
              testID="name" returnKeyType="done" />
            <View style={{ gap: space.sm, marginTop: space.xs }}>
              <GlassButton label={busyNow ? 'Connecting…' : 'Create a game'} variant="primary" size="lg" onPress={create}
                disabled={busyNow} testID="create" />
              <GlassButton label="Join with a code" size="lg" onPress={() => { setError(null); setPhase('join'); }} testID="join" />
            </View>
            {error ? <T v="caption" c={color.danger} testID="error">{error}</T> : null}
          </Glass>

          <Pressable onPress={() => setEditServer((v) => !v)} testID="server-toggle">
            <Glass radius={radius.md} contentStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="label" c={color.ink3}>Server</T>
                <T v="label" c={color.ink3}>{editServer ? 'done' : 'edit'}</T>
              </View>
              {editServer ? (
                <Field value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} mono testID="server"
                  style={{ fontSize: 13, height: 40 }} />
              ) : (
                <T v="mono" c={color.ink2} numberOfLines={1} style={{ fontSize: 13 }}>{serverUrl}</T>
              )}
            </Glass>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
