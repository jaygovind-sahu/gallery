import { describe, expect, it } from 'vitest';
import { appendPosition, MIN_GAP, positionBetween, renumber } from '../../src/lib/order';

describe('positionBetween', () => {
  it('inserts between two neighbours at the midpoint', () => {
    expect(positionBetween(1, 2)).toEqual({ position: 1.5, renumber: false });
    expect(positionBetween(3, 7)).toEqual({ position: 5, renumber: false });
  });
  it('inserts at the start', () => {
    expect(positionBetween(null, 1)).toEqual({ position: 0, renumber: false });
  });
  it('inserts at the end', () => {
    expect(positionBetween(5, null)).toEqual({ position: 6, renumber: false });
  });
  it('is 1 for an empty list', () => {
    expect(positionBetween(null, null)).toEqual({ position: 1, renumber: false });
  });
  it('asks for a renumber when the gap gets tiny', () => {
    const a = 1;
    const b = 1 + MIN_GAP / 2;
    const r = positionBetween(a, b);
    expect(r.renumber).toBe(true);
    expect(r.position).toBeGreaterThan(a);
    expect(r.position).toBeLessThan(b);
  });
  it('keeps halving without renumbering while the gap is comfortable', () => {
    let before = 1;
    const after = 2;
    for (let i = 0; i < 10; i++) {
      const r = positionBetween(before, after);
      expect(r.renumber).toBe(false);
      before = r.position;
    }
  });
});

describe('renumber / appendPosition', () => {
  it('assigns 1..n', () => {
    expect(renumber(['c', 'a', 'b'])).toEqual([
      { id: 'c', position: 1 },
      { id: 'a', position: 2 },
      { id: 'b', position: 3 },
    ]);
  });
  it('appends after the max', () => {
    expect(appendPosition(null)).toBe(1);
    expect(appendPosition(4.5)).toBe(5.5);
  });
});
