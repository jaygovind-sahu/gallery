# Testing

What has to be tested is set by [DESIGN.md → Testing checklist](../docs/DESIGN.md#testing-checklist).

## Unit: Vitest

- Run `pnpm test`, or `pnpm test:watch`. Files are `tests/unit/*.test.ts`.
- Tests run in plain Node with no Worker bindings, so only pure modules can be tested. Anything that imports `cloudflare:workers` is out of reach: move the logic into a pure module first ([architecture.md](architecture.md#module-conventions)).

| File | Covers |
| --- | --- |
| `auth.test.ts` | JWT valid / expired / wrong aud / wrong email / bad signature (local key set passed as `getKey`); token extraction from header and cookie |
| `exif-format.test.ts` | Shutter, aperture, exposure compensation, the EXIF line, the info panel's exposure figures, dates |
| `gallery.test.ts` | Layout resolution, alt text, srcset sources, the lightbox's real-size cap, placeholders and captions |
| `images.test.ts` | Size allowlist, version parsing, URLs, format negotiation, R2 and cache keys, dimension reconciliation |
| `slug.test.ts` | Slugify; the reserved `miscellaneous` category slug |
| `order.test.ts` | Fractional positions, renumbering, appending |
| `captions.test.ts` | What a caption write means for the shown caption; the re-run merge rule; shown-tone fallback; hashtag normalising |
| `walk.test.ts` | Walk-through room: its natural size and the repeats of a small collection, a large one hung once, the smallest room, prints in order on both walls, even spacing, the corridor, the inner prints' angled stretches and the inner wall's surface, the walking view's turn, angles, print and frame sizes, focus distance and the view widened to fit, where the lightbox draws a photo |
| `ai.test.ts` | The text sent to the model (place and month, never time or coordinates); tidying a model's answer; schema parity; blind-comparison tokens and tally; nearest location from GPS; production hostname and site origin |

## End to end: Playwright

- Run `pnpm fixtures` once: it generates the test JPEGs in `tests/fixtures/` with sharp, and they're gitignored.
- Then `pnpm test:e2e` runs everything, or `pnpm test:e2e tests/e2e/<spec>.ts` runs one spec.
- **Server:** tests run against `pnpm dev` on :4321 with local D1/R2 and the auth bypass. Playwright starts the server, or reuses one already running.
  - Run by an AI agent (`CLAUDECODE=1`), `astro dev` moves itself to the background and its foreground process exits, so Playwright stops with "Process from config.webServer exited early". Start it first with `pnpm astro dev --background`, check it isn't `dev:live`, then run the tests.
- **Browsers:** chromium only, in two projects, `desktop` (Desktop Chrome) and `phone` (Pixel 7). One worker, serial.
- **Run time:** the full suite takes over 10 minutes because of the throttled 30 MB upload. Run single specs while iterating.
- Tests create and delete real rows and R2 objects in the local store. **Never run them while `pnpm dev:live` is up.**
- **Don't edit files while the suite runs.** Tailwind's Vite plugin scans the whole project, Markdown included, and reloads open pages when a scanned file changes. A reload mid-upload loses the queue, and the upload test fails and leaves a stuck "uploading" row that breaks the library test.
- `upload.spec.ts` doesn't delete the photos it uploads; they stay in local D1 and R2 as drafts.

| Spec | Covers |
| --- | --- |
| `upload.spec.ts` | Batch upload with shared fields; stored EXIF and dimensions; browser-side rejection of > 100 MB and non-images |
| `admin.spec.ts` | Library filters (including "No category") and bulk actions; edit, replace (version bump), delete; categories (rename, reorder, cover, drag-reorder); locations (merge, delete) |
| `images.spec.ts` | AVIF/WebP per size, immutable caching, portrait stays portrait, no metadata, watermark (remote only), 404 cases |
| `ai.spec.ts` | Suggest on an upload card and on the edit page (against `AI_MOCK=1`); saved captions and which one is public; re-run keeps edits; blind comparison counts a pick; duplicate warning; location from GPS; draft default and saving edits after upload; AI settings |
| `gallery.spec.ts` | Photos on category / all / home / location pages; three layouts, persistence and `?layout=`; the lightbox never enlarging a photo past real size (1× and 2× screens); lightbox and `/p/:id` history; the spec sheet opening with each photo, its figures, never covering the photo, and `i`; on phones the Details bar and dragging the sheet closed; the header's Categories menu leaving out empty categories, Miscellaneous and its page, and a reserved-slug category; tiles loading before hydration or after a failure; deterrents; unpublish → 404 page; unknown pages → 404 page; security headers; a category's Open Graph image is its cover, never a draft |

### Writing e2e tests that don't flake

- After each navigation, wait for the island's `[data-hydrated]` before interacting.
- Use role and label locators, not `getByText`: Astro's dev toolbar echoes island props as text.
- Set up data through the admin API (`POST /api/admin/photos`, then `PUT …/original`) unless the UI is what's under test; `gallery.spec.ts` has a helper.
- Use the fixed seed ids for categories and locations ([data-model.md](data-model.md#seeds)).
- `ai.spec.ts` needs `AI_MOCK=1` in `.dev.vars` and fails its `beforeAll` with a message if the mock isn't on. No test calls a real provider.
- Match labels exactly on pages with `TextFields` (`getByLabel('Title', { exact: true })`): after a Suggest, other elements have labels containing the same words.
- Scratch Playwright scripts must live inside the project directory, or `@playwright/test` won't resolve. Outside it, load it with `createRequire('<repo>/package.json')`.
- The CSP isn't sent by `astro dev`, so the suite can't catch a CSP break. See [development.md → Checking the CSP](development.md#checking-the-csp).

### Checking the real watermark

The local Images binding ignores `draw()`, so the watermark test skips by default. To run it:

1. Temporarily set `"images": { "binding": "IMAGES", "remote": true }` in `wrangler.jsonc`. This needs `wrangler login`; D1 and R2 stay local.
2. Run `REMOTE_IMAGES=1 pnpm test:e2e tests/e2e/images.spec.ts`. It uses real transformations from the monthly allowance.
3. Revert the config.

## Manual checks

The spec's "Manual before launch" list. Still open: Lighthouse, Safari and a real phone (see the Status table in [README.md](../README.md#status)).
