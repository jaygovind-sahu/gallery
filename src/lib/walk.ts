/**
 * Pure geometry for the walk-through: a ring-shaped corridor with framed prints on both walls, evenly spaced
 * along each, and the title on the outer wall, which the visitor can walk round forever. No DOM or three.js
 * imports, so it runs in unit tests. World units are roughly metres.
 *
 * Angles follow three.js's CylinderGeometry: a point at angle θ and radius r is (r·sinθ, y, r·cosθ).
 * Walking forward increases the angle; the inner wall is then on the visitor's left.
 */

export type Wall = 'outer' | 'inner';

export const ROOM = {
  /** Distance between the inner and outer walls. */
  corridor: 6,
  wallHeight: 4.6,
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
  photoY: 1.92,
  eyeY: 1.72,
  /** Where along the corridor the visitor walks: 0 is the inner wall, 1 the outer. */
  walkLane: 0.58,
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
  /** Bays round each whole wall, evenly spaced; the outer wall's bay 0 is the title. */
  outerBays: number;
  innerBays: number;
  /** How many times each photo hangs round the room: more than once only in a small collection. */
  repeats: number;
  /** Average angle between neighbouring prints (either wall), for measuring distances in prints. */
  unit: number;
  /** On the outer wall: the exhibition title, where the visitor arrives and each lap begins. */
  titleAngle: number;
  /** Every print round the room, by angle: the photos in order, again and again for a small collection. */
  slots: Slot[];
}

/**
 * Bays every `ROOM.spacing` along each wall (so the longer outer wall has more of them). The title takes the
 * outer wall's bay 0; prints fill the rest in order of angle, so walking forward passes the photos in order,
 * on whichever wall comes next.
 *
 * The room keeps close to its natural size. A collection that would leave it more than half empty repeats,
 * in whole runs, as many times as fills it best, and the room is sized to fit them exactly; a larger one
 * hangs once, in a room just big enough. Any spare bays (rounding) are blank wall before the title.
 */
export function planRoom(count: number): RoomPlan {
  const photos = Math.max(0, count);
  const turn = Math.PI * 2;
  const bays = (r: number) => Math.floor((turn * r) / ROOM.spacing);
  /** Prints a room of inner radius r holds, the title's bay aside. */
  const capacity = (r: number) => bays(r) + bays(r + ROOM.corridor) - 1;
  const natural = capacity(ROOM.innerRadius);
  const repeats = photos > 0 && photos < natural ? Math.max(1, Math.round(natural / photos)) : 1;
  const prints = photos * repeats;
  let innerRadius: number = photos >= natural ? ROOM.innerRadius : ROOM.minInnerRadius;
  if (photos === 0) innerRadius = ROOM.innerRadius;
  while (capacity(innerRadius) < prints) innerRadius += 0.05;
  const outerRadius = innerRadius + ROOM.corridor;
  const outerBays = bays(outerRadius);
  const innerBays = bays(innerRadius);
  const positions = [
    ...Array.from({ length: outerBays - 1 }, (_, j) => ({ wall: 'outer' as Wall, angle: ((j + 1) * turn) / outerBays })),
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
    titleAngle: 0,
    slots: positions.slice(0, prints).map((p, i) => ({ photoIndex: i % Math.max(1, photos), ...p })),
  };
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

/**
 * How far from the wall to stand so the print fills at most `fill` of the view's height and width,
 * capped so the visitor stays inside a corridor `corridor` wide.
 */
export function focusDistance(w: number, h: number, fovYDeg: number, aspect: number, corridor: number = ROOM.corridor, fill = { h: 0.6, w: 0.74 }): number {
  const tanY = Math.tan((fovYDeg * Math.PI) / 360);
  const tanX = tanY * aspect;
  const byHeight = h / fill.h / (2 * tanY);
  const byWidth = w / fill.w / (2 * tanX);
  return Math.min(Math.max(byHeight, byWidth, 2.2), corridor - 0.35);
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
