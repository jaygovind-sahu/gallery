import { useRef, useState } from 'react';
import type { SuggestionSet, Suggestion } from '../../lib/ai-pure';
import {
  AI_TONES,
  TONES,
  TONE_LABELS,
  mergeSuggestedCaptions,
  normalizeHashtags,
  pickShownTone,
  setCaptionText,
  tidyCaptions,
  withHashtags,
  type AiTone,
  type Caption,
  type Tone,
} from '../../lib/captions';
import { RequestFailed } from '../../lib/client/http';
import { recordVote, requestSuggestions, type SuggestRequestContext } from '../../lib/client/suggest';
import { btn, input, label } from './ui';

/** The words that go with a photo: what both the upload card and the edit page let the owner write. */
export interface TextState {
  title: string;
  subject: string;
  hashtags: string;
  captions: Caption[];
  /** The saved caption shown on the site. */
  captionTone: Tone | null;
}

export const EMPTY_TEXT: TextState = { title: '', subject: '', hashtags: '', captions: [], captionTone: null };

/** The request-body form of a TextState (`POST /api/admin/photos` and `PATCH …/:id` both take it). */
export function textPayload(t: TextState) {
  const captions = tidyCaptions(t.captions);
  return {
    title: t.title.trim() || null,
    subject: t.subject.trim() || null,
    hashtags: normalizeHashtags(t.hashtags),
    captions,
    captionTone: pickShownTone(captions, t.captionTone),
  };
}

interface Option {
  id: string;
  name: string;
}

interface Props {
  value: TextState;
  onChange: (next: TextState) => void;
  disabled?: boolean;
  /** False when no AI provider is configured: the Suggest button is left out. */
  aiEnabled: boolean;
  /** The image to describe, read when Suggest is clicked. Null = not available yet. */
  getImage: (() => Promise<Blob>) | null;
  /** What is known about the photo, read when Suggest is clicked. */
  getContext: () => Omit<SuggestRequestContext, 'subject'>;
  categories: Option[];
  categoryIds: string[];
  onAddCategory: (id: string) => void;
  /** Upload cards are tight on space: hashtags stay hidden until there are some, and there are no copy buttons. */
  compact?: boolean;
  /** Makes radio group names unique when several of these are on one page. */
  name: string;
}

interface Guess {
  name: string;
  scientificName: string | null;
  confidence: Suggestion['subject']['confidence'];
  alternatives: string[];
}

export default function TextFields({ value, onChange, disabled = false, aiEnabled, getImage, getContext, categories, categoryIds, onAddCategory, compact = false, name }: Props) {
  // Suggestions arrive seconds after the click; apply them to whatever the fields hold by then.
  const latest = useRef(value);
  latest.current = value;

  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [pending, setPending] = useState<Partial<Record<AiTone, string>>>({});
  const [pendingHashtags, setPendingHashtags] = useState<string | null>(null);
  const [guess, setGuess] = useState<Guess | null>(null);
  // While the subject field still holds the AI's own guess, a re-run must not hand it back as the owner's word.
  const guessRef = useRef<Guess | null>(null);
  guessRef.current = guess;
  const subjectIsGuess = () => guessRef.current !== null && latest.current.subject.trim() === guessRef.current.name;
  const [suggestedCategories, setSuggestedCategories] = useState<string[]>([]);
  const [choice, setChoice] = useState<SuggestionSet[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const set = (changes: Partial<TextState>) => onChange({ ...latest.current, ...changes });

  const setCaption = (tone: Tone, text: string) => {
    const captions = setCaptionText(latest.current.captions, tone, text);
    set({ captions, captionTone: pickShownTone(captions, latest.current.captionTone) });
  };

  /** Fill the fields from one set of suggestions without overwriting anything the owner wrote. */
  const apply = (s: Suggestion) => {
    const cur = latest.current;
    const merged = mergeSuggestedCaptions(cur.captions, s.captions);
    const tags = s.hashtags.join(' ');
    const hadSubject = Boolean(cur.subject.trim()) && !subjectIsGuess();
    onChange({
      title: cur.title.trim() ? cur.title : (s.titles[0] ?? ''),
      subject: hadSubject ? cur.subject : (s.subject.name ?? cur.subject),
      hashtags: cur.hashtags.trim() ? cur.hashtags : tags,
      captions: merged.captions,
      captionTone: pickShownTone(merged.captions, cur.captionTone),
    });
    setTitleOptions(s.titles);
    setPending(merged.pending);
    setPendingHashtags(cur.hashtags.trim() && tags && normalizeHashtags(cur.hashtags) !== tags ? tags : null);
    setGuess(!hadSubject && s.subject.name && s.subject.confidence !== 'given' ? { name: s.subject.name, scientificName: s.subject.scientificName, confidence: s.subject.confidence, alternatives: s.subject.alternatives } : null);
    setSuggestedCategories(s.categoryIds);
    setMessage('Suggestions added. Review and edit them before saving.');
  };

  const suggest = async () => {
    if (!getImage) return;
    setWorking(true);
    setChoice(null);
    setMessage('Asking the AI…');
    try {
      const subject = subjectIsGuess() ? null : latest.current.subject.trim() || null;
      const result = await requestSuggestions(await getImage(), { ...getContext(), subject });
      if (result.blind && result.sets.length === 2) {
        setChoice(result.sets);
        setMessage('Two sets from two models, in random order. Pick the one you prefer.');
      } else if (result.sets[0]) {
        apply(result.sets[0].suggestion);
        if (result.note) setMessage(result.note);
      }
    } catch (err) {
      setMessage(err instanceof RequestFailed ? err.message : (err as Error).message || 'The suggestion failed.');
    } finally {
      setWorking(false);
    }
  };

  const choose = (index: number) => {
    if (!choice) return;
    const winner = choice[index]!;
    const loser = choice[1 - index]!;
    recordVote(winner.token, loser.token);
    setChoice(null);
    apply(winner.suggestion);
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setMessage('Copying needs clipboard permission in this browser.');
    }
  };

  // The owner's own caption is always there to type in; AI tones appear once they have been generated.
  const tones = TONES.filter((tone) => tone === 'own' || value.captions.some((c) => c.tone === tone));
  const textOf = (tone: Tone) => value.captions.find((c) => c.tone === tone)?.text ?? '';
  const filled = tones.filter((tone) => textOf(tone).trim());
  const shown = pickShownTone(value.captions, value.captionTone);
  const showHashtags = !compact || Boolean(value.hashtags.trim()) || pendingHashtags !== null;
  const categoryChips = suggestedCategories.filter((id) => !categoryIds.includes(id)).flatMap((id) => categories.find((c) => c.id === id) ?? []);
  const small = 'text-xs text-ink-muted underline hover:text-ink disabled:opacity-40';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {!compact && <span className={label}>Title</span>}
        <input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={compact ? 'Title' : undefined}
          disabled={disabled}
          className={`${input} font-serif ${compact ? 'text-[15px]' : 'text-base'}`}
          aria-label="Title"
        />
        {titleOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5" role="group" aria-label="Suggested titles">
            {titleOptions.map((t) => (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => set({ title: t })}
                aria-pressed={value.title === t}
                className={`rounded-full border px-2.5 py-0.5 text-left font-serif text-[13px] transition-colors ${value.title === t ? 'border-ink text-ink' : 'border-divider text-ink-muted hover:border-ink-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {!compact && <span className={label}>Subject</span>}
        <div className="flex gap-2">
          <input
            value={value.subject}
            onChange={(e) => {
              setGuess(null);
              set({ subject: e.target.value });
            }}
            placeholder={compact ? 'Subject, e.g. Great Blue Heron' : 'e.g. Great Blue Heron'}
            disabled={disabled}
            className={input}
            aria-label="Subject"
          />
          {aiEnabled && (
            <button type="button" onClick={suggest} disabled={disabled || working || !getImage} className={`${btn} shrink-0`}>
              {working ? 'Suggesting…' : 'Suggest'}
            </button>
          )}
        </div>
        {aiEnabled && !guess && !compact && (
          <p className="text-xs text-ink-muted">Name the bird, animal or insect if you know it; the AI writes around what you give it.</p>
        )}
        {guess && (
          <p className="text-xs text-ink" role="note">
            AI guess, {guess.confidence} confidence{guess.scientificName ? ` (${guess.scientificName})` : ''}.
            {guess.alternatives.length > 0 && ` Could also be: ${guess.alternatives.join(', ')}.`} Check it before publishing.
          </p>
        )}
        {message && (
          <p className="text-xs text-ink-muted" role="status">
            {message}
          </p>
        )}
      </div>

      {choice && (
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Compare suggestions">
          {choice.map((set, i) => (
            <SetCard key={set.token} title={`Set ${'AB'[i]}`} suggestion={set.suggestion} onUse={() => choose(i)} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {!compact && <span className={label}>Captions</span>}
        {tones.map((tone) => {
          const text = textOf(tone);
          const offered = tone !== 'own' ? pending[tone as AiTone] : undefined;
          return (
            <div key={tone} className="flex flex-col gap-1">
              {(tones.length > 1 || !compact) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <span className={shown === tone ? 'text-ink' : ''}>{TONE_LABELS[tone]}</span>
                  {filled.length > 1 && text.trim() && (
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="radio"
                        name={`${name}-shown`}
                        checked={shown === tone}
                        onChange={() => set({ captionTone: tone })}
                        disabled={disabled}
                        aria-label={`Show ${TONE_LABELS[tone]} on the site`}
                      />
                      {shown === tone ? 'Shown on site' : 'Show on site'}
                    </label>
                  )}
                  {!compact && text.trim() && (
                    <>
                      <button type="button" className={small} onClick={() => copy(`${tone}`, text.trim())} aria-label={`Copy ${TONE_LABELS[tone]}`}>
                        {copied === tone ? 'Copied' : 'Copy'}
                      </button>
                      {normalizeHashtags(value.hashtags) && (
                        <button type="button" className={small} onClick={() => copy(`${tone}+tags`, withHashtags(text, value.hashtags))} aria-label={`Copy ${TONE_LABELS[tone]} with hashtags`}>
                          {copied === `${tone}+tags` ? 'Copied' : 'Copy with hashtags'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              <textarea
                value={text}
                onChange={(e) => setCaption(tone, e.target.value)}
                placeholder={tone === 'own' ? (compact ? 'Caption' : 'Write your own, one or two sentences') : undefined}
                disabled={disabled}
                rows={compact ? 2 : 3}
                className={input}
                aria-label={tone === 'own' ? 'Caption' : `${TONE_LABELS[tone]} version`}
              />
              {offered && (
                <p className="text-xs text-ink-muted">
                  New suggestion: “{offered}”{' '}
                  <button
                    type="button"
                    className={small}
                    onClick={() => {
                      const captions = latest.current.captions.map((c) => (c.tone === tone ? { ...c, text: offered, edited: false } : c));
                      set({ captions });
                      setPending((p) => ({ ...p, [tone]: undefined }));
                    }}
                  >
                    Replace mine
                  </button>{' '}
                  <button type="button" className={small} onClick={() => setPending((p) => ({ ...p, [tone]: undefined }))}>
                    Keep mine
                  </button>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {showHashtags && (
        <div className="flex flex-col gap-1">
          <span className={compact ? 'text-xs text-ink-muted' : label}>Hashtags{compact ? ' (private, for Instagram)' : ''}</span>
          <textarea
            value={value.hashtags}
            onChange={(e) => set({ hashtags: e.target.value })}
            onBlur={() => set({ hashtags: normalizeHashtags(latest.current.hashtags) ?? '' })}
            placeholder="#greatblueheron #birdphotography"
            disabled={disabled}
            rows={2}
            className={input}
            aria-label="Hashtags"
          />
          {!compact && <p className="text-xs text-ink-muted">Private. Shown only here, for copying to Instagram.</p>}
          {pendingHashtags && (
            <p className="text-xs text-ink-muted">
              New suggestion: {pendingHashtags}{' '}
              <button
                type="button"
                className={small}
                onClick={() => {
                  set({ hashtags: pendingHashtags });
                  setPendingHashtags(null);
                }}
              >
                Replace mine
              </button>{' '}
              <button type="button" className={small} onClick={() => setPendingHashtags(null)}>
                Keep mine
              </button>
            </p>
          )}
        </div>
      )}

      {categoryChips.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          Looks like it belongs in
          {categoryChips.map((c) => (
            <button key={c.id} type="button" disabled={disabled} onClick={() => onAddCategory(c.id)} className="rounded-full border border-divider px-2.5 py-0.5 text-ink hover:border-ink-muted">
              Add to {c.name}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

/** One unlabeled set in a blind comparison. */
function SetCard({ title, suggestion, onUse }: { title: string; suggestion: Suggestion; onUse: () => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-divider p-3 text-sm" aria-label={title}>
      <h3 className="m-0 text-xs uppercase tracking-wide text-ink-muted">{title}</h3>
      {suggestion.subject.name && suggestion.subject.confidence !== 'given' && (
        <p className="m-0 text-xs text-ink-muted">
          Sees: {suggestion.subject.name} ({suggestion.subject.confidence} confidence)
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-serif text-[15px] text-ink">
        {suggestion.titles.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <dl className="m-0 flex flex-col gap-1.5">
        {AI_TONES.map((tone) => (
          <div key={tone}>
            <dt className="text-xs text-ink-muted">{TONE_LABELS[tone]}</dt>
            <dd className="m-0 text-ink">{suggestion.captions[tone]}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 break-words text-xs text-ink-muted">{suggestion.hashtags.join(' ')}</p>
      <button type="button" onClick={onUse} className={`${btn} self-start`}>
        Use {title.toLowerCase()}
      </button>
    </section>
  );
}
