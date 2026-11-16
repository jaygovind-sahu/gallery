/**
 * Browser-side metadata reading for the upload flow (docs/DESIGN.md, "Upload flow", steps 2–3).
 * Runs only in the admin UI; the Worker re-verifies format and dimensions with the Images binding.
 */
import exifr from 'exifr';
import { rgbaToThumbHash } from 'thumbhash';

export interface ParsedMetadata {
  /** EXIF DateTimeOriginal as ISO 8601 local time ("2026-10-12T14:03:11"). */
  takenAt: string | null;
  camera: string | null;
  lens: string | null;
  focalLengthMm: number | null;
  aperture: number | null;
  shutterS: number | null;
  iso: number | null;
  exposureComp: number | null;
  /** EXIF orientation 1–8. */
  orientation: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  /** XMP dc:title / IPTC ObjectName, as set in Lightroom. */
  title: string | null;
  /** XMP dc:description / IPTC Caption. */
  caption: string | null;
}

export const EMPTY_METADATA: ParsedMetadata = {
  takenAt: null,
  camera: null,
  lens: null,
  focalLengthMm: null,
  aperture: null,
  shutterS: null,
  iso: null,
  exposureComp: null,
  orientation: null,
  gpsLat: null,
  gpsLng: null,
  title: null,
  caption: null,
};

export async function readMetadata(file: File): Promise<ParsedMetadata> {
  let tags: Record<string, unknown> = {};
  let gps: { latitude?: number; longitude?: number } | undefined;
  // exifr's typings don't admit the per-segment booleans its docs describe, hence the cast.
  const options = {
    ifd0: true,
    exif: true,
    gps: false,
    xmp: true,
    iptc: true,
    interop: false,
    translateValues: false,
    reviveValues: false,
    mergeOutput: true,
  } as unknown as Parameters<typeof exifr.parse>[1];
  try {
    tags = ((await exifr.parse(file, options)) as Record<string, unknown> | undefined) ?? {};
  } catch {
    // No EXIF at all (or an unreadable segment): every field stays null.
  }
  try {
    gps = (await exifr.gps(file)) ?? undefined;
  } catch {
    gps = undefined;
  }

  return {
    takenAt: exifDate(tags.DateTimeOriginal) ?? exifDate(tags.CreateDate) ?? exifDate(tags.DateTime),
    camera: cleanCamera(str(tags.Make), str(tags.Model)),
    lens: str(tags.LensModel) ?? str(tags.Lens) ?? null,
    focalLengthMm: num(tags.FocalLength),
    aperture: num(tags.FNumber),
    shutterS: num(tags.ExposureTime),
    iso: int(tags.ISO ?? tags.ISOSpeedRatings),
    exposureComp: num(tags.ExposureCompensation ?? tags.ExposureBiasValue),
    orientation: int(tags.Orientation),
    gpsLat: finite(gps?.latitude),
    gpsLng: finite(gps?.longitude),
    title: str(tags.title) ?? str(tags.ObjectName) ?? str(tags.Headline) ?? null,
    caption: str(tags.description) ?? str(tags.Caption) ?? str(tags['Caption-Abstract']) ?? null,
  };
}

/** "2026:10:12 14:03:11" → "2026-10-12T14:03:11"; Dates and ISO strings pass through as local time. */
function exifDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}

/** XMP values arrive as strings, { value }, { 'x-default': … } or arrays; take the first text. */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.replace(/\0/g, '').trim();
    return t ? t : null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = str(x);
      if (s) return s;
    }
    return null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o.value) ?? str(o['x-default']) ?? str(Object.values(o)[0]);
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const frac = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
    if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return v[1] ? v[0] / v[1] : null;
  return null;
}

function int(v: unknown): number | null {
  const n = num(Array.isArray(v) ? v[0] : v);
  return n === null ? null : Math.round(n);
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const BRANDS: Record<string, string> = {
  NIKON: 'Nikon',
  'NIKON CORPORATION': 'Nikon',
  CANON: 'Canon',
  SONY: 'Sony',
  FUJIFILM: 'Fujifilm',
  OLYMPUS: 'Olympus',
  'OM DIGITAL SOLUTIONS': 'OM System',
  PANASONIC: 'Panasonic',
  LEICA: 'Leica',
  'LEICA CAMERA AG': 'Leica',
  APPLE: 'Apple',
  SAMSUNG: 'Samsung',
  GOOGLE: 'Google',
};

/** "NIKON CORPORATION" + "NIKON Z50_2" → "Nikon Z50_2"; the owner can tidy the model name in the form. */
export function cleanCamera(make: string | null, model: string | null): string | null {
  if (!make && !model) return null;
  const brand = make ? (BRANDS[make.toUpperCase()] ?? make.split(/\s+/)[0]) : '';
  if (!model) return brand || null;
  const m = model.replace(/\s+/g, ' ').trim();
  const firstWord = m.split(' ')[0] ?? '';
  if (brand && (firstWord.toUpperCase() === brand.toUpperCase() || BRANDS[firstWord.toUpperCase()] === brand)) {
    return `${brand} ${m.slice(firstWord.length).trim()}`.trim();
  }
  return brand ? `${brand} ${m}` : m;
}

export interface Preview {
  /** Display dimensions, EXIF orientation applied. */
  width: number;
  height: number;
  /** ThumbHash, base64. */
  placeholder: string;
  /** Small JPEG for the upload card; revoke with URL.revokeObjectURL when done. */
  url: string;
}

/** Decode once (orientation applied), then derive the display size, a ThumbHash and a small card preview. */
export async function makePreview(file: File, cardWidth = 640): Promise<Preview> {
  const source = await decode(file);
  try {
    const { width, height } = source;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unavailable');

    // ThumbHash needs a ≤100 px image.
    const tScale = 100 / Math.max(width, height);
    canvas.width = Math.max(1, Math.round(width * tScale));
    canvas.height = Math.max(1, Math.round(height * tScale));
    ctx.drawImage(source.element, 0, 0, canvas.width, canvas.height);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = rgbaToThumbHash(canvas.width, canvas.height, rgba);
    const placeholder = btoa(String.fromCharCode(...hash));

    const pScale = Math.min(1, cardWidth / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * pScale));
    canvas.height = Math.max(1, Math.round(height * pScale));
    ctx.drawImage(source.element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    const url = blob ? URL.createObjectURL(blob) : '';
    return { width, height, placeholder, url };
  } finally {
    source.release();
  }
}

interface Decoded {
  width: number;
  height: number;
  element: CanvasImageSource;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bitmap.width, height: bitmap.height, element: bitmap, release: () => bitmap.close() };
    } catch {
      // Fall through to the <img> path (older Safari).
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('The browser could not decode this image.');
  }
  return { width: img.naturalWidth, height: img.naturalHeight, element: img, release: () => URL.revokeObjectURL(url) };
}
