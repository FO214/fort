/**
 * The three type families, loaded from bundled files.
 *
 * Each file is registered under the key on the left, and that key is the
 * `fontFamily` components use (see `fonts` in theme.ts). The key is what
 * matters on every platform: expo-font registers the face under it, so the
 * file's own PostScript name never has to match.
 *
 *   Barlow Condensed   display: titles, banners, buttons, outcomes
 *   IBM Plex Sans      interface: labels, body, instructions
 *   IBM Plex Mono      technical: codes, ammo, distance, timers
 */
import { useFonts } from 'expo-font';

export const FONT_FILES = {
  'BarlowCondensed-SemiBold': require('@expo-google-fonts/barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf'),
  'BarlowCondensed-Bold': require('@expo-google-fonts/barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf'),
  'BarlowCondensed-ExtraBold': require('@expo-google-fonts/barlow-condensed/800ExtraBold/BarlowCondensed_800ExtraBold.ttf'),
  'BarlowCondensed-Black': require('@expo-google-fonts/barlow-condensed/900Black/BarlowCondensed_900Black.ttf'),
  'IBMPlexSans-Regular': require('@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf'),
  'IBMPlexSans-Medium': require('@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf'),
  'IBMPlexSans-SemiBold': require('@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf'),
  'IBMPlexMono-Medium': require('@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf'),
  'IBMPlexMono-SemiBold': require('@expo-google-fonts/ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf'),
} as const;

/** True once every face is ready (or loading failed and we fall back rather than hang). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_FILES);
  return loaded || !!error;
}
