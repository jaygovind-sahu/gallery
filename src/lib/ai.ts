/**
 * AI suggestions: the provider calls (docs/DESIGN.md, "AI suggestions"). Admin-only; called from
 * /api/admin/ai/*. Prompt, output shape and tidying live in ai-pure.ts so they can be unit-tested.
 *
 * The provider is one function, `runModel`: adding or swapping a model means adding a case there.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from 'cloudflare:workers';
import { ApiError } from './api';
import {
  MODEL_OUTPUT_JSON_SCHEMA,
  PROVIDERS,
  SYSTEM_PROMPT,
  buildUserText,
  encodeModelToken,
  isUsable,
  modelOutputSchema,
  shuffled,
  toSuggestion,
  type ModelOutput,
  type ModelRef,
  type Provider,
  type SuggestContext,
  type SuggestResult,
  type SuggestionSet,
} from './ai-pure';
import { getSetting } from './db';
import { isProductionHost } from './host';

export type AiImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface AiImage {
  /** Base64, no data: prefix. A downscaled copy made in the browser, never the original. */
  data: string;
  mediaType: AiImageType;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-5-mini',
};

/** Room for the answer plus the model's own reasoning; the answer itself is a few hundred tokens. */
const MAX_OUTPUT_TOKENS = 4000;
const TIMEOUT_MS = 60_000;

/** AI_MOCK=1 swaps the real providers for canned answers, for local dev and tests. Never on the production hostname. */
export function mockAllowed(url: URL): boolean {
  return env.AI_MOCK === '1' && !isProductionHost(url.hostname, env.SITE_URL);
}

function modelFor(provider: Provider): string {
  const configured = provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;
  return configured?.trim() || DEFAULT_MODELS[provider];
}

function keyFor(provider: Provider): string {
  return (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY)?.trim() ?? '';
}

/** The models that can run right now: one per provider with an API key (or two stand-ins under AI_MOCK). */
export function availableModels(url: URL): ModelRef[] {
  if (mockAllowed(url)) {
    return [
      { provider: 'mock', model: 'a' },
      { provider: 'mock', model: 'b' },
    ];
  }
  return PROVIDERS.filter((p) => keyFor(p)).map((provider) => ({ provider, model: modelFor(provider) }));
}

export function aiEnabled(url: URL): boolean {
  return availableModels(url).length > 0;
}

export interface AiSettings {
  /** The provider used outside a blind comparison. */
  provider: Provider;
  /** Run both models on every request and let the owner pick a set without seeing which model wrote it. */
  blindTest: boolean;
  /** The owner's notes on voice, passed to the model with every request. */
  styleNotes: string;
}

export async function getAiSettings(): Promise<AiSettings> {
  const [provider, blind, notes] = await Promise.all([getSetting('ai_provider'), getSetting('ai_blind_test'), getSetting('ai_style_notes')]);
  return {
    provider: provider === 'openai' ? 'openai' : 'anthropic',
    blindTest: blind === '1',
    styleNotes: notes ?? '',
  };
}

/** Run the configured model, or both under a blind comparison, on one photo. */
export async function suggest(url: URL, image: AiImage, ctx: Omit<SuggestContext, 'styleNotes'>): Promise<SuggestResult> {
  const models = availableModels(url);
  if (!models.length) {
    throw new ApiError(503, 'ai_not_configured', 'No AI provider is set up. Add an API key (README, "AI suggestions").');
  }
  const settings = await getAiSettings();
  const context: SuggestContext = { ...ctx, styleNotes: settings.styleNotes };
  const run = async (ref: ModelRef): Promise<SuggestionSet> => {
    const suggestion = toSuggestion(await runModel(ref, image, context), context);
    if (!isUsable(suggestion)) throw new ApiError(502, 'ai_empty', 'The model returned nothing usable. Try again.');
    return { token: encodeModelToken(ref), suggestion };
  };

  if (settings.blindTest && models.length >= 2) {
    const [a, b] = shuffled(models);
    const results = await Promise.allSettled([run(a!), run(b!)]);
    const sets = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (sets.length === 2) return { sets, blind: true };
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (!sets.length) throw failure?.reason ?? new ApiError(502, 'ai_failed', 'Both models failed.');
    console.warn('AI blind comparison: one model failed', failure?.reason);
    return { sets, blind: false, note: 'One of the two models failed, so there is nothing to compare this time.' };
  }

  const chosen = models.find((m) => m.provider === settings.provider) ?? models[0]!;
  return { sets: [await run(chosen)], blind: false };
}

async function runModel(ref: ModelRef, image: AiImage, ctx: SuggestContext): Promise<ModelOutput> {
  const text = buildUserText(ctx);
  switch (ref.provider) {
    case 'anthropic':
      return runAnthropic(ref.model, image, text);
    case 'openai':
      return runOpenAI(ref.model, image, text);
    case 'mock':
      return mockOutput(ref.model, ctx);
  }
}

// ───────────────────────── Anthropic ─────────────────────────

async function runAnthropic(model: string, image: AiImage, text: string): Promise<ModelOutput> {
  const client = new Anthropic({ apiKey: keyFor('anthropic'), maxRetries: 1, timeout: TIMEOUT_MS });
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      // Low effort: this is short descriptive writing, and reasoning is billed as output.
      output_config: { effort: 'low', format: zodOutputFormat(modelOutputSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
            { type: 'text', text },
          ],
        },
      ],
    });
    logUsage(model, response.usage.input_tokens, response.usage.output_tokens);
    if (response.stop_reason === 'refusal') throw new ApiError(422, 'ai_refused', 'Claude declined to describe this photo.');
    if (response.stop_reason === 'max_tokens') throw new ApiError(502, 'ai_truncated', 'Claude ran out of room before finishing. Try again.');
    if (!response.parsed_output) throw new ApiError(502, 'ai_bad_output', 'Claude returned an answer in the wrong shape. Try again.');
    return response.parsed_output;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ApiError(502, 'ai_auth', 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.');
    }
    if (err instanceof Anthropic.NotFoundError) throw new ApiError(502, 'ai_model', `Anthropic does not know the model "${model}". Check ANTHROPIC_MODEL.`);
    if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, 'ai_rate_limited', 'Anthropic is rate-limiting or the spend limit is reached. Try again later.');
    if (err instanceof Anthropic.BadRequestError) throw new ApiError(502, 'ai_rejected', `Anthropic rejected the request: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new ApiError(504, 'ai_unreachable', 'Could not reach Anthropic. Try again.');
    if (err instanceof Anthropic.APIError) throw new ApiError(502, 'ai_failed', `Anthropic error ${err.status ?? ''}: ${err.message}`.trim());
    throw err;
  }
}

// ───────────────────────── OpenAI ─────────────────────────

interface OpenAIChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function runOpenAI(model: string, image: AiImage, text: string): Promise<ModelOutput> {
  const effort = (env.OPENAI_REASONING_EFFORT ?? 'low').trim();
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${keyFor('openai')}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        // Set OPENAI_REASONING_EFFORT to an empty string for a model that does not take this parameter.
        ...(effort ? { reasoning_effort: effort } : {}),
        response_format: { type: 'json_schema', json_schema: { name: 'photo_suggestions', strict: true, schema: MODEL_OUTPUT_JSON_SCHEMA } },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}`, detail: 'high' } },
              { type: 'text', text },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new ApiError(504, 'ai_unreachable', 'Could not reach OpenAI. Try again.');
  }
  const body = (await res.json().catch(() => ({}))) as OpenAIChatResponse;
  if (!res.ok) {
    const detail = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new ApiError(502, 'ai_auth', 'OpenAI rejected the API key. Check OPENAI_API_KEY.');
    if (res.status === 404) throw new ApiError(502, 'ai_model', `OpenAI does not know the model "${model}". Check OPENAI_MODEL.`);
    if (res.status === 429) throw new ApiError(429, 'ai_rate_limited', 'OpenAI is rate-limiting or the spend limit is reached. Try again later.');
    throw new ApiError(502, res.status === 400 ? 'ai_rejected' : 'ai_failed', `OpenAI: ${detail}`);
  }
  logUsage(model, body.usage?.prompt_tokens, body.usage?.completion_tokens);
  const choice = body.choices?.[0];
  if (choice?.message?.refusal) throw new ApiError(422, 'ai_refused', 'GPT declined to describe this photo.');
  if (choice?.finish_reason === 'length') throw new ApiError(502, 'ai_truncated', 'GPT ran out of room before finishing. Try again.');
  let raw: unknown;
  try {
    raw = JSON.parse(choice?.message?.content ?? '');
  } catch {
    throw new ApiError(502, 'ai_bad_output', 'GPT returned an answer that is not JSON. Try again.');
  }
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(502, 'ai_bad_output', 'GPT returned an answer in the wrong shape. Try again.');
  return parsed.data;
}

/** One line per call in the Worker logs, so spend can be read off without either provider's console. */
function logUsage(model: string, input: number | undefined, output: number | undefined): void {
  console.log(JSON.stringify({ event: 'ai_suggest', model, input_tokens: input ?? null, output_tokens: output ?? null }));
}

// ───────────────────────── mock (local dev and tests) ─────────────────────────

/** Canned answers that echo the request, so the UI and the tests can tell what was sent and which "model" wrote what. */
function mockOutput(variant: string, ctx: SuggestContext): ModelOutput {
  const given = ctx.subject?.trim();
  const name = given || 'Great Blue Heron';
  const place = ctx.location?.name ?? 'the marsh';
  const tag = variant.toUpperCase();
  return {
    subject: {
      present: true,
      fieldMarks: given ? '' : 'grey-blue body, black stripe over the eye, long neck',
      commonName: name,
      scientificName: given ? '' : 'Ardea herodias',
      confidence: given ? 'high' : 'medium',
      alternatives: given ? [] : ['Great Egret'],
    },
    titles: [`${name}, Waiting (${tag})`, `${name} at First Light (${tag})`, `Still Water, ${name} (${tag})`],
    captions: {
      fieldNotes: `[${tag}] A ${name.toLowerCase()} stands motionless at ${place}.`,
      poetic: `[${tag}] Patience, wearing the shape of a ${name.toLowerCase()}.`,
      playful: `[${tag}] This ${name.toLowerCase()} has been pretending to be a stick all morning.`,
    },
    hashtags: [name.replace(/\s+/g, ''), 'birdphotography', 'wildlife', `mock${variant}`],
    categories: ctx.allCategories.filter((c) => c.name === 'Birds').map((c) => c.name),
  };
}
