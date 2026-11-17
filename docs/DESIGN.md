# Gallery — Design Doc

As of Oct 16, 2026 · Owner: Jaygovind Sahu · AI suggestions added Nov 17, 2026

## Overview & goals

Build a self-hosted photography portfolio at **gallery.jaygovindsahu.com**, running entirely on Cloudflare, with a private upload/admin area only the owner can reach. The owner is a single photographer (Jaygovind Sahu) who shoots birds, macro, landscape, astro and family photos in mixed aspect ratios, edits in Lightroom, and uploads full-resolution JPEG exports.

v1 must deliver:

1. **Excellent image quality on the web** — crisp on retina and 4K screens, modern formats (AVIF/WebP), no layout shift, fast first paint.
2. **Effortless uploads from laptop or phone** — EXIF read automatically; the owner only types title, caption, location and categories.
3. **Full-resolution originals kept private** — visitors only ever receive resized derivatives; large views carry a burned-in watermark.
4. **Near-zero running cost** — fits Cloudflare free tiers at the expected scale (20–30 photos at launch, growing to hundreds); a few dollars a month is acceptable if exceeded.

Audience for this doc: a coding agent building the project in this repo. Where this doc leaves a choice open, pick the simplest option that satisfies the requirement and note it in the README.

## Scope

v1 is a public gallery plus a private admin; selling, social features and RAW handling are out.

**In scope (v1)**

- Categories: Birds, Macro, Landscape, Astro, Family (all public). A photo can belong to several categories.
- Location tags from a reusable list (e.g. Bombay Hook NWR, Marsh Creek State Park); location pages list every photo taken there.
- Per-photo fields: title, caption, date taken, location, categories, plus EXIF read automatically (camera, lens, focal length, aperture, shutter, ISO, exposure compensation).
- Three gallery layouts — justified rows, masonry, uniform grid — with a visitor toggle and an owner-set default per category.
- Full-screen lightbox: swipe, pinch/scroll zoom, keyboard arrows, info panel, shareable per-photo URL.
- Download deterrents and a burned-in text watermark "© Jaygovind Sahu" on large derivatives only.
- Private admin (laptop + mobile): batch upload, edit details, publish/unpublish, drag-to-reorder within a category, set category cover, delete, replace original, manage categories and locations.
- AI suggestions in the admin: titles, a caption in each of three tones, and hashtags, on request per photo. Captions are saved per tone; the owner picks the one the site shows and reuses the others elsewhere (Instagram).

**Non-goals (v1)**

- RAW files (NEF) and HEIC. Accept JPEG; PNG and WebP are optional.
- Print sales or licensing — keep the schema easy to extend, build nothing for it.
- Lightroom plugin or publish service.
- Multiple users, comments, likes, accounts for visitors.
- Map view, search, RSS (see Future).

## Architecture

One Cloudflare Worker running Astro handles every request; D1, R2 and the Images binding sit behind it and nothing else is public.

```
                        ┌──────────────── Cloudflare account ─────────────────────────────┐
                        │                                                                 │
┌──────────────┐        │                    ┌────────────────────────┐   ┌─────────────┐ │
│ Visitor      │ pages + images              │ Worker (Astro app)     │──▶│ D1 database │ │
│ views pages, │────────┼───────────────────▶│                        │   │ photos,     │ │
│ resized imgs │        │                    │ Public pages           │   │ categories, │ │
└──────────────┘        │                    │  /, /c, /l, /p, /all   │   │ order       │ │
                        │                    │ Image route /img       │   └─────────────┘ │
                        │                    │  resize + watermark,   │   ┌─────────────┐ │
                        │                    │  cached at the edge    │──▶│ R2 (private)│ │
                        │                    │ Admin + API            │   │ originals,  │ │
┌──────────────┐        │  ┌──────────────┐  │  JWT checked again     │   │ never served│ │
│ Owner        │        │  │ Access       │  │                        │   └─────────────┘ │
│ laptop/phone,│────────┼─▶│ email-code   │─▶│                        │   ┌─────────────┐ │
│ uploads/edits│        │  │ login, guards│  │                        │──▶│ Images      │ │
└──────────────┘        │  │ the admin    │  └────────────────────────┘   │ binding     │ │
                        │  └──────────────┘                               │ AVIF/WebP,  │ │
                        │                                                 │ watermark   │ │
                        │                                                 └─────────────┘ │
                        └─────────────────────────────────────────────────────────────────┘
```

Visitors only ever receive HTML and resized images from the Worker. The owner's admin traffic passes Cloudflare Access first, and the Worker re-checks the Access token before touching D1 or R2.

## Data model

All metadata lives in one D1 (SQLite) database; originals live in R2 and are referenced by key. This is in `migrations/0001_init.sql`.

```sql
CREATE TABLE locations (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,               -- "Bombay Hook NWR"
  region      TEXT,                        -- "Delaware"
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id                TEXT PRIMARY KEY,      -- ULID, also used in public URLs
  status            TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready')),
  published         INTEGER NOT NULL DEFAULT 0,
  r2_key            TEXT NOT NULL,         -- originals/<id>/v<version>.<ext>
  version           INTEGER NOT NULL DEFAULT 1, -- bumped on replace; part of image URLs (cache bust)
  original_filename TEXT,
  mime              TEXT NOT NULL,
  bytes             INTEGER,
  width             INTEGER NOT NULL,      -- display orientation, after EXIF rotation
  height            INTEGER NOT NULL,
  placeholder       TEXT,                  -- ThumbHash, base64
  title             TEXT,
  caption           TEXT,
  taken_at          TEXT,                  -- EXIF DateTimeOriginal as ISO 8601 local time
  location_id       TEXT REFERENCES locations(id) ON DELETE SET NULL,
  camera            TEXT,                  -- "Nikon Z50II"
  lens              TEXT,
  focal_length_mm   REAL,
  aperture          REAL,                  -- 6.3
  shutter_s         REAL,                  -- 0.0005 -> shown as 1/2000 s
  iso               INTEGER,
  exposure_comp     REAL,
  gps_lat           REAL,                  -- PRIVATE: never returned by public pages
  gps_lng           REAL,
  watermark         INTEGER NOT NULL DEFAULT 1,
  sort_order        REAL,                  -- order in the "All" view
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photos_published_taken ON photos(published, taken_at DESC);
CREATE INDEX photos_location ON photos(location_id);

CREATE TABLE categories (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  cover_photo_id  TEXT REFERENCES photos(id) ON DELETE SET NULL,
  default_layout  TEXT NOT NULL DEFAULT 'rows' CHECK (default_layout IN ('rows','masonry','grid')),
  position        REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photo_categories (
  photo_id     TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position     REAL NOT NULL,              -- manual order within the category
  PRIMARY KEY (photo_id, category_id)
);
CREATE INDEX photo_categories_order ON photo_categories(category_id, position);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
```

Added by `migrations/0003_ai_captions.sql` (see AI suggestions):

```sql
CREATE TABLE photo_captions (
  photo_id    TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tone        TEXT NOT NULL CHECK (tone IN ('field-notes','poetic','playful','own')),
  text        TEXT NOT NULL,
  edited      INTEGER NOT NULL DEFAULT 0,  -- 1 once the owner has typed in it
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (photo_id, tone)
);

ALTER TABLE photos ADD COLUMN subject TEXT;       -- PRIVATE: "Great Blue Heron"
ALTER TABLE photos ADD COLUMN hashtags TEXT;      -- PRIVATE: "#greatblueheron #birdphotography"
ALTER TABLE photos ADD COLUMN caption_tone TEXT;  -- which saved caption photos.caption is a copy of

CREATE TABLE ai_votes (                           -- one row per settled blind comparison
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  winner      TEXT NOT NULL,                      -- "anthropic:claude-haiku-5-5"
  loser       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Seeds** (`migrations/0002_seed.sql`):

- Categories, in this order: Birds (`birds`), Macro (`macro`), Landscape (`landscape`), Astro (`astro`), Family (`family`). Default layout `rows`.
- Locations: Bombay Hook NWR (Delaware); Marsh Creek State Park, Struble Trail, Stroud Preserve, ChesLen Preserve, Hibernia County Park (all Pennsylvania). More are added from the admin.
- Settings: `watermark_text` = `© Jaygovind Sahu`, `site_title` = `Jaygovind Sahu — Gallery`, `default_layout` = `rows`.

**Rules**

- Ordering uses fractional `position` values: a drag inserts at the midpoint of its neighbours; renumber a category when gaps get below 1e-6.
- New photos get `position` = max + 1 in each category they join (newest last) and `sort_order` likewise; the owner reorders from there.
- GPS is stored for the owner only. Public pages, the image route and any public JSON must never include `gps_lat`/`gps_lng`, and served derivatives are stripped of all metadata (see Image delivery). Family photos taken at home make this a hard requirement.
- Public queries always filter `status = 'ready' AND published = 1`.
- `photos.caption` is the only caption the public site reads. It is a copy of the saved caption named by `caption_tone`, kept in step whenever captions are written. `subject`, `hashtags` and the other saved captions are private.

## Image storage & delivery

Originals sit in a private R2 bucket; one Worker route turns them into cached, resized, watermarked derivatives on demand via the Cloudflare Images binding.

**R2**

- Bucket `gallery-originals`: no public access, no `r2.dev` URL, no custom domain. Only the Worker binding reads it.
- Key: `originals/<photoId>/v<version>.<ext>`. A replace writes a new version key, then deletes the old object once the DB row is updated.

**Public route** — `GET /img/<photoId>/v<version>/<size>`

1. Validate: `size` must be in the allowlist below; anything else → 404. This caps cost and prevents arbitrary transforms.
2. Look up the photo row (`r2_key`, `version`, `status`, `published`, `watermark`). Not found, not `ready`, not `published`, or version mismatch → 404. This D1 read happens on every request so unpublished or deleted photos stop serving everywhere immediately.
3. Pick the output format from `Accept`: `image/avif` if accepted, else `image/webp`. Two formats only.
4. Check the edge cache (`caches.default`) with a synthetic key that includes the chosen format, e.g. `https://img-cache.internal/<id>/v<version>/<size>.<fmt>`. Hit → return it.
5. Miss → read the R2 object, then `env.IMAGES.input(body).transform({ width: size, height: size, fit: 'scale-down' })`, optionally `.draw(watermark)`, then `.output({ format, quality })`. Store in the edge cache, return.
6. Response headers: `Cache-Control: public, max-age=31536000, immutable`, `Vary: Accept`, correct `Content-Type`, `Content-Disposition: inline`.

| Size (long edge, px) | Used for | Watermark | Quality |
| --- | --- | --- | --- |
| 480 | grid tiles, phones | no | 82 |
| 768 | grid tiles | no | 82 |
| 1080 | grid tiles on retina (largest grid size) | no | 85 |
| 1600 | lightbox on phones/laptops, Open Graph image | yes | 88 |
| 2400 | lightbox on large/retina screens | yes | 88 |
| 3200 | lightbox on 4K / zoom | yes | 88 |

**Watermark**

- A transparent PNG of the text `© Jaygovind Sahu` (white, subtle dark shadow for legibility on bright skies), generated by `scripts/make-watermark.mjs` (sharp rendering an SVG) and shipped as `public/watermark.png`.
- Drawn bottom-right, margin about 2% of the long edge, overlay width about 18% of the output's long edge, opacity 0.6. Only on sizes ≥ 1600 and only when `photos.watermark = 1`.
- If the Images binding's text overlay is available and simpler, it may replace the PNG; the output must look the same.

**Quality and correctness**

- EXIF orientation must be honoured: a portrait shot comes out portrait. Verify with a rotated test JPEG.
- Strip metadata from every derivative (at minimum GPS and camera serials). Use the transform's metadata option if the binding exposes one; verify by downloading a derivative and inspecting it.
- The owner exports sRGB from Lightroom; Display P3 support is a later improvement.

**Admin preview route** — `GET /api/admin/img/<photoId>/<size>` behind Access: same transform, no publish check, no watermark, `Cache-Control: private, no-store`. Used for drafts in the admin UI.

**Cost guardrail** — each (photo, size, format) is one unique transformation per month, so the worst case is 12 per photo. The free plan includes 5,000 unique transformations a month, then $0.50 per 1,000 on the paid Images plan. On the free plan, new transformations past the limit fail (error 9422) while cached ones keep working. The route should log that error and return 503, never fall back to the original.

## Upload & admin

The browser does the EXIF reading and previews; the Worker stores the original, re-checks it, and owns the database. Every admin page must work on a phone (iOS Safari, Android Chrome) as well as a laptop.

**Upload flow (per file)**

1. Owner picks one or more files (`<input type=file multiple accept="image/jpeg,image/png,image/webp">`, plus drag-and-drop on desktop). Files over 100 MB are rejected in the browser.
2. Browser parses metadata with `exifr`: DateTimeOriginal, Make/Model, LensModel, FocalLength, FNumber, ExposureTime, ISO, ExposureCompensation, Orientation, GPS. Also read XMP/IPTC title and description, so a title or caption set in Lightroom pre-fills the form.
3. Browser computes display width/height (orientation applied) and a ThumbHash from a ~100 px downscale. Process files one at a time so phones don't run out of memory.
4. Owner fills shared fields once for the batch (location, categories, publish now or save as draft), then per-photo title, subject and caption on each card; any field can be overridden per photo. Visibility defaults to draft and remembers the last choice on the device. A card warns when its file looks like a photo already in the library (same size, and same filename or capture time), and when the photo has GPS it preselects the location whose earlier photos were taken within 5 km.
5. `POST /api/admin/photos` with the metadata → returns `{ id }` and creates the row with `status = 'uploading'`.
6. `PUT /api/admin/photos/:id/original` with the raw file body (XHR for a progress bar). The Worker streams it to R2, runs `env.IMAGES.info()` to confirm format and dimensions (server values win over the browser's), then sets `status = 'ready'`.
7. Queue runs 2 uploads at a time, retries failed requests up to 3 times with backoff, and shows per-file progress and errors. A row stuck in `uploading` for over 24 h is shown in the admin with a retry/delete option.
8. Cards stay editable while the file uploads and afterwards; changes made once the row exists are saved with `PATCH`. Leaving the page with uploads in flight or unsaved edits asks for confirmation.

On iOS, the photo picker usually converts HEIC to JPEG when the input doesn't accept HEIC; verify on a device.

**Admin pages**

- `/admin` — library of all photos, drafts included. Filters: category, location, published/draft. Multi-select bulk actions: publish, unpublish, add/remove category, set location, delete.
- `/admin/upload` — the flow above.
- `/admin/photos/:id` — large preview plus every field: title, caption, date, location, categories, EXIF values (editable when missing), watermark on/off, published. Buttons: Replace original, Delete (with confirm), View on site.
- `/admin/categories` — create, rename, describe, reorder categories; per category set the default layout and the cover photo; open a category to drag-reorder its photos (touch-friendly, e.g. dnd-kit).
- `/admin/locations` — create, rename, merge or delete locations.
- `/admin/ai` — which model writes suggestions, the blind comparison and its results, the owner's notes on voice.

**Admin API** (JSON, all under `/api/admin/`, all behind Access)

| Method + path | Does |
| --- | --- |
| `POST photos` | create row from metadata, return id |
| `PUT photos/:id/original` | raw body → R2, verify, mark ready |
| `PATCH photos/:id` | edit fields and category membership |
| `PUT photos/:id/replace` | raw body → new R2 version, bump `version`, refresh dimensions and ThumbHash, keep all other metadata; optionally re-read EXIF |
| `DELETE photos/:id` | delete R2 object(s) and DB rows; clear it as any category cover |
| `POST photos/bulk` | bulk publish/unpublish/category/location/delete |
| `POST categories/:id/move` | `{ photoId, beforeId?, afterId? }` → fractional position |
| `GET/POST/PATCH/DELETE categories` | category CRUD, cover, default layout, order |
| `GET/POST/PATCH/DELETE locations` | location CRUD and merge |
| `GET img/:id/:size` | private preview (Image delivery) |
| `POST photos/duplicates` | which files about to be uploaded look like photos already in the library |
| `POST ai/suggest` | downscaled image + context → titles, captions per tone, hashtags; stores nothing |
| `GET/PATCH ai/settings` | provider, blind comparison, voice notes, comparison tally |
| `POST ai/votes` | record the set chosen in a blind comparison |

Validate every request body with a schema (zod). Return `{ error: { code, message } }` with a proper status on failure.

## AI suggestions

A Suggest button writes the words for one photo; the owner chooses, edits and saves. Everything here is admin-only except the one caption the owner chooses to show.

**What it produces**

| Piece | Length | Used for |
| --- | --- | --- |
| Title (three options) | 2–6 words, about 40 characters | The label under a tile, alt text, link previews |
| Caption, one per tone | 1–2 sentences, about 100–200 characters | The info panel and link preview; reused on Instagram. It adds what the title can't and never repeats it |
| Hashtags | 10–15 | Instagram only; private |

Tones: **field notes** (plain, observational), **poetic** (quiet, reflective), **playful** (light, witty). A fourth saved caption, **own**, is the one the owner writes by hand.

**Rules**

- A photo is sent to a model only when the owner clicks Suggest for that photo. No automatic or bulk generation; family photos stay out unless asked for.
- If the photo's subject is a bird, another animal, an insect or a plant (a flower, tree or fungus), its name goes in every title and caption.
- The subject is an input. General models are unreliable at species-level identification, so the owner types the subject when it is known and the model writes around it. If it is left blank the model may name the subject as far as it is sure; the admin shows that name as a guess, with its confidence and alternatives, to be checked before publishing.
- The model is given the location's name and region, the month and year, the categories, the gear and any Lightroom keywords. It is never given GPS coordinates, the exact date or time, or the original file: the browser sends a 1568 px JPEG copy.
- One request returns everything (all tones, titles, hashtags), using each provider's structured-output mode.
- Nothing is saved or published by the request itself. Suggestions fill the form; the owner saves.
- Re-running never overwrites the owner's words: an edited caption is kept and the new text is offered beside it, and a title, subject or hashtags already present are left alone.

**Saved captions**

- Each photo keeps at most one caption per tone in `photo_captions`. The owner marks one as shown; `photos.caption` holds a copy of it and is what the public site reads.
- The edit page lists every saved caption with "Show on site", "Copy" and "Copy with hashtags", so a caption not used on the site can be taken to Instagram later.

**Providers**

- Anthropic (Claude Haiku) and OpenAI (GPT mini), the cheapest tier of each: with the subject supplied, what separates models is writing style. API keys are Worker secrets; the model names are vars. The provider is one swappable function.
- **Blind comparison:** with both keys set and the option on, each Suggest runs both models and shows two unlabeled sets in random order. The owner's pick is recorded in `ai_votes`; `/admin/ai` reveals the tally on request, and the owner then sets the provider.
- The owner's notes on voice (example captions, words to avoid) are stored in `settings` and sent with every request.
- Without a key the Suggest button is hidden and everything else works as before.

**Cost** — well under a cent per photo on either default model, and only when asked. The guardrail is a monthly spend limit set in each provider's console. Prompt caching does not apply (the prompt is below the minimum cacheable size) and batch pricing is not used (requests are interactive).

## Public gallery

The public site is server-rendered Astro with one interactive React island per gallery; photos lead, chrome stays out of the way.

**Routes**

| Path | Page |
| --- | --- |
| `/` | header, then straight into the latest photos in the gallery layout; categories live in the header menu |
| `/c/:slug` | one category in its layout, manual order |
| `/all` | every published photo, by `sort_order` |
| `/l/:slug` | every published photo at a location, newest first |
| `/p/:id` | photo permalink: opens the lightbox over its category (or `/all`); server-renders title, caption and Open Graph tags so shared links preview well |
| `/img/...` | image route (Image delivery) |

The main site jaygovindsahu.com gets a plain "Gallery" nav link to this subdomain (a one-line change in that separate repo).

**Layouts**

- **Justified rows** (default): each photo keeps its aspect ratio; rows fill the width at a target height (~280 px desktop, ~180 px phone).
- **Masonry**: columns (2 on phone, 3–4 on desktop), photos uncropped.
- **Grid**: uniform 3:2 tiles with `object-fit: cover`; the full uncropped image shows in the lightbox.
- Use `react-photo-album` for rows and masonry (and its columns mode or plain CSS grid for the uniform grid).
- A small segmented toggle (three icons) in the header. The initial layout comes from `?layout=` if present, else the visitor's last choice (localStorage, wrapped in try/catch), else the category's `default_layout`. Switching updates the URL param without a reload.

**Lightbox**

- `yet-another-react-lightbox` with Zoom, Captions/Info and Fullscreen plugins: swipe on touch, arrow keys, Esc to close, pinch and scroll zoom.
- Opening a photo pushes `/p/:id` to history; closing restores the gallery URL; Back closes the lightbox.
- Info panel (toggle with `i`): title, caption, date (e.g. "Oct 12, 2026"), location linked to `/l/:slug`, category chips, and the EXIF values: `Nikon Z50II · Tamron 50-400mm · 400 mm · f/6.3 · 1/2000 s · ISO 1600`. Omit any missing value rather than showing a blank.
- Preload the next and previous slide.

**Image markup and performance**

- Every `<img>` has explicit `width`/`height` from the DB (no layout shift) and a `srcset` from the allowlist: grid uses 480/768/1080, lightbox uses 1600/2400/3200, with `sizes` matching the rendered width.
- The ThumbHash placeholder renders as the tile background until the image loads, then fades.
- First row loads eagerly with `fetchpriority="high"`; everything else lazy.
- HTML responses: `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`, so admin changes show within about a minute.
- Targets on a mid-range phone over 4G: LCP < 2.5 s, CLS ≈ 0.

**Download deterrents** (they deter, not prevent; screenshots always work)

- Originals are never reachable; the largest public size is 3200 px and watermarked.
- On gallery and lightbox images: block the context menu, `draggable="false"`, `user-select: none`, `-webkit-touch-callout: none` (stops the iOS long-press save sheet).
- No download button anywhere.

**Look and feel**

- **Direction: minimal dark.** The photos are the only color on the page; chrome is quiet, thin and sparse. Dark only in v1 (no light theme).
- **Palette** (CSS variables): background `#0f0f10`, raised surfaces `#18181a`, dividers `#2a2a2d`, primary text `#ece9e4` (warm off-white), secondary text `#8f8c87`. No accent color: active states (current category, selected layout icon) use primary text vs. secondary. No gradients, borders or shadows on photos.
- **Type: serif + sans.** Serif for the site name, page titles and photo titles (Newsreader); sans for menus, locations, EXIF and admin UI (Instrument Sans). Self-host via `@fontsource` so the CSP stays self-only. Sizes: site name 22 px, page title 32–40 px, tile title 15 px, tile location 12 px, EXIF 13 px.
- **Header**: site name in serif on the left; category links (Birds, Macro, Landscape, Astro, Family, All) and the layout toggle on the right; collapses to a menu on phones. Slim, sticky, hides on scroll down and returns on scroll up.
- **Home page**: no hero and no intro block — the header, then straight into the latest photos in the gallery layout.
- **Category page**: serif category name, photo count and the optional one-line description in secondary text, then the gallery.
- **Captions under every tile** in all three layouts: title in serif (15 px, primary) and location in sans (12 px, secondary), each one line, truncated with an ellipsis. Untitled photo → location only. Captions take a fixed height (~44 px) so justified rows stay aligned; the layout height calculation must include it (custom render in `react-photo-album`).
- **Spacing**: 8 px gutters on phones, 12 px on desktop; page side padding 16 px phone, 32 px desktop; generous space above page titles.
- **Hover and motion**: tiles lift brightness slightly on hover (no zoom, no movement); images fade in over their ThumbHash in ~200 ms; respect `prefers-reduced-motion`.
- **Lightbox**: pure black background, image as large as fits; info panel slides in from the right on desktop and as a bottom sheet on phones, with the serif title over sans details.
- **Footer**: small © Jaygovind Sahu and a link back to jaygovindsahu.com.
- **Accessible**: alt text = title, else "&lt;category&gt; photo, &lt;location&gt;, &lt;date&gt;"; text contrast ≥ 4.5:1 on the dark background; visible focus rings; lightbox fully keyboard-operable.

## Auth & security

Cloudflare Access keeps everyone but the owner out of the admin, and the Worker verifies Access's token itself rather than trusting the path.

- **Access application** (Zero Trust, self-hosted) covering `gallery.jaygovindsahu.com/admin*` and `gallery.jaygovindsahu.com/api/admin/*`. Policy: allow only the owner's email; login by one-time email code (Google login optional).
- **Worker check**: middleware on every `/admin` and `/api/admin` request verifies the `Cf-Access-Jwt-Assertion` header — signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cache the keys), `aud` = the Access app's AUD tag, `exp` not passed, and email equal to `OWNER_EMAIL`. Fail → 403. Use `jose` for JWT verification.
- **Local dev**: `DEV_BYPASS_AUTH=1` (only honoured when not on the production hostname) skips the check.
- **Uploads**: check `Content-Type` against the allowlist, cap the body at 100 MB, and trust only `env.IMAGES.info()` for format and dimensions.
- **Public surface**: the image route accepts only allowlisted sizes and existing published ids; public pages never expose drafts, GPS, R2 keys or internal fields.
- **Headers**: a strict CSP (self + the image route; no third-party scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Admin pages also send `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **SQL**: prepared statements only.
- **AI providers**: the only outbound calls from the Worker, made from `/api/admin/ai/suggest` with keys held as Worker secrets. See AI suggestions for what is and is not sent. The browser never contacts a provider, so the CSP stays self-only.

## Project structure & config

One Astro project deployed as one Cloudflare Worker serves the public site, the admin, the APIs and the image route.

**Stack**

- Astro with `@astrojs/cloudflare`, `output: 'server'`; React islands for the gallery, lightbox and admin UI.
- TypeScript strict; Tailwind CSS; `zod` (validation), `jose` (Access JWT), `exifr`, `thumbhash`, `ulid`, `react-photo-album`, `yet-another-react-lightbox`, `@dnd-kit/*`.
- D1 via prepared statements behind a small typed data layer (`src/lib/db.ts`).
- Tests: Vitest (unit), Playwright (end to end). Package manager: pnpm.
- `@anthropic-ai/sdk` for Claude; OpenAI is called with `fetch`.

**Layout**

```
/
├─ astro.config.mjs
├─ wrangler.jsonc
├─ migrations/
│  ├─ 0001_init.sql
│  └─ 0002_seed.sql
├─ scripts/make-watermark.mjs
├─ public/watermark.png
├─ src/
│  ├─ middleware.ts            # Access JWT check for /admin and /api/admin
│  ├─ lib/
│  │  ├─ db.ts                 # typed queries
│  │  ├─ images.ts             # size allowlist, transform + watermark, cache keys
│  │  ├─ exif-format.ts        # "1/2000 s", "f/6.3", lens/camera cleanup
│  │  ├─ auth.ts               # jose verification
│  │  └─ order.ts              # fractional positions
│  ├─ components/
│  │  ├─ gallery/              # Gallery.tsx, LayoutToggle.tsx, Lightbox.tsx, InfoPanel.tsx
│  │  └─ admin/                # UploadQueue.tsx, PhotoForm.tsx, SortableGrid.tsx, ...
│  ├─ layouts/                 # Base.astro, Admin.astro
│  └─ pages/
│     ├─ index.astro
│     ├─ all.astro
│     ├─ c/[slug].astro
│     ├─ l/[slug].astro
│     ├─ p/[id].astro
│     ├─ img/[id]/[version]/[size].ts
│     ├─ admin/...             # index, upload, photos/[id], categories, locations
│     └─ api/admin/...         # endpoints from Upload & admin
└─ tests/
```

**Bindings** (see `wrangler.jsonc`): `ORIGINALS` (R2 `gallery-originals`), `DB` (D1 `gallery-db`), `IMAGES` (Images binding); vars `SITE_URL`, `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`; secrets `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

Local dev uses `astro dev` with local D1 and R2 (via the Cloudflare adapter's platform proxy) and `DEV_BYPASS_AUTH=1` in `.dev.vars`. If the Images binding isn't available locally, fall back to returning the original bytes in dev only.

The README must cover setup, local dev, migrations, deploy, and the Lightroom export settings (below).

## Cloudflare setup (owner)

These steps run in the owner's Cloudflare account; the agent prepares commands and docs but cannot run them. jaygovindsahu.com is assumed to already use Cloudflare DNS.

1. `pnpm wrangler login`
2. `pnpm wrangler r2 bucket create gallery-originals` — leave public access off.
3. `pnpm wrangler d1 create gallery-db` — paste the returned `database_id` into `wrangler.jsonc`.
4. `pnpm db:migrate:remote`
5. In the dashboard, open **Images** and confirm transformations / the Images binding are enabled for the account.
6. `pnpm run deploy` — the `custom_domain` route creates the DNS record for `gallery.jaygovindsahu.com`.
7. **Zero Trust → Access → Applications → Add (self-hosted)**: domain `gallery.jaygovindsahu.com`, paths `/admin*` and `/api/admin/*`; policy "Allow" for the owner's email only. Copy the **AUD tag** and the team domain into `wrangler.jsonc` `vars`, then redeploy.
8. Open `/admin`, sign in with the email code, upload a test photo, and run the acceptance checks.
9. In the main site repo, add a "Gallery" nav link to `https://gallery.jaygovindsahu.com`.

**Lightroom export settings**

- File: JPEG, quality 90–100, color space **sRGB**.
- Size: no resizing (full resolution).
- Metadata: **All Metadata** — otherwise EXIF and titles are stripped and nothing pre-fills. Keep location info on; the site never publishes GPS.
- Output sharpening: Screen, Standard (optional).

## Milestones

Build in this order; each milestone ends with its checks passing and a commit.

1. **Scaffold** — Astro + Cloudflare adapter, Tailwind, wrangler config, migrations, seeds, README skeleton, `make-watermark` script. **(Done in the initial commit.)**
   - Done when: `pnpm dev` serves a placeholder home page reading categories from local D1; migrations apply cleanly locally.
2. **Auth + admin shell** — middleware JWT check, admin layout, dev bypass.
   - Done when: `/admin` returns 403 without a valid token in a production-like run and loads with the bypass locally; unit tests cover valid, expired, wrong-aud and wrong-email tokens.
3. **Upload** — EXIF parsing, ThumbHash, batch form, upload queue, `POST photos` + `PUT original`, server verification.
   - Done when: 5 JPEGs (landscape, portrait, one with GPS, one with no EXIF, one ~30 MB) upload from desktop and from a phone-sized viewport; rows hold correct EXIF and dimensions; the 30 MB file shows progress.
4. **Image route** — allowlist, format negotiation, transform, watermark, cache, admin preview route.
   - Done when: every size returns AVIF to a modern browser and WebP otherwise; ≥ 1600 carries the watermark, ≤ 1080 doesn't; a portrait photo is portrait; derivatives contain no GPS; a disallowed size or unpublished id returns 404.
5. **Public gallery** — home, category, all, location and permalink pages; three layouts with toggle; lightbox with info panel and history; deterrents.
   - Done when: the testing checklist below passes on desktop Chrome, Safari and a real phone; Lighthouse mobile performance ≥ 90 on a category page.
6. **Admin management** — edit page, replace, delete, bulk actions, category and location managers, drag reorder, covers, default layout.
   - Done when: a reorder shows on the public page within about a minute; replace changes the image URL version and the new image appears; delete removes R2 objects and rows.
7. **Polish + deploy** — Open Graph tags, 404 page, security headers, README with setup and Lightroom settings, production deploy steps verified with the owner.
8. **AI suggestions** — Suggest on upload cards and the edit page, saved captions per tone with one shown, subject and hashtags, the two providers and the blind comparison, `/admin/ai`; upload improvements (draft default, edit while uploading, duplicate warning, location from GPS, leave warning).
   - Done when: with a stand-in model, Suggest fills titles, three captions and hashtags without overwriting the owner's edits; the public page shows only the chosen caption; a blind pick is counted; and, with real keys, a bird photo with the subject given comes back with that name in every title and caption.

## Testing checklist

Unit tests cover the pure logic; Playwright covers the flows; the rest is checked by hand before launch.

**Unit (Vitest)**

- EXIF formatting: shutter 0.0005 → "1/2000 s", 2.5 → "2.5 s"; aperture 6.3 → "f/6.3"; missing values omitted.
- Fractional ordering: insert between, at start, at end; renumber when gaps get tiny.
- Size allowlist and format negotiation from various `Accept` headers.
- JWT verification cases (valid, expired, wrong aud, wrong email, bad signature).
- Captions: what a write means for the shown caption; a re-run keeps edited captions; hashtag normalising.
- AI: the text sent to the model carries the place and month but no time or coordinates; a model's answer is tidied and tied to real categories.

**End to end (Playwright)**

- Upload a batch with shared categories and location; edit a title; publish; the photo appears on its category page and in `/all`.
- Switch all three layouts; reload keeps the choice; `?layout=grid` overrides it.
- Open the lightbox, swipe/arrow through, URL becomes `/p/:id`, Back closes it, a direct `/p/:id` load opens it.
- Unpublish a photo: its page 404s and its image URLs 404.
- With a stand-in model: Suggest on an upload card and on the edit page; choose a tone; the public page shows that caption and no other; a blind comparison records the pick.

**Manual before launch**

- [ ] Portrait and landscape photos display in the right orientation at every size
- [ ] Downloaded derivative has no GPS or camera serial in its metadata
- [ ] Watermark legible on a bright sky and a dark night photo, absent on grid tiles
- [ ] Long-press on iPhone shows no save sheet; right-click shows no menu
- [ ] `/admin` and `/api/admin/*` blocked in a private window without login
- [ ] Lightroom export with All Metadata pre-fills title, caption and EXIF
- [ ] Upload works from an iPhone over cellular
- [ ] Category page scores ≥ 90 in Lighthouse mobile performance
- [ ] With real API keys: Suggest on a bird photo with the subject given, and on one without; the blind comparison shows two sets

## Future and open questions

Nothing here is built in v1; the schema and routes should simply not block it.

**Later**

- Collections or trip albums (e.g. a national park trip) as a second grouping beside categories.
- Print sales: per-photo print availability and sizes, checkout via Stripe.
- Map view by named location (never per-photo GPS).
- Filters by lens or focal length; search across titles and captions.
- RSS/Atom feed of new photos; Cloudflare Web Analytics (cookieless).
- Display P3 output and HEIC uploads.

**Open questions for the owner**

- Watermark size and opacity: tune after seeing real bird and astro shots at 1600 and 3200 px.
- Home page: show the latest uploads (current plan) or a hand-picked featured set?

## Sources

- [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/) — free tier of 5,000 unique transformations a month, $0.50 per 1,000 after, error 9422 past the free limit.
- [Cloudflare Images: draw overlays and watermarks](https://developers.cloudflare.com/images/optimization/draw-overlays/) — `.draw()` on the Images binding, position and opacity options.
- [RealBirdID: Benchmarking Bird Species Identification in the Era of MLLMs](https://arxiv.org/abs/2603.27033) — general multimodal models do poorly at species-level bird identification, which is why the subject is an input.
