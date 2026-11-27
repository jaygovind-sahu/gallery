import { describe, expect, it } from 'vitest';
import { aheadAngle, focusDistance, framedSize, lightboxRect, nearestEquivalent, photoSize, planRoom, ROOM, wrapAngle } from '../../src/lib/walk';

const TURN = Math.PI * 2;

describe('planRoom', () => {
  it('has no prints for an empty gallery, but still the room at its natural size', () => {
    const plan = planRoom(0);
    expect(plan.slots).toEqual([]);
    expect(plan.innerRadius).toBe(ROOM.innerRadius);
    expect(plan.titleAngle).toBe(0);
  });

  it('repeats a small collection in whole runs, in order, to fill a room near its natural size', () => {
    const plan = planRoom(13);
    expect(plan.repeats).toBe(4);
    expect(plan.slots).toHaveLength(52);
    plan.slots.forEach((slot, i) => expect(slot.photoIndex).toBe(i % 13));
    expect(plan.innerRadius).toBeGreaterThan(ROOM.innerRadius * 0.8);
    expect(plan.innerRadius).toBeLessThan(ROOM.innerRadius * 1.25);
    expect(plan.outerBays - 1 + plan.innerBays - 52).toBeLessThan(3);
  });

  it('hangs a large collection once, in a room just big enough', () => {
    for (const count of [60, 200]) {
      const plan = planRoom(count);
      expect(plan.repeats).toBe(1);
      expect(plan.slots.map((s) => s.photoIndex)).toEqual([...Array(count).keys()]);
      expect(plan.innerRadius).toBeGreaterThanOrEqual(ROOM.innerRadius);
      expect(plan.outerBays - 1 + plan.innerBays - count).toBeLessThan(3);
    }
  });

  it('never shrinks the room below its smallest size', () => {
    for (const count of [1, 13, 30, 40, 46]) expect(planRoom(count).innerRadius).toBeGreaterThanOrEqual(ROOM.minInnerRadius);
  });

  it('keeps prints in order of angle round the ring, after the title, on both walls', () => {
    const plan = planRoom(40);
    for (let i = 0; i < plan.slots.length; i++) {
      expect(plan.slots[i]!.angle).toBeGreaterThan(plan.titleAngle);
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
