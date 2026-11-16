import { describe, expect, it } from 'vitest';
import { exifLine, exifParts, formatAperture, formatExposureComp, formatShutter, formatTakenAt } from '../../src/lib/exif-format';

describe('formatShutter', () => {
  it('shows fast shutters as fractions', () => {
    expect(formatShutter(0.0005)).toBe('1/2000 s');
    expect(formatShutter(1 / 250)).toBe('1/250 s');
  });
  it('shows long exposures in seconds', () => {
    expect(formatShutter(2.5)).toBe('2.5 s');
    expect(formatShutter(30)).toBe('30 s');
  });
  it('omits missing values', () => {
    expect(formatShutter(null)).toBeNull();
    expect(formatShutter(undefined)).toBeNull();
    expect(formatShutter(0)).toBeNull();
  });
});

describe('formatAperture', () => {
  it('formats f-numbers', () => {
    expect(formatAperture(6.3)).toBe('f/6.3');
    expect(formatAperture(8)).toBe('f/8');
    expect(formatAperture(null)).toBeNull();
  });
});

describe('formatExposureComp', () => {
  it('signs and omits zero', () => {
    expect(formatExposureComp(-1 / 3)).toBe('-0.33 EV');
    expect(formatExposureComp(1)).toBe('+1 EV');
    expect(formatExposureComp(0)).toBeNull();
    expect(formatExposureComp(null)).toBeNull();
  });
});

describe('exifLine', () => {
  it('joins present values with middle dots', () => {
    expect(
      exifLine({ camera: 'Nikon Z50II', lens: 'Tamron 50-400mm', focalLengthMm: 400, aperture: 6.3, shutterS: 0.0005, iso: 1600 }),
    ).toBe('Nikon Z50II · Tamron 50-400mm · 400 mm · f/6.3 · 1/2000 s · ISO 1600');
  });
  it('omits missing values rather than showing blanks', () => {
    expect(exifParts({ camera: 'Nikon Z50II', aperture: null, iso: 100 })).toEqual(['Nikon Z50II', 'ISO 100']);
    expect(exifLine({})).toBeNull();
  });
});

describe('formatTakenAt', () => {
  it('formats the stored local date', () => {
    expect(formatTakenAt('2026-10-12T14:03:11')).toBe('Oct 12, 2026');
    expect(formatTakenAt('2026-01-05')).toBe('Jan 5, 2026');
    expect(formatTakenAt(null)).toBeNull();
    expect(formatTakenAt('nope')).toBeNull();
  });
});
