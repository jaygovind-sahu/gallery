/**
 * The provider-independent half of AI suggestions (docs/DESIGN.md, "AI suggestions"): what we ask for,
 * the shape we expect back, and how the answer is tidied. No bindings and no network, so it is unit-tested;
 * src/lib/ai.ts holds the provider calls.
 */
import { z } from 'zod';
import { AI_TONES, cleanCaptionText, parseHashtags, type AiTone } from './captions';

// This module also runs in the browser (admin islands). Without `jitless`, zod probes `new Function` on first
// use, which the CSP blocks and reports as a violation even though zod catches it. In the Worker the probe is
// already skipped, so this changes nothing there.
z.config({ jitless: true });

export const PROVIDERS = ['anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = { anthropic: 'Claude', openai: 'GPT' };

/**
 * What the model is asked to return. Every field is required so both providers' strict modes accept it.
 * Field order matters: models write fields in order, so `fieldMarks` comes before the name to make the
 * model look at the evidence before it commits to one.
 */
export const modelOutputSchema = z.object({
  subject: z.object({
    present: z.boolean(),
    fieldMarks: z.string(),
    commonName: z.string(),
    scientificName: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
    alternatives: z.array(z.string()),
  }),
  titles: z.array(z.string()),
  captions: z.object({ fieldNotes: z.string(), poetic: z.string(), playful: z.string() }),
  hashtags: z.array(z.string()),
  categories: z.array(z.string()),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** The same shape as a JSON Schema, for providers that take one directly. Keep in step with modelOutputSchema. */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'titles', 'captions', 'hashtags', 'categories'],
  properties: {
    subject: {
      type: 'object',
      additionalProperties: false,
      required: ['present', 'fieldMarks', 'commonName', 'scientificName', 'confidence', 'alternatives'],
      properties: {
        present: { type: 'boolean' },
        fieldMarks: { type: 'string' },
        commonName: { type: 'string' },
        scientificName: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        alternatives: { type: 'array', items: { type: 'string' } },
      },
    },
    titles: { type: 'array', items: { type: 'string' } },
    captions: {
      type: 'object',
      additionalProperties: false,
      required: ['fieldNotes', 'poetic', 'playful'],
      properties: { fieldNotes: { type: 'string' }, poetic: { type: 'string' }, playful: { type: 'string' } },
    },
    hashtags: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** What the admin UI gets back. */
export interface Suggestion {
  subject: {
    /** Null when the photo has no bird, animal, insect or plant as its subject. */
    name: string | null;
    scientificName: string | null;
    /** `given` = the owner typed it, so nothing was guessed. */
    confidence: 'given' | 'high' | 'medium' | 'low';
    alternatives: string[];
    /** What the model went by for a guessed name ("streaked flanks, red only on the head and breast"). */
    fieldMarks: string | null;
  };
  titles: string[];
  captions: Record<AiTone, string>;
  /** "#tag" strings. */
  hashtags: string[];
  /** Ids of existing categories the photo seems to belong to. */
  categoryIds: string[];
}

export interface SuggestionSet {
  /** Opaque handle for the model that wrote this set; sent back with a blind vote. */
  token: string;
  suggestion: Suggestion;
}

export interface SuggestResult {
  sets: SuggestionSet[];
  /** True when there are two unlabeled sets to choose between. */
  blind: boolean;
  note?: string;
}

export interface SuggestContext {
  /** Typed by the owner. When present the model writes around it and does not second-guess it. */
  subject?: string | null;
  /** ISO local time; only the month and year are passed on. */
  takenAt?: string | null;
  location?: { name: string; region: string | null } | null;
  /** Categories already chosen for the photo. */
  categoryNames?: string[];
  /** Every category that exists, so the model can only suggest real ones. */
  allCategories: { id: string; name: string }[];
  camera?: string | null;
  lens?: string | null;
  focalLengthMm?: number | null;
  /** Lightroom keywords read from the file. */
  keywords?: string[];
  /** The owner's own notes on voice, with example captions. */
  styleNotes?: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-12T14:03:11" → "October 2026". The day and time add nothing and stay private. */
export function monthAndYear(takenAt: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(takenAt ?? '');
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

export const SYSTEM_PROMPT = `You write the words that go with one photograph in a photographer's online portfolio. They shoot birds, insects, flowers and other macro subjects, landscapes, night skies and family. You will be shown the photo and what is known about it, and you return titles, captions in three tones, and hashtags.

Where each piece is used, so you can judge length and content:
- Title: shown on one line under the photo's thumbnail and used as its alt text. It is a label, 2 to 6 words and at most about 40 characters, in title case, with no closing punctuation. Offer three that differ in angle rather than in wording.
- Caption: shown when someone opens the photo, and reused by the photographer on Instagram. One or two sentences, roughly 100 to 200 characters. It adds what the title cannot: what is happening, the light, the moment. It never repeats the title, and it carries no hashtags and no emoji.
- Hashtags: pasted under an Instagram post. 10 to 15 of them, without the # sign and without spaces, running from specific (the species, the place) to general (the genre).

The three caption tones:
- fieldNotes: plain and observational, the way a naturalist's notebook reads. What the subject is doing, where, in what light.
- poetic: quiet and reflective. An image or a feeling, held in few words, without grand statements.
- playful: light and witty, as if the photographer were smiling while writing it. Gentle, never mocking the subject.

Naming the subject:
- When the photo's subject is a living thing (a bird or another animal, an insect, or a plant such as a flower, tree or fungus), its name belongs in every title and every caption. This is the one firm rule; visitors come to this portfolio to learn what they are looking at.
- If the photographer has given the subject, that name is correct. The photographer was there and often confirmed it with a field guide. Use it exactly, set "present" to true and "confidence" to "high", and do not offer alternatives.
- If the subject is not given, identify it the way a birder or naturalist would. First find the features that tell it apart from similar species (for a bird: bill shape, where the colour sits, streaking, wing bars, face markings; for an insect: wing pattern and markings; for a plant: flower shape and colour, how the flowers are arranged, the leaves), and write them in "fieldMarks" as a short phrase, such as "streaked brown flanks, red only on the head and breast". Then weigh them against the place and month.
- When those features point to one species, name the species, not only its group: "House Finch", not "a finch". A clear, close photo of a common species can usually be named. Set "confidence" to "high" when the features settle it, or "medium" when one species is most likely but another is still possible, and list those others in "alternatives". Give the species' scientific name.
- Only when the photo cannot tell the likely species apart (the deciding features are hidden, too small or too blurred) use the broader name in "commonName" and in the writing ("a sparrow", "a skipper butterfly", "an orchid"), set "confidence" to "low", list the likely species in "alternatives", and leave "scientificName" empty. A wrong species name published under the photographer's name is worse than a broader right one, but stopping at the group when the features are plain to see is not caution, it is a missed identification.
- When the plumage or markings clearly show the sex or age, say so in the titles and captions ("a male House Finch"), and keep "commonName" to the species.
- If the photo's subject is not a living thing (a landscape, the night sky, people), set "present" to false and leave the names and "fieldMarks" empty. When the photographer gave the subject, leave "fieldMarks" empty too.

Write only what the photo and the notes support. Do not invent a location, a time of day, a behaviour or a story that is not visible or given. People in family photos are never named or described by appearance; write about the moment instead.

Avoid the worn phrases of photo captions: "nature's beauty", "majestic", "captured", "breathtaking", "in all its glory", and openings like "A stunning shot of". Plain, specific words read better.

For "categories", return the names from the provided list that fit the photo, and nothing that is not on the list.`;

/** The text half of the user turn: everything known about the photo, as plain labelled lines. */
export function buildUserText(ctx: SuggestContext): string {
  const lines: string[] = [];
  const subject = ctx.subject?.trim();
  lines.push(subject ? `Subject, given by the photographer: ${subject}` : 'Subject: not given. Identify it only as far as you can be sure.');
  if (ctx.location) lines.push(`Place: ${ctx.location.name}${ctx.location.region ? `, ${ctx.location.region}` : ''}`);
  const when = monthAndYear(ctx.takenAt);
  if (when) lines.push(`Taken: ${when}`);
  if (ctx.categoryNames?.length) lines.push(`Filed under: ${ctx.categoryNames.join(', ')}`);
  const gear = [ctx.camera?.trim(), ctx.lens?.trim(), ctx.focalLengthMm ? `${ctx.focalLengthMm} mm` : null].filter(Boolean);
  if (gear.length) lines.push(`Gear: ${gear.join(', ')}`);
  if (ctx.keywords?.length) lines.push(`The photographer's own keywords for this photo: ${ctx.keywords.slice(0, 30).join(', ')}`);
  lines.push(`Categories to choose from: ${ctx.allCategories.map((c) => c.name).join(', ') || 'none'}`);
  const notes = ctx.styleNotes?.trim();
  if (notes) lines.push('', 'How the photographer likes the captions to read, in their own words:', notes);
  return lines.join('\n');
}

const TITLE_LIMIT = 80;
const CAPTION_LIMIT = 600;

/** Turn a model's raw answer into what the UI uses: trimmed, de-duplicated, and tied back to real category ids. */
export function toSuggestion(raw: ModelOutput, ctx: Pick<SuggestContext, 'subject' | 'allCategories'>): Suggestion {
  const given = ctx.subject?.trim() || null;
  const guessed = raw.subject.present ? raw.subject.commonName.trim() || null : null;
  const titles = uniqueStrings(raw.titles.map((t) => t.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').trim().slice(0, TITLE_LIMIT))).slice(0, 3);
  const caption = (text: string) => cleanCaptionText(text.replace(/\s+/g, ' ')).slice(0, CAPTION_LIMIT);
  const byName = new Map(ctx.allCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const categoryIds = uniqueStrings(raw.categories.flatMap((name) => byName.get(name.trim().toLowerCase()) ?? []));
  return {
    subject: {
      name: given ?? guessed,
      scientificName: (given ?? guessed) ? raw.subject.scientificName.trim() || null : null,
      confidence: given ? 'given' : raw.subject.confidence,
      alternatives: given ? [] : uniqueStrings(raw.subject.alternatives.map((a) => a.trim())).slice(0, 4),
      fieldMarks: given || !guessed ? null : raw.subject.fieldMarks.replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 200) || null,
    },
    titles,
    captions: {
      'field-notes': caption(raw.captions.fieldNotes),
      poetic: caption(raw.captions.poetic),
      playful: caption(raw.captions.playful),
    },
    hashtags: parseHashtags(raw.hashtags),
    categoryIds,
  };
}

function uniqueStrings(xs: string[]): string[] {
  return Array.from(new Set(xs.filter(Boolean)));
}

/** A suggestion is usable once it has at least one title or one caption. */
export function isUsable(s: Suggestion): boolean {
  return s.titles.length > 0 || AI_TONES.some((tone) => s.captions[tone]);
}

// ───────────────────────── blind comparison ─────────────────────────

export interface ModelRef {
  provider: Provider | 'mock';
  model: string;
}

/** "anthropic:claude-haiku-5-5": how a model is recorded in ai_votes. */
export function modelKey(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

/**
 * An opaque handle for "the model that wrote this set", so the browser can report which set won without
 * the admin page ever displaying which model that was. It hides the name from the owner's own eyes only;
 * it is not a secret.
 */
export function encodeModelToken(ref: ModelRef): string {
  return btoa(modelKey(ref)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeModelToken(token: string): string | null {
  try {
    const key = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    return /^(anthropic|openai|mock):[\w.\-:]{1,80}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** Fisher–Yates with an injectable random source, so the set order carries no hint and tests are repeatable. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface Tally {
  model: string;
  wins: number;
}

/** Wins per model from the vote rows, most wins first; models that only ever lost are listed with 0. */
export function tallyVotes(votes: readonly { winner: string; loser: string }[]): Tally[] {
  const wins = new Map<string, number>();
  for (const v of votes) {
    wins.set(v.winner, (wins.get(v.winner) ?? 0) + 1);
    if (!wins.has(v.loser)) wins.set(v.loser, 0);
  }
  return [...wins.entries()].map(([model, n]) => ({ model, wins: n })).sort((a, b) => b.wins - a.wins || a.model.localeCompare(b.model));
}
