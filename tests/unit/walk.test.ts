import { describe, expect, it } from 'vitest';
import { aheadAngle, focusDistance, framedSize, lightboxRect, nearestEquivalent, photoSize, planRoom, ROOM, wrapAngle } from '../../src/lib/walk';

const TURN = Math.PI * 2;

describe('planRoom', () => {
  it('has no prints for an empty gallery, but still a ring with the title', () => {
    const plan = planRoom(0);
    expect(plan.slots).toEqual([]);
    expect(plan.outerBays).toBeGreaterThan(0);
    expect(plan.titleAngle).toBe(0);
  });

  it('hangs every photo once, in order of angle round the ring, after the title', () => {
    const plan = planRoom(40);
    expect(plan.slots.map((s) => s.photoIndex)).toEqual([...Array(40).keys()]);
    for (let i = 0; i < 40; i++) {
      expect(plan.slots[i]!.angle).toBeGreaterThan(plan.titleAngle);
      expect(plan.slots[i]!.angle).toBeLessThan(TURN);
      if (i > 0) expect(plan.slots[i]!.angle).toBeGreaterThanOrEqual(plan.slots[i - 1]!.angle);
    }
  });

  it('spaces both walls the same distance apart, so the longer outer wall holds more', () => {
    for (const count of [48, 120, 300]) {
      const plan = planRoom(count);
      const outerArc = (TURN * plan.outerRadius) / plan.outerBays;
      const innerArc = (TURN * plan.innerRadius) / plan.innerBays;
      for (const arc of [outerArc, innerArc]) {
        expect(arc).toBeGreaterThanOrEqual(ROOM.spacing);
        expect(arc).toBeLessThan(ROOM.spacing * 1.2);
      }
      expect(plan.outerBays).toBeGreaterThan(plan.innerBays);
      expect(plan.corridor).toBe(ROOM.corridor);
      expect(plan.slots.some((s) => s.wall === 'inner')).toBe(true);
      expect(plan.slots.some((s) => s.wall === 'outer')).toBe(true);
    }
  });

  it('makes the ring just big enough for a large set, with room for the title', () => {
    for (const count of [48, 120, 300]) {
      const plan = planRoom(count);
      const capacity = plan.outerBays - 1 + plan.innerBays;
      expect(capacity).toBeGreaterThanOrEqual(count);
      expect(capacity - count).toBeLessThan(4);
    }
  });

  it('hangs a small set on the outer wall only, round a column, at the same spacing and nearly full', () => {
    for (const count of [5, 13, 20]) {
      const plan = planRoom(count);
      expect(plan.innerBays).toBe(0);
      expect(plan.slots.every((s) => s.wall === 'outer')).toBe(true);
      const arc = (TURN * plan.outerRadius) / plan.outerBays;
      expect(arc).toBeGreaterThanOrEqual(ROOM.spacing);
      expect(arc).toBeLessThan(ROOM.spacing * 1.2);
      expect(plan.innerRadius).toBeGreaterThanOrEqual(ROOM.minColumnRadius - 1e-9);
      expect(plan.corridor).toBeLessThanOrEqual(ROOM.columnCorridor);
    }
    const thirteen = planRoom(13);
    expect(thirteen.outerBays - 1 - 13).toBeLessThan(2);
  });

  it('keeps a very small set in the smallest room, the spare bays blank at the end of the lap', () => {
    const plan = planRoom(3);
    expect(plan.outerRadius).toBe(ROOM.minOuterRadius);
    expect(plan.slots).toHaveLength(3);
    expect(plan.slots[2]!.angle).toBeLessThan(Math.PI);
  });

  it('switches to two walls once a set is big enough to fill them', () => {
    expect(planRoom(40).innerBays).toBeGreaterThan(0);
  });

  it('walks between the walls', () => {
    for (const count of [13, 60]) {
      const plan = planRoom(count);
      expect(plan.outerRadius - plan.innerRadius).toBeCloseTo(plan.corridor);
      expect(plan.walkRadius).toBeGreaterThan(plan.innerRadius);
      expect(plan.walkRadius).toBeLessThan(plan.outerRadius);
      expect(aheadAngle(plan) * plan.walkRadius).toBeCloseTo(3.4);
    }
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
