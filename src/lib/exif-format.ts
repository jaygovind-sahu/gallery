/**
 * Formatting of stored EXIF values for display (docs/DESIGN.md, "Lightbox → Info panel").
 * Every helper returns null for a missing value so callers can omit it rather than show a blank.
 */

export function formatShutter(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !(seconds > 0)) return null;
  if (seconds >= 1) {
    const s = Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 10) / 10);
    return `${s} s`;
  }
  const denominator = Math.round(1 / seconds);
  return `1/${denominator} s`;
}

export function formatAperture(f: number | null | undefined): string | null {
  if (f === null || f === undefined || !(f > 0)) return null;
  return `f/${Math.round(f * 10) / 10}`;
}

export function formatFocalLength(mm: number | null | undefined): string | null {
  if (mm === null || mm === undefined || !(mm > 0)) return null;
  return `${Math.round(mm)} mm`;
}

export function formatIso(iso: number | null | undefined): string | null {
  if (iso === null || iso === undefined || !(iso > 0)) return null;
  return `ISO ${Math.round(iso)}`;
}

export function formatExposureComp(ev: number | null | undefined): string | null {
  if (ev === null || ev === undefined || Number.isNaN(ev) || ev === 0) return null;
  const rounded = Math.round(ev * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded} EV`;
}

/** "NIKON CORPORATION" + "NIKON Z50_2" → "Nikon Z50II"-style cleanup is vendor specific; do the safe parts only. */
export function cleanCamera(make: string | null | undefined, model: string | null | undefined): string | null {
  const m = (model ?? '').trim();
  const mk = (make ?? '').trim();
  if (!m && !mk) return null;
  if (!m) return titleCaseBrand(mk);
  const brand = titleCaseBrand(mk.split(/\s+/)[0] ?? '');
  // Model strings often repeat the brand ("NIKON Z 8", "Canon EOS R5"); don't print it twice.
  if (brand && m.toLowerCase().startsWith(brand.toLowerCase())) {
    return `${brand}${m.slice(brand.length)}`.replace(/\s+/g, ' ').trim();
  }
  return brand ? `${brand} ${m}` : m;
}

export function cleanLens(lens: string | null | undefined): string | null {
  const l = (lens ?? '').trim().replace(/\s+/g, ' ');
  return l ? l : null;
}

function titleCaseBrand(s: string): string {
  if (!s) return '';
  const upper = s.toUpperCase();
  if (upper !== s) return s; // already mixed case ("Canon", "FUJIFILM" stays below)
  const known: Record<string, string> = { NIKON: 'Nikon', CANON: 'Canon', SONY: 'Sony', FUJIFILM: 'Fujifilm', OLYMPUS: 'Olympus', PANASONIC: 'Panasonic', LEICA: 'Leica', APPLE: 'Apple', SAMSUNG: 'Samsung', GOOGLE: 'Google', TAMRON: 'Tamron', SIGMA: 'Sigma' };
  return known[upper] ?? s.charAt(0) + s.slice(1).toLowerCase();
}

export interface ExifLike {
  camera?: string | null;
  lens?: string | null;
  focalLengthMm?: number | null;
  aperture?: number | null;
  shutterS?: number | null;
  iso?: number | null;
  exposureComp?: number | null;
}

/** "Nikon Z50II · Tamron 50-400mm · 400 mm · f/6.3 · 1/2000 s · ISO 1600", omitting missing values. */
export function exifParts(e: ExifLike): string[] {
  return [
    e.camera?.trim() || null,
    cleanLens(e.lens),
    formatFocalLength(e.focalLengthMm),
    formatAperture(e.aperture),
    formatShutter(e.shutterS),
    formatIso(e.iso),
    formatExposureComp(e.exposureComp),
  ].filter((p): p is string => Boolean(p));
}

export function exifLine(e: ExifLike): string | null {
  const parts = exifParts(e);
  return parts.length ? parts.join(' · ') : null;
}

/** "2026-10-12T14:03:11" → "Oct 12, 2026" (local date as stored; no timezone math). */
export function formatTakenAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}
