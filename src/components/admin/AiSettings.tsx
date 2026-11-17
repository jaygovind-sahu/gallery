import { useState } from 'react';
import { PROVIDER_LABELS, type Provider, type Tally } from '../../lib/ai-pure';
import { api, confirmDanger, RequestFailed } from '../../lib/client/http';
import { btn, btnPrimary, input, label, useHydrated } from './ui';

export interface AiState {
  settings: { provider: Provider; blindTest: boolean; styleNotes: string };
  /** Models with an API key, i.e. the ones that can run. */
  models: { provider: Provider | 'mock'; model: string; key: string }[];
  votes: number;
  tally: Tally[];
}

/** Which model writes suggestions, the blind comparison, and the owner's notes on voice. */
export default function AiSettings({ initial }: { initial: AiState }) {
  const [state, setState] = useState(initial);
  const [notes, setNotes] = useState(initial.settings.styleNotes);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();

  const update = async (patch: Record<string, unknown>, done = 'Saved') => {
    setBusy(true);
    setStatus('Saving…');
    try {
      const next = await api<AiState>('PATCH', '/api/admin/ai/settings', patch);
      setState(next);
      setNotes(next.settings.styleNotes);
      setStatus(done);
    } catch (err) {
      setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const real = state.models.filter((m): m is { provider: Provider; model: string; key: string } => m.provider !== 'mock');
  const mock = state.models.some((m) => m.provider === 'mock');
  const canCompare = state.models.length >= 2;

  return (
    <div className="flex max-w-2xl flex-col gap-8" data-hydrated={hydrated || undefined}>
      {state.models.length === 0 && (
        <p className="m-0 rounded-md border border-divider p-3 text-sm text-ink">
          No AI provider is set up yet, so the Suggest button is hidden. Add an API key as a Worker secret (README, “AI suggestions”) and reload.
        </p>
      )}
      {mock && <p className="m-0 text-sm text-ink-muted">AI_MOCK is on: suggestions come from two built-in stand-ins, not a real model.</p>}

      <section className="flex flex-col gap-3">
        <h2 className={`${label} m-0 font-normal`}>Model</h2>
        {real.length === 0 && !mock && <p className="m-0 text-sm text-ink-muted">Nothing to choose yet.</p>}
        {real.map((m) => (
          <label key={m.key} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="provider"
              checked={state.settings.provider === m.provider || real.length === 1}
              disabled={busy || real.length === 1}
              onChange={() => update({ provider: m.provider })}
            />
            {PROVIDER_LABELS[m.provider]} <span className="text-ink-muted">({m.model})</span>
          </label>
        ))}
        <label className={`flex items-start gap-2 text-sm ${canCompare ? 'text-ink' : 'text-ink-muted'}`}>
          <input type="checkbox" className="mt-0.5" checked={state.settings.blindTest && canCompare} disabled={busy || !canCompare} onChange={(e) => update({ blindTest: e.target.checked })} />
          <span>
            Blind comparison: every Suggest runs both models and shows two unlabeled sets in random order. You pick one, and the pick is counted.
            {!canCompare && ' Needs an API key for both providers.'}
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={`${label} m-0 font-normal`}>Comparison results</h2>
        <p className="m-0 text-sm text-ink-muted">
          {state.votes === 0 ? 'No comparisons yet.' : `${state.votes} ${state.votes === 1 ? 'comparison' : 'comparisons'} so far.`}
        </p>
        {state.votes > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">Show which model won (this ends the blind part)</summary>
            <table className="mt-2 border-collapse text-ink">
              <tbody>
                {state.tally.map((t) => (
                  <tr key={t.model}>
                    <td className="py-0.5 pr-6">{t.model}</td>
                    <td className="py-0.5 tabular-nums">
                      {t.wins} of {state.votes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className={`${btn} mt-3`}
              disabled={busy}
              onClick={() => confirmDanger('Clear the comparison results?') && update({ resetVotes: true }, 'Results cleared')}
            >
              Clear results
            </button>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={`${label} m-0 font-normal`}>Your voice</h2>
        <p className="m-0 text-sm text-ink-muted">
          Sent with every request. Paste a few captions you have written and liked, and anything to prefer or avoid (words, emoji, how many hashtags).
        </p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8} maxLength={4000} className={input} aria-label="Voice notes" />
        <div className="flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={busy || notes === state.settings.styleNotes} onClick={() => update({ styleNotes: notes })}>
            Save notes
          </button>
          {status && (
            <span className="text-sm text-ink-muted" role="status">
              {status}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
