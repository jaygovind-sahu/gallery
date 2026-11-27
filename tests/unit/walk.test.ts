import { describe, expect, it } from 'vitest';
import { aheadAngle, focusDistance, framedSize, lightboxRect, nearestEquivalent, photoSize, planRoom, ROOM, walkYaw, wrapAngle } from '../../src/lib/walk';

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
    expect(plan.repeats).toBe(2);
    expect(plan.slots).toHaveLength(26);
    plan.slots.forEach((slot, i) => expect(slot.photoIndex).toBe(i % 13));
    expect(plan.innerRadius).toBeGreaterThan(ROOM.innerRadius * 0.8);
    expect(plan.innerRadius).toBeLessThan(ROOM.innerRadius * 1.25);
    expect(plan.bays - 1 - 26).toBeLessThan(2);
  });

  it('hangs a large collection once, in a room just big enough', () => {
    for (const count of [30, 60, 200]) {
      const plan = planRoom(count);
      expect(plan.repeats).toBe(1);
      expect(plan.slots.map((s) => s.photoIndex)).toEqual([...Array(count).keys()]);
      expect(plan.innerRadius).toBeGreaterThanOrEqual(ROOM.innerRadius);
      expect(plan.bays - 1 - count).toBeLessThan(2);
    }
  });

  it('never shrinks the room below its smallest size', () => {
    for (const count of [1, 5, 13, 20, 27]) expect(planRoom(count).innerRadius).toBeGreaterThanOrEqual(ROOM.minInnerRadius);
  });

  it('hangs prints one to a bay round the outer wall, in order, after the title', () => {
    const plan = planRoom(20);
    plan.slots.forEach((slot, i) => {
      expect(slot.angle).toBeCloseTo(((i + 1) * TURN) / plan.bays);
      expect(slot.angle).toBeGreaterThan(plan.titleAngle);
      expect(slot.angle).toBeLessThan(TURN);
    });
    expect(plan.unit).toBeCloseTo(TURN / plan.bays);
  });

  it('spaces the prints a little more than the spacing apart along the outer wall', () => {
    for (const count of [13, 60, 200]) {
      const plan = planRoom(count);
      const arc = (TURN * plan.outerRadius) / plan.bays;
      expect(arc).toBeGreaterThanOrEqual(ROOM.spacing);
      expect(arc).toBeLessThan(ROOM.spacing * 1.2);
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

describe('walkYaw', () => {
  it('turns until the inner wall takes the given share of the view at the left', () => {
    const plan = planRoom(13);
    const tangent = Math.acos(plan.innerRadius / plan.walkRadius);
    for (const tanHalfWidth of [0.27, 0.34, 0.85, 1.3]) {
      const yaw = walkYaw(plan, tanHalfWidth, 0.08);
      // Where the inner wall's edge lands across the view: -1 is the left edge, 1 the right.
      const x = -Math.tan(tangent - yaw) / tanHalfWidth;
      expect((x + 1) / 2).toBeCloseTo(0.08);
    }
  });

  it('turns further on a narrow portrait screen than on a wide one', () => {
    const plan = planRoom(13);
    const phone = walkYaw(plan, 0.27);
    const desktop = walkYaw(plan, 0.85);
    expect(phone).toBeGreaterThan(desktop);
    expect(phone).toBeGreaterThan(0.3);
    expect(phone).toBeLessThan(0.6);
    expect(desktop).toBeGreaterThan(-0.1);
    expect(desktop).toBeLessThan(0.3);
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
