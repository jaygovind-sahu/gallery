/**
 * Pure geometry for the walk-through: a ring-shaped corridor with framed prints on both walls, evenly spaced
 * along each, which the visitor can walk round forever. The inner prints hang on short stretches of wall angled
 * towards the visitor (`facet`). No DOM or three.js imports, so it runs in
 * unit tests. World units are roughly metres.
 *
 * Angles follow three.js's CylinderGeometry: a point at angle θ and radius r is (r·sinθ, y, r·cosθ).
 * Walking forward increases the angle; the inner wall is then on the visitor's left.
 */

export type Wall = 'outer' | 'inner';

export const ROOM = {
  /** Distance between the inner and outer walls. */
  corridor: 6,
  wallHeight: 5.4,
  /**
   * The room's natural size: its inner wall's radius, a gentle curve with the visitor walking well clear of
   * it. A collection too small to fill it repeats round the walls, as an exhibition hang does; a large one
   * grows the room.
   */
  innerRadius: 12.2,
  /** A collection that nearly fills the natural room shrinks it a little, never below this. */
  minInnerRadius: 8,
  /** Centre to centre along either wall: the widest frame and a generous gap. Both walls keep it. */
  spacing: 3.9,
  /** Height of a print's centre, and of the visitor's eyes while walking. */
  photoY: 2.1,
  eyeY: 1.72,
  /** Where along the corridor the visitor walks: 0 is the inner wall, 1 the outer. */
  walkLane: 0.58,
  /**
   * How far each inner print's stretch of wall turns from the curve towards the visitor walking up to it
   * (radians, 25°), and how long it is: the widest landscape frame with room either side. A panorama's is longer.
   */
  facetTurn: 0.44,
  facetLength: 3.2,
  /**
   * The ceiling's two light slots, one over each wall, run all the way round: the outer one this far in from
   * the outer wall, the inner one this far out from the inner curve, and clear of the angled stretches' tips.
   */
  slotFromOuter: 1.1,
  slotFromInner: 1.75,
  /** White mat around each print, with a little extra at the bottom as framers do. */
  mat: 0.16,
  matBottom: 0.04,
} as const;

export interface Slot {
  photoIndex: number;
  wall: Wall;
  angle: number;
}

export interface RoomPlan {
  innerRadius: number;
  outerRadius: number;
  walkRadius: number;
  /** Bays round each whole wall, evenly spaced, a print in every one. */
  outerBays: number;
  innerBays: number;
  /** How many times each photo hangs round the room: more than once only in a small collection. */
  repeats: number;
  /** Average angle between neighbouring prints (either wall), for measuring distances in prints. */
  unit: number;
  /** Every print round the room, by angle: the photos in order, again and again for a small collection. */
  slots: Slot[];
}

/**
 * Bays every `ROOM.spacing` along each wall (so the longer outer wall has more of them). Prints fill them in
 * order of angle, so walking forward passes the photos in order, on whichever wall comes next. The first hangs
 * in the outer wall's bay 0, at angle 0, where the visitor arrives and each lap begins; the inner wall's bays
 * sit half a step on from the outer wall's.
 *
 * The room keeps close to its natural size. A collection that would leave it more than half empty repeats,
 * in whole runs, as many times as fills it best, and the room is sized to fit them exactly; a larger one
 * hangs once, in a room just big enough. Every bay holds a print: where the smallest room is a bay or so too
 * big, the outer wall spaces its prints a little wider instead of leaving a gap.
 */
export function planRoom(count: number): RoomPlan {
  const photos = Math.max(0, count);
  const turn = Math.PI * 2;
  const bays = (r: number) => Math.floor((turn * r) / ROOM.spacing);
  /** Prints a room of inner radius r holds. */
  const capacity = (r: number) => bays(r) + bays(r + ROOM.corridor);
  const natural = capacity(ROOM.innerRadius);
  const repeats = photos > 0 && photos < natural ? Math.max(1, Math.round(natural / photos)) : 1;
  const prints = photos * repeats;
  let innerRadius: number = photos >= natural ? ROOM.innerRadius : ROOM.minInnerRadius;
  if (photos === 0) innerRadius = ROOM.innerRadius;
  while (capacity(innerRadius) < prints) innerRadius += 0.05;
  const outerRadius = innerRadius + ROOM.corridor;
  const innerBays = bays(innerRadius);
  const outerBays = prints > 0 ? prints - innerBays : bays(outerRadius);
  const positions = [
    ...Array.from({ length: outerBays }, (_, j) => ({ wall: 'outer' as Wall, angle: (j * turn) / outerBays })),
    ...Array.from({ length: innerBays }, (_, j) => ({ wall: 'inner' as Wall, angle: ((j + 0.5) * turn) / innerBays })),
  ].sort((x, y) => x.angle - y.angle);
  return {
    innerRadius,
    outerRadius,
    walkRadius: innerRadius + ROOM.corridor * ROOM.walkLane,
    outerBays,
    innerBays,
    repeats,
    unit: turn / (outerBays + innerBays),
    slots: positions.slice(0, prints).map((p, i) => ({ photoIndex: i % Math.max(1, photos), ...p })),
  };
}

export interface Point {
  x: number;
  z: number;
}

/** Where a print hangs: the point on the wall behind its centre, and the wall's normal into the corridor. */
export interface Mount extends Point {
  nx: number;
  nz: number;
}

/** A place on the concave outer wall, at angle θ: it faces the centre of the room. */
export function outerMount(radius: number, angle: number): Mount {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return { x: radius * s, z: radius * c, nx: -s, nz: -c };
}

/** An inner print's stretch of wall, seen from above. */
export interface Facet {
  /** Where it leaves the curved wall, on the side the visitor walks up from. */
  start: Point;
  /** Its far end, standing out into the corridor. */
  tip: Point;
  /** Where the short return from the tip meets the curved wall again. */
  foot: Point;
  /** The middle of its face, where the print hangs. */
  mount: Mount;
  /** How far from the centre of the room the tip stands. */
  reach: number;
}

/**
 * The stretch of inner wall an inner print hangs on, `length` long and centred at angle θ. The curved inner
 * wall is convex, so a print hung flat on it faces the visitor only once they are beside it, outside a
 * portrait phone's view. This stretch is straight and turned `ROOM.facetTurn` from the curve towards the
 * visitor walking up to it (forward, the way the view always faces): its near end on the curve, its far end
 * standing out, and a short return from there straight back to the curve. In a row they make a gentle sawtooth.
 */
export function facet(innerRadius: number, angle: number, length: number = ROOM.facetLength): Facet {
  const turn = ROOM.facetTurn;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const half = length / 2;
  const across = half * Math.cos(turn);
  // The face's middle, out from the centre far enough that its near end lands on the curve.
  const out = Math.sqrt(Math.max(0, innerRadius ** 2 - across ** 2)) + half * Math.sin(turn);
  // Along the face (forward and outward), and its normal (outward and back towards the visitor).
  const dx = Math.cos(turn) * c + Math.sin(turn) * s;
  const dz = -Math.cos(turn) * s + Math.sin(turn) * c;
  const mount = { x: out * s, z: out * c, nx: Math.cos(turn) * s - Math.sin(turn) * c, nz: Math.cos(turn) * c + Math.sin(turn) * s };
  const start = { x: mount.x - dx * half, z: mount.z - dz * half };
  const tip = { x: mount.x + dx * half, z: mount.z + dz * half };
  const reach = Math.hypot(tip.x, tip.z);
  return { start, tip, foot: { x: (tip.x * innerRadius) / reach, z: (tip.z * innerRadius) / reach }, mount, reach };
}

/**
 * How far from the centre of the room the inner wall's corridor side is at angle θ: the curve, or an angled
 * stretch standing out from it. Camera poses stay outside this.
 */
export function innerSurface(innerRadius: number, facets: readonly Facet[], angle: number): number {
  const ux = Math.sin(angle);
  const uz = Math.cos(angle);
  let surface = innerRadius;
  for (const f of facets) {
    const ex = f.tip.x - f.start.x;
    const ez = f.tip.z - f.start.z;
    const denom = ux * ez - uz * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (f.start.x * ez - f.start.z * ex) / denom;
    const along = (f.start.x * uz - f.start.z * ux) / denom;
    if (t > 0 && along >= 0 && along <= 1) surface = Math.max(surface, t);
  }
  return surface;
}

/**
 * The inner wall seen from above, as a closed outline in order of angle: the curve, and out round each angled
 * stretch where one stands (its start, tip and foot). Arcs of the curve are cut into pieces at most a
 * `segments`th of a turn. The picture rail and the skirting follow it. `facets` must be in order of angle
 * and not overlap, as the room's are.
 */
export function innerOutline(innerRadius: number, facets: readonly Facet[], segments: number): Point[] {
  const turn = Math.PI * 2;
  const step = turn / segments;
  const at = (angle: number): Point => ({ x: innerRadius * Math.sin(angle), z: innerRadius * Math.cos(angle) });
  const angleOf = (p: Point) => Math.atan2(p.x, p.z);
  /** The curve strictly between two angles, `to` after `from`. */
  const arc = (from: number, to: number): Point[] => {
    const pieces = Math.max(1, Math.ceil((to - from) / step));
    return Array.from({ length: pieces - 1 }, (_, j) => at(from + ((to - from) * (j + 1)) / pieces));
  };
  if (facets.length === 0) return Array.from({ length: segments }, (_, i) => at(i * step));
  const outline: Point[] = [];
  let foot = angleOf(facets[facets.length - 1]!.foot);
  for (const f of facets) {
    const start = foot + wrapAngle(angleOf(f.start) - foot);
    outline.push(...arc(foot, start), f.start, f.tip, f.foot);
    foot = start + wrapAngle(angleOf(f.foot) - start);
  }
  return outline;
}

/**
 * For a closed wall outline seen from above, in order of angle: how far, and which way, to move each corner so
 * that every straight run of it moves one unit into the corridor. `towards` is 1 where the corridor is away
 * from the centre (the inner wall) and -1 where it is towards it (the outer). Mouldings along a wall are its
 * outline moved out by their depth.
 */
export function cornerOffsets(outline: readonly Point[], towards: 1 | -1): Point[] {
  const n = outline.length;
  /** The unit normal into the corridor of the run from corner i to the next. */
  const normal = (i: number): Point => {
    const a = outline[i % n]!;
    const b = outline[(i + 1) % n]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (towards * (a.z - b.z)) / length, z: (towards * (b.x - a.x)) / length };
  };
  return outline.map((_, i) => {
    const before = normal(i + n - 1);
    const after = normal(i);
    // Along the bisector, 1 / cos(half the turn) long, so both runs move exactly one unit.
    const scale = 1 / Math.max(0.1, 1 + before.x * after.x + before.z * after.z);
    return { x: (before.x + after.x) * scale, z: (before.z + after.z) * scale };
  });
}

/** The radii of the ceiling's two light slots: in from the outer wall, and out past the angled stretches' tips. */
export function lightSlots(innerRadius: number, outerRadius: number, facets: readonly Facet[]): { inner: number; outer: number } {
  const tips = facets.reduce((far, f) => Math.max(far, f.reach), innerRadius);
  return { inner: Math.max(innerRadius + ROOM.slotFromInner, tips + 0.3), outer: outerRadius - ROOM.slotFromOuter };
}

/** Where the line out from a print, along its wall's normal, passes under the light slot of this radius. */
export function underSlot(mount: Mount, radius: number): Point {
  // The line meets the circle twice; the light goes where it first does, out in front of the print.
  const along = mount.x * mount.nx + mount.z * mount.nz;
  const root = Math.sqrt(Math.max(0, along * along - (mount.x ** 2 + mount.z ** 2) + radius ** 2));
  const s = -along - root > 0 ? -along - root : -along + root;
  return { x: mount.x + mount.nx * s, z: mount.z + mount.nz * s };
}

/**
 * How far the walking view turns from the direction of travel towards the inner wall: 0.3 on a wide screen, as
 * in the example the room started from, up to 0.4 on a narrow portrait one. That brings each inner print into
 * view at the left as the visitor walks up to it, while the outer wall's run keeps the middle and right of the
 * screen; turned further, the inner wall took over a phone's view. `tanHalfWidth` is the tangent of half the
 * horizontal field of view.
 */
export function walkYaw(tanHalfWidth: number): number {
  const t = Math.min(1, Math.max(0, (tanHalfWidth - 0.32) / (0.85 - 0.32)));
  return 0.4 - 0.1 * t;
}

/** How far ahead of the visitor, as an angle, the print they are walking up to hangs. */
export function aheadAngle(plan: Pick<RoomPlan, 'walkRadius'>): number {
  return 3.4 / plan.walkRadius;
}

/** An angle folded into [0, 2π), for the map. */
export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}

/** A print's size on the wall: tall photos 1.7 high, wide ones 2.2 wide, panoramas up to 3. */
export function photoSize(width: number, height: number): { w: number; h: number } {
  const aspect = width > 0 && height > 0 ? width / height : 1.5;
  const maxW = aspect > 2 ? 3 : 2.2;
  const h = Math.min(1.7, maxW / aspect);
  return { w: h * aspect, h };
}

/**
 * The framed print, for a moulding `frameWidth` wide: the outer size of the frame and where the print sits in
 * it. The mat is deeper at the bottom, so the frame's centre is `centreY` below the print's.
 */
export function framedSize(w: number, h: number, frameWidth: number): { outerW: number; outerH: number; centreY: number } {
  const border = ROOM.mat + frameWidth;
  return { outerW: w + 2 * border, outerH: h + 2 * border + ROOM.matBottom, centreY: -ROOM.matBottom / 2 };
}

/** `target` plus whole turns, as close as possible to `current` (so the camera never spins the long way). */
export function nearestEquivalent(target: number, current: number): number {
  const turn = Math.PI * 2;
  return target + Math.round((current - target) / turn) * turn;
}

/** How much of the view's height and width a print (with its label) fills while the visitor stands at it. */
export const FOCUS_FILL = { h: 0.6, w: 0.74 } as const;

/**
 * How far from the wall to stand so the print fills at most `fill` of the view's height and width,
 * capped so the visitor stays inside a corridor `corridor` wide.
 */
export function focusDistance(w: number, h: number, fovYDeg: number, aspect: number, corridor: number = ROOM.corridor, fill = FOCUS_FILL): number {
  const tanY = Math.tan((fovYDeg * Math.PI) / 360);
  const tanX = tanY * aspect;
  const byHeight = h / fill.h / (2 * tanY);
  const byWidth = w / fill.w / (2 * tanX);
  return Math.min(Math.max(byHeight, byWidth, 2.2), corridor - 0.35);
}

/**
 * The vertical field of view, never narrower than `fovYDeg`, at which a print w × h seen from `distance`
 * fills at most `fill` of the view: wider only when the opposite wall stops the visitor stepping back far
 * enough, as for a wide print on a narrow portrait screen.
 */
export function fovToFit(w: number, h: number, distance: number, aspect: number, fovYDeg: number, fill = FOCUS_FILL): number {
  const tanY = Math.max(Math.tan((fovYDeg * Math.PI) / 360), h / fill.h / (2 * distance), w / fill.w / (2 * distance) / aspect);
  return (Math.atan(tanY) * 360) / Math.PI;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the lightbox will draw a photo, in CSS pixels, so the camera can step in until the print sits exactly
 * there before the lightbox fades in over it. Mirrors `.lightbox .yarl__container` and the info panel in
 * global.css: 64 px padding and a 340 px side panel from 768 px wide; on phones 56 px above, and the
 * details sheet (taken as 42% of the height) below. Never larger than the file's real pixels.
 */
export function lightboxRect(file: { width: number; height: number }, viewport: { width: number; height: number }, pixelRatio: number): Rect {
  const wide = viewport.width >= 768;
  const side = wide ? 64 : 0;
  const top = wide ? 64 : 56;
  const bottom = wide ? 64 : Math.round(viewport.height * 0.42);
  const panel = wide ? 340 : 0;
  const areaW = Math.max(1, viewport.width - panel - 2 * side);
  const areaH = Math.max(1, viewport.height - top - bottom);
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const scale = Math.min(areaW / file.width, areaH / file.height, 1 / ratio);
  const width = file.width * scale;
  const height = file.height * scale;
  return { x: side + (areaW - width) / 2, y: top + (areaH - height) / 2, width, height };
}

export const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeOutQuad = (t: number) => 1 - (1 - t) ** 2;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
