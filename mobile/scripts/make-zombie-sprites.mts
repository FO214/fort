/**
 * Render the 3D zombie into the sprite sheets the game draws.
 *
 *   npm run zombie-sprites                    (or: node scripts/make-zombie-sprites.mts [folder])
 *   npm run zombie-sprites -- --proof out.png --only walker
 *
 * The game draws zombies as billboards over the camera, so the model is not
 * drawn live. It is rendered here, once, into frames: every animation of
 * every zombie type, seen from five angles (front, front quarter, side, back
 * quarter, back; the app mirrors them for the other side, which makes eight).
 * The frames of one animation are packed into one sheet.
 *
 * THE MODEL
 * A block-built Minecraft-style zombie, exported from Blockbench as glTF:
 * `assets/zombies/source/model.gltf` (its 64x32 skin is embedded in the file).
 * It is six boxes on pivots: head, body, two arms, two legs. Pass another
 * folder to render a different model with the same part names.
 *
 * THE ANIMATIONS
 * The file has no walk in it, only a pose, so the movement is made here: the
 * `pose` function below swings the legs, holds the arms out, claws for the
 * attack and tips the whole figure over for the death, the way the game it
 * comes from does.
 *
 * THE FOUR TYPES
 * One model, four zombies that can be told apart by outline: each type is the
 * same six boxes resized (a brute's wide body and thick arms, a boss's one
 * great arm), posed and paced its own way, and lit from behind in its type
 * colour. See KINDS.
 *
 * Output:
 *   assets/zombies/<type>-<move|attack|die>.webp
 *   src/ui/zombieSheets.ts           (generated: where each frame is)
 *   src/ui/zombieSources.ts          (generated: the images)
 *
 * It runs three.js in a headless browser. `--proof <file.png>` also writes a
 * page of sample frames over dark, mid and bright backgrounds to look at;
 * `--only <type>` renders one type (the generated modules are then left alone).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { colors } from '../src/theme.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const threeDir = join(mobile, 'node_modules', 'three');
const outDir = join(mobile, 'assets', 'zombies');

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const proofAt = flag('--proof');
const only = flag('--only');
const modelDir = args.find((a, i) => !a.startsWith('--') && !['--proof', '--only'].includes(args[i - 1])) ?? join(outDir, 'source');
if (!existsSync(modelDir)) {
  console.error(`No such folder: ${modelDir}\nUsage: node scripts/make-zombie-sprites.mts [folder with the .gltf] [--proof out.png] [--only walker]`);
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const modelFile = walk(modelDir).find((f) => /\.(gltf|glb)$/i.test(f));
if (!modelFile) { console.error(`No .gltf or .glb under ${modelDir}`); process.exit(1); }

// ---- what to render --------------------------------------------------------

/** Degrees the zombie is turned away from facing the viewer. The other three come from mirroring. */
const ANGLES = [0, 45, 90, 135, 180];
/** How tall every type stands in its frames. The game scales the bigger types up from there. */
const HEIGHT_M = 1.8;
/** No sheet is larger than this on a side: every phone can hold it as one texture. */
const MAX_SHEET = 2048;
/** Frames are drawn at up to this many pixels per metre, less if the sheet would not fit. */
const MAX_PPM = 160;

const CLIP_KEYS = ['move', 'attack', 'die'] as const;
type ClipKey = (typeof CLIP_KEYS)[number];
interface Clip { frames: number; loop: boolean; /** How long one pass takes in the game. */ seconds: number }

interface Kind {
  key: 'walker' | 'runner' | 'brute' | 'boss';
  // ---- build: the boxes resized. 1 is as modelled.
  /** Body: width, depth. */
  torso: [number, number];
  head: number;
  /** Each arm: thickness, length. Right, then left. */
  arms: [[number, number], [number, number]];
  /** Legs: thickness, length. */
  legs: [number, number];
  /** A wash over the skin, to set the type apart a little more. */
  tint: string;
  // ---- how it carries itself, in radians
  /** How far the body pitches forward from the hips. */
  lean: number;
  /** How far each leg swings either way in a stride. */
  stride: number;
  /** How high each arm is held: 0 hangs, half pi points straight ahead. Right, then left. */
  raise: [number, number];
  /** How far the shoulders rock side to side as it walks. */
  sway: number;
  clips: Record<ClipKey, Clip>;
}

const clips = (move: number, attack: number): Record<ClipKey, Clip> => ({
  move: { frames: 12, loop: true, seconds: move },
  attack: { frames: 8, loop: true, seconds: attack },
  die: { frames: 8, loop: false, seconds: 0.75 },
});

const KINDS: Kind[] = [
  // As modelled: upright, arms straight out, an even plod.
  { key: 'walker', torso: [1, 1], head: 1, arms: [[1, 1], [1, 1]], legs: [1, 1], tint: '#ffffff',
    lean: 0.04, stride: 0.62, raise: [1.5, 1.5], sway: 0.03, clips: clips(0.9, 1.0) },
  // Thin and long in the limb, pitched right forward, arms trailing: a sprint.
  { key: 'runner', torso: [0.86, 0.9], head: 0.94, arms: [[0.8, 1.14], [0.8, 1.14]], legs: [0.84, 1.14], tint: '#fff6ea',
    lean: 0.5, stride: 1.0, raise: [1.05, 1.05], sway: 0.05, clips: clips(0.5, 0.8) },
  // Half as wide again, arms like beams held low, short thick legs, a small head.
  { key: 'brute', torso: [1.5, 1.5], head: 0.82, arms: [[1.6, 1.1], [1.6, 1.1]], legs: [1.45, 0.86], tint: '#f1ecf6',
    lean: 0.14, stride: 0.4, raise: [0.55, 0.55], sway: 0.09, clips: clips(1.4, 1.2) },
  // Tall and lopsided: one arm huge and dragging, the other small and held out.
  { key: 'boss', torso: [1.22, 1.2], head: 1.08, arms: [[2.1, 1.5], [0.78, 0.9]], legs: [1.12, 1.16], tint: '#ffe2da',
    lean: 0.1, stride: 0.5, raise: [0.3, 1.5], sway: 0.07, clips: clips(1.25, 1.1) },
];

const kinds = KINDS.filter((k) => !only || k.key === only);
if (kinds.length === 0) { console.error(`No such type: ${only}`); process.exit(1); }

const job = {
  model: '/model/' + relative(modelDir, modelFile).split(sep).join('/'),
  kinds: kinds.map((k) => ({ ...k, rim: colors.zombies[k.key], clips: CLIP_KEYS.map((c) => ({ key: c, ...k.clips[c] })) })),
  angles: ANGLES, height: HEIGHT_M, maxSheet: MAX_SHEET, maxPpm: MAX_PPM,
  outline: colors.zombies.body,
  backdrops: [colors.background, colors.sample.mid, '#ffffff'],
};

// ---- the page that does the rendering --------------------------------------

const PAGE = `<!doctype html><html><body style="margin:0;background:#555">
<script type="importmap">{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const JOB = ${JSON.stringify(job)};
const SS = 2;                 // render at twice the size, then scale down: smooth edges
const MARGIN_M = 0.05;        // clear space around the figure in its frame
const TAU = Math.PI * 2;
const rad = (d) => (d * Math.PI) / 180;
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;           // the skin's own colours, not a film look

const scene = new THREE.Scene();
// Flat, bright light with a little shape to it: the top of each box brightest,
// the side away from the light a step darker. Two lights behind pick out the
// far edges in the type's colour.
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 2.8));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-1.4, 2.6, 4); scene.add(key);
const rims = [-2.8, 2.8].map((x) => { const l = new THREE.DirectionalLight(0xffffff, 1.5); l.position.set(x, 2.2, -3); scene.add(l); return l; });
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);

// scene > turntable (the viewing angle) > stand (size, floor) > tipper > untip > facing > the model
const turntable = new THREE.Group(), stand = new THREE.Group(), tipper = new THREE.Group(), untip = new THREE.Group(), facing = new THREE.Group();
scene.add(turntable); turntable.add(stand); stand.add(tipper); tipper.add(untip); untip.add(facing);
facing.rotation.y = Math.PI;             // the file faces away from +Z; the camera looks from +Z

let model, meshes = [], materials = [];
const P = {}, rest = new Map();
window.sheets = {};
window.cells = {};

/** The pivot a part turns on: the group of that name, not the box inside it of the same name. */
function pivot(name) {
  let hit = null;
  model.traverse((o) => { if (!hit && !o.isMesh && o.children.length && o.name.replace(/_[0-9]+$/, '') === name) hit = o; });
  if (!hit) throw new Error('The model has no part called ' + name);
  return hit;
}
function box(name) {
  let hit = null;
  model.traverse((o) => { if (!hit && o.isMesh && o.name.replace(/_[0-9]+$/, '') === name) hit = o; });
  if (!hit) throw new Error('The model has no box called ' + name);
  return hit;
}

async function setUp() {
  model = (await new GLTFLoader().loadAsync(JOB.model)).scene;
  facing.add(model);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; meshes.push(o);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!materials.includes(m)) materials.push(m);
  });
  for (const name of ['waist', 'head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) P[name] = pivot(name);
  P.torso = box('body');
  for (const o of Object.values(P)) rest.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
}

/**
 * Put the figure in one moment of one animation. \`u\` runs 0 to 1 through it.
 * The model faces -Z, so a limb that hangs down swings forward on a positive
 * turn about X, and the body pitches forward on a negative one.
 */
function pose(k, clip, u) {
  for (const [o, r] of rest) { o.position.copy(r.p); o.quaternion.copy(r.q); o.scale.copy(r.s); }
  // ---- the build
  P.torso.scale.set(k.torso[0], 1, k.torso[1]);
  P.head.scale.setScalar(k.head);
  const out = 0.25 * (k.torso[0] - 1);                              // shoulders move out with a wider body
  const armR = k.arms[0], armL = k.arms[1];
  P.rightArm.scale.set(armR[0], armR[1], armR[0]); P.rightArm.position.x += out + 0.125 * (armR[0] - 1);
  P.leftArm.scale.set(armL[0], armL[1], armL[0]); P.leftArm.position.x -= out + 0.125 * (armL[0] - 1);
  for (const leg of [P.rightLeg, P.leftLeg]) leg.scale.set(k.legs[0], k.legs[1], k.legs[0]);
  const apart = 0.12 * (k.legs[0] - 1);
  P.rightLeg.position.x += apart; P.leftLeg.position.x -= apart;

  // ---- the moment
  const swing = Math.sin(u * TAU);
  let lean = k.lean, legR = 0, legL = 0, upR = k.raise[0], upL = k.raise[1], roll = 0, nod = 0, fall = 0;
  if (clip === 'move') {
    legR = swing * k.stride; legL = -swing * k.stride;
    // Held-out arms bob a little; hanging ones swing against the legs.
    upR += k.raise[0] > 1 ? Math.sin(u * TAU * 2) * 0.05 : -swing * k.stride * 0.5;
    upL += k.raise[1] > 1 ? -Math.sin(u * TAU * 2) * 0.05 : swing * k.stride * 0.5;
    roll = swing * k.sway;
    nod = Math.sin(u * TAU * 2) * 0.03;
  } else if (clip === 'attack') {
    // Feet planted, body thrown forward, the arms clawing down in turn.
    lean += 0.16; legR = 0.2; legL = -0.2;
    upR = Math.max(k.raise[0], 1.0) + 0.45 + 0.6 * Math.cos(u * TAU);
    upL = Math.max(k.raise[1], 1.0) + 0.45 - 0.6 * Math.cos(u * TAU);
    roll = Math.sin(u * TAU) * 0.06;
    nod = -0.12;
  } else {
    // Shot: the arms drop and it goes over sideways like a felled post.
    const e = u * u * (3 - 2 * u);
    fall = Math.pow(u, 1.7) * Math.PI / 2;
    upR *= 1 - e; upL *= 1 - e;
    lean *= 1 - e;
    legR = 0.25 * e; legL = -0.1 * e;
  }
  P.waist.rotation.set(-lean, 0, roll);
  P.rightLeg.rotation.x = legR + lean; P.leftLeg.rotation.x = legL + lean;
  P.rightArm.rotation.order = 'YXZ'; P.leftArm.rotation.order = 'YXZ';
  P.rightArm.rotation.set(upR, -0.1, 0); P.leftArm.rotation.set(upL, 0.1, 0);
  P.head.rotation.x = lean * 0.7 + nod;                             // the head stays up when the body pitches
  // It tips about the outside edge of the arm on the side it falls to, so it lands on the floor, not through it.
  const edge = 0.9 * (0.5 + 0.25 * (k.torso[0] - 1) + 0.25 * (k.arms[1][0] - 1));
  tipper.position.x = edge; untip.position.x = -edge;
  tipper.rotation.z = -fall;
}

/** Every vertex where the pose has put it, in world space. */
const point = new THREE.Vector3();
function eachVertex(visit) {
  scene.updateMatrixWorld(true);
  for (const m of meshes) {
    const at = m.geometry.attributes.position;
    for (let i = 0; i < at.count; i++) { point.fromBufferAttribute(at, i).applyMatrix4(m.matrixWorld); visit(point.x, point.y, point.z); }
  }
}
const phase = (clip, f) => (clip.loop ? f / clip.frames : f / (clip.frames - 1));

window.renderKind = async (kindKey) => {
  if (!model) await setUp();
  const kind = JOB.kinds.find((k) => k.key === kindKey);
  for (const l of rims) l.color.set(kind.rim);
  for (const m of materials) m.color.set(kind.tint);

  // Stand it HEIGHT metres tall, as it is when it stands straight.
  turntable.rotation.y = 0; stand.scale.setScalar(1); stand.position.set(0, 0, 0);
  pose({ ...kind, lean: 0, raise: [0, 0] }, 'move', 0);
  let lo = Infinity, hi = -Infinity;
  eachVertex((x, y) => { if (y < lo) lo = y; if (y > hi) hi = y; });
  stand.scale.setScalar(JOB.height / (hi - lo));

  const report = {};
  for (const clip of kind.clips) {
    // ---- measure: where the figure reaches over the whole clip, from each angle
    stand.position.set(0, 0, 0); turntable.rotation.y = 0;
    const sin = JOB.angles.map((a) => Math.sin(rad(a))), cos = JOB.angles.map((a) => Math.cos(rad(a)));
    const left = JOB.angles.map(() => Infinity), right = JOB.angles.map(() => -Infinity);
    let floor = Infinity, ceiling = -Infinity;
    for (let f = 0; f < clip.frames; f++) {
      pose(kind, clip.key, phase(clip, f));
      eachVertex((x, y, z) => {
        if (y < floor) floor = y; if (y > ceiling) ceiling = y;
        for (let a = 0; a < sin.length; a++) { const sx = x * cos[a] + z * sin[a]; if (sx < left[a]) left[a] = sx; if (sx > right[a]) right[a] = sx; }
      });
    }
    // A figure reaches further one way than the other (arms ahead, a body fallen to one side),
    // so the frame is centred off its feet: by whatever makes the frame narrowest.
    let forward = 0, side = 0, half = Infinity;
    for (let s = -1.2; s <= 1.2; s += 0.02) for (let f = -1.2; f <= 1.2; f += 0.02) {
      let need = 0;
      for (let a = 0; a < sin.length; a++) { const c = s * cos[a] + f * sin[a]; need = Math.max(need, right[a] - c, c - left[a]); }
      if (need < half - 1e-9) { half = need; forward = f; side = s; }
    }
    forward = Math.round(forward * 100) / 100; side = Math.round(side * 100) / 100;
    half += 0.02;                                                    // the rounding above
    const widthM = 2 * (half + MARGIN_M), topM = ceiling - floor + MARGIN_M, bottomM = -MARGIN_M;

    // ---- fit: the most pixels per metre that still packs into one sheet
    const count = clip.frames * JOB.angles.length;
    let ppm = JOB.maxPpm, cw, ch, cols, rows;
    for (;; ppm -= 2) {
      cw = Math.ceil(widthM * ppm); ch = Math.ceil((topM - bottomM) * ppm);
      cols = Math.min(count, Math.floor(JOB.maxSheet / cw)); rows = Math.ceil(count / cols);
      if (rows * ch <= JOB.maxSheet) break;
    }
    // Even out the grid: no wider than it needs to be for that many rows.
    cols = Math.ceil(count / rows);

    // ---- draw
    stand.position.y = -floor;
    renderer.setSize(cw * SS, ch * SS, false);
    camera.left = -cw / ppm / 2; camera.right = cw / ppm / 2; camera.top = bottomM + ch / ppm; camera.bottom = bottomM;
    camera.updateProjectionMatrix();
    const sheet = canvas(cols * cw, rows * ch), pen = sheet.getContext('2d');
    const cell = canvas(cw, ch), cellPen = cell.getContext('2d');
    const edge = canvas(cw, ch), edgePen = edge.getContext('2d');
    cellPen.imageSmoothingQuality = 'high';
    for (let f = 0; f < clip.frames; f++) {
      pose(kind, clip.key, phase(clip, f));
      for (let a = 0; a < JOB.angles.length; a++) {
        turntable.rotation.y = rad(JOB.angles[a]);
        camera.position.set(side * cos[a] + forward * sin[a], 0, 10);
        scene.updateMatrixWorld(true);
        renderer.render(scene, camera);
        cellPen.clearRect(0, 0, cw, ch); cellPen.drawImage(renderer.domElement, 0, 0, cw, ch);
        // A dark edge all the way round, so a pale limb never sits straight on a bright wall.
        edgePen.globalCompositeOperation = 'source-over'; edgePen.clearRect(0, 0, cw, ch);
        for (const [ox, oy] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5], [-1, -1], [1, -1], [-1, 1], [1, 1]]) edgePen.drawImage(cell, ox, oy);
        edgePen.globalCompositeOperation = 'source-in'; edgePen.fillStyle = JOB.outline; edgePen.fillRect(0, 0, cw, ch);
        const i = a * clip.frames + f, x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
        pen.globalAlpha = 0.75; pen.drawImage(edge, x, y); pen.globalAlpha = 1; pen.drawImage(cell, x, y);
      }
    }

    // How bright the figure is, as relative luminance: it has to stand off both black and white.
    const px = pen.getImageData(0, 0, sheet.width, sheet.height).data;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) if (px[i + 3] > 250) { sum += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]); n++; }

    const name = kind.key + '-' + clip.key;
    window.sheets[name] = sheet;
    window.cells[name] = { cw, ch, cols, frames: clip.frames };
    report[clip.key] = {
      w: sheet.width, h: sheet.height, cw, ch, cols, frames: clip.frames, ppm, forward, side,
      floorY: Math.round((bottomM + ch / ppm) * ppm * 100) / 100,          // sheet pixels from the top of a frame down to the floor
      luminance: +(sum / n).toFixed(3),
    };
  }
  return report;
};

/** One sheet as WebP (lossy, with transparency), base64. */
window.encode = (name, quality) => new Promise((res) => window.sheets[name].toBlob(async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  res(btoa(s));
}, 'image/webp', quality));

/**
 * A page to look at: for each type, a few frames of each animation, over the
 * darkest, a middling and the brightest background the camera might show.
 */
window.proof = () => {
  const picks = [['move', 0, 0], ['move', 3, 1], ['move', 6, 2], ['move', 2, 3], ['move', 5, 4], ['attack', 0, 0], ['attack', 4, 2], ['die', 3, 0], ['die', 5, 2], ['die', 7, 0]];
  const kinds = JOB.kinds.map((k) => k.key);
  const rowH = Math.max(...Object.values(window.cells).map((c) => c.ch)) + 16;
  const widths = picks.map(([clip]) => Math.max(...kinds.map((k) => window.cells[k + '-' + clip].cw)) + 12);
  const total = widths.reduce((a, b) => a + b, 0);
  const c = canvas(total, rowH * kinds.length * JOB.backdrops.length), pen = c.getContext('2d');
  let y = 0;
  for (const k of kinds) for (const back of JOB.backdrops) {
    pen.fillStyle = back; pen.fillRect(0, y, total, rowH);
    let x = 0;
    picks.forEach(([clip, f, a], n) => {
      const g = window.cells[k + '-' + clip], i = a * g.frames + Math.min(f, g.frames - 1);
      pen.drawImage(window.sheets[k + '-' + clip], (i % g.cols) * g.cw, Math.floor(i / g.cols) * g.ch, g.cw, g.ch, x + (widths[n] - g.cw) / 2, y + rowH - 8 - g.ch, g.cw, g.ch);
      x += widths[n];
    });
    y += rowH;
  }
  return c.toDataURL('image/png').split(',')[1];
};
window.ready = true;
</script></body></html>`;

// ---- serve three.js and the model to that page, and drive it ---------------

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.png': 'image/png', '.html': 'text/html', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
  const base = url.startsWith('/three/') ? threeDir : url.startsWith('/model/') ? modelDir : null;
  const file = base ? normalize(join(base, url.replace(/^\/(three|model)\//, ''))) : '';
  if (!base || !file.startsWith(normalize(base)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const port = (server.address() as { port: number }).port;

interface SheetReport { w: number; h: number; cw: number; ch: number; cols: number; frames: number; ppm: number; forward: number; side: number; floorY: number; luminance: number }
interface RenderPage {
  ready?: boolean;
  renderKind: (kind: string) => Promise<Record<string, SheetReport>>;
  encode: (name: string, quality: number) => Promise<string>;
  proof: () => string;
}

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
const preinstalled = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? preinstalled,
  // Software WebGL is fine for this, and works on a machine with no GPU.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[render page]', e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => (window as unknown as RenderPage).ready === true);

mkdirSync(outDir, { recursive: true });
const sheets: Record<string, Record<string, SheetReport>> = {};
let bytesTotal = 0;
for (const kind of kinds) {
  const report = await page.evaluate((k) => (window as unknown as RenderPage).renderKind(k), kind.key);
  sheets[kind.key] = report;
  for (const clip of CLIP_KEYS) {
    const name = `${kind.key}-${clip}`;
    const b64 = await page.evaluate(([n, q]) => (window as unknown as RenderPage).encode(n as string, q as number), [name, 0.9] as const);
    const bytes = Buffer.from(b64, 'base64');
    bytesTotal += bytes.length;
    writeFileSync(join(outDir, `${name}.webp`), bytes);
    const r = report[clip];
    console.log(`  ${name.padEnd(14)} ${String(r.w).padStart(4)}x${String(r.h).padEnd(4)}  frame ${r.cw}x${r.ch}  ${r.ppm} px/m  centred ${r.side} across, ${r.forward} ahead  luminance ${r.luminance}  ${(bytes.length / 1024).toFixed(0)} KB`);
  }
}
console.log(`  ${(bytesTotal / 1024 / 1024).toFixed(2)} MB in all`);
if (proofAt) {
  writeFileSync(proofAt, Buffer.from(await page.evaluate(() => (window as unknown as RenderPage).proof()), 'base64'));
  console.log('  proof:', proofAt);
}
await browser.close();
server.close();

// ---- tell the app where each frame is --------------------------------------

if (only) { console.log('  (one type only: the generated modules are left as they were)'); process.exit(0); }

const ABOUT = `The zombies' sprite sheets, rendered from the block-built zombie model in
 * assets/zombies/source/ (see assets/zombies/CREDITS.md).`;
const kindType = KINDS.map((k) => `'${k.key}'`).join(' | ');

const entry = (kind: Kind, clip: ClipKey) => {
  const r = sheets[kind.key][clip], c = kind.clips[clip];
  return `{ w: ${r.w}, h: ${r.h}, cw: ${r.cw}, ch: ${r.ch}, cols: ${r.cols}, frames: ${r.frames}, ppm: ${r.ppm}, floorY: ${r.floorY}, forward: ${r.forward}, side: ${r.side}, seconds: ${c.seconds}, loop: ${c.loop}, luminance: ${r.luminance} }`;
};
writeFileSync(join(mobile, 'src', 'ui', 'zombieSheets.ts'), `/**
 * GENERATED by scripts/make-zombie-sprites.mts. Do not edit by hand.
 *
 * ${ABOUT}
 *
 * One sheet per type per animation. A sheet is a grid of equal frames, read
 * left to right, top to bottom: all the frames of the animation seen from the
 * first angle, then all of them from the next. The angles are how far the
 * zombie is turned away from facing the viewer; the other side is the same
 * frame mirrored.
 *
 * Numbers only, so the placement maths can be tested without loading an image.
 * The images themselves are in zombieSources.ts.
 */

export interface ZombieSheet {
  /** The whole sheet, in pixels. */
  w: number; h: number;
  /** One frame, in pixels, and how many sit in a row. */
  cw: number; ch: number; cols: number;
  /** Frames in the animation. */
  frames: number;
  /** Sheet pixels per metre of zombie. */
  ppm: number;
  /** Sheet pixels from the top of a frame down to the floor the zombie stands on. */
  floorY: number;
  /**
   * Where a frame is centred, in metres from the point between the zombie's
   * feet: \`forward\` ahead of it (negative: behind), \`side\` towards the
   * viewer's right when it faces them.
   */
  forward: number; side: number;
  /** Seconds one pass of the animation takes in the game. */
  seconds: number;
  loop: boolean;
  /** Mean relative luminance of the figure, 0 (black) to 1 (white). */
  luminance: number;
}

/** How tall a zombie stands in its frames, in metres. */
export const ZOMBIE_SHEET_HEIGHT_M = ${HEIGHT_M};
/** Degrees turned away from facing the viewer, one per block of frames in a sheet. */
export const ZOMBIE_ANGLES = [${ANGLES.join(', ')}] as const;

export type ZombieKind = ${kindType};
export type ZombieClip = ${CLIP_KEYS.map((c) => `'${c}'`).join(' | ')};

export const ZOMBIE_SHEETS: Record<ZombieKind, Record<ZombieClip, ZombieSheet>> = {
${KINDS.map((k) => `  ${k.key}: {\n${CLIP_KEYS.map((c) => `    ${c}: ${entry(k, c)},`).join('\n')}\n  },`).join('\n')}
};
`);
writeFileSync(join(mobile, 'src', 'ui', 'zombieSources.ts'), `/**
 * GENERATED by scripts/make-zombie-sprites.mts. Do not edit by hand.
 *
 * ${ABOUT}
 *
 * The images. Their geometry is in zombieSheets.ts.
 */
import type { ZombieClip, ZombieKind } from './zombieSheets';

export const ZOMBIE_SOURCES: Record<ZombieKind, Record<ZombieClip, number>> = {
${KINDS.map((k) => `  ${k.key}: {\n${CLIP_KEYS.map((c) => `    ${c}: require('../../assets/zombies/${k.key}-${c}.webp'),`).join('\n')}\n  },`).join('\n')}
};
`);
console.log('  src/ui/zombieSheets.ts, src/ui/zombieSources.ts');
