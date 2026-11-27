import { describe, expect, it } from 'vitest';
import {
  aheadAngle,
  cornerOffsets,
  facet,
  FOCUS_FILL,
  focusDistance,
  fovToFit,
  framedSize,
  innerOutline,
  innerSurface,
  lightboxRect,
  lightSlots,
  nearestEquivalent,
  outerMount,
  photoSize,
  planRoom,
  ROOM,
  underSlot,
  walkYaw,
  wrapAngle,
} from '../../src/lib/walk';

const TURN = Math.PI * 2;

describe('planRoom', () => {
  it('has no prints for an empty gallery, but still the room at its natural size', () => {
    const plan = planRoom(0);
    expect(plan.slots).toEqual([]);
    expect(plan.innerRadius).toBe(ROOM.innerRadius);
  });

  it('repeats a small collection in whole runs, in order, to fill a room near its natural size', () => {
    const plan = planRoom(13);
    expect(plan.repeats).toBe(4);
    expect(plan.slots).toHaveLength(52);
    plan.slots.forEach((slot, i) => expect(slot.photoIndex).toBe(i % 13));
    expect(plan.innerRadius).toBeGreaterThan(ROOM.innerRadius * 0.8);
    expect(plan.innerRadius).toBeLessThan(ROOM.innerRadius * 1.25);
    expect(plan.outerBays + plan.innerBays).toBe(52);
  });

  it('hangs a large collection once, in a room just big enough', () => {
    for (const count of [60, 200]) {
      const plan = planRoom(count);
      expect(plan.repeats).toBe(1);
      expect(plan.slots.map((s) => s.photoIndex)).toEqual([...Array(count).keys()]);
      expect(plan.innerRadius).toBeGreaterThanOrEqual(ROOM.innerRadius);
      expect(plan.outerBays + plan.innerBays).toBe(count);
    }
  });

  it('never shrinks the room below its smallest size', () => {
    for (const count of [1, 13, 30, 40, 46]) expect(planRoom(count).innerRadius).toBeGreaterThanOrEqual(ROOM.minInnerRadius);
  });

  it('hangs a print in every bay, with no gap anywhere round the ring', () => {
    for (let count = 1; count <= 150; count++) {
      const plan = planRoom(count);
      expect(plan.slots).toHaveLength(plan.outerBays + plan.innerBays);
      expect(plan.slots).toHaveLength(count * plan.repeats);
      for (const arc of [(TURN * plan.outerRadius) / plan.outerBays, (TURN * plan.innerRadius) / plan.innerBays]) {
        expect(arc).toBeGreaterThanOrEqual(ROOM.spacing);
        expect(arc).toBeLessThan(ROOM.spacing * 1.2);
      }
    }
  });

  it('hangs the first photo on the outer wall where the visitor arrives, at angle 0', () => {
    for (const count of [1, 13, 40, 200]) expect(planRoom(count).slots[0]).toEqual({ photoIndex: 0, wall: 'outer', angle: 0 });
  });

  it('keeps prints in order of angle round the ring, on both walls', () => {
    const plan = planRoom(40);
    for (let i = 0; i < plan.slots.length; i++) {
      expect(plan.slots[i]!.angle).toBeGreaterThanOrEqual(0);
      expect(plan.slots[i]!.angle).toBeLessThan(TURN);
      if (i > 0) expect(plan.slots[i]!.angle).toBeGreaterThanOrEqual(plan.slots[i - 1]!.angle);
    }
    expect(plan.slots.some((s) => s.wall === 'inner')).toBe(true);
    expect(plan.slots.some((s) => s.wall === 'outer')).toBe(true);
  });

  it('spaces both walls the same distance apart, so the longer outer wall holds more', () => {
    for (const count of [13, 60, 200]) {
      const plan = planRoom(count);
      for (const arc of [(TURN * plan.outerRadius) / plan.outerBays, (TURN * plan.innerRadius) / plan.innerBays]) {
        expect(arc).toBeGreaterThanOrEqual(ROOM.spacing);
        expect(arc).toBeLessThan(ROOM.spacing * 1.2);
      }
      expect(plan.outerBays).toBeGreaterThan(plan.innerBays);
    }
  });

  it('keeps the corridor width and walks between the walls, well clear of the inner one', () => {
    for (const count of [13, 60]) {
      const plan = planRoom(count);
      expect(plan.outerRadius - plan.innerRadius).toBeCloseTo(ROOM.corridor);
      expect(plan.walkRadius - plan.innerRadius).toBeGreaterThan(3);
      expect(plan.walkRadius).toBeLessThan(plan.outerRadius);
      expect(aheadAngle(plan) * plan.walkRadius).toBeCloseTo(3.4);
    }
  });
});

describe('outerMount and facet', () => {
  const dot = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.x + a.z * b.z;

  it('faces an outer print towards the centre of the room', () => {
    const m = outerMount(18, 1.1);
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(18);
    expect(m.nx * Math.sin(1.1) + m.nz * Math.cos(1.1)).toBeCloseTo(-1);
  });

  it('runs an inner print\'s stretch of wall from the curve out into the corridor, the length asked for', () => {
    for (const length of [ROOM.facetLength, 4]) {
      const f = facet(12.2, 0.7, length);
      expect(Math.hypot(f.start.x, f.start.z)).toBeCloseTo(12.2);
      expect(Math.hypot(f.foot.x, f.foot.z)).toBeCloseTo(12.2);
      expect(Math.hypot(f.tip.x - f.start.x, f.tip.z - f.start.z)).toBeCloseTo(length);
      expect(f.reach).toBeGreaterThan(12.2 + 0.8);
      // The print hangs in the middle of the face.
      expect(f.mount.x).toBeCloseTo((f.start.x + f.tip.x) / 2);
      expect(f.mount.z).toBeCloseTo((f.start.z + f.tip.z) / 2);
    }
  });

  it('turns the face from the curve towards the visitor walking up to it', () => {
    const angle = 0.7;
    const f = facet(12.2, angle, ROOM.facetLength);
    const radial = { x: Math.sin(angle), z: Math.cos(angle) };
    const forward = { x: Math.cos(angle), z: -Math.sin(angle) };
    const normal = { x: f.mount.nx, z: f.mount.nz };
    expect(Math.hypot(normal.x, normal.z)).toBeCloseTo(1);
    expect(dot(normal, radial)).toBeCloseTo(Math.cos(ROOM.facetTurn));
    // Back along the walk, towards where the visitor comes from.
    expect(dot(normal, forward)).toBeCloseTo(-Math.sin(ROOM.facetTurn));
    expect(Math.atan2(f.mount.x, f.mount.z)).toBeCloseTo(angle);
  });

  it('leaves the walk clear of every angled stretch, and they never overlap', () => {
    for (const count of [13, 60]) {
      const plan = planRoom(count);
      const inner = plan.slots.filter((s) => s.wall === 'inner');
      const facets = inner.map((s) => facet(plan.innerRadius, s.angle, 4));
      for (const f of facets) expect(plan.walkRadius - f.reach).toBeGreaterThan(1.5);
      const span = (f: ReturnType<typeof facet>) => [wrapAngle(Math.atan2(f.start.x, f.start.z)), wrapAngle(Math.atan2(f.foot.x, f.foot.z))];
      for (let i = 1; i < facets.length; i++) expect(span(facets[i]!)[0]).toBeGreaterThan(span(facets[i - 1]!)[1]);
    }
  });
});

describe('innerSurface', () => {
  it('is the curve away from the angled stretches, and stands out to the tip across one', () => {
    const f = facet(12.2, 1, ROOM.facetLength);
    expect(innerSurface(12.2, [f], 2)).toBe(12.2);
    expect(innerSurface(12.2, [f], 1)).toBeCloseTo(Math.hypot(f.mount.x, f.mount.z));
    expect(innerSurface(12.2, [f], Math.atan2(f.tip.x, f.tip.z) - 1e-6)).toBeCloseTo(f.reach, 3);
    expect(innerSurface(12.2, [f], Math.atan2(f.start.x, f.start.z) + 1e-6)).toBeCloseTo(12.2, 3);
  });
});

describe('innerOutline and cornerOffsets', () => {
  const radius = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
  const roomWithFacets = (count: number) => {
    const plan = planRoom(count);
    const facets = plan.slots.filter((s) => s.wall === 'inner').map((s) => facet(plan.innerRadius, s.angle, ROOM.facetLength));
    return { plan, facets };
  };

  it('is the plain curve when no stretch stands out from it', () => {
    const outline = innerOutline(12.2, [], 100);
    expect(outline).toHaveLength(100);
    for (const p of outline) expect(radius(p)).toBeCloseTo(12.2);
  });

  it('runs along the curve and out round every angled stretch, in order of angle', () => {
    const { plan, facets } = roomWithFacets(13);
    const segments = 200;
    const outline = innerOutline(plan.innerRadius, facets, segments);
    for (const f of facets) {
      const i = outline.indexOf(f.start);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(outline[i + 1]).toBe(f.tip);
      expect(outline[i + 2]).toBe(f.foot);
    }
    const corners = new Set(facets.flatMap((f) => [f.tip]));
    let angle = -Infinity;
    let unwound = 0;
    outline.forEach((p, i) => {
      if (!corners.has(p)) expect(radius(p)).toBeCloseTo(plan.innerRadius);
      let a = Math.atan2(p.x, p.z) + unwound;
      if (a < angle - 1) {
        unwound += TURN;
        a += TURN;
      }
      expect(a).toBeGreaterThanOrEqual(angle - 1e-9);
      if (i > 0 && !corners.has(p) && !corners.has(outline[i - 1]!)) expect(a - angle).toBeLessThanOrEqual(TURN / segments + 1e-9);
      angle = a;
    });
    expect(unwound).toBe(TURN);
  });

  it('moves every run of a wall exactly one unit into the corridor', () => {
    const { plan, facets } = roomWithFacets(13);
    const outline = innerOutline(plan.innerRadius, facets, 200);
    const offsets = cornerOffsets(outline, 1);
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      // Signed distance of both moved ends from the run's own line, on the corridor side.
      for (const [p, o] of [[a, offsets[i]!], [b, offsets[(i + 1) % outline.length]!]] as const) {
        const side = ((a.z - b.z) * (p.x + o.x - a.x) + (b.x - a.x) * (p.z + o.z - a.z)) / length;
        expect(side).toBeCloseTo(1);
      }
    });
    // On the outer wall the corridor is towards the centre.
    const ring = Array.from({ length: 90 }, (_, i) => ({ x: 18 * Math.sin((TURN * i) / 90), z: 18 * Math.cos((TURN * i) / 90) }));
    cornerOffsets(ring, -1).forEach((o, i) => expect(radius({ x: ring[i]!.x + o.x, z: ring[i]!.z + o.z })).toBeLessThan(18 - 0.99));
  });
});

describe('lightSlots and underSlot', () => {
  it('runs one slot in from the outer wall and one clear of the angled stretches, either side of the walk', () => {
    for (const count of [13, 60]) {
      const plan = planRoom(count);
      const facets = plan.slots.filter((s) => s.wall === 'inner').map((s) => facet(plan.innerRadius, s.angle, 4));
      const slots = lightSlots(plan.innerRadius, plan.outerRadius, facets);
      expect(slots.outer).toBeCloseTo(plan.outerRadius - ROOM.slotFromOuter);
      expect(slots.inner).toBeGreaterThanOrEqual(plan.innerRadius + ROOM.slotFromInner);
      for (const f of facets) expect(slots.inner - f.reach).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(slots.inner).toBeLessThan(plan.walkRadius);
      expect(slots.outer).toBeGreaterThan(plan.walkRadius);
    }
  });

  it('puts each light square on to its print, under its wall\'s slot', () => {
    const outer = outerMount(18, 0.4);
    const spot = underSlot(outer, 18 - ROOM.slotFromOuter);
    expect(Math.hypot(spot.x - outer.x, spot.z - outer.z)).toBeCloseTo(ROOM.slotFromOuter);
    expect(Math.atan2(spot.x, spot.z)).toBeCloseTo(0.4);
    const f = facet(12.2, 1, ROOM.facetLength);
    const inner = underSlot(f.mount, 14);
    expect(Math.hypot(inner.x, inner.z)).toBeCloseTo(14);
    const dx = inner.x - f.mount.x;
    const dz = inner.z - f.mount.z;
    expect(dx * f.mount.nz - dz * f.mount.nx).toBeCloseTo(0);
    expect(dx * f.mount.nx + dz * f.mount.nz).toBeGreaterThan(0);
  });
});

describe('walkYaw', () => {
  it('turns further towards the inner wall on a narrow portrait screen than on a wide one, within bounds', () => {
    const phone = walkYaw(0.32);
    const desktop = walkYaw(0.85);
    expect(phone).toBeCloseTo(0.4);
    expect(desktop).toBeCloseTo(0.3);
    expect(walkYaw(0.55)).toBeGreaterThan(desktop);
    expect(walkYaw(0.55)).toBeLessThan(phone);
    expect(walkYaw(0.1)).toBe(phone);
    expect(walkYaw(2)).toBe(desktop);
  });
});

describe('wrapAngle and nearestEquivalent', () => {
  it('folds any angle into one turn', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(TURN + 1)).toBeCloseTo(1);
    expect(wrapAngle(-1)).toBeCloseTo(TURN - 1);
  });

  it('adds whole turns to land closest to the current angle', () => {
    expect(nearestEquivalent(0.1, 3 * TURN + 0.2)).toBeCloseTo(3 * TURN + 0.1);
    expect(nearestEquivalent(0.1, -TURN)).toBeCloseTo(-TURN + 0.1);
    expect(nearestEquivalent(TURN - 0.1, 0)).toBeCloseTo(-0.1);
  });
});

describe('photoSize and framedSize', () => {
  it('keeps the aspect ratio within the size limits', () => {
    expect(photoSize(3000, 2000)).toEqual({ w: 2.2, h: 2.2 / 1.5 });
    const portrait = photoSize(2000, 3000);
    expect(portrait.h).toBe(1.7);
    expect(portrait.w).toBeCloseTo(1.7 / 1.5);
    expect(photoSize(1000, 1000)).toEqual({ w: 1.7, h: 1.7 });
    expect(photoSize(4000, 1000).w).toBeCloseTo(3);
    expect(photoSize(0, 0).w / photoSize(0, 0).h).toBeCloseTo(1.5);
  });

  it('adds the mat and moulding on every side, and the deeper bottom mat', () => {
    const border = ROOM.mat + 0.09;
    const framed = framedSize(2.2, 1.4, 0.09);
    expect(framed.outerW).toBeCloseTo(2.2 + 2 * border);
    expect(framed.outerH).toBeCloseTo(1.4 + 2 * border + ROOM.matBottom);
    expect(framed.centreY).toBeCloseTo(-ROOM.matBottom / 2);
  });

  it('leaves a gap between the widest framed prints, even in the widest moulding', () => {
    expect(ROOM.spacing - framedSize(2.2, 1.4, 0.12).outerW).toBeGreaterThan(0.4);
  });
});

describe('focusDistance', () => {
  it('stands far enough back for the print to fit, but stays inside the corridor', () => {
    const near = focusDistance(1.3, 1.95, 56, 16 / 9);
    expect(near).toBeGreaterThan(2.2);
    expect(near).toBeLessThanOrEqual(ROOM.corridor - 0.35);
    expect(focusDistance(3.4, 1, 62, 0.46)).toBe(ROOM.corridor - 0.35);
    expect(focusDistance(3.4, 1, 62, 0.46, 5)).toBe(5 - 0.35);
  });
});

describe('fovToFit', () => {
  it('keeps the screen\'s view when the print already fits from where the visitor stands', () => {
    const d = focusDistance(2.7, 2.1, 56, 1.6);
    expect(fovToFit(2.7, 2.1, d, 1.6, 56)).toBeCloseTo(56);
  });

  it('widens the view just enough when the visitor can\'t step back far enough', () => {
    const fov = fovToFit(2.7, 2.1, 4, 0.46, 70);
    expect(fov).toBeGreaterThan(70);
    const tanX = Math.tan((fov * Math.PI) / 360) * 0.46;
    expect(2.7 / (2 * 4 * tanX)).toBeCloseTo(FOCUS_FILL.w);
  });
});

describe('lightboxRect', () => {
  it('fits the photo beside the info panel inside the padding on a wide screen', () => {
    const rect = lightboxRect({ width: 2400, height: 1600 }, { width: 1440, height: 900 }, 1);
    const areaW = 1440 - 340 - 128;
    expect(rect.width).toBeCloseTo(areaW);
    expect(rect.height).toBeCloseTo(areaW / 1.5);
    expect(rect.x).toBeCloseTo(64);
    expect(rect.y + rect.height / 2).toBeCloseTo(450);
  });

  it('never draws a file larger than its real pixels', () => {
    const rect = lightboxRect({ width: 1600, height: 1067 }, { width: 2560, height: 1440 }, 2);
    expect(rect.width).toBeCloseTo(800);
    expect(rect.height).toBeCloseTo(533.5);
  });

  it('sits above the details sheet on a phone', () => {
    const rect = lightboxRect({ width: 1600, height: 2400 }, { width: 412, height: 915 }, 2.6);
    expect(rect.y).toBeGreaterThanOrEqual(56);
    expect(rect.y + rect.height).toBeLessThanOrEqual(915 - Math.round(915 * 0.42) + 0.01);
  });
});
