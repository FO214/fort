/**
 * What a zombie looks like: one frame of a 3D model, picked from a sprite
 * sheet. The model is a block-built, Minecraft-style zombie
 * (assets/zombies/source/); the sheets are rendered from it ahead of time by
 * scripts/make-zombie-sprites.mts, and the phone only ever draws flat images,
 * which is cheap enough for a crowd.
 *
 * Four types, told apart by outline before anything else:
 *
 *   walker  the model as made: upright, arms straight out          pale stone
 *   runner  thin and long-limbed, pitched forward at a sprint      rust
 *   brute   half as wide again, arms like beams held low           violet-grey
 *   boss    tall and lopsided, one arm huge and dragging           crimson
 *
 * Each is lit brightly enough to read in a dark corridor, catches light in
 * its type colour on its far edges, and has a thin dark edge so it reads on
 * a white wall. That is all baked into the frames. What is drawn live is the
 * rest: the shadow it stands on, the outline while the crosshair is on it,
 * the flash when a bullet lands, and its health.
 */
import React from 'react';
import { Platform, View } from 'react-native';
import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { colors } from '../theme';
import { FIGURE_ASPECT, cellPlace, zombieKind, type CellPlace } from './spriteBox';
import { ZOMBIE_SHEETS, type ZombieClip, type ZombieKind, type ZombieSheet } from './zombieSheets';
import { ZOMBIE_SOURCES } from './zombieSources';

export { ZOMBIE_KINDS, ZOMBIE_SCALE, zombieKind } from './spriteBox';
export type { ZombieClip, ZombieKind } from './zombieSheets';

export interface ZombieSpriteProps {
  /** Zombie type code from the server: 0 walker, 1 runner, 2 brute, 3 boss. */
  type: number;
  /** Which animation, and which frame of it. */
  clip: ZombieClip;
  frame: number;
  /** Which of the drawn angles it is seen from (see `facing`), and whether that is flipped. */
  row: number;
  mirror: boolean;
  /** Height in pixels of the body, head to feet. Limbs reach outside it. */
  size: number;
  /** Health left, 0–1. A bar appears once it has been hurt. */
  hp: number;
  /** True for the instant after a bullet lands. */
  hurt: boolean;
  /** True while the crosshair is on it. */
  aimed: boolean;
}

const WEB = Platform.OS === 'web';

const uris = new Map<number, string>();
/** Where the browser fetches a sheet from. */
function uriOf(source: number): string {
  let uri = uris.get(source);
  if (uri == null) { uri = Asset.fromModule(source).uri; uris.set(source, uri); }
  return uri;
}

interface CellProps {
  source: number; sheet: ZombieSheet; place: CellPlace; mirror: boolean;
  /** Paint the figure's shape in this one colour instead of the frame itself. */
  tint?: string;
  opacity?: number;
  /** Shift, in pixels. */
  dx?: number; dy?: number;
  /** Web only: an outline of this colour and thickness around the figure. */
  outline?: [string, number];
}

/**
 * On the web the outline is a filter, and a filter costs by the area it
 * covers. A zombie taller than this is close enough to fill the view: there
 * is no doubt which one the crosshair is on, so it goes without.
 */
const OUTLINE_MAX_PX = 640;

/** A plain DOM element. On the web a frame is one small box with the sheet as its background. */
const Div = 'div' as unknown as React.ComponentType<{ style: Record<string, string | number | undefined> }>;

/**
 * One frame of a sheet.
 *
 * On a phone: a window the size of the frame over the whole sheet, slid so
 * the right frame shows. Every zombie shares the one decoded sheet.
 * On the web: a box with the sheet as its background, which keeps the
 * element small (and lets a filter draw the outline).
 */
function Cell({ source, sheet, place, mirror, tint, opacity = 1, dx = 0, dy = 0, outline }: CellProps) {
  const left = place.left + dx, top = place.top + dy;
  const sheetW = sheet.w * place.scale, sheetH = sheet.h * place.scale;
  const offX = -place.col * place.width, offY = -place.line * place.height;
  if (WEB) {
    const url = `url(${uriOf(source)})`, size = `${sheetW}px ${sheetH}px`, at = `${offX}px ${offY}px`;
    const edge = outline && place.height <= OUTLINE_MAX_PX ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => `drop-shadow(${x * outline[1]}px ${y * outline[1]}px 0 ${outline[0]})`).join(' ') : undefined;
    return (
      <Div style={{
        position: 'absolute', left, top, width: place.width, height: place.height, opacity,
        transform: mirror ? 'scaleX(-1)' : undefined, filter: edge, pointerEvents: 'none',
        ...(tint
          ? {
            backgroundColor: tint,
            maskImage: url, maskSize: size, maskPosition: at, maskRepeat: 'no-repeat',
            WebkitMaskImage: url, WebkitMaskSize: size, WebkitMaskPosition: at, WebkitMaskRepeat: 'no-repeat',
          }
          : { backgroundImage: url, backgroundSize: size, backgroundPosition: at, backgroundRepeat: 'no-repeat' }),
      }} />
    );
  }
  return (
    <View pointerEvents="none"
      style={{ position: 'absolute', left, top, width: place.width, height: place.height, overflow: 'hidden', opacity, transform: [{ scaleX: mirror ? -1 : 1 }] }}>
      <Image source={source} contentFit="fill" allowDownscaling={false} cachePolicy="memory" tintColor={tint} accessible={false}
        style={{ position: 'absolute', left: offX, top: offY, width: sheetW, height: sheetH }} />
    </View>
  );
}

const CUE: Record<ZombieKind, string> = colors.zombies;

function ZombieSpriteImpl({ type, clip, frame, row, mirror, size, hp, hurt, aimed }: ZombieSpriteProps) {
  const kind = zombieKind(type);
  const sheet = ZOMBIE_SHEETS[kind][clip], source = ZOMBIE_SOURCES[kind][clip];
  const place = cellPlace(sheet, size, Math.min(frame, sheet.frames - 1), { row, mirror });
  const width = size * FIGURE_ASPECT;
  const line = Math.min(3, Math.max(1.5, size * 0.011));          // outline thickness while aimed at
  const standing = clip !== 'die';
  const shadow = size * 0.46;
  const barW = Math.max(26, size * 0.36), barH = Math.max(4, size * 0.03);
  return (
    <View style={{ width, height: size }} pointerEvents="none">
      {/* Contact shadow, so it stands on the floor instead of floating: a circle squashed flat. */}
      {standing ? (
        <View style={{
          position: 'absolute', left: width / 2 - shadow / 2, top: size - shadow / 2, width: shadow, height: shadow,
          borderRadius: shadow / 2, backgroundColor: colors.camera.edge, opacity: 0.42, transform: [{ scaleY: 0.13 }],
        }} />
      ) : null}
      {/* Under the crosshair: an outline in the type colour. The web draws it with a filter instead. */}
      {aimed && !WEB ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => (
        <Cell key={`${x}${y}`} source={source} sheet={sheet} place={place} mirror={mirror} tint={CUE[kind]} dx={x * line} dy={y * line} />
      )) : null}
      <Cell source={source} sheet={sheet} place={place} mirror={mirror} outline={aimed ? [CUE[kind], line] : undefined} />
      {/* A hit: the whole figure flashes pale for an instant. Short, and the model still shows through. */}
      {hurt ? <Cell source={source} sheet={sheet} place={place} mirror={mirror} tint={colors.textPrimary} opacity={0.72} /> : null}
      {hp < 1 && standing ? (
        <View style={{ position: 'absolute', left: width / 2 - barW / 2, top: -size * 0.1 - barH, width: barW, height: barH, backgroundColor: colors.camera.edge, padding: 1 }}>
          <View style={{ width: `${Math.max(0, Math.min(1, hp)) * 100}%`, height: '100%', backgroundColor: hp <= 0.34 ? colors.status.danger : colors.textPrimary }} />
        </View>
      ) : null}
    </View>
  );
}

/** Re-renders only when what it shows changes, not on every camera frame. */
export const ZombieSprite = React.memo(ZombieSpriteImpl);

const warm: unknown[] = [];
const warmed = new Set<number>();

/**
 * Loads a type's sheets before they are needed, so a zombie is never an
 * empty space for its first moment on screen, or when it first bites or falls.
 */
export function ZombiePreload({ kinds }: { kinds: readonly ZombieKind[] }) {
  const sources = kinds.flatMap((k) => Object.values(ZOMBIE_SOURCES[k]));
  React.useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    for (const source of sources) {
      if (warmed.has(source)) continue;
      warmed.add(source);
      const img = new window.Image();
      img.src = uriOf(source);
      img.decode?.().catch(() => { /* it will load when first drawn */ });
      warm.push(img);                              // held, so the browser keeps it decoded
    }
  });
  if (WEB) return null;
  // On a phone: a dot-sized view of each sheet is enough to bring it into the shared image cache.
  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} pointerEvents="none">
      {sources.map((source) => (
        <Image key={source} source={source} allowDownscaling={false} cachePolicy="memory" accessible={false} style={{ width: 1, height: 1 }} />
      ))}
    </View>
  );
}
