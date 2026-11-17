import type { APIRoute } from 'astro';
import { availableModels, getAiSettings } from '../../../../lib/ai';
import { modelKey, tallyVotes } from '../../../../lib/ai-pure';
import { handle, json, parseJson } from '../../../../lib/api';
import { clearAiVotes, listAiVotes, setSetting } from '../../../../lib/db';
import { aiSettingsSchema } from '../../../../lib/schemas';

export const prerender = false;

async function state(url: URL) {
  const [settings, votes] = await Promise.all([getAiSettings(), listAiVotes()]);
  return {
    settings,
    /** Models with an API key, i.e. the ones that can run. */
    models: availableModels(url).map((m) => ({ provider: m.provider, model: m.model, key: modelKey(m) })),
    votes: votes.length,
    tally: tallyVotes(votes),
  };
}

export const GET: APIRoute = ({ url }) => handle(async () => json(await state(url)));

export const PATCH: APIRoute = ({ request, url }) =>
  handle(async () => {
    const patch = await parseJson(request, aiSettingsSchema);
    if (patch.provider !== undefined) await setSetting('ai_provider', patch.provider);
    if (patch.blindTest !== undefined) await setSetting('ai_blind_test', patch.blindTest ? '1' : '0');
    if (patch.styleNotes !== undefined) await setSetting('ai_style_notes', patch.styleNotes);
    if (patch.resetVotes) await clearAiVotes();
    return json(await state(url));
  });
