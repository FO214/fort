/**
 * Design tokens. Dark glass over a live camera feed: every surface is a
 * tint of white at low alpha so the world (or the colour blobs on menu
 * screens) reads through it.
 */
import { Platform } from 'react-native';

export const color = {
  bg: '#06080D',
  blobTeal: '#0E5F63',
  blobViolet: '#3A1F6E',
  blobBlue: '#0F2D6B',

  ink: '#F5F7FA',
  ink2: 'rgba(245,247,250,0.66)',
  ink3: 'rgba(245,247,250,0.42)',
  ink4: 'rgba(245,247,250,0.22)',

  glass: 'rgba(255,255,255,0.07)',
  glassStrong: 'rgba(255,255,255,0.12)',
  glassBorder: 'rgba(255,255,255,0.16)',
  glassHighlight: 'rgba(255,255,255,0.42)',
  scrim: 'rgba(6,8,13,0.55)',

  accent: '#7DF3D3',          // lock, ready, interactive
  accentDim: 'rgba(125,243,211,0.22)',
  danger: '#FF453A',
  dangerDim: 'rgba(255,69,58,0.22)',
  warning: '#FFD60A',
  onAccent: '#06110E',
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 } as const;

export const font = {
  family: Platform.select({ ios: 'System', android: 'sans-serif', default: '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: '"SF Mono", ui-monospace, Menlo, monospace' }) as string,
};

export const type = {
  display: { fontSize: 44, lineHeight: 48, fontWeight: '700' as const, letterSpacing: -1.2 },
  title: { fontSize: 26, lineHeight: 30, fontWeight: '600' as const, letterSpacing: -0.5 },
  headline: { fontSize: 18, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 21, fontWeight: '400' as const },
  caption: { fontSize: 13, lineHeight: 16, fontWeight: '400' as const },
  label: { fontSize: 11, lineHeight: 13, fontWeight: '600' as const, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  mono: { fontSize: 15, lineHeight: 18, fontWeight: '500' as const, fontVariant: ['tabular-nums'] as const },
  monoBig: { fontSize: 30, lineHeight: 34, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const, letterSpacing: -0.5 },
};
