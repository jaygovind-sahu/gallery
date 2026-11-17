# AI suggestions and saved captions

A **Suggest** button on each upload card and on the photo edit page asks a model for titles, a caption in each tone, and hashtags. Captions are saved per tone; one is shown on the site and the rest stay in the admin for reuse (Instagram). Spec: [DESIGN.md → AI suggestions](../docs/DESIGN.md#ai-suggestions).

## The request, end to end

1. **The browser makes the image.** `makeAiImage` ([src/lib/client/suggest.ts](../src/lib/client/suggest.ts)) downscales to a 1568 px JPEG. On the upload page the source is the picked file; on the edit page it is the private preview (`/api/admin/img/:id/1600`). The original is never sent, and no extra Images transformation is used.
2. **`POST /api/admin/ai/suggest`** takes the image plus what is known: subject, capture time, location id, category ids, camera, lens, focal length, Lightroom keywords. The handler looks up the location's name and region and the category names itself.
3. **`suggest`** in [src/lib/ai.ts](../src/lib/ai.ts) picks the model(s), calls `runModel`, and tidies the answer with `toSuggestion`.
4. **Nothing is stored by the endpoint.** The island fills its fields; the owner saves (or uploads) as usual.

## Pure and Worker halves

- [src/lib/ai-pure.ts](../src/lib/ai-pure.ts): the system prompt, `buildUserText`, the output schema (zod and the matching JSON Schema), `toSuggestion`, the blind-comparison token and tally. Unit-tested.
- [src/lib/ai.ts](../src/lib/ai.ts): reads keys and settings, and holds one function per provider behind `runModel`. Adding or swapping a provider means adding a case there and an entry in `PROVIDERS`.
- [src/lib/captions.ts](../src/lib/captions.ts): tones, the merge rule for re-runs, what a caption write means for `photos.caption`, hashtag normalising. Pure; used by islands, schemas and `db.ts`.

## Providers

| Provider | Model (default) | Key | Call |
| --- | --- | --- | --- |
| `anthropic` | `ANTHROPIC_MODEL` (`claude-haiku-5-5`) | secret `ANTHROPIC_API_KEY` | `@anthropic-ai/sdk`, `messages.parse` with a zod output format, effort `low` |
| `openai` | `OPENAI_MODEL` (`gpt-5-mini`) | secret `OPENAI_API_KEY` | `fetch` to Chat Completions with a strict JSON Schema; `OPENAI_REASONING_EFFORT` (`low`; set it empty for a model that rejects the parameter) |
| `mock` | two stand-ins, `a` and `b` | `AI_MOCK=1` in `.dev.vars` | Canned answers that echo the request. Honoured only off the production hostname, like `DEV_BYPASS_AUTH` |

- A provider is available when its key is set. With no key (and no mock) `aiEnabled` is false, the pages hide the Suggest button, and the endpoint answers 503 `ai_not_configured`.
- Provider failures become `ApiError`s with an `ai_*` code and a message the island shows as is.
- Each real call logs one JSON line (`event: "ai_suggest"`, model, token counts) for reading spend from the Worker logs.

## What is sent, and what is not

- Sent: the downscaled image, the subject the owner typed, the location's **name and region**, the **month and year** taken, category names, gear, keywords, and the owner's voice notes.
- Never sent: GPS coordinates, the day or time, the original file, anything about other photos.
- Nothing is sent unless the owner clicks Suggest for that photo. That is the only guard on family photos, so don't add automatic or bulk generation without asking the owner.

## Subject

The subject is any living thing: a bird or other animal, an insect, or a plant (flower, tree, fungus). Landscapes, night skies and people have none.

General models are unreliable at species-level identification, so the subject is an input:

- If the owner fills in **Subject**, the prompt tells the model the name is correct and to write around it. `toSuggestion` reports confidence `given`.
- If it is blank, the model first writes the field marks it sees (`fieldMarks`, placed before the name in the schema so the model looks before it commits). It then names the species when those marks settle it ("House Finch", confidence high or medium). It falls back to the group ("a finch", confidence low) only when the photo can't tell the likely species apart. Before this rule, it stopped at the group even on clear photos.
- The island fills the field with the guess and shows a note with the confidence, the field marks and the alternatives, to be checked before publishing. Each alternative is a button: clicking one makes it the subject, as the owner's word, and the next Suggest writes around it.
- While the field still holds that untouched guess, a re-run sends no subject, so the model's own guess never comes back to it as the owner's word. Editing the field makes it the owner's. The flag lives in the island only: once saved and reloaded, a stored subject counts as given.

## Saved captions

- Table `photo_captions`: one row per photo per tone (`field-notes`, `poetic`, `playful`, `own`). `edited = 1` once the owner has typed in it; `own` is always edited.
- **`photos.caption` stays the public field.** It is a copy of the saved caption named by `photos.caption_tone`, written in the same batch (`updatePhoto` / `createPhoto` via `resolveCaptionWrite`). Public queries are unchanged.
- Request forms (`POST photos`, `PATCH photos/:id`):
  - `captions` replaces the saved set; `captionTone` chooses the shown one.
  - `captionTone` alone switches the shown caption.
  - `caption` alone is the older single-caption form: it becomes `own` and is shown; `null` stops showing a caption but keeps the saved ones.
- **Re-running Suggest** (`mergeSuggestedCaptions`): unedited captions are replaced; an edited one is kept and the new text is offered beside it ("Replace mine" / "Keep mine"). Titles, subject and hashtags the owner already has are not overwritten either.
- `photos.subject` and `photos.hashtags` are private. Hashtags are stored normalised (`#tag #tag`, lowercase, at most 30).

## The island: `TextFields`

[src/components/admin/TextFields.tsx](../src/components/admin/TextFields.tsx) renders title, subject, the captions and hashtags, and owns the Suggest button. `UploadQueue` cards use it in `compact` mode; `PhotoForm` uses the full form with Copy and Copy-with-hashtags buttons. `textPayload` turns its state into the request fields.

## Blind comparison

- Turned on at `/admin/ai` (setting `ai_blind_test`), and only active while two models are available.
- Each Suggest runs both models and returns two sets in random order. Each set carries an opaque `token` (`encodeModelToken`); the UI labels them Set A and Set B.
- Choosing a set applies it and posts both tokens to `POST /api/admin/ai/votes`, which stores a row in `ai_votes`.
- `/admin/ai` shows how many comparisons were made and, behind a disclosure, the wins per model.
- If one model fails, the other set is returned on its own with a note and no vote is taken.

## Settings

Stored in the `settings` table: `ai_provider` (`anthropic` | `openai`), `ai_blind_test` (`0` | `1`), `ai_style_notes` (the owner's voice notes, appended to every request). Read with `getAiSettings`, written by `PATCH /api/admin/ai/settings`.

## Not verified here

The real provider calls have never run in CI or in the build environment (no keys). The request shapes follow each provider's documented API and the mock covers everything around them; the first real run should be watched with `wrangler tail`.
