/**
 * FORTIRL — BLACKSITE design tokens.
 *
 * The one source of colour, type, spacing and motion for the whole app.
 * Components read semantic tokens from here; a raw hex value or a magic
 * number anywhere else is a bug.
 *
 * Direction: industrial typography × operational amber × geometric insignia.
 * Solid surfaces first. Dark glass only on the gameplay HUD, where the camera
 * has to stay visible, and never without an opaque fallback.
 */

/** `#RRGGBB` at an opacity, for scrims and tints derived from a token. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const palette = {
  obsidian: '#101211',
  graphite: '#202421',
  graphiteRaised: '#2B302C',
  overlay: '#171A19',
  bone: '#E9E7DE',
  silver: '#A6AAA4',
  slate: '#777F78',
  line: '#414541',
  lineStrong: '#686E67',
  amber: '#D4A34F',
  olive: '#A8B58A',
  red: '#C94D43',
  blue: '#8CABB5',
  violet: '#B9A2C8',
  ammo: '#D6D0BE',
  black: '#000000',
} as const;

export const colors = {
  background: palette.obsidian,
  surface: palette.graphite,
  surfaceElevated: palette.graphiteRaised,
  surfaceOverlay: palette.overlay,
  textPrimary: palette.bone,
  textSecondary: palette.silver,
  /** Tertiary labels only. Never critical data. */
  textMuted: palette.slate,
  border: palette.line,
  borderStrong: palette.lineStrong,

  brand: {
    amber: palette.amber,
    /** Amber under a finger. */
    amberPressed: '#B98A3C',
    /** Text and icons on an amber fill. */
    onAmber: palette.obsidian,
    olive: palette.olive,
  },

  status: {
    /** Icons, bars, edges and large text. Too dark for small text on a dark surface. */
    danger: palette.red,
    /** The same red lifted until small text in it passes 4.5:1 on the dark surfaces. */
    dangerText: '#E07A70',
    /** A fill that bone text can sit on at 4.5:1: the destructive button. */
    dangerSurface: '#AE3F38',
    dangerPressed: '#8F322C',
    onDanger: palette.bone,
    health: palette.olive,
    objective: palette.amber,
    ammo: palette.ammo,
    neutral: palette.silver,
  },

  /** Identity only. These never say anything about health or readiness. */
  players: {
    one: palette.amber,
    two: palette.blue,
    three: palette.violet,
    four: palette.olive,
  },

  /** Type cue. Damage feedback is `status.danger`, which is a different thing. */
  zombies: {
    walker: '#C4B9A4',
    runner: '#D07842',
    brute: '#887C8A',
    boss: '#A83F3B',
    /**
     * The figure itself: dark enough to read on a white wall, and dark enough
     * that even the boss's deep crimson rim stands off it at 3:1.
     */
    body: '#0E100F',
    /** Torn clothing on the near versions: one step off the body. */
    cloth: '#262A27',
    eye: '#F2A65A',
  },

  /** Backings that keep HUD text readable over whatever the camera sees. */
  camera: {
    /**
     * Behind primary (bone) text and nothing else. Over a pure white scene
     * this still leaves 6:1, so it is as light as a plate for critical text
     * can be.
     */
    backing: alpha(palette.obsidian, 0.72),
    /**
     * Behind panels that also carry secondary text, amber, olive or red.
     * Red is the hard one: it needs this much ground to hold 3:1 over white.
     */
    backingStrong: alpha(palette.obsidian, 0.9),
    /** Glass tint laid over the blur. */
    glass: alpha(palette.overlay, 0.62),
    /** Used alone when blur is unavailable. */
    glassFallback: alpha(palette.overlay, 0.92),
    scrimFrom: alpha(palette.obsidian, 0.72),
    scrimTo: alpha(palette.obsidian, 0),
    /** Dark edge around light HUD strokes (crosshair, markers). */
    edge: alpha(palette.black, 0.6),
  },

  /**
   * Stand-ins for what the camera might see: a white wall, a mid-grey room.
   * Only for checking HUD pieces against light scenes in the gallery and in
   * the contrast tests. Nothing in the game is drawn in these.
   */
  sample: { bright: '#D9D6CC', mid: '#8E8B82', dim: '#6C6A63' },

  /** Full-screen dimmers behind sheets and state overlays. */
  dim: {
    sheet: alpha(palette.obsidian, 0.82),
    /** Knocked: the scene drops back and goes cold. The red is kept to the edges. */
    knocked: alpha(palette.obsidian, 0.58),
    dead: alpha(palette.obsidian, 0.8),
  },
} as const;

export const PLAYER_COLORS = [colors.players.one, colors.players.two, colors.players.three, colors.players.four] as const;

/** Font families, by the name each file is registered under in `fonts.ts`. */
export const fonts = {
  displayBlack: 'BarlowCondensed-Black',
  display: 'BarlowCondensed-ExtraBold',
  displayBold: 'BarlowCondensed-Bold',
  displaySemibold: 'BarlowCondensed-SemiBold',
  interface: 'IBMPlexSans-Regular',
  interfaceMedium: 'IBMPlexSans-Medium',
  interfaceSemibold: 'IBMPlexSans-SemiBold',
  technical: 'IBMPlexMono-Medium',
  technicalSemibold: 'IBMPlexMono-SemiBold',
} as const;

const tabular = ['tabular-nums'] as ['tabular-nums'];
const upper = 'uppercase' as const;

/**
 * The type scale. Sizes are logical points.
 * Portrait styles are read in the hand; `hud*` styles are read at 50–60 cm
 * with the phone on a blaster, so they start where the others stop.
 */
export const type = {
  // ---- portrait
  displayXL: { fontFamily: fonts.displayBlack, fontSize: 46, lineHeight: 46, letterSpacing: 0.6, textTransform: upper },
  displayL: { fontFamily: fonts.display, fontSize: 36, lineHeight: 38, letterSpacing: 0.5, textTransform: upper },
  headingM: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 26, letterSpacing: 0.6, textTransform: upper },
  /** Section headers: "MISSION CODE", "SELECT CLASS". */
  overline: { fontFamily: fonts.displaySemibold, fontSize: 16, lineHeight: 18, letterSpacing: 1.3, textTransform: upper },
  button: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 22, letterSpacing: 1.2, textTransform: upper },
  buttonSmall: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 18, letterSpacing: 1.1, textTransform: upper },
  body: { fontFamily: fonts.interface, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.interfaceSemibold, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: fonts.interfaceMedium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: fonts.interface, fontSize: 13, lineHeight: 18 },
  technical: { fontFamily: fonts.technical, fontSize: 15, lineHeight: 19, fontVariant: tabular },
  technicalStrong: { fontFamily: fonts.technicalSemibold, fontSize: 17, lineHeight: 21, fontVariant: tabular },
  /** The four-character mission code. */
  code: { fontFamily: fonts.display, fontSize: 54, lineHeight: 54, letterSpacing: 4, fontVariant: tabular, textTransform: upper },
  /** Stat keys and values on the class cards. */
  stat: { fontFamily: fonts.interfaceMedium, fontSize: 11, lineHeight: 15, letterSpacing: 0.3, textTransform: upper },
  statValue: { fontFamily: fonts.technicalSemibold, fontSize: 12, lineHeight: 15, fontVariant: tabular },
  /** The tagline under the wordmark. */
  tagline: { fontFamily: fonts.technical, fontSize: 14, lineHeight: 18, letterSpacing: 5, textTransform: upper },

  // ---- landscape HUD
  hudHero: { fontFamily: fonts.displayBlack, fontSize: 42, lineHeight: 42, letterSpacing: 1, textTransform: upper },
  hudPrimary: { fontFamily: fonts.display, fontSize: 30, lineHeight: 30, letterSpacing: 0.6, textTransform: upper },
  hudTitle: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 24, letterSpacing: 0.8, textTransform: upper },
  hudValue: { fontFamily: fonts.technicalSemibold, fontSize: 24, lineHeight: 26, fontVariant: tabular },
  hudLabel: { fontFamily: fonts.interfaceSemibold, fontSize: 17, lineHeight: 21 },
  hudSecondary: { fontFamily: fonts.interfaceMedium, fontSize: 15, lineHeight: 19 },
  /** Non-critical labels only. Nothing on the HUD is set smaller than this. */
  hudMicro: { fontFamily: fonts.interfaceSemibold, fontSize: 12, lineHeight: 14, letterSpacing: 1, textTransform: upper },
  /** The magazine count. */
  hudAmmo: { fontFamily: fonts.displayBlack, fontSize: 54, lineHeight: 50, letterSpacing: 0.5, fontVariant: tabular },
} as const;

export type TypeVariant = keyof typeof type;

/** 4-point grid. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

/** Sharp but comfortable. Square for HUD framing, 4–8 for portrait UI. */
export const radius = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, pill: 999 } as const;

export const borders = { thin: 1, strong: 1.5 } as const;

/** Icon stroke at the standard 24-point size. */
export const stroke = { icon: 1.75, hud: 2 } as const;

export const materials = {
  /** Menus, lobby, forms, class cards, results. */
  solid: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: borders.thin },
  /** Modal, selected card, popover, critical prompt. */
  elevated: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderStrong, borderWidth: borders.thin },
  /** HUD panels over the camera. `fallback` is the surface when blur is off. */
  glass: { intensity: 28, tint: 'dark' as const, overlay: colors.camera.glass, fallback: colors.camera.glassFallback, borderColor: alpha(palette.bone, 0.16) },
} as const;

/** Only for a surface that genuinely floats above another (sheets). */
export const elevation = {
  none: {},
  sheet: { shadowColor: palette.black, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
} as const;

/** Durations in ms. Feedback is brief; nothing bounces. */
export const motion = {
  instant: 60,
  fast: 120,
  base: 200,
  slow: 320,
  /** How long a transient banner stays up. */
  banner: 2600,
  /** Standard deceleration: cubic-bezier control points. */
  easeOut: [0.2, 0, 0, 1] as const,
  easeIn: [0.4, 0, 1, 1] as const,
} as const;

export const touch = {
  /** Smallest portrait target. */
  min: 44,
  /** What portrait controls aim for. */
  comfortable: 52,
  /** Gameplay targets, used while moving. */
  hud: 56,
  /** The fallback trigger. */
  fire: 88,
  reload: 68,
} as const;

/** HUD geometry that is a decision, not an accident. Everything else flexes. */
export const hud = {
  reference: { width: 844, height: 390 },
  /** Gap between the safe area and HUD content. */
  margin: 14,
  crosshair: 108,
  minimap: 104,
  /** Below this height, secondary detail starts to go. */
  compactHeight: 360,
  /** Below this width, the minimap and wave label compact. */
  compactWidth: 700,
} as const;

export const theme = { colors, fonts, type, space, radius, borders, stroke, materials, elevation, motion, touch, hud } as const;
export type Theme = typeof theme;

// ------------------------------------------------------------------ contrast

/** WCAG relative luminance of an opaque `#RRGGBB`. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio between two opaque colours, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
