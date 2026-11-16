/** Pure helpers for upload verification, kept free of Worker imports so they can be unit-tested. */

export interface BrowserHint {
  width: number;
  height: number;
  /** EXIF orientation 1–8 if the browser read one. */
  orientation?: number | null;
}

/**
 * The binding reports the stored pixel grid; the browser reports the display size after EXIF rotation.
 * If they describe the same grid (possibly swapped), keep the browser's orientation of the server's numbers.
 * Otherwise the browser was wrong: use the server's numbers, swapped if EXIF says the image is rotated.
 */
export function reconcileDimensions(serverW: number, serverH: number, hint: BrowserHint): { width: number; height: number } {
  const sameGrid =
    (hint.width === serverW && hint.height === serverH) || (hint.width === serverH && hint.height === serverW);
  if (sameGrid) return { width: hint.width, height: hint.height };
  const rotated = hint.orientation !== undefined && hint.orientation !== null && hint.orientation >= 5;
  return rotated ? { width: serverH, height: serverW } : { width: serverW, height: serverH };
}
