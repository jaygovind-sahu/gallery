import { describe, expect, it } from 'vitest';
import { cacheKey, imageUrl, isImagesQuotaError, isUploadMime, originalKey, parseSize, parseVersion, pickFormat, SIZE_SPECS, SIZES, srcSet } from '../../src/lib/images';
import { reconcileDimensions } from '../../src/lib/originals-pure';

describe('size allowlist', () => {
  it('accepts exactly the six sizes', () => {
    for (const s of SIZES) expect(parseSize(String(s))).toBe(s);
  });
  it('rejects anything else', () => {
    for (const bad of ['0', '100', '481', '0480', '480.0', '4800', '-480', 'abc', '', undefined, null, '1e3']) {
      expect(parseSize(bad)).toBeNull();
    }
  });
  it('watermarks only 1600 and up', () => {
    expect(SIZE_SPECS[480].watermark).toBe(false);
    expect(SIZE_SPECS[1080].watermark).toBe(false);
    expect(SIZE_SPECS[1600].watermark).toBe(true);
    expect(SIZE_SPECS[3200].watermark).toBe(true);
  });
});

describe('parseVersion', () => {
  it('accepts v + a positive integer', () => {
    expect(parseVersion('v1')).toBe(1);
    expect(parseVersion('v12')).toBe(12);
  });
  it('rejects everything else', () => {
    for (const bad of ['1', 'v0', 'v01', 'v-1', 'v1.0', 'V1', 'v', '', 'v1e3', undefined, null]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('public URLs', () => {
  it('builds the image URL and srcset', () => {
    expect(imageUrl('01ABC', 2, 480)).toBe('/img/01ABC/v2/480');
    expect(srcSet('01ABC', 1, [480, 768, 1080])).toBe('/img/01ABC/v1/480 480w, /img/01ABC/v1/768 768w, /img/01ABC/v1/1080 1080w');
  });
  it('recognises the Images quota error', () => {
    expect(isImagesQuotaError({ code: 9422 })).toBe(true);
    expect(isImagesQuotaError({ code: 9412 })).toBe(false);
    expect(isImagesQuotaError(new Error('x'))).toBe(false);
    expect(isImagesQuotaError(null)).toBe(false);
  });
});

describe('pickFormat', () => {
  it('prefers AVIF when accepted', () => {
    expect(pickFormat('image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')).toBe('image/avif');
    expect(pickFormat('text/html, image/AVIF')).toBe('image/avif');
  });
  it('falls back to WebP otherwise', () => {
    expect(pickFormat('image/webp,image/apng,*/*')).toBe('image/webp');
    expect(pickFormat('image/jpeg')).toBe('image/webp');
    expect(pickFormat('*/*')).toBe('image/webp');
    expect(pickFormat(null)).toBe('image/webp');
    expect(pickFormat('')).toBe('image/webp');
  });
});

describe('keys', () => {
  it('builds R2 and cache keys', () => {
    expect(originalKey('01ABC', 2, 'image/jpeg')).toBe('originals/01ABC/v2.jpg');
    expect(originalKey('01ABC', 1, 'image/webp')).toBe('originals/01ABC/v1.webp');
    expect(cacheKey('01ABC', 3, 1600, 'image/avif')).toBe('https://img-cache.internal/01ABC/v3/1600.avif');
    expect(cacheKey('01ABC', 3, 480, 'image/webp')).toBe('https://img-cache.internal/01ABC/v3/480.webp');
  });
  it('checks upload types', () => {
    expect(isUploadMime('image/jpeg')).toBe(true);
    expect(isUploadMime('IMAGE/PNG; charset=binary')).toBe(true);
    expect(isUploadMime('image/heic')).toBe(false);
    expect(isUploadMime(null)).toBe(false);
  });
});

describe('reconcileDimensions', () => {
  it('keeps the browser orientation when both describe the same grid', () => {
    expect(reconcileDimensions(3000, 2000, { width: 2000, height: 3000, orientation: 6 })).toEqual({ width: 2000, height: 3000 });
    expect(reconcileDimensions(3000, 2000, { width: 3000, height: 2000, orientation: 1 })).toEqual({ width: 3000, height: 2000 });
  });
  it('uses the server grid when the browser disagrees, swapped if EXIF says rotated', () => {
    expect(reconcileDimensions(3000, 2000, { width: 1, height: 1, orientation: 6 })).toEqual({ width: 2000, height: 3000 });
    expect(reconcileDimensions(3000, 2000, { width: 1, height: 1, orientation: 1 })).toEqual({ width: 3000, height: 2000 });
    expect(reconcileDimensions(3000, 2000, { width: 1, height: 1 })).toEqual({ width: 3000, height: 2000 });
  });
});
