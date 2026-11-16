/**
 * Fractional ordering (docs/DESIGN.md, "Data model → Rules").
 * A drag inserts at the midpoint of its neighbours; when gaps get below MIN_GAP the list is renumbered 1..n.
 */
export const MIN_GAP = 1e-6;

export interface Placement {
  position: number;
  /** True when the neighbours were too close: the caller should renumber the whole list. */
  renumber: boolean;
}

/**
 * Position for an item placed between `before` (the item it should follow) and `after` (the item it should precede).
 * Either may be null: null `before` = start of the list, null `after` = end of the list.
 */
export function positionBetween(before: number | null, after: number | null): Placement {
  if (before === null && after === null) return { position: 1, renumber: false };
  if (before === null) return { position: (after as number) - 1, renumber: false };
  if (after === null) return { position: before + 1, renumber: false };
  const gap = after - before;
  if (!(gap > MIN_GAP)) return { position: before + gap / 2, renumber: true };
  return { position: before + gap / 2, renumber: false };
}

/** Assign positions 1..n to an ordered list of ids. */
export function renumber<T extends string>(idsInOrder: readonly T[]): Array<{ id: T; position: number }> {
  return idsInOrder.map((id, i) => ({ id, position: i + 1 }));
}

/** Next position for an item appended to a list (newest last). */
export function appendPosition(currentMax: number | null): number {
  return currentMax === null ? 1 : currentMax + 1;
}
