import { describe, expect, it } from 'vitest';
import { altText, derivativeDimensions, lightboxSources, placeholderDataUrl, realSizeLimit, resolveLayout, tileCaption, tileSources, withLayoutParam } from '../../src/lib/gallery';

const base = { id: '01ABC', version: 2, width: 3000, height: 2000, title: null, categories: [{ slug: 'birds', name: 'Birds' }], location: { slug: 'bombay-hook-nwr', name: 'Bombay Hook NWR' }, takenAt: '2026-10-12T14:03:11' };

describe('resolveLayout', () => {
  it('prefers the URL param, then the stored choice, then the default', () => {
    expect(resolveLayout('grid', 'masonry', 'rows')).toBe('grid');
    expect(resolveLayout(null, 'masonry', 'rows')).toBe('masonry');
    expect(resolveLayout(undefined, undefined, 'rows')).toBe('rows');
  });
  it('ignores unknown values', () => {
    expect(resolveLayout('bogus', 'nope', 'masonry')).toBe('masonry');
    expect(resolveLayout('', '', 'grid')).toBe('grid');
  });
});

describe('altText', () => {
  it('uses the title when there is one', () => {
    expect(altText({ ...base, title: '  Great egret ' })).toBe('Great egret');
  });
  it('falls back to category, location and date, omitting what is missing', () => {
    expect(altText(base)).toBe('Birds photo, Bombay Hook NWR, Oct 12, 2026');
    expect(altText({ ...base, location: null })).toBe('Birds photo, Oct 12, 2026');
    expect(altText({ ...base, categories: [], location: null, takenAt: null })).toBe('Photo');
    expect(altText({ ...base, categories: [] }, 'Landscape')).toBe('Landscape photo, Bombay Hook NWR, Oct 12, 2026');
  });
});

describe('sources', () => {
  it('scales dimensions to the long edge without upscaling', () => {
    expect(derivativeDimensions(3000, 2000, 1080)).toEqual({ width: 1080, height: 720 });
    expect(derivativeDimensions(2000, 3000, 1600)).toEqual({ width: 1067, height: 1600 });
    expect(derivativeDimensions(1800, 1200, 2400)).toEqual({ width: 1800, height: 1200 });
  });
  it('lists tile and lightbox sizes with their URLs', () => {
    expect(tileSources(base)).toEqual([
      { src: '/img/01ABC/v2/480', width: 480, height: 320 },
      { src: '/img/01ABC/v2/768', width: 768, height: 512 },
      { src: '/img/01ABC/v2/1080', width: 1080, height: 720 },
    ]);
    expect(lightboxSources(base).map((s) => s.src)).toEqual(['/img/01ABC/v2/1600', '/img/01ABC/v2/2400']);
  });
  it('drops sizes that would just repeat the original', () => {
    expect(lightboxSources({ ...base, width: 1800, height: 1200 })).toEqual([
      { src: '/img/01ABC/v2/1600', width: 1600, height: 1067 },
      { src: '/img/01ABC/v2/2400', width: 1800, height: 1200 },
    ]);
  });
});

describe('realSizeLimit', () => {
  it('caps a photo at one image pixel per screen pixel', () => {
    expect(realSizeLimit(2400, 1600, 1)).toEqual({ width: 2400, height: 1600 });
    expect(realSizeLimit(2400, 1600, 2)).toEqual({ width: 1200, height: 800 });
    expect(realSizeLimit(1800, 1200, 1.5)).toEqual({ width: 1200, height: 800 });
  });
  it('treats a missing or broken ratio as 1', () => {
    expect(realSizeLimit(2400, 1600, 0)).toEqual({ width: 2400, height: 1600 });
    expect(realSizeLimit(2400, 1600, Number.NaN)).toEqual({ width: 2400, height: 1600 });
  });
});

describe('placeholders and captions', () => {
  it('decodes a ThumbHash to a PNG data URL and tolerates junk', () => {
    expect(placeholderDataUrl('HBkSHYSIeHiPiHh8eXe4h3h8h4CA')?.startsWith('data:image/png;base64,')).toBe(true);
    expect(placeholderDataUrl(null)).toBeNull();
    expect(placeholderDataUrl('')).toBeNull();
    expect(placeholderDataUrl('AA==')).toBeNull();
    expect(placeholderDataUrl('not base64!!')).toBeNull();
  });
  it('shows location only for untitled photos', () => {
    expect(tileCaption(base)).toEqual({ title: null, location: 'Bombay Hook NWR' });
    expect(tileCaption({ ...base, title: 'Egret', location: null })).toEqual({ title: 'Egret', location: null });
  });
  it('adds or removes the layout param', () => {
    expect(withLayoutParam('/c/birds', 'grid', 'rows')).toBe('/c/birds?layout=grid');
    expect(withLayoutParam('/c/birds?layout=grid', 'rows', 'rows')).toBe('/c/birds');
    expect(withLayoutParam('/all?x=1', 'masonry', 'rows')).toBe('/all?x=1&layout=masonry');
  });
});
