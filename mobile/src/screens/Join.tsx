import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { net } from '../net/client';
import { useStore } from '../store';
import { color, radius, space } from '../theme';
import { Field } from '../ui/Field';
import { Glass } from '../ui/Glass';
import { GlassButton } from '../ui/GlassButton';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

export function Join() {
  const { name, serverUrl, setPhase, error, setError } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  const join = async () => {
    if (clean.length !== 4) { setError('Codes are four letters'); return; }
    setBusy(true);
    try { await net.connect(serverUrl, { t: 'join', code: clean, name: name.trim() || 'Player' }); setPhase('lobby'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.xl }}>
          <View style={{ gap: space.xs }}>
            <T v="label" c={color.ink3}>Join a game</T>
            <T v="title">Enter the code</T>
            <T v="body" c={color.ink2}>It's on the host's lobby screen.</T>
          </View>
          <Glass radius={radius.xl} padding={space.lg} contentStyle={{ gap: space.md }}>
            <Field value={clean} onChangeText={setCode} placeholder="ABCD" autoCapitalize="characters" autoCorrect={false}
              maxLength={4} big mono center autoFocus testID="code" onSubmitEditing={join} />
            <GlassButton label={busy ? 'Joining…' : 'Join'} variant="primary" size="lg" onPress={join} disabled={busy || clean.length !== 4} testID="join-go" />
            {error ? <T v="caption" c={color.danger} testID="error">{error}</T> : null}
          </Glass>
          <GlassButton label="Back" variant="ghost" onPress={() => { setError(null); setPhase('menu'); }} testID="back" />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
