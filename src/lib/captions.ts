/**
 * Saved captions: one per tone per photo, one of them shown on the site (docs/DESIGN.md, "AI suggestions").
 * Pure logic shared by the admin islands, the API and the data layer; no bindings, so it is unit-tested.
 */

/** The three tones the AI writes, in display order. */
export const AI_TONES = ['field-notes', 'poetic', 'playful'] as const;
/** Every tone a caption can be saved under; `own` is the owner's hand-written one. */
export const TONES = [...AI_TONES, 'own'] as const;

export type AiTone = (typeof AI_TONES)[number];
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
  'field-notes': 'Field notes',
  poetic: 'Poetic',
  playful: 'Playful',
  own: 'Your own',
};

export interface Caption {
  tone: Tone;
  text: string;
  /** True once the owner has typed in it. A re-run of the AI never overwrites an edited caption. */
  edited: boolean;
}

/** D1 mappers split rows on these, so they can never be stored inside a caption. */
const SEPARATORS = /[\x1e\x1f]/g;

export function cleanCaptionText(text: string): string {
  return text.replace(SEPARATORS, ' ').trim();
}

/** Drop empty captions, keep one per tone (the last wins), and return them in display order. */
export function tidyCaptions(captions: readonly Caption[]): Caption[] {
  const byTone = new Map<Tone, Caption>();
  for (const c of captions) {
    const text = cleanCaptionText(c.text);
    if (text) byTone.set(c.tone, { tone: c.tone, text, edited: c.tone === 'own' ? true : c.edited });
  }
  return TONES.flatMap((tone) => {
    const c = byTone.get(tone);
    return c ? [c] : [];
  });
}

export interface CaptionWrite {
  /** Rows to store, replacing whatever the photo had. Undefined = leave the saved captions alone. */
  rows?: Caption[];
  /** New value for photos.caption_tone. Undefined = leave it. */
  tone?: Tone | null;
  /** New value for photos.caption (the copy the public site reads). Undefined = leave it. */
  display?: string | null;
}

/**
 * Work out what a create or patch request means for the saved captions.
 *
 * - `captions` replaces the saved set. The shown tone is `captionTone` if given, else the current one;
 *   either way it only sticks if that tone still has a caption.
 * - `captionTone` alone switches which saved caption is shown.
 * - `caption` alone is the older single-caption form: it becomes the owner's own caption and is shown;
 *   null or empty stops showing a caption but keeps the saved ones.
 */
export function resolveCaptionWrite(
  input: { caption?: string | null; captions?: readonly Caption[]; captionTone?: Tone | null },
  current: { captions: readonly Caption[]; captionTone: Tone | null },
): CaptionWrite {
  if (input.captions !== undefined) {
    const rows = tidyCaptions(input.captions);
    const wanted = input.captionTone !== undefined ? input.captionTone : current.captionTone;
    const shown = rows.find((c) => c.tone === wanted) ?? null;
    return { rows, tone: shown?.tone ?? null, display: shown?.text ?? null };
  }
  if (input.captionTone !== undefined) {
    const shown = current.captions.find((c) => c.tone === input.captionTone) ?? null;
    return { tone: shown?.tone ?? null, display: shown?.text ?? null };
  }
  if (input.caption !== undefined) {
    const text = cleanCaptionText(input.caption ?? '');
    if (!text) return { tone: null, display: null };
    const rows = tidyCaptions([...current.captions.filter((c) => c.tone !== 'own'), { tone: 'own', text, edited: true }]);
    return { rows, tone: 'own', display: text };
  }
  return {};
}

export interface CaptionMerge {
  captions: Caption[];
  /** New AI text for tones the owner has edited: offered, never applied without a click. */
  pending: Partial<Record<AiTone, string>>;
}

/** Fold a fresh set of AI captions into the saved ones without touching anything the owner edited. */
export function mergeSuggestedCaptions(existing: readonly Caption[], suggested: Record<AiTone, string>): CaptionMerge {
  const byTone = new Map<Tone, Caption>(existing.map((c) => [c.tone, c]));
  const pending: Partial<Record<AiTone, string>> = {};
  for (const tone of AI_TONES) {
    const text = cleanCaptionText(suggested[tone] ?? '');
    if (!text) continue;
    const mine = byTone.get(tone);
    if (mine?.edited && cleanCaptionText(mine.text)) {
      if (cleanCaptionText(mine.text) !== text) pending[tone] = text;
    } else {
      byTone.set(tone, { tone, text, edited: false });
    }
  }
  return { captions: sortByTone([...byTone.values()]), pending };
}

/** Set one tone's text as typed by the owner (kept even when empty, so the field doesn't vanish mid-edit). */
export function setCaptionText(captions: readonly Caption[], tone: Tone, text: string): Caption[] {
  const rest = captions.filter((c) => c.tone !== tone);
  return sortByTone([...rest, { tone, text, edited: true }]);
}

function sortByTone(captions: Caption[]): Caption[] {
  return [...captions].sort((a, b) => TONES.indexOf(a.tone) - TONES.indexOf(b.tone));
}

/**
 * The tone to show after an edit: keep the current one while it has text; otherwise fall back to the
 * owner's own caption, then the first tone with text, then nothing.
 */
export function pickShownTone(captions: readonly Caption[], current: Tone | null): Tone | null {
  const has = (tone: Tone | null) => tone !== null && captions.some((c) => c.tone === tone && cleanCaptionText(c.text));
  if (has(current)) return current;
  if (has('own')) return 'own';
  return TONES.find((tone) => has(tone)) ?? null;
}

const MAX_HASHTAGS = 30; // Instagram's own ceiling

/** "#GreatBlueHeron, birds #birds" → ["#greatblueheron", "#birds"]: one lowercase tag per token, de-duplicated. */
export function parseHashtags(input: string | readonly string[]): string[] {
  const tokens = typeof input === 'string' ? input.split(/[\s,]+/) : input.flatMap((t) => t.split(/[\s,]+/));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    // Letters, digits and underscore are all a hashtag can hold; anything else ends it on Instagram.
    const body = token.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase();
    if (!body || seen.has(body)) continue;
    seen.add(body);
    out.push(`#${body}`);
    if (out.length === MAX_HASHTAGS) break;
  }
  return out;
}

/** Stored form: tags separated by single spaces, or null when there are none. */
export function normalizeHashtags(input: string | readonly string[] | null | undefined): string | null {
  const tags = parseHashtags(input ?? '');
  return tags.length ? tags.join(' ') : null;
}

/** What "Copy with hashtags" puts on the clipboard: the caption, a blank line, then the tags. */
export function withHashtags(caption: string, hashtags: string | null | undefined): string {
  const tags = normalizeHashtags(hashtags);
  const text = caption.trim();
  if (!tags) return text;
  return text ? `${text}\n\n${tags}` : tags;
}
