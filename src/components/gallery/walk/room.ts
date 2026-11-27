/**
 * The walk-through: a lit gallery shaped as a ring-shaped corridor that never ends. Framed, matted prints
 * hang on both walls, all the way round. The inner wall's prints hang on short stretches of wall angled
 * towards the visitor, so they face them as they walk up. The light is
 * painted into the textures rather than computed, so every surface is an unlit material and the prints keep
 * their exact colours. Browser only; the island loads it `client:only`.
 *
 * The visitor arrives facing the first print, walks round (wheel, drag, keys, the map), clicks a print to
 * stand in front of it, and from there steps into it: the camera moves until the print sits exactly where
 * the lightbox will draw it, and the island fades the lightbox in over it. Closing steps back out.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Matrix4,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { PublicPhoto } from '../../../lib/db';
import { exposureFigures } from '../../../lib/exif-format';
import { placeholderDataUrl } from '../../../lib/gallery';
import { imageUrl, type Size } from '../../../lib/images';
import {
  aheadAngle,
  cornerOffsets,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuad,
  easeOutQuart,
  facet,
  focusDistance,
  fovToFit,
  framedSize,
  innerOutline,
  innerSurface,
  lightSlots,
  nearestEquivalent,
  outerMount,
  photoSize,
  planRoom,
  ROOM,
  walkYaw,
  wrapAngle,
  type Facet,
  type Mount,
  type Point,
  type Rect,
  underSlot,
  type Wall,
} from '../../../lib/walk';

/** Warm off-white plaster (near the site's ink tone), a plain white ceiling, pale oak underfoot. */
const COLORS = {
  air: 0xe4e0d9,
  wall: '#dcd8d1',
  /** The spots' light, and the falloff towards ceiling and floor, as rgb triples for canvas gradients. */
  light: '255,252,246',
  shade: '62,52,40',
  ceiling: 0xefece7,
  /** Inside the light slots: their ceiling, the side facing the nearer wall, the side facing the corridor. */
  slot: 0xe5e1da,
  slotWall: 0xe0dbd3,
  slotCorridor: 0xd3cdc4,
  lens: 0xfffefb,
  trim: 0xd9d4cc,
  mat: 0xf5f3ef,
  bevel: 0xfdfcfa,
  blank: 0xd2cdc5,
  ink: '#1a1918',
  figure: '#2e2c29',
  meta: '#6d6861',
};

/** A finish for moulding, one colour per face: lit from above, so tops are lightest and undersides darkest. */
const FINISHES = {
  black: { front: 0x262524, top: 0x4a4744, side: 0x181716, under: 0x0d0c0c },
  blackRaised: { front: 0x343230, top: 0x5c5955, side: 0x1d1c1b, under: 0x0f0e0e },
  gold: { front: 0xb39457, top: 0xdcc386, side: 0x8f7340, under: 0x5f4b25 },
  goldLight: { front: 0xc9ab6c, top: 0xead69e, side: 0xa1834b, under: 0x6c552b },
  goldDark: { front: 0x8c7240, top: 0xb69a5e, side: 0x6d582f, under: 0x45371b },
  walnut: { front: 0x4b3427, top: 0x6e4f3b, side: 0x3a281d, under: 0x22170f },
  walnutDark: { front: 0x3a281e, top: 0x58402f, side: 0x2c1f16, under: 0x1a120c },
};
type Finish = keyof typeof FINISHES;

/**
 * Painted joinery round every wall, lit from above like the mouldings: a picture rail near the ceiling and a
 * skirting at the floor. Heights are of the bottom and top edges; depth is how far
 * each stands out from the wall.
 */
const JOINERY = {
  rail: { y0: ROOM.wallHeight - 0.4, y1: ROOM.wallHeight - 0.33, depth: 0.03, front: 0xe3dfd8, top: 0xf0ede8, under: 0xa39c91 },
  skirting: { y0: 0, y1: 0.13, depth: 0.016, front: 0xc8c2b8, top: 0xe4e0d9, under: 0xc8c2b8 },
};
/** The ceiling's light slots, one over each wall all the way round (`lightSlots`): how wide and how deep. */
const SLOT = { width: 0.26, depth: 0.12 };

export type FrameStyle = 'gallery' | 'gilt' | 'walnut' | 'plain';
export const FRAME_STYLES: readonly FrameStyle[] = ['gallery', 'gilt', 'walnut', 'plain'];

/**
 * Mouldings as steps from the outer edge in: each step's face width, how far it stands off the wall, and its
 * finish. Steps at different depths make the profile; the innermost is usually a fillet against the mat.
 */
const MOULDINGS: Record<FrameStyle, { width: number; depth: number; finish: Finish }[]> = {
  // Black, rising to a raised ridge and down again, with a thin gilt fillet against the mat.
  gallery: [
    { width: 0.028, depth: 0.045, finish: 'black' },
    { width: 0.034, depth: 0.07, finish: 'blackRaised' },
    { width: 0.022, depth: 0.052, finish: 'black' },
    { width: 0.011, depth: 0.034, finish: 'gold' },
  ],
  // A museum gilt frame: an outer bead, a high rounded run, then steps down to a bright sight edge.
  gilt: [
    { width: 0.03, depth: 0.06, finish: 'goldDark' },
    { width: 0.035, depth: 0.085, finish: 'goldLight' },
    { width: 0.025, depth: 0.07, finish: 'gold' },
    { width: 0.02, depth: 0.055, finish: 'goldDark' },
    { width: 0.01, depth: 0.038, finish: 'goldLight' },
  ],
  // A wide, flat walnut face, a dark step in, and a gilt fillet.
  walnut: [
    { width: 0.07, depth: 0.06, finish: 'walnut' },
    { width: 0.022, depth: 0.045, finish: 'walnutDark' },
    { width: 0.011, depth: 0.032, finish: 'gold' },
  ],
  // The thin black frame from before, for comparison.
  plain: [{ width: 0.045, depth: 0.05, finish: 'black' }],
};

const WALK = {
  // The turn from the direction of travel towards the inner wall depends on the screen: `walkYaw`.
  pitch: -0.04,
  /** Vertical field of view: wide screens, and portrait ones (as in the example, so the inner wall fits). */
  fov: 56,
  fovPortrait: 70,
  /** World units walked per wheel pixel and per dragged pixel (mouse / touch). */
  wheel: 0.022,
  drag: 0.032,
  dragTouch: 0.06,
  /** Exponential damping of the walk, in seconds. */
  tau: 0.36,
  tauReduced: 0.12,
  /** Moves longer than this (radians round the ring) cut through a quick fade instead of gliding. */
  jump: 1.6,
};

/** Texture levels: the ThumbHash, then real derivatives. Only sizes the tiles and lightbox already use. */
type Level = 0 | 1 | 2 | 3;
const LEVEL_SIZE: Record<1 | 2 | 3, Size> = { 1: 480, 2: 1080, 3: 1600 };

interface Pose {
  angle: number;
  radius: number;
  y: number;
  heading: number;
  pitch: number;
  /** Vertical field of view: the screen's own, or wider to fit a print the visitor can't step back from. */
  fov: number;
}

interface PhotoState {
  material: MeshBasicMaterial;
  label: MeshBasicMaterial;
  textures: Partial<Record<Level, Texture>>;
  loading: Set<Level>;
  want: Level;
}

export interface RoomCallbacks {
  /** The print most in view while walking changed. */
  onCurrent: (photoIndex: number) => void;
  /** The camera now stands in front of this print, or went back to walking (null). */
  onFocus: (photoIndex: number | null) => void;
  /** The focused print was clicked again. */
  onOpen: (photoIndex: number) => void;
  /** The visitor moved for the first time (hide the hints). */
  onMove: () => void;
  /** Where the visitor stands round the ring, 0…2π from the first print, whenever it changes. */
  onAngle: (angle: number) => void;
}

export interface RoomHandle {
  /** Walk one print on (1) or back (-1); while standing at a print, move to the next or previous one. */
  step: (dir: 1 | -1) => void;
  focusPhoto: (photoIndex: number) => void;
  focusCurrent: () => void;
  unfocus: () => void;
  /** Walk to a point round the ring (0…2π from the first print), the short way round. */
  walkTo: (angle: number) => void;
  /** Step into a print until it fills `rect` (client pixels), then call `done`. */
  stepIn: (photoIndex: number, rect: Rect, done: () => void) => void;
  /** While the lightbox covers the room: stand where this print fills `rect`, so closing reveals it there. */
  standIn: (photoIndex: number, rect: Rect) => void;
  /** After the lightbox: step back out from this print to stand in front of it. */
  stepOut: (photoIndex: number) => void;
  /** Stop rendering and input while the lightbox covers the room. */
  setPaused: (paused: boolean) => void;
  dispose: () => void;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Throws when WebGL is unavailable; the island falls back to the grid. */
export function createRoom(
  host: HTMLElement,
  inputRoot: HTMLElement,
  photos: PublicPhoto[],
  cb: RoomCallbacks,
  options: { reducedMotion: boolean; frame?: FrameStyle },
): RoomHandle {
  const plan = planRoom(photos.length);
  const count = photos.length;
  const { innerRadius: RI, outerRadius: RO } = plan;
  const ahead = aheadAngle(plan);
  const H = ROOM.wallHeight;
  const TURN = Math.PI * 2;
  const moulding = MOULDINGS[options.frame ?? 'gallery'];
  const frameWidth = moulding.reduce((sum, step) => sum + step.width, 0);
  const sizes = photos.map((p) => {
    const print = photoSize(p.width, p.height);
    return { ...print, ...framedSize(print.w, print.h, frameWidth) };
  });
  // Prints are slots round the room; a small collection hangs each photo in several of them. `k` below is
  // always a slot; `photoOf(k)` is the photo it shows.
  const prints = plan.slots.length;
  const photoOf = (k: number) => plan.slots[k]!.photoIndex;
  const slotsOf: number[][] = photos.map(() => []);
  plan.slots.forEach((slot, k) => slotsOf[slot.photoIndex]!.push(k));
  /** Signed angle from `from` to print k, the short way round. */
  const towards = (k: number, from: number) => nearestEquivalent(plan.slots[k]!.angle, from) - from;
  /** The print hanging nearest a point on the walk; or, given a photo, the nearest print of it. */
  const nearestTo = (angle: number, photo?: number) => {
    const candidates = photo === undefined ? plan.slots.map((_, k) => k) : (slotsOf[photo] ?? []);
    let best = candidates[0] ?? 0;
    for (const k of candidates) if (Math.abs(towards(k, angle)) < Math.abs(towards(best, angle))) best = k;
    return best;
  };
  /** The first print strictly past `angle` in direction `dir`, and the signed angle to it. */
  const nextFrom = (angle: number, dir: 1 | -1) => {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < prints; k++) {
      let d = towards(k, angle) * dir;
      if (d <= 1e-4) d += TURN;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return { k: best, d: bestD * dir };
  };

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(COLORS.air);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.style.transition = 'opacity 170ms ease';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new Scene();
  scene.fog = new Fog(COLORS.air, 9, 44);
  const camera = new PerspectiveCamera(56, 1, 0.05, 90);
  camera.rotation.order = 'YXZ';

  /** Something changed on screen since the last frame was drawn. */
  let dirty = true;
  let paused = false;
  let disposed = false;
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };

  // ── The room ───────────────────────────────────────────────────────────────────────────────────────────
  // Walls are vertical bands and the floor and ceiling flat rings, sampled round the angle so their texture
  // coordinates follow it: u counts bays, so each bay's light pool lines up with its print. Each inner print
  // hangs on its own angled stretch of wall standing out from the curve (`facet`). Every architectural mesh
  // also blocks clicks, so prints hidden behind the inner wall can't be picked.
  const occluders: Mesh[] = [];
  const SEGMENTS = Math.max(160, (plan.outerBays + plan.innerBays) * 10);
  const geometry = (position: number[], uv: number[], index: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(position, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    return keep(g);
  };
  const add = (g: BufferGeometry, material: Material) => {
    const mesh = new Mesh(g, material);
    scene.add(mesh);
    occluders.push(mesh);
    return mesh;
  };
  /** A flat ring from r0 to r1 at height y; uv u from `u(θ)`, v across it (0 at r0). */
  const flatRing = (r0: number, r1: number, y: number, u: (t: number) => number) => {
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (TURN * i) / SEGMENTS;
      position.push(r0 * Math.sin(t), y, r0 * Math.cos(t), r1 * Math.sin(t), y, r1 * Math.cos(t));
      uv.push(u(t), 0, u(t), 1);
      if (i < SEGMENTS) index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
    return geometry(position, uv, index);
  };
  /** A wall of radius r, floor to ceiling unless told otherwise; uv u from `u(θ)`, v up it. */
  const wallRing = (r: number, u: (t: number) => number, y0 = 0, y1: number = H) => {
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (TURN * i) / SEGMENTS;
      position.push(r * Math.sin(t), y0, r * Math.cos(t), r * Math.sin(t), y1, r * Math.cos(t));
      uv.push(u(t), 0, u(t), 1);
      if (i < SEGMENTS) index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
    return geometry(position, uv, index);
  };
  /** Straight walls, floor to ceiling, one along each run; u along each, v up it. */
  const uprights = (runs: [Point, Point][]) => {
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    runs.forEach(([a, b], i) => {
      position.push(a.x, 0, a.z, b.x, 0, b.z, a.x, H, a.z, b.x, H, b.z);
      uv.push(0, 0, 1, 0, 0, 1, 1, 1);
      index.push(4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 2, 4 * i + 1, 4 * i + 3);
    });
    return geometry(position, uv, index);
  };
  const lit = (texture: Texture) => keep(new MeshBasicMaterial({ map: texture, side: DoubleSide }));
  /** Seen from the corridor only, so a camera gliding past an angled stretch's corner never sees its inside. */
  const litFront = (texture: Texture) => keep(new MeshBasicMaterial({ map: texture }));
  // Each wall has its own bays (outer ones centred on whole steps, inner ones half a step on), so the floor is
  // two halves, each with the spill under its own wall's prints. The curve of the inner wall is plain plaster:
  // its prints' pools of light fall on their angled stretches, which are lit like a bay of the outer wall, and
  // the short return behind each is in shade.
  const outerStep = TURN / plan.outerBays;
  const innerStep = TURN / plan.innerBays;
  const mid = (RI + RO) / 2;
  add(wallRing(RO, (t) => t / outerStep + 0.5), lit(keep(wallTexture((RO * outerStep) / H))));
  add(wallRing(RI, (t) => t / innerStep), lit(keep(wallTexture((RI * innerStep) / H, 'plain'))));
  add(flatRing(RI, mid, 0, (t) => t / innerStep), lit(keep(floorTexture('inner'))));
  add(flatRing(mid, RO, 0, (t) => t / outerStep + 0.5), lit(keep(floorTexture('outer'))));
  /** Per print (slot): its angled stretch of wall, for an inner print; a panorama's is longer. */
  const facets = plan.slots.map((slot) =>
    slot.wall === 'inner' ? facet(RI, slot.angle, Math.max(ROOM.facetLength, sizes[slot.photoIndex]!.outerW + 0.5)) : null,
  );
  const allFacets = facets.filter((f): f is Facet => f !== null);
  if (allFacets.length > 0) {
    add(uprights(allFacets.map((f) => [f.start, f.tip])), litFront(keep(wallTexture(ROOM.facetLength / H))));
    add(uprights(allFacets.map((f) => [f.tip, f.foot])), litFront(keep(wallTexture(0.3, 'shaded'))));
  }
  // The ceiling, with a light slot over each wall: a recess the spots sit in, running all the way round.
  const slots = lightSlots(RI, RO, allFacets);
  const plain = (color: number) => keep(new MeshBasicMaterial({ color, side: DoubleSide }));
  const [ceiling, slotTop, slotWall, slotCorridor] = [COLORS.ceiling, COLORS.slot, COLORS.slotWall, COLORS.slotCorridor].map(plain);
  const half = SLOT.width / 2;
  const level = () => 0;
  add(flatRing(RI, slots.inner - half, H, level), ceiling!);
  add(flatRing(slots.inner + half, slots.outer - half, H, level), ceiling!);
  add(flatRing(slots.outer + half, RO, H, level), ceiling!);
  // Each slot's side nearer its wall faces the corridor, and the other side faces that wall.
  for (const [r, facesCorridor, facesWall] of [
    [slots.inner, slots.inner - half, slots.inner + half],
    [slots.outer, slots.outer + half, slots.outer - half],
  ] as const) {
    add(flatRing(r - half, r + half, H + SLOT.depth, level), slotTop!);
    add(wallRing(facesCorridor, level, H, H + SLOT.depth), slotCorridor!);
    add(wallRing(facesWall, level, H, H + SLOT.depth), slotWall!);
  }

  // Picture rail and skirting along both walls: the outer curve, and the inner one out round every stretch.
  const ledge = (outline: Point[], towards: 1 | -1, spec: (typeof JOINERY)[keyof typeof JOINERY]) => {
    const offsets = cornerOffsets(outline, towards);
    const n = outline.length;
    // Each corner on the wall (a touch inside it, so no seam shows) and out at the moulding's face.
    const back = outline.map((p, i) => ({ x: p.x - offsets[i]!.x * 0.005, z: p.z - offsets[i]!.z * 0.005 }));
    const face = outline.map((p, i) => ({ x: p.x + offsets[i]!.x * spec.depth, z: p.z + offsets[i]!.z * spec.depth }));
    const faces: number[][] = [[], [], []];
    const { y0, y1 } = spec;
    type V = [number, number, number];
    /** Two triangles from the run a→b and its other edge c→d, wound to face `want`. */
    const quad = (out: number[], a: V, b: V, c: V, d: V, want: V) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const facing = normal[0]! * want[0] + normal[1]! * want[1] + normal[2]! * want[2] >= 0;
      out.push(...(facing ? [...a, ...b, ...c, ...c, ...b, ...d] : [...a, ...c, ...b, ...c, ...d, ...b]));
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [p0, p1, q0, q1] = [back[i]!, back[j]!, face[i]!, face[j]!];
      const length = Math.hypot(outline[j]!.x - outline[i]!.x, outline[j]!.z - outline[i]!.z) || 1;
      const out: V = [(towards * (outline[i]!.z - outline[j]!.z)) / length, 0, (towards * (outline[j]!.x - outline[i]!.x)) / length];
      quad(faces[0]!, [q0.x, y0, q0.z], [q1.x, y0, q1.z], [q0.x, y1, q0.z], [q1.x, y1, q1.z], out);
      quad(faces[1]!, [p0.x, y1, p0.z], [p1.x, y1, p1.z], [q0.x, y1, q0.z], [q1.x, y1, q1.z], [0, 1, 0]);
      quad(faces[2]!, [p0.x, y0, p0.z], [p1.x, y0, p1.z], [q0.x, y0, q0.z], [q1.x, y0, q1.z], [0, -1, 0]);
    }
    const g = keep(new BufferGeometry());
    g.setAttribute('position', new Float32BufferAttribute(faces.flat(), 3));
    let first = 0;
    faces.forEach((list, i) => {
      g.addGroup(first, list.length / 3, i);
      first += list.length / 3;
    });
    const materials = [spec.front, spec.top, spec.under].map((color) => keep(new MeshBasicMaterial({ color })));
    scene.add(new Mesh(g, materials));
  };
  const outerOutline = Array.from({ length: SEGMENTS }, (_, i) => ({ x: RO * Math.sin((TURN * i) / SEGMENTS), z: RO * Math.cos((TURN * i) / SEGMENTS) }));
  const innerLine = innerOutline(RI, allFacets, SEGMENTS);
  for (const spec of [JOINERY.rail, JOINERY.skirting]) {
    ledge(outerOutline, -1, spec);
    ledge(innerLine, 1, spec);
  }
  /** How far out from the centre the camera must stay within half a metre of angle θ, to keep clear of the inner wall. */
  const clearOfInner = (angle: number, margin: number) => {
    let surface = RI;
    for (let i = -5; i <= 5; i++) surface = Math.max(surface, innerSurface(RI, allFacets, angle + (i * 0.1) / RI));
    return surface + margin;
  };

  // ── The framed prints ──────────────────────────────────────────────────────────────────────────────────
  // Each print: a soft shadow on the wall, the frame (four bars), the mat, a bright bevel round the opening,
  // the print itself, and a label below. Depths are a few millimetres apart so nothing fights in the depth
  // buffer at a distance.
  const Z = { shadow: 0.003, mat: 0.02, bevel: 0.024, print: 0.028 };
  const BEVEL = 0.007;
  const LABEL_W = 1.5;
  const LABEL_H = (LABEL_W * 300) / 1024;
  /** The shadow texture's rectangle fills 208 of its 256 px; the rest is the blur. */
  const SHADOW_SCALE = 256 / 208;

  const planeGeometry = keep(new PlaneGeometry(1, 1));
  const matMat = keep(new MeshBasicMaterial({ color: COLORS.mat, toneMapped: false }));
  const bevelMat = keep(new MeshBasicMaterial({ color: COLORS.bevel, toneMapped: false }));
  const shadowMat = keep(new MeshBasicMaterial({ map: keep(shadowTexture()), transparent: true, depthWrite: false, opacity: 0.6 }));
  /** Moulding pieces by finish, placed per print, then drawn as one instanced mesh per finish. */
  const pieces = new Map<Finish, Matrix4[]>();
  const disc = keep(new CircleGeometry(1, 28));
  disc.rotateX(Math.PI / 2); // face down
  // One light over each print.
  const trims = new InstancedMesh(disc, keep(new MeshBasicMaterial({ color: COLORS.trim })), prints);
  const lenses = new InstancedMesh(disc, keep(new MeshBasicMaterial({ color: COLORS.lens, toneMapped: false })), prints);
  scene.add(trims, lenses);

  const states: PhotoState[] = photos.map(() => ({
    material: keep(new MeshBasicMaterial({ color: COLORS.blank, toneMapped: false })),
    label: keep(new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, visible: false })),
    textures: {},
    loading: new Set<Level>(),
    want: 1,
  }));

  const plane = (material: Material, w: number, h: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(planeGeometry, material);
    mesh.scale.set(w, h, 1);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const lightDummy = new Object3D();
  /** A recessed light in its wall's light slot, square on to the print: trim ring, then lens. */
  const hangLight = (n: number, mount: Mount, wall: Wall) => {
    const spot = underSlot(mount, wall === 'outer' ? slots.outer : slots.inner);
    for (const [mesh, radius, drop] of [
      [trims, 0.105, 0.003],
      [lenses, 0.08, 0.006],
    ] as const) {
      lightDummy.position.set(spot.x, H + SLOT.depth - drop, spot.z);
      lightDummy.scale.setScalar(radius);
      lightDummy.updateMatrix();
      mesh.setMatrixAt(n, lightDummy.matrix);
    }
  };
  /** How far flat things on the concave outer wall stand off it, so their edges clear it. */
  const concave = (halfExtent: number) => (halfExtent * halfExtent) / (2 * RO) + 0.01;
  /** A group on a wall, `standoff` out from it and facing into the corridor, its origin on the floor. */
  const onMount = (mount: Mount, standoff: number) => {
    const group = new Group();
    group.position.set(mount.x + mount.nx * standoff, 0, mount.z + mount.nz * standoff);
    group.lookAt(group.position.x + mount.nx, 0, group.position.z + mount.nz);
    group.updateMatrixWorld();
    scene.add(group);
    return group;
  };

  const pickables: Mesh[] = [];
  /** Per print (slot): the middle of its surface and the way it faces, for standing in front of it. */
  const surface: Mount[] = [];
  const barDummy = new Object3D();
  plan.slots.forEach((slot, n) => {
    const k = slot.photoIndex;
    const { w, h, outerW, outerH, centreY } = sizes[k]!;
    const mount = facets[n]?.mount ?? outerMount(RO, slot.angle);
    const standoff = facets[n] ? 0.004 : concave(Math.max((outerW * SHADOW_SCALE) / 2, LABEL_W - outerW / 2));
    const group = onMount(mount, standoff);
    const out = standoff + Z.print;
    surface[n] = { x: mount.x + mount.nx * out, z: mount.z + mount.nz * out, nx: mount.nx, nz: mount.nz };
    const frameY = ROOM.photoY + centreY;
    const state = states[k]!;
    // Light comes from above, so the shadow falls a little below the frame.
    group.add(plane(shadowMat, outerW * SHADOW_SCALE, outerH * SHADOW_SCALE, 0, frameY - 0.05, Z.shadow));
    const mat = plane(matMat, outerW, outerH, 0, frameY, Z.mat);
    const print = plane(state.material, w, h, 0, ROOM.photoY, Z.print);
    mat.userData.slot = n;
    print.userData.slot = n;
    pickables.push(mat, print);
    group.add(mat, plane(bevelMat, w + 2 * BEVEL, h + 2 * BEVEL, 0, ROOM.photoY, Z.bevel), print);
    group.add(plane(state.label, LABEL_W, LABEL_H, -outerW / 2 + LABEL_W / 2, frameY - outerH / 2 - 0.12 - LABEL_H / 2, 0.004));

    // The moulding, step by step from the outside in: in each, the top and bottom run the full width and the
    // sides fit between them.
    group.add(barDummy);
    let inset = 0;
    for (const step of moulding) {
      const w0 = outerW - 2 * inset;
      const h0 = outerH - 2 * inset;
      const sw = step.width;
      const bars: [number, number, number, number][] = [
        [0, frameY + h0 / 2 - sw / 2, w0, sw],
        [0, frameY - h0 / 2 + sw / 2, w0, sw],
        [-w0 / 2 + sw / 2, frameY, sw, h0 - 2 * sw],
        [w0 / 2 - sw / 2, frameY, sw, h0 - 2 * sw],
      ];
      const list = pieces.get(step.finish) ?? [];
      for (const [x, y, bw, bh] of bars) {
        barDummy.position.set(x, y, step.depth / 2);
        barDummy.scale.set(bw, bh, step.depth);
        barDummy.updateMatrixWorld();
        list.push(barDummy.matrixWorld.clone());
      }
      pieces.set(step.finish, list);
      inset += sw;
    }
    group.remove(barDummy);
    hangLight(n, mount, slot.wall);
  });
  const box = keep(new BoxGeometry(1, 1, 1));
  const instanced: InstancedMesh[] = [];
  for (const [finish, matrices] of pieces) {
    const colours = FINISHES[finish];
    const face = (color: number) => keep(new MeshBasicMaterial({ color }));
    const [front, top, side, under] = [face(colours.front), face(colours.top), face(colours.side), face(colours.under)];
    // BoxGeometry's groups: +x, -x, +y, -y, +z, -z.
    const mesh = new InstancedMesh(box, [side, side, top, under, front, side], matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    instanced.push(mesh);
  }
  trims.instanceMatrix.needsUpdate = true;
  lenses.instanceMatrix.needsUpdate = true;

  // ── Camera ─────────────────────────────────────────────────────────────────────────────────────────────
  let portrait = false;
  /** The screen's field of view (`resize`). */
  let baseFov: number = WALK.fov;
  /** Turned from the way ahead towards the inner wall, further on a narrow screen (`resize`). */
  let yaw = 0;
  const tau = options.reducedMotion ? WALK.tauReduced : WALK.tau;
  const walkPose = (a: number): Pose => ({
    angle: a,
    radius: plan.walkRadius,
    y: ROOM.eyeY,
    heading: a - Math.PI / 2 + yaw,
    pitch: WALK.pitch,
    fov: baseFov,
  });
  /** The heading that looks from (angle, radius) towards a point. */
  const headingTowards = (angle: number, radius: number, tx: number, tz: number) =>
    Math.atan2(-(tx - radius * Math.sin(angle)), -(tz - radius * Math.cos(angle)));
  /** On arrival: facing the first print, on the outer wall at angle 0, with the corridor curving away to the left. */
  const introPose = (): Pose => {
    const t = 0;
    const angle = t - 0.12;
    const radius = Math.max(RO - (portrait ? 5.0 : 4.6), clearOfInner(angle, 0.6));
    const look = t + (portrait ? -0.012 : 0.13);
    return {
      angle,
      radius,
      y: ROOM.eyeY,
      heading: headingTowards(angle, radius, RO * Math.sin(look), RO * Math.cos(look)),
      pitch: 0.03,
      fov: baseFov,
    };
  };

  let mode: 'intro' | 'walk' | 'focus' | 'dive' = 'intro';
  let a = -0.12;
  let aTarget = a;
  let focusK: number | null = null;
  let target: Pose = introPose();
  let pose: Pose = { ...target };
  let glide: { from: Pose; start: number; duration: number; smooth: boolean } | null = null;
  let arrive: (() => void) | null = null;
  let now = performance.now();

  /** Where to stand `d` out from print k, square on to it, `left` to the left of its centre, eyes at `y`. */
  const standBefore = (k: number, d: number, left: number, y: number, fov: number, from: Pose): Pose => {
    const { x, z, nx, nz } = surface[k]!;
    // Looking back along the normal, the view's right is (nz, -nx).
    const px = x + nx * d - nz * left;
    const pz = z + nz * d + nx * left;
    return {
      angle: nearestEquivalent(Math.atan2(px, pz), from.angle),
      radius: Math.hypot(px, pz),
      y,
      heading: nearestEquivalent(Math.atan2(nx, nz), from.heading),
      pitch: 0,
      fov,
    };
  };

  /** How far out from print k the visitor can stand before the opposite wall gets in the way. */
  const roomBefore = (k: number) => {
    const slot = plan.slots[k]!;
    // From the outer wall: as far as the inner wall, angled stretches and all, on either side.
    if (slot.wall === 'outer') return RO - clearOfInner(slot.angle, 0);
    // From an angled stretch: along its normal to the outer wall.
    const { x, z, nx, nz } = surface[k]!;
    const along = x * nx + z * nz;
    return -along + Math.sqrt(along * along - (x * x + z * z) + RO * RO);
  };

  const focusPoseFor = (k: number, from: Pose): Pose => {
    const { outerW, outerH } = sizes[photoOf(k)]!;
    // Frame plus the three-line label under it. Where the opposite wall stops the visitor stepping back far
    // enough, the view widens instead.
    const d = focusDistance(outerW, outerH + 0.6, baseFov, camera.aspect, roomBefore(k));
    const fov = fovToFit(outerW, outerH + 0.6, d, camera.aspect, baseFov);
    const tanY = Math.tan((fov * Math.PI) / 360);
    // Centred on frame and label, then a little lower, so the frame sits above the caption bar.
    return standBefore(k, d, 0, ROOM.photoY - 0.25 - d * tanY * (portrait ? 0.24 : 0.14), fov, from);
  };

  /** Where to stand so print k fills `rect` on screen: straight in front of it, square on. */
  const divePoseFor = (k: number, rect: Rect, from: Pose): Pose => {
    const box = canvas.getBoundingClientRect();
    const vw = box.width || 1;
    const vh = box.height || 1;
    const tanY = Math.tan((baseFov * Math.PI) / 360);
    const d = (sizes[photoOf(k)]!.h * vh) / (2 * tanY * Math.max(1, rect.height));
    const perPixel = (2 * d * tanY) / vh;
    const dx = (rect.x - box.left + rect.width / 2 - vw / 2) * perPixel;
    const dy = (rect.y - box.top + rect.height / 2 - vh / 2) * perPixel;
    // Back off along the normal, then shift sideways so the print lands where the rect is: a rect right of
    // the middle means standing to the left.
    return standBefore(k, d, dx, ROOM.photoY + dy, baseFov, from);
  };

  const mix = (from: Pose, to: Pose, t: number, smooth: boolean): Pose => {
    const heading = nearestEquivalent(to.heading, from.heading);
    if (smooth) {
      const e = easeInOutCubic(t);
      return {
        angle: from.angle + (to.angle - from.angle) * e,
        radius: from.radius + (to.radius - from.radius) * e,
        y: from.y + (to.y - from.y) * e,
        heading: from.heading + (heading - from.heading) * e,
        pitch: from.pitch + (to.pitch - from.pitch) * e,
        fov: from.fov + (to.fov - from.fov) * e,
      };
    }
    const c = easeOutCubic(t);
    return {
      angle: from.angle + (to.angle - from.angle) * easeOutQuart(t),
      radius: from.radius + (to.radius - from.radius) * c,
      y: from.y + (to.y - from.y) * c,
      heading: from.heading + (heading - from.heading) * easeOutQuad(t),
      pitch: from.pitch + (to.pitch - from.pitch) * c,
      fov: from.fov + (to.fov - from.fov) * c,
    };
  };

  const glideFrom = (duration: number, smooth = false) => {
    glide = options.reducedMotion || duration <= 0 ? null : { from: { ...pose }, start: now, duration, smooth };
    dirty = true;
  };

  /** A long way round the ring: dip the view out and back in rather than spin the camera. */
  const cutTo = (apply: () => void) => {
    if (options.reducedMotion) {
      apply();
      glide = null;
      dirty = true;
      return;
    }
    canvas.style.opacity = '0';
    later(() => {
      // The next frame finds the camera somewhere new and moves it there in one step, map dot and all.
      apply();
      glide = null;
      dirty = true;
      canvas.style.opacity = '1';
    }, 180);
  };

  let hasMoved = false;
  const moved = () => {
    if (hasMoved) return;
    hasMoved = true;
    cb.onMove();
  };

  /** Stand in front of print (slot) k, any number round the ring: it wraps. */
  const focusSlot = (k: number) => {
    if (prints === 0 || mode === 'dive') return;
    const index = ((k % prints) + prints) % prints;
    moved();
    const next = focusPoseFor(index, pose);
    const far = Math.abs(next.angle - pose.angle) > WALK.jump;
    const distance = Math.abs(next.angle - pose.angle) * plan.walkRadius;
    mode = 'focus';
    focusK = index;
    target = next;
    if (far) cutTo(() => undefined);
    else glideFrom(950 + Math.min(650, distance * 45));
    want(photoOf(index), 3);
    cb.onFocus(photoOf(index));
    schedule();
  };

  /** Back to walking, from a print or from the arrival view. */
  const toWalk = (angle: number) => {
    const wasFocus = mode === 'focus';
    mode = 'walk';
    focusK = null;
    a = aTarget = angle;
    glideFrom(800);
    if (wasFocus) cb.onFocus(null);
    schedule();
  };
  const unfocus = () => {
    if (mode === 'focus') toWalk(pose.angle - ahead * 0.85);
  };
  const leave = () => {
    if (mode === 'intro') toWalk(pose.angle);
    else if (mode === 'focus') unfocus();
  };

  const walkBy = (distance: number) => {
    if (mode === 'dive') return;
    leave();
    aTarget += distance / plan.walkRadius;
    moved();
  };

  // ── Textures ───────────────────────────────────────────────────────────────────────────────────────────
  const loader = new TextureLoader();
  let inflight = 0;

  /** In prints, from the point the visitor is looking at to the nearest print of photo i, either way round. */
  const photoDistance = (i: number): number => {
    const view = focusK !== null ? plan.slots[focusK]!.angle : pose.angle + ahead;
    let best = Infinity;
    for (const k of slotsOf[i] ?? []) best = Math.min(best, Math.abs(towards(k, view)));
    return best / plan.unit;
  };

  const show = (i: number) => {
    const state = states[i]!;
    let level: Level | null = null;
    for (let l = state.want; l >= 0; l--) {
      if (state.textures[l as Level]) {
        level = l as Level;
        break;
      }
    }
    // Drop sharper copies that are no longer wanted (the 480 and the ThumbHash stay).
    for (const l of [2, 3] as const) {
      if (l > state.want && state.textures[l]) {
        state.textures[l]!.dispose();
        delete state.textures[l];
      }
    }
    const map = level === null ? null : state.textures[level]!;
    if (state.material.map !== map) {
      state.material.map = map;
      state.material.color.set(map ? 0xffffff : COLORS.blank);
      state.material.needsUpdate = true;
      dirty = true;
      // Paused behind the lightbox, but standing in a print: draw it as soon as its sharper copy lands.
      if (paused) renderer.render(scene, camera);
    }
  };

  const want = (i: number, level: Level) => {
    const state = states[i]!;
    if (state.want === level) return;
    state.want = level;
    show(i);
    pump();
  };

  const load = (i: number, level: Level) => {
    const state = states[i]!;
    const photo = photos[i]!;
    const url = level === 0 ? placeholderDataUrl(photo.placeholder) : imageUrl(photo.id, photo.version, LEVEL_SIZE[level as 1 | 2 | 3]);
    if (!url) return;
    state.loading.add(level);
    inflight++;
    loader
      .loadAsync(url)
      .then((texture) => {
        if (disposed || (level > 1 && state.want < level)) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        if (level === 0) {
          texture.generateMipmaps = false;
          texture.minFilter = LinearFilter;
        } else {
          texture.anisotropy = anisotropy;
        }
        state.textures[level]?.dispose();
        state.textures[level] = texture;
        show(i);
      })
      .catch(() => {
        /* the print keeps its lower level; a later pass may retry */
      })
      .finally(() => {
        state.loading.delete(level);
        inflight--;
        if (!disposed) pump();
      });
  };

  /** Start the most useful loads: the focused print, sharp copies of nearby ones, then every 480 by distance. */
  const pump = () => {
    while (inflight < 4) {
      let bestI = -1;
      let bestLevel: Level = 1;
      let bestScore = Infinity;
      for (let i = 0; i < count; i++) {
        const state = states[i]!;
        const d = photoDistance(i);
        const jobs: [Level, number][] = [[1, d]];
        if (state.want >= 2) jobs.push([state.want, state.want === 3 ? -1000 : d - 40]);
        for (const [level, score] of jobs) {
          if (state.textures[level] || state.loading.has(level) || score >= bestScore) continue;
          bestI = i;
          bestLevel = level;
          bestScore = score;
        }
      }
      if (bestI < 0) return;
      load(bestI, bestLevel);
    }
  };

  // Placeholders first (data URLs, instant), then the real images.
  photos.forEach((photo, i) => {
    if (photo.placeholder) load(i, 0);
  });

  let lastScheduled = Infinity;
  /** Sharper textures within a few bays of the view, with hysteresis so they don't flicker. */
  const schedule = () => {
    for (let i = 0; i < count; i++) {
      const state = states[i]!;
      if (state.want === 3 && focusK !== null && photoOf(focusK) === i) continue;
      const d = photoDistance(i);
      const next: Level = d < 2.6 ? 2 : d > 4 ? 1 : state.want === 3 ? 2 : state.want;
      if (next !== state.want) want(i, next);
    }
    pump();
  };

  // ── Labels (after the fonts load) ──────────────────────────────────────────────────────────────────────
  void Promise.all([
    document.fonts.load('500 72px "Barlow Condensed"'),
    document.fonts.load('500 28px "Barlow"'),
    document.fonts.load('400 22px "Barlow"'),
  ])
    .catch(() => undefined)
    .then(() => {
      if (disposed) return;
      photos.forEach((photo, i) => {
        const texture = labelTexture(photo);
        if (!texture) return;
        texture.anisotropy = anisotropy;
        const material = states[i]!.label;
        material.map = keep(texture);
        material.visible = true;
        material.needsUpdate = true;
      });
      dirty = true;
    });

  // ── Size ───────────────────────────────────────────────────────────────────────────────────────────────
  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    // Collapsed for a moment (a layout change under the lightbox): keep the last size, which stepping in
    // and out of prints measures against.
    if (width < 2 || height < 2) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    portrait = camera.aspect < 0.8;
    baseFov = portrait ? WALK.fovPortrait : WALK.fov;
    camera.updateProjectionMatrix();
    yaw = walkYaw(Math.tan((baseFov * Math.PI) / 360) * camera.aspect);
    if (mode === 'focus' && focusK !== null) target = focusPoseFor(focusK, target);
    if (mode === 'intro') target = introPose();
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  if (mode === 'intro') pose = { ...target };

  // ── Input ──────────────────────────────────────────────────────────────────────────────────────────────
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const hit = (clientX: number, clientY: number): number | null => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    raycaster.far = 40;
    const first = raycaster.intersectObjects([...occluders, ...pickables], false)[0];
    const index = first?.object.userData.slot;
    return typeof index === 'number' ? index : null;
  };

  let drag: { id: number; lastX: number; lastY: number; travelled: number; touch: boolean; dragging: boolean } | null = null;
  let hover: { x: number; y: number } | null = null;

  const onWheel = (e: WheelEvent) => {
    if (paused) return;
    e.preventDefault();
    if (e.ctrlKey) return; // pinch-zoom on a trackpad
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale;
    walkBy(delta * WALK.wheel);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (paused || !e.isPrimary || e.button !== 0) return;
    drag = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY, travelled: 0, touch: e.pointerType !== 'mouse', dragging: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone; the drag simply ends at the canvas edge */
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (paused) return;
    if (!drag || e.pointerId !== drag.id) {
      if (e.pointerType === 'mouse') hover = { x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.travelled += Math.abs(dx) + Math.abs(dy);
    if (!drag.dragging && drag.travelled > 6) {
      drag.dragging = true;
      canvas.style.cursor = 'grabbing';
    }
    if (drag.dragging) walkBy(-(Math.abs(dx) > Math.abs(dy) ? dx : dy) * (drag.touch ? WALK.dragTouch : WALK.drag));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.dragging;
    drag = null;
    canvas.style.cursor = 'grab';
    if (wasDrag || paused || mode === 'dive') return;
    const index = hit(e.clientX, e.clientY);
    if (index === null) {
      unfocus();
      return;
    }
    if (mode === 'focus' && focusK === index) {
      cb.onOpen(photoOf(index));
      return;
    }
    focusSlot(index);
  };
  const onPointerCancel = () => {
    drag = null;
    canvas.style.cursor = 'grab';
  };
  const onPointerLeave = () => {
    hover = null;
  };

  inputRoot.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  const blockMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('contextmenu', blockMenu);

  // ── Frame loop ─────────────────────────────────────────────────────────────────────────────────────────
  const placeCamera = () => {
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(pose.radius * Math.sin(pose.angle), pose.y, pose.radius * Math.cos(pose.angle));
    camera.rotation.set(pose.pitch, pose.heading, 0);
    camera.updateMatrixWorld();
  };

  const probe = new Vector3();
  const toProbe = new Vector3();
  /** The print most in view while walking: nearest the middle of the screen, nearer ones preferred, not hidden. */
  const centralK = (): number | null => {
    const view = pose.angle + ahead;
    let bestK: number | null = null;
    let bestScore = Infinity;
    for (let k = 0; k < prints; k++) {
      const offset = towards(k, view);
      if (offset < -0.6 || offset > 1.4) continue;
      probe.set(surface[k]!.x, ROOM.photoY, surface[k]!.z);
      toProbe.subVectors(probe, camera.position);
      const distance = toProbe.length();
      probe.project(camera);
      if (probe.z > 1 || Math.abs(probe.x) > 0.95) continue;
      const score = Math.abs(probe.x) + distance * 0.05;
      if (score >= bestScore) continue;
      raycaster.set(camera.position, toProbe.normalize());
      raycaster.far = distance - 0.2;
      if (raycaster.intersectObjects(occluders, false).length > 0) continue;
      bestScore = score;
      bestK = k;
    }
    return bestK;
  };

  let last = now;
  let currentPhoto = -1;
  let hovered: number | null = null;
  let lastAngle = NaN;

  const frame = (time: number) => {
    now = time;
    const dt = Math.min(0.05, Math.max(0, (time - last) / 1000));
    last = time;

    if (mode === 'walk') {
      a += (aTarget - a) * (1 - Math.exp(-dt / tau));
      if (Math.abs(aTarget - a) < 1e-6) a = aTarget;
    }
    const live = mode === 'walk' ? walkPose(a) : target;
    let next = live;
    if (glide) {
      const t = clamp01((time - glide.start) / glide.duration);
      next = mix(glide.from, live, t, glide.smooth);
      if (t >= 1) glide = null;
    }
    const changed =
      next.angle !== pose.angle ||
      next.radius !== pose.radius ||
      next.y !== pose.y ||
      next.heading !== pose.heading ||
      next.pitch !== pose.pitch ||
      next.fov !== pose.fov;
    pose = next;

    if (changed) {
      placeCamera();
      dirty = true;
      if (mode === 'walk' && prints > 0) {
        // None in view: the print in the nearest bay ahead.
        const photo = photoOf(centralK() ?? nearestTo(a + ahead));
        if (photo !== currentPhoto) {
          currentPhoto = photo;
          cb.onCurrent(photo);
        }
      }
      if (Math.abs(pose.angle - lastAngle) > 1e-4 || Number.isNaN(lastAngle)) {
        lastAngle = pose.angle;
        cb.onAngle(wrapAngle(pose.angle));
      }
      if (Math.abs(pose.angle - lastScheduled) > plan.unit * 0.5) {
        lastScheduled = pose.angle;
        schedule();
      }
    }

    if (hover && !drag) {
      const index = hit(hover.x, hover.y);
      hover = null;
      if (index !== hovered) {
        hovered = index;
        canvas.style.cursor = index === null ? 'grab' : mode === 'focus' && focusK === index ? 'zoom-in' : 'pointer';
      }
    }

    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    if (mode === 'dive' && !glide && arrive) {
      const done = arrive;
      arrive = null;
      done();
    }
  };
  placeCamera();
  cb.onAngle(wrapAngle(pose.angle));
  schedule();
  renderer.setAnimationLoop(frame);

  // ── Handle ─────────────────────────────────────────────────────────────────────────────────────────────
  return {
    step(dir) {
      if (paused || prints === 0 || mode === 'dive') return;
      moved();
      if (mode === 'focus' && focusK !== null) {
        focusSlot(focusK + dir);
        return;
      }
      if (mode === 'intro') toWalk(pose.angle);
      aTarget += nextFrom(aTarget + ahead, dir).d;
    },
    focusPhoto(photoIndex) {
      if (photoIndex < 0 || photoIndex >= count) return;
      if (mode === 'focus' && focusK !== null && photoOf(focusK) === photoIndex) return;
      focusSlot(nearestTo(pose.angle, photoIndex));
    },
    focusCurrent() {
      if (mode === 'focus' || mode === 'dive' || prints === 0) return;
      if (mode === 'intro') {
        focusSlot(0);
        return;
      }
      focusSlot(centralK() ?? nearestTo(a + ahead));
    },
    unfocus,
    walkTo(angle) {
      if (paused || mode === 'dive') return;
      moved();
      const from = mode === 'walk' ? aTarget : pose.angle;
      const to = nearestEquivalent(angle, from);
      if (Math.abs(to - pose.angle) > WALK.jump) {
        if (mode === 'focus') cb.onFocus(null);
        mode = 'walk';
        focusK = null;
        cutTo(() => {
          a = aTarget = to;
        });
        return;
      }
      leave();
      aTarget = to;
    },
    stepIn(photoIndex, rect, done) {
      if (paused || photoIndex < 0 || photoIndex >= count) return;
      // Into the print the visitor stands at, or the nearest one of that photo.
      const k = focusK !== null && photoOf(focusK) === photoIndex ? focusK : nearestTo(pose.angle, photoIndex);
      mode = 'dive';
      focusK = k;
      target = divePoseFor(k, rect, pose);
      want(photoIndex, 3);
      arrive = done;
      glideFrom(720, true);
    },
    standIn(photoIndex, rect) {
      if (photoIndex < 0 || photoIndex >= count) return;
      const k = nearestTo(pose.angle, photoIndex);
      mode = 'dive';
      focusK = k;
      arrive = null;
      glide = null;
      target = divePoseFor(k, rect, pose);
      pose = { ...target };
      want(photoIndex, 3);
      schedule();
      placeCamera();
      renderer.render(scene, camera);
      cb.onFocus(photoIndex);
    },
    stepOut(photoIndex) {
      if (photoIndex < 0 || photoIndex >= count) return;
      const k = focusK !== null && photoOf(focusK) === photoIndex ? focusK : nearestTo(pose.angle, photoIndex);
      mode = 'focus';
      focusK = k;
      target = focusPoseFor(k, pose);
      glideFrom(850, true);
      cb.onFocus(photoIndex);
    },
    setPaused(value) {
      if (paused === value) return;
      paused = value;
      drag = null;
      if (paused) renderer.setAnimationLoop(null);
      else {
        last = performance.now();
        now = last;
        dirty = true;
        renderer.setAnimationLoop(frame);
      }
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      for (const id of timers) window.clearTimeout(id);
      observer.disconnect();
      inputRoot.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', blockMenu);
      for (const state of states) for (const texture of Object.values(state.textures)) texture?.dispose();
      for (const thing of disposables) thing.dispose();
      for (const mesh of instanced) mesh.dispose();
      trims.dispose();
      lenses.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

// ── Painted textures ─────────────────────────────────────────────────────────────────────────────────────

function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A small deterministic random sequence, so the painted floor is the same on every visit. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** An elliptical radial gradient: `rx` across, `ry` up and down. */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, stops: [number, string][]) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

/**
 * One wall bay (one print's width of wall): warm plaster, slightly darker under the ceiling and towards the
 * floor, with the pool of light the recessed spot throws round the print. `aspect` is the bay's width / height.
 * A `plain` stretch has no print, so no pool; a `shaded` one is the return behind an angled stretch, turned
 * from the light.
 */
function wallTexture(aspect: number, kind: 'bay' | 'plain' | 'shaded' = 'bay'): CanvasTexture {
  const height = 512;
  const width = Math.round(Math.min(1024, Math.max(256, height * aspect)));
  const unit = height / ROOM.wallHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, 0, width, height);

  let g = ctx.createLinearGradient(0, 0, 0, height * 0.3);
  g.addColorStop(0, `rgba(${COLORS.shade},0.12)`);
  g.addColorStop(1, `rgba(${COLORS.shade},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  g = ctx.createLinearGradient(0, height * 0.62, 0, height);
  g.addColorStop(0, `rgba(${COLORS.shade},0)`);
  g.addColorStop(1, `rgba(${COLORS.shade},0.16)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // The pool round the print, and the brighter scallop where the beam first meets the wall. Both are kept
  // within the bay, so neighbouring bays' pools meet without a seam.
  if (kind === 'bay') {
    const cx = width / 2;
    glow(ctx, cx, height - (ROOM.photoY + 0.2) * unit, Math.min(2.1 * unit, width / 2), 2.6 * unit, [
      [0, `rgba(${COLORS.light},0.9)`],
      [0.45, `rgba(${COLORS.light},0.5)`],
      [1, `rgba(${COLORS.light},0)`],
    ]);
    glow(ctx, cx, height - (ROOM.wallHeight - 1.05) * unit, Math.min(1.05 * unit, width * 0.4), 1.5 * unit, [
      [0, `rgba(${COLORS.light},0.45)`],
      [1, `rgba(${COLORS.light},0)`],
    ]);
  }
  if (kind === 'shaded') {
    ctx.fillStyle = `rgba(${COLORS.shade},0.12)`;
    ctx.fillRect(0, 0, width, height);
  }

  // The picture rail's shadow, just below it. (The skirting covers the foot of the wall.)
  const railY = height - JOINERY.rail.y0 * unit;
  g = ctx.createLinearGradient(0, railY, 0, railY + 0.09 * unit);
  g.addColorStop(0, `rgba(${COLORS.shade},0.2)`);
  g.addColorStop(1, `rgba(${COLORS.shade},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, railY, width, 0.09 * unit);

  const texture = canvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  return texture;
}

/**
 * One bay of half the floor, pale oak boards running along the corridor: darker where it meets its wall, with
 * the spill of light under that wall's print. The canvas's top row is the outer edge of its strip (v = 1), so
 * the outer half has its wall at the top and the inner half at the bottom.
 */
function floorTexture(edge: Wall): CanvasTexture {
  const width = 512;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const random = seeded(edge === 'outer' ? 7 : 11);
  const rows = 17;
  const rowH = height / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    ctx.fillStyle = `hsl(35 24% ${71 + random() * 3.5}%)`;
    ctx.fillRect(0, y, width, rowH);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(${COLORS.shade},${0.015 + random() * 0.025})`;
      ctx.fillRect(0, y + random() * rowH, width, 1 + random() * 1.5);
    }
    ctx.fillStyle = `rgba(${COLORS.shade},0.16)`;
    const ends = 1 + Math.floor(random() * 2);
    for (let i = 0; i < ends; i++) ctx.fillRect(Math.floor(random() * width), y, 1.5, rowH);
    ctx.fillStyle = `rgba(${COLORS.shade},0.12)`;
    ctx.fillRect(0, y, width, 1.25);
  }
  const wallY = edge === 'outer' ? 0 : height;
  const g = ctx.createLinearGradient(0, wallY, 0, edge === 'outer' ? height * 0.14 : height * 0.86);
  g.addColorStop(0, `rgba(${COLORS.shade},0.22)`);
  g.addColorStop(1, `rgba(${COLORS.shade},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  glow(ctx, width / 2, wallY, width * 0.45, height * 0.6, [
    [0, `rgba(${COLORS.light},0.5)`],
    [1, `rgba(${COLORS.light},0)`],
  ]);
  const texture = canvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  return texture;
}

/** A soft rectangle of shade, stretched behind each frame. */
function shadowTexture(): CanvasTexture {
  const size = 256;
  const pad = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Draw the rectangle off-canvas and keep only its blurred shadow.
  ctx.shadowColor = `rgba(${COLORS.shade},0.9)`;
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = size * 4;
  ctx.fillStyle = '#000';
  ctx.fillRect(pad - size * 4, pad, size - 2 * pad, size - 2 * pad);
  return canvasTexture(canvas);
}

/** Fits `text` into `max` pixels in the context's current font, with an ellipsis if it must be cut. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function tracking(ctx: CanvasRenderingContext2D, value: string) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}

/**
 * The wall label under a print: the title in the display face; the exposure as figures, with ƒ and the units
 * small like the info panel's spec sheet; then place and year in small caps. Missing lines are left out.
 */
function labelTexture(photo: PublicPhoto): CanvasTexture | null {
  const title = photo.title?.trim() || null;
  const year = photo.takenAt?.slice(0, 4) || null;
  const meta = [photo.location?.name ?? null, year].filter(Boolean).join(' · ') || null;
  const figures = exposureFigures(photo);
  if (!title && !meta && figures.length === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 300;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  let y = 0;
  if (title) {
    y += 70;
    ctx.font = '500 70px "Barlow Condensed", sans-serif';
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(fit(ctx, title, 1010), 4, y);
  }
  if (figures.length > 0) {
    y += title ? 64 : 50;
    let x = 4;
    const small = (text: string) => {
      ctx.font = '400 24px "Barlow", sans-serif';
      tracking(ctx, '1px');
      ctx.fillStyle = COLORS.meta;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
      tracking(ctx, '0px');
    };
    const big = (text: string, italic = false) => {
      ctx.font = `${italic ? 'italic ' : ''}500 46px "Barlow Condensed", sans-serif`;
      ctx.fillStyle = COLORS.figure;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    };
    for (const f of figures) {
      if (f.key === 'iso') {
        small('ISO ');
        big(f.value);
      } else if (f.key === 'aperture') {
        big('f', true);
        big(`/${f.value}`);
      } else {
        big(f.value);
        if (f.unit) small(` ${f.unit}`);
      }
      x += 30;
    }
  }
  if (meta) {
    y += title || figures.length > 0 ? 50 : 40;
    ctx.font = '500 26px "Barlow", sans-serif';
    tracking(ctx, '5px');
    ctx.fillStyle = COLORS.meta;
    ctx.fillText(fit(ctx, meta.toUpperCase(), 1010), 4, y);
  }
  return canvasTexture(canvas);
}
