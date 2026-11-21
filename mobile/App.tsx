import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Game } from './src/screens/Game';
import { Join } from './src/screens/Join';
import { Lobby } from './src/screens/Lobby';
import { Menu } from './src/screens/Menu';
import { Summary } from './src/screens/Summary';
import { useStore } from './src/store';
import { Screen } from './src/ui/Screen';

function Router() {
  const phase = useStore((s) => s.phase);
  switch (phase) {
    case 'join': return <Join />;
    case 'lobby': return <Lobby />;
    case 'playing': return <Game />;
    case 'summary': return <Summary />;
    default: return <Menu />;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useStore.getState().hydrate().finally(() => setReady(true));
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready ? <Router /> : <Screen><></></Screen>}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
