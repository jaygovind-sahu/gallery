/**
 * Image delivery helpers (docs/DESIGN.md, "Image storage & delivery").
 * Pure parts (allowlist, format negotiation) are unit-tested; `transformOriginal` needs the Images binding.
 */

export const SIZES = [480, 768, 1080, 1600, 2400, 3200] as const;
export type Size = (typeof SIZES)[number];

/** Long edge, quality and whether the watermark is drawn, per allowlisted size. */
export const SIZE_SPECS: Record<Size, { quality: number; watermark: boolean }> = {
  480: { quality: 82, watermark: false },
  768: { quality: 82, watermark: false },
  1080: { quality: 85, watermark: false },
  1600: { quality: 88, watermark: true },
  2400: { quality: 88, watermark: true },
  3200: { quality: 88, watermark: true },
};

export const GRID_SIZES: Size[] = [480, 768, 1080];
export const LIGHTBOX_SIZES: Size[] = [1600, 2400, 3200];

/** Parse a size path segment; only exact allowlisted values pass ("480", not "480.0" or "0480"). */
export function parseSize(raw: string | undefined | null): Size | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return (SIZES as readonly number[]).includes(n) && String(n) === raw ? (n as Size) : null;
}

/** Parse the `v<version>` path segment of an image URL; only `v` + a positive integer without leading zeros passes. */
export function parseVersion(raw: string | undefined | null): number | null {
  if (!raw || !/^v[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw.slice(1));
  return Number.isSafeInteger(n) ? n : null;
}

/** Public derivative URL: `/img/<photoId>/v<version>/<size>`. */
export function imageUrl(photoId: string, version: number, size: Size): string {
  return `/img/${photoId}/v${version}/${size}`;
}

/** `srcset` value for the given sizes, each with its width descriptor. */
export function srcSet(photoId: string, version: number, sizes: readonly Size[]): string {
  return sizes.map((s) => `${imageUrl(photoId, version, s)} ${s}w`).join(', ');
}

export type OutputFormat = 'image/avif' | 'image/webp';

/** AVIF when the client accepts it, otherwise WebP. Two formats only. */
export function pickFormat(accept: string | null | undefined): OutputFormat {
  const a = (accept ?? '').toLowerCase();
  return a.includes('image/avif') ? 'image/avif' : 'image/webp';
}

/** Headers on every public derivative: a year, immutable (the version in the URL busts the cache on replace). */
export const PUBLIC_IMAGE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Accept',
  'content-disposition': 'inline',
};

/** Cloudflare Images returns 9422 when the plan's monthly transformations are used up. */
export function isImagesQuotaError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 9422;
}

/** Allowed upload types; HEIC and RAW are out of scope for v1. */
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadMime = (typeof UPLOAD_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function isUploadMime(mime: string | null | undefined): mime is UploadMime {
  return (UPLOAD_MIME_TYPES as readonly string[]).includes((mime ?? '').toLowerCase().split(';')[0].trim());
}

export function extensionFor(mime: UploadMime): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
}

export function originalKey(photoId: string, version: number, mime: UploadMime): string {
  return `originals/${photoId}/v${version}.${extensionFor(mime)}`;
}

/** Synthetic edge-cache key: includes the format because the response varies on Accept. */
export function cacheKey(photoId: string, version: number, size: Size, format: OutputFormat): string {
  return `https://img-cache.internal/${photoId}/v${version}/${size}.${format === 'image/avif' ? 'avif' : 'webp'}`;
}

export interface TransformInput {
  images: ImagesBinding;
  body: ReadableStream<Uint8Array>;
  size: Size;
  format: OutputFormat;
  /** Draw the watermark (only honoured on sizes whose spec says so). */
  watermark: boolean;
  /** Source dimensions, used to size the overlay relative to the output. */
  width: number;
  height: number;
  /** Fetches the watermark PNG bytes; injected so the route decides how (static asset fetch). */
  loadWatermark?: () => Promise<ReadableStream<Uint8Array> | null>;
}

/** Resize (long edge = size, never upscale), optionally draw the watermark, encode. Metadata is not copied. */
export async function transformOriginal(input: TransformInput): Promise<Response> {
  const spec = SIZE_SPECS[input.size];
  let t = input.images.input(input.body).transform({ width: input.size, height: input.size, fit: 'scale-down' });

  if (spec.watermark && input.watermark && input.loadWatermark) {
    const wm = await input.loadWatermark();
    if (wm) {
      const longEdge = Math.min(input.size, Math.max(input.width, input.height));
      const scale = longEdge / Math.max(input.width, input.height);
      const outW = Math.round(input.width * scale);
      const outH = Math.round(input.height * scale);
      const outLong = Math.max(outW, outH);
      const overlayWidth = Math.max(1, Math.round(outLong * 0.18));
      const margin = Math.round(outLong * 0.02);
      t = t.draw(input.images.input(wm).transform({ width: overlayWidth }), { opacity: 0.6, bottom: margin, right: margin });
    }
  }

  const result = await t.output({ format: input.format, quality: spec.quality });
  return result.response();
}
