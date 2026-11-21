# Data model

The schema is [migrations/0001_init.sql](../migrations/0001_init.sql) plus [0003_ai_captions.sql](../migrations/0003_ai_captions.sql); the commented version is in [DESIGN.md → Data model](../docs/DESIGN.md#data-model). Seeds are [migrations/0002_seed.sql](../migrations/0002_seed.sql).

## Tables at a glance

- **`photos`**: one row per photo. `id` is a ULID and appears in public URLs. `status` goes `uploading` → `ready`, and `published` is 0/1. `r2_key` + `version` locate the original. `width`/`height` are in display orientation (after EXIF rotation). `placeholder` is a base64 ThumbHash. Then come the EXIF columns, the private `gps_lat`/`gps_lng`, the `watermark` flag, and `sort_order` (the order of `/all`). `subject`, `hashtags` and `caption_tone` are private. `caption` is the public caption: a copy of the saved caption that `caption_tone` names ([ai.md](ai.md)).
- **`photo_captions`**: the saved captions, one row per photo per tone, with an `edited` flag. Admin only.
- **`ai_votes`**: one row per settled blind comparison (winner and loser as `provider:model`).
- **`categories`**: slug, name, description, `cover_photo_id`, `default_layout` (`rows` | `masonry` | `grid`), `position`.
- **`photo_categories`**: membership, with a per-category `position`. A photo can be in several categories.
- **`locations`**: slug, name, region.
- **`settings`**: key/value. `site_title` and `default_layout` are read by the public pages. `ai_provider`, `ai_blind_test` and `ai_style_notes` are the AI settings. `watermark_text` is seeded but nothing reads it: the watermark is a pre-rendered PNG ([images.md](images.md)).

## The data layer: `src/lib/db.ts`

- **Every query lives here.** Pages and endpoints call its functions and never build SQL themselves. Values are always `?` binds. The only things interpolated into SQL strings are placeholder lists (`?,?,?`) and column names chosen in code.
- **Public and admin functions are separate families:**
  - Public functions return `PublicPhoto`, `Category` and `PublicLocation`. Photos are selected through `PUBLIC_PHOTO_SELECT`, which lists every column explicitly, and filtered with `PUBLIC_WHERE` (`status = 'ready' AND published = 1`). A `PublicPhoto` has no GPS, R2 key, status or published flag. **A new column stays private until you deliberately add it to `PUBLIC_PHOTO_SELECT`.**
  - Admin functions (`AdminPhoto`, `AdminCategory`, `Location`, `listCategoryPhotosAdmin`, …) return everything, GPS and R2 keys included. Only admin pages and `/api/admin/*` may call them.
  - `getImageSource` serves the image route only. It holds the R2 key and never leaves the server.
  - `getPublicCoverPhotoId` returns a category's cover id only when that photo is published and ready; category pages use it for the Open Graph image.
- **Mapping.** Rows are converted to camelCase objects (`toPublicPhoto`, `toAdminPhoto`, …); 0/1 columns become booleans. Empty strings are stored as `NULL` (`emptyToNull`).
- **Atomic writes** go through `db().batch([...])`.
- **Cleanup is explicit.** Deletes clear related rows themselves (covers, memberships, saved captions, `location_id`) rather than relying on foreign-key actions.
- **Saved captions** come back on `AdminPhoto.captions` from one `group_concat` (`\x1f` between tone, edited flag and text; `\x1e` between captions), so caption text is stripped of those two characters before it is stored. Caption writes go through `resolveCaptionWrite` ([captions.ts](../src/lib/captions.ts)), which keeps `photos.caption` and `caption_tone` in step with the rows.
- **`listLocationCentroids`** averages the private GPS of photos per location for the upload page's location suggestion. Admin only.
- **`findDuplicatePhotos`** matches a file about to be uploaded: same `bytes`, and the same filename or capture time.
- **A photo's categories** come back from one `group_concat`, ordered by category position, with `\x1f` between slug and name and `\x1e` between categories.
- **Slugs.** Create uses `slugify`, plus `-2`, `-3`, … until the slug is free. A PATCH to a slug that's taken is a 409 `slug_taken`. Category slugs in `RESERVED_CATEGORY_SLUGS` (`miscellaneous`) count as taken.

## Ordering

| List | Order | Set by |
| --- | --- | --- |
| Photos in a category | `photo_categories.position`, fractional | Drag-reorder → `POST /api/admin/categories/:id/move` |
| Categories | `categories.position`, renumbered 1..n | `PATCH /api/admin/categories` with `{ ids }` |
| `/all` | `photos.sort_order` | API only (`PATCH photos/:id` `sortOrder`); there is no UI yet |
| Location page | `taken_at` newest first (undated last), then upload time | — |
| Home | `created_at` newest first, 48 photos (`HOME_LIMIT`) | — |
| Miscellaneous (`/c/miscellaneous`) | `created_at` newest first: photos in no category have no manual order | — |

- `positionBetween(before, after)` in [src/lib/order.ts](../src/lib/order.ts) returns the midpoint. When the gap is ≤ 1e-6 it also flags a renumber, and `movePhotoInCategory` then rewrites the whole category as 1..n.
- New category memberships and new photos append at max + 1 (newest last).

## Migrations

- A schema change is a **new** numbered file: `migrations/0004_<what>.sql`. Never edit an applied migration; 0001 to 0003 are applied locally and in production. A data change that production needs (like `0004_site_title.sql`, which renames the site) goes the same way.
- Apply locally with `pnpm db:migrate:local`. `pnpm db:migrate:remote` changes production, so ask the owner first ([deploy.md](deploy.md)).
- The Deploy workflow applies new migrations to production on every push to `main`, before deploying the code. Merging a migration to `main` applies it.
- Local D1 data is keyed by `database_id`. If the id in `wrangler.jsonc` changes, migrate again.
- After adding a column, update in this order: the row interface and mapper in `db.ts`; then decide whether it's public (most aren't); then the zod schemas in `schemas.ts` if the admin edits it.

## Seeds

Seeded categories (Birds, Macro, Landscape, Astro, Family) and the six locations have **fixed ULIDs**. The e2e tests refer to them by id (Birds `01M53JH10086R420JC0GP7PP0A`, Marsh Creek State Park `01M53JH106D6B49CG33N0NQ49V`), so don't change them.
