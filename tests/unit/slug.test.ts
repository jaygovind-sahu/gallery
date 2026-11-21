import { describe, expect, it } from 'vitest';
import { isReservedCategorySlug, slugify } from '../../src/lib/slug';

describe('slugify', () => {
  it('lowercases, strips accents and joins words with hyphens', () => {
    expect(slugify('  Café Birds & Bees! ')).toBe('cafe-birds-bees');
  });
});

describe('reserved category slugs', () => {
  it('keeps /c/miscellaneous for photos in no category', () => {
    expect(isReservedCategorySlug('miscellaneous')).toBe(true);
    expect(isReservedCategorySlug(slugify('Miscellaneous'))).toBe(true);
    expect(isReservedCategorySlug('miscellaneous-2')).toBe(false);
    expect(isReservedCategorySlug('birds')).toBe(false);
  });
});
