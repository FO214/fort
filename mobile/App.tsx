import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppFonts } from './src/fonts';
import { JoinMissionScreen } from './src/screens/JoinMissionScreen';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { MainMenuScreen } from './src/screens/MainMenuScreen';
import { MatchScreen } from './src/screens/MatchScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { GalleryScreen } from './src/screens/GalleryScreen';
import { useStore } from './src/store';
import { colors } from './src/theme';

function Router() {
  const phase = useStore((s) => s.phase);
  const gallery = useStore((s) => s.gallery);
  if (gallery) return <GalleryScreen onClose={() => useStore.getState().setGallery(false)} />;
  switch (phase) {
    case 'join': return <JoinMissionScreen />;
    case 'lobby': return <LobbyScreen />;
    case 'playing': return <MatchScreen />;
    case 'summary': return <ResultsScreen />;
    default: return <MainMenuScreen />;
  }
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const fontsReady = useAppFonts();
  useEffect(() => {
    useStore.getState().hydrate().finally(() => setHydrated(true));
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* Nothing is drawn in a fallback face: the first frame already has the real type. */}
        {hydrated && fontsReady ? <Router /> : <View style={{ flex: 1, backgroundColor: colors.background }} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
