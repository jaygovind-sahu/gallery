import { describe, expect, it } from 'vitest';
import {
  MODEL_OUTPUT_JSON_SCHEMA,
  buildUserText,
  decodeModelToken,
  encodeModelToken,
  isUsable,
  modelOutputSchema,
  monthAndYear,
  shuffled,
  tallyVotes,
  toSuggestion,
  type ModelOutput,
} from '../../src/lib/ai-pure';
import { distanceKm, nearestLocation } from '../../src/lib/geo';
import { isProductionHost, productionHostname } from '../../src/lib/host';

const categories = [
  { id: 'c-birds', name: 'Birds' },
  { id: 'c-macro', name: 'Macro' },
];

const raw: ModelOutput = {
  subject: { present: true, commonName: 'Great Blue Heron', scientificName: 'Ardea herodias', confidence: 'medium', alternatives: ['Great Egret', 'Great Egret', ''] },
  titles: ['  Great Blue Heron, Waiting. ', 'Great Blue Heron, Waiting', 'Heron at Dawn', 'Fourth'],
  captions: { fieldNotes: 'A great blue heron\nstands still.', poetic: ' Patience. ', playful: '' },
  hashtags: ['GreatBlueHeron', '#Birds', 'birds'],
  categories: ['birds', 'Reptiles'],
};

describe('buildUserText', () => {
  it('passes the place and month, never the day, time or coordinates', () => {
    const text = buildUserText({
      subject: 'Great Blue Heron',
      takenAt: '2026-10-12T14:03:11',
      location: { name: 'Bombay Hook NWR', region: 'Delaware' },
      categoryNames: ['Birds'],
      allCategories: categories,
      camera: 'Nikon Z50II',
      lens: 'Tamron 50-400mm',
      focalLengthMm: 400,
      keywords: ['heron', 'marsh'],
      styleNotes: 'Short and dry.',
    });
    expect(text).toContain('Subject, given by the photographer: Great Blue Heron');
    expect(text).toContain('Place: Bombay Hook NWR, Delaware');
    expect(text).toContain('Taken: October 2026');
    expect(text).not.toContain('14:03');
    expect(text).not.toContain('-12');
    expect(text).toContain('Gear: Nikon Z50II, Tamron 50-400mm, 400 mm');
    expect(text).toContain('keywords for this photo: heron, marsh');
    expect(text).toContain('Categories to choose from: Birds, Macro');
    expect(text).toContain('Short and dry.');
  });

  it('says so when the subject is not given', () => {
    expect(buildUserText({ allCategories: [] })).toContain('Subject: not given');
  });

  it('reads the month from an ISO local time', () => {
    expect(monthAndYear('2026-01-05')).toBe('January 2026');
    expect(monthAndYear(null)).toBeNull();
    expect(monthAndYear('2026-13-01')).toBeNull();
  });
});

describe('toSuggestion', () => {
  it('tidies titles, captions, hashtags and maps categories to real ids', () => {
    const s = toSuggestion(raw, { subject: null, allCategories: categories });
    expect(s.titles).toEqual(['Great Blue Heron, Waiting', 'Heron at Dawn', 'Fourth']);
    expect(s.captions['field-notes']).toBe('A great blue heron stands still.');
    expect(s.captions.poetic).toBe('Patience.');
    expect(s.hashtags).toEqual(['#greatblueheron', '#birds']);
    expect(s.categoryIds).toEqual(['c-birds']);
    expect(s.subject).toEqual({ name: 'Great Blue Heron', scientificName: 'Ardea herodias', confidence: 'medium', alternatives: ['Great Egret'] });
  });

  it('the owner’s subject wins over the model’s and is never a guess', () => {
    const s = toSuggestion(raw, { subject: ' Green Heron ', allCategories: categories });
    expect(s.subject.name).toBe('Green Heron');
    expect(s.subject.confidence).toBe('given');
    expect(s.subject.alternatives).toEqual([]);
  });

  it('reports no subject when the photo has none', () => {
    const s = toSuggestion({ ...raw, subject: { ...raw.subject, present: false } }, { subject: null, allCategories: categories });
    expect(s.subject.name).toBeNull();
    expect(s.subject.scientificName).toBeNull();
  });

  it('is usable with a title or a caption, not with neither', () => {
    const empty = toSuggestion({ ...raw, titles: [], captions: { fieldNotes: '', poetic: ' ', playful: '' } }, { subject: null, allCategories: [] });
    expect(isUsable(empty)).toBe(false);
    expect(isUsable(toSuggestion(raw, { subject: null, allCategories: [] }))).toBe(true);
  });
});

describe('output schema', () => {
  it('the JSON Schema and the zod schema describe the same fields', () => {
    expect(modelOutputSchema.safeParse(raw).success).toBe(true);
    expect([...MODEL_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(Object.keys(modelOutputSchema.shape).sort());
    expect([...MODEL_OUTPUT_JSON_SCHEMA.properties.subject.required].sort()).toEqual(Object.keys(modelOutputSchema.shape.subject.shape).sort());
    expect([...MODEL_OUTPUT_JSON_SCHEMA.properties.captions.required].sort()).toEqual(Object.keys(modelOutputSchema.shape.captions.shape).sort());
  });
});

describe('blind comparison', () => {
  it('round-trips a model through its opaque token', () => {
    const token = encodeModelToken({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(token).not.toContain('claude');
    expect(decodeModelToken(token)).toBe('anthropic:claude-haiku-5-5');
  });

  it('rejects tokens that are not a known provider', () => {
    expect(decodeModelToken(btoa('evil:model'))).toBeNull();
    expect(decodeModelToken('%%%')).toBeNull();
  });

  it('shuffles without losing items', () => {
    expect(shuffled([1, 2], () => 0)).toEqual([2, 1]);
    expect(shuffled([1, 2], () => 0.99)).toEqual([1, 2]);
  });

  it('counts wins per model and lists a model that only lost', () => {
    expect(
      tallyVotes([
        { winner: 'a', loser: 'b' },
        { winner: 'a', loser: 'b' },
      ]),
    ).toEqual([
      { model: 'a', wins: 2 },
      { model: 'b', wins: 0 },
    ]);
  });
});

describe('location from GPS', () => {
  const bombayHook = { locationId: 'bh', lat: 39.26, lng: -75.47 };
  const marshCreek = { locationId: 'mc', lat: 40.07, lng: -75.72 };

  it('measures great-circle distance', () => {
    expect(distanceKm(39.26, -75.47, 40.07, -75.72)).toBeGreaterThan(85);
    expect(distanceKm(39.26, -75.47, 40.07, -75.72)).toBeLessThan(95);
  });

  it('picks the closest location within range, or none', () => {
    expect(nearestLocation(39.27, -75.48, [marshCreek, bombayHook])).toBe('bh');
    expect(nearestLocation(39.6, -75.6, [marshCreek, bombayHook])).toBeNull();
    expect(nearestLocation(null, null, [bombayHook])).toBeNull();
  });
});

describe('production hostname', () => {
  it('is SITE_URL’s hostname, with the real domain as the fallback', () => {
    expect(productionHostname('https://gallery.jaygovindsahu.com')).toBe('gallery.jaygovindsahu.com');
    expect(productionHostname(undefined)).toBe('gallery.jaygovindsahu.com');
  });

  it('dev-only switches (auth bypass, AI mock) are refused on it and allowed elsewhere', () => {
    expect(isProductionHost('gallery.jaygovindsahu.com', 'https://gallery.jaygovindsahu.com')).toBe(true);
    expect(isProductionHost('localhost', 'https://gallery.jaygovindsahu.com')).toBe(false);
  });
});
