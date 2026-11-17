import { describe, expect, it } from 'vitest';
import {
  mergeSuggestedCaptions,
  normalizeHashtags,
  parseHashtags,
  pickShownTone,
  resolveCaptionWrite,
  setCaptionText,
  tidyCaptions,
  withHashtags,
  type Caption,
} from '../../src/lib/captions';

const cap = (tone: Caption['tone'], text: string, edited = false): Caption => ({ tone, text, edited });

describe('tidyCaptions', () => {
  it('drops empty captions, keeps one per tone and orders them', () => {
    const out = tidyCaptions([cap('own', ' mine '), cap('playful', '   '), cap('poetic', 'a'), cap('poetic', 'b'), cap('field-notes', 'f')]);
    expect(out.map((c) => [c.tone, c.text])).toEqual([
      ['field-notes', 'f'],
      ['poetic', 'b'],
      ['own', 'mine'],
    ]);
  });

  it('always marks the owner’s own caption as edited and strips the D1 separators', () => {
    expect(tidyCaptions([cap('own', 'a\x1eb\x1fc')])).toEqual([cap('own', 'a b c', true)]);
  });
});

describe('resolveCaptionWrite', () => {
  const none = { captions: [], captionTone: null };

  it('treats a lone caption as the owner’s own, shown', () => {
    expect(resolveCaptionWrite({ caption: 'Waiting for fish.' }, none)).toEqual({ rows: [cap('own', 'Waiting for fish.', true)], tone: 'own', display: 'Waiting for fish.' });
  });

  it('keeps the AI captions when the older single-caption form is used', () => {
    const current = { captions: [cap('poetic', 'p'), cap('own', 'old', true)], captionTone: 'poetic' as const };
    const write = resolveCaptionWrite({ caption: 'new' }, current);
    expect(write.rows).toEqual([cap('poetic', 'p'), cap('own', 'new', true)]);
    expect(write.display).toBe('new');
  });

  it('a null caption stops showing one but leaves the saved captions alone', () => {
    expect(resolveCaptionWrite({ caption: null }, { captions: [cap('own', 'x', true)], captionTone: 'own' })).toEqual({ tone: null, display: null });
  });

  it('replaces the saved set and shows the requested tone', () => {
    const write = resolveCaptionWrite({ captions: [cap('poetic', 'p'), cap('playful', 'q')], captionTone: 'playful' }, none);
    expect(write).toEqual({ rows: [cap('poetic', 'p'), cap('playful', 'q')], tone: 'playful', display: 'q' });
  });

  it('keeps the current tone when only the texts change', () => {
    const write = resolveCaptionWrite({ captions: [cap('poetic', 'p2')] }, { captions: [cap('poetic', 'p')], captionTone: 'poetic' });
    expect(write.tone).toBe('poetic');
    expect(write.display).toBe('p2');
  });

  it('shows nothing when the requested tone has no caption', () => {
    expect(resolveCaptionWrite({ captions: [cap('poetic', 'p')], captionTone: 'playful' }, none)).toMatchObject({ tone: null, display: null });
  });

  it('switches the shown caption without touching the saved ones', () => {
    const current = { captions: [cap('poetic', 'p'), cap('playful', 'q')], captionTone: 'poetic' as const };
    expect(resolveCaptionWrite({ captionTone: 'playful' }, current)).toEqual({ tone: 'playful', display: 'q' });
  });

  it('does nothing when no caption field is in the request', () => {
    expect(resolveCaptionWrite({}, none)).toEqual({});
  });
});

describe('mergeSuggestedCaptions', () => {
  const suggested = { 'field-notes': 'F2', poetic: 'P2', playful: 'L2' };

  it('fills empty tones and replaces captions the owner never edited', () => {
    const { captions, pending } = mergeSuggestedCaptions([cap('poetic', 'P1')], suggested);
    expect(captions.map((c) => c.text)).toEqual(['F2', 'P2', 'L2']);
    expect(captions.every((c) => !c.edited)).toBe(true);
    expect(pending).toEqual({});
  });

  it('never overwrites an edited caption: the new text is only offered', () => {
    const { captions, pending } = mergeSuggestedCaptions([cap('poetic', 'my words', true), cap('own', 'mine', true)], suggested);
    expect(captions.find((c) => c.tone === 'poetic')).toEqual(cap('poetic', 'my words', true));
    expect(captions.find((c) => c.tone === 'own')?.text).toBe('mine');
    expect(pending).toEqual({ poetic: 'P2' });
  });

  it('keeps an existing caption when the model returned nothing for that tone', () => {
    const { captions } = mergeSuggestedCaptions([cap('playful', 'L1')], { ...suggested, playful: '' });
    expect(captions.find((c) => c.tone === 'playful')?.text).toBe('L1');
  });
});

describe('pickShownTone', () => {
  it('keeps the current tone while it has text', () => {
    expect(pickShownTone([cap('poetic', 'p'), cap('own', 'o', true)], 'poetic')).toBe('poetic');
  });
  it('falls back to the owner’s own caption, then the first with text', () => {
    expect(pickShownTone([cap('poetic', ''), cap('playful', 'q'), cap('own', 'o', true)], 'poetic')).toBe('own');
    expect(pickShownTone([cap('playful', 'q'), cap('field-notes', 'f')], null)).toBe('field-notes');
    expect(pickShownTone([cap('own', '  ', true)], 'own')).toBeNull();
  });
});

describe('setCaptionText', () => {
  it('marks the caption as edited and keeps an emptied one in place', () => {
    const out = setCaptionText([cap('poetic', 'p')], 'poetic', '');
    expect(out).toEqual([cap('poetic', '', true)]);
  });
});

describe('hashtags', () => {
  it('normalises tokens to lowercase #tags without duplicates', () => {
    expect(parseHashtags('#GreatBlueHeron, birds #birds  bird-photography')).toEqual(['#greatblueheron', '#birds', '#birdphotography']);
    expect(parseHashtags(['Great Blue Heron', '#wildlife'])).toEqual(['#great', '#blue', '#heron', '#wildlife']);
  });
  it('caps the list at Instagram’s limit of 30', () => {
    expect(parseHashtags(Array.from({ length: 40 }, (_, i) => `tag${i}`))).toHaveLength(30);
  });
  it('stores nothing when there are no tags', () => {
    expect(normalizeHashtags('  , # ')).toBeNull();
    expect(normalizeHashtags(null)).toBeNull();
  });
  it('builds the Instagram text: caption, blank line, tags', () => {
    expect(withHashtags(' A heron. ', 'heron #birds')).toBe('A heron.\n\n#heron #birds');
    expect(withHashtags('A heron.', '')).toBe('A heron.');
  });
});
