/**
 * Pure helpers for the public gallery (docs/DESIGN.md, "Public gallery"). No Worker or DOM imports so
 * they run on the server, in the islands and in unit tests.
 */
import { thumbHashToDataURL } from 'thumbhash';
import type { PublicPhoto } from './db';
import { formatTakenAt } from './exif-format';
import { GRID_SIZES, imageUrl, LIGHTBOX_SIZES, type Size } from './images';

export const LAYOUTS = ['rows', 'masonry', 'grid'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const LAYOUT_STORAGE_KEY = 'gallery:layout';
export const LAYOUT_EVENT = 'gallery:layout';

/** Height reserved under every tile for title + location (docs: ~44 px). */
export const CAPTION_HEIGHT = 44;

export function isLayout(value: unknown): value is Layout {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

/** `?layout=` wins, then the visitor's stored choice, then the category default. */
export function resolveLayout(param: string | null | undefined, stored: string | null | undefined, fallback: Layout): Layout {
  if (isLayout(param)) return param;
  if (isLayout(stored)) return stored;
  return fallback;
}

/** Title, else "<category> photo, <location>, <date>" with missing parts omitted. */
export function altText(photo: Pick<PublicPhoto, 'title' | 'categories' | 'location' | 'takenAt'>, contextCategory?: string | null): string {
  if (photo.title?.trim()) return photo.title.trim();
  const category = contextCategory || photo.categories[0]?.name;
  const parts = [category ? `${category} photo` : 'Photo', photo.location?.name ?? null, formatTakenAt(photo.takenAt)];
  return parts.filter((p): p is string => Boolean(p)).join(', ');
}

export interface ImageSource {
  src: string;
  width: number;
  height: number;
}

/** Dimensions of the derivative whose long edge is `size` (never upscaled past the original). */
export function derivativeDimensions(width: number, height: number, size: Size): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= size) return { width, height };
  const scale = size / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function sources(photo: Pick<PublicPhoto, 'id' | 'version' | 'width' | 'height'>, sizes: readonly Size[]): ImageSource[] {
  const out: ImageSource[] = [];
  for (const size of sizes) {
    const dims = derivativeDimensions(photo.width, photo.height, size);
    // Once the original is smaller than a size, larger sizes return the same bytes: list it once.
    if (out.some((s) => s.width === dims.width && s.height === dims.height)) continue;
    out.push({ src: imageUrl(photo.id, photo.version, size), ...dims });
  }
  return out;
}

/** 480 / 768 / 1080 for tiles. */
export function tileSources(photo: Pick<PublicPhoto, 'id' | 'version' | 'width' | 'height'>): ImageSource[] {
  return sources(photo, GRID_SIZES);
}

/** 1600 / 2400 for the lightbox. */
export function lightboxSources(photo: Pick<PublicPhoto, 'id' | 'version' | 'width' | 'height'>): ImageSource[] {
  return sources(photo, LIGHTBOX_SIZES);
}

/**
 * The largest size, in CSS px, at which an image of `width`×`height` pixels can be drawn without
 * enlarging it: one image pixel per screen pixel. On a 2× screen that's half its pixel size.
 */
export function realSizeLimit(width: number, height: number, devicePixelRatio: number): { width: number; height: number } {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: width / ratio, height: height / ratio };
}

/** The ThumbHash placeholder as a PNG data URL, or null when there is none or it is malformed. */
export function placeholderDataUrl(base64: string | null | undefined): string | null {
  if (!base64) return null;
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return bytes.length >= 5 ? thumbHashToDataURL(bytes) : null;
  } catch {
    return null;
  }
}

/** Caption lines under a tile: title (display face) and location (sans); untitled photos show the location only. */
export function tileCaption(photo: Pick<PublicPhoto, 'title' | 'location'>): { title: string | null; location: string | null } {
  return { title: photo.title?.trim() || null, location: photo.location?.name ?? null };
}

/** Gallery URL with the layout param applied (omitted when it is the page default). */
export function withLayoutParam(url: string, layout: Layout, fallback: Layout): string {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  if (layout === fallback) params.delete('layout');
  else params.set('layout', layout);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}
