# Testing

What has to be tested is set by [DESIGN.md → Testing checklist](../docs/DESIGN.md#testing-checklist).

## Unit: Vitest

- Run `pnpm test`, or `pnpm test:watch`. Files are `tests/unit/*.test.ts`.
- Tests run in plain Node with no Worker bindings, so only pure modules can be tested. Anything that imports `cloudflare:workers` is out of reach: move the logic into a pure module first ([architecture.md](architecture.md#module-conventions)).

| File | Covers |
| --- | --- |
| `auth.test.ts` | JWT valid / expired / wrong aud / wrong email / bad signature (local key set passed as `getKey`); token extraction from header and cookie |
| `exif-format.test.ts` | Shutter, aperture, exposure compensation, the EXIF line, dates |
| `gallery.test.ts` | Layout resolution, alt text, srcset sources, placeholders and captions |
| `images.test.ts` | Size allowlist, version parsing, URLs, format negotiation, R2 and cache keys, dimension reconciliation |
| `order.test.ts` | Fractional positions, renumbering, appending |

## End to end: Playwright

- Run `pnpm fixtures` once: it generates the test JPEGs in `tests/fixtures/` with sharp, and they're gitignored.
- Then `pnpm test:e2e` runs everything, or `pnpm test:e2e tests/e2e/<spec>.ts` runs one spec.
- **Server:** tests run against `pnpm dev` on :4321 with local D1/R2 and the auth bypass. Playwright starts the server, or reuses one already running.
- **Browsers:** chromium only, in two projects, `desktop` (Desktop Chrome) and `phone` (Pixel 7). One worker, serial.
- **Run time:** the full suite takes over 10 minutes because of the throttled 30 MB upload. Run single specs while iterating.
- Tests create and delete real rows and R2 objects in the local store. **Never run them while `pnpm dev:live` is up.**

| Spec | Covers |
| --- | --- |
| `upload.spec.ts` | Batch upload with shared fields; stored EXIF and dimensions; browser-side rejection of > 100 MB and non-images |
| `admin.spec.ts` | Library filters and bulk actions; edit, replace (version bump), delete; categories (rename, reorder, cover, drag-reorder); locations (merge, delete) |
| `images.spec.ts` | AVIF/WebP per size, immutable caching, portrait stays portrait, no metadata, watermark (remote only), 404 cases |
| `gallery.spec.ts` | Photos on category / all / home / location pages; three layouts, persistence and `?layout=`; lightbox and `/p/:id` history; tiles loading before hydration or after a failure; deterrents; unpublish → 404 |

### Writing e2e tests that don't flake

- After each navigation, wait for the island's `[data-hydrated]` before interacting.
- Use role and label locators, not `getByText`: Astro's dev toolbar echoes island props as text.
- Set up data through the admin API (`POST /api/admin/photos`, then `PUT …/original`) unless the UI is what's under test; `gallery.spec.ts` has a helper.
- Use the fixed seed ids for categories and locations ([data-model.md](data-model.md#seeds)).
- Scratch Playwright scripts must live inside the project directory, or `@playwright/test` won't resolve.

### Checking the real watermark

The local Images binding ignores `draw()`, so the watermark test skips by default. To run it:

1. Temporarily set `"images": { "binding": "IMAGES", "remote": true }` in `wrangler.jsonc`. This needs `wrangler login`; D1 and R2 stay local.
2. Run `REMOTE_IMAGES=1 pnpm test:e2e tests/e2e/images.spec.ts`. It uses real transformations from the monthly allowance.
3. Revert the config.

## Manual checks

The spec's "Manual before launch" list. Still open: Lighthouse, Safari and a real phone (see the Status table in [README.md](../README.md#status)).
