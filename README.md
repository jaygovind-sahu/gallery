# Gallery

Self-hosted photography portfolio for **gallery.jaygovindsahu.com**, running entirely on Cloudflare: an Astro app on Workers, originals in a private R2 bucket, metadata in D1, and resizing plus watermarking through the Cloudflare Images binding. A private admin (behind Cloudflare Access) handles uploads from laptop or phone.

The full design — scope, data model, image pipeline, admin, look and feel, milestones — is in [docs/DESIGN.md](docs/DESIGN.md).

## Status

| Milestone | State |
| --- | --- |
| 1. Scaffold (Astro + Cloudflare, D1 schema and seeds, watermark) | done |
| 2. Auth + admin shell | done |
| 3. Upload | done |
| 4. Image route | done |
| 5. Public gallery | done (Lighthouse and the real-phone / Safari checks are still to run by hand) |
| 6. Admin management | done |
| 7. Polish + deploy | done locally: 404 page, security headers and CSP, Open Graph images, visual polish. The production checks are waiting for the owner ([wiki/deploy.md](wiki/deploy.md#checks-after-a-deploy-that-changes-headers-or-pages)) |
| 8. AI suggestions, saved captions, upload improvements | done, built ahead of 7 at the owner's request. Deployed 2026-11-17 with migration 0003. The real provider calls are untested until API keys are added |

## Stack

- [Astro](https://astro.build) with `@astrojs/cloudflare` (server output, one Worker)
- Cloudflare D1 (`DB`), R2 (`ORIGINALS`), Images (`IMAGES`), Access
- React islands, Tailwind CSS v4, self-hosted Barlow Condensed + Barlow
- pnpm, Node 22+

## Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars     # local-only settings (auth bypass, owner email)
pnpm db:migrate:local              # creates the schema and seeds in a local D1
pnpm dev                           # http://localhost:4321
```

`astro dev` runs on Cloudflare's `workerd` runtime with local D1 and R2 stored under `.wrangler/`. Local D1 data is keyed by `database_id`, so if the id in `wrangler.jsonc` changes, run `pnpm db:migrate:local` again. Bindings are typed from `wrangler.jsonc`; after changing it, run `pnpm cf-typegen`.

**Working on the live data from your machine:** `pnpm dev:live` runs the same dev server against the live D1 database and R2 bucket (the `live` environment in `wrangler.jsonc`, selected by `CLOUDFLARE_ENV=live`; needs `pnpm wrangler login`). Uploads, edits and deletes made at `http://localhost:4321/admin` land in the real gallery, exactly as if made on gallery.jaygovindsahu.com. It reads `.dev.vars.live` instead of `.dev.vars` when that file exists (wrangler loads `.dev.vars.<env>` first, and doesn't merge the two), so a real AI key can live there while `pnpm dev` and the e2e tests stay on the mock. The admin auth bypass still applies on localhost. The Images binding stays local in this mode, so previews on localhost have no watermark; the live site renders its own derivatives from the same originals. Don't run `pnpm test:e2e` while `dev:live` is running: Playwright reuses an open dev server and its tests upload and delete photos.

Other scripts:

| Script | Does |
| --- | --- |
| `pnpm build` | production build into `dist/` |
| `pnpm test` | unit tests (Vitest) |
| `pnpm fixtures` | generate the test JPEGs in `tests/fixtures/` (needs sharp) |
| `pnpm dev:live` | dev server against the **live** D1 and R2 (needs `wrangler login`); uploads and edits change the real gallery |
| `pnpm test:e2e` | Playwright flows against the dev server (run `pnpm fixtures` once first; never with `dev:live` running) |
| `pnpm preview` | build, then run the built Worker locally with `wrangler dev` |
| `pnpm watermark ["© Name"]` | regenerate `public/watermark.png` |
| `pnpm db:migrate:remote` | apply migrations to the production D1 by hand (the Deploy workflow does this on every push to `main`) |
| `pnpm cf-typegen` | regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` or the names in `.dev.vars` |
| `pnpm run deploy` | build and deploy to Cloudflare by hand (normally the Deploy workflow does it) |

## Deploying

Every push to `main` deploys the live site through GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)): unit tests, build, D1 migrations, then `wrangler deploy`. It can also be run from **Actions → Deploy → Run workflow**. The Cloudflare API token, account ID and the Worker's secrets (`OWNER_EMAIL`, the AI keys) are GitHub secrets on the `production` environment. Setup, and how changing or removing a secret works: [wiki/deploy.md](wiki/deploy.md#secrets).

## First deploy (Cloudflare account)

1. `pnpm wrangler login`
2. `pnpm wrangler r2 bucket create gallery-originals` — keep public access **off**.
3. `pnpm wrangler d1 create gallery-db`, then paste the printed `database_id` into `wrangler.jsonc` (top level and `env.live`). Done for this account: `gallery-db` is `5d6ee36d-…`.
4. `pnpm db:migrate:remote`
5. In the Cloudflare dashboard, open **Images** and confirm transformations / the Images binding are enabled.
6. `pnpm wrangler secret put OWNER_EMAIL` — the only email allowed into the admin.
7. `pnpm run deploy` — the `custom_domain` route creates the DNS record for `gallery.jaygovindsahu.com`.
8. **Zero Trust → Access → Applications → Add (self-hosted)**: domain `gallery.jaygovindsahu.com`, paths `/admin*` and `/api/admin/*`, policy "Allow" for your email only. Copy the **AUD tag** and your team domain (shown on the Access sign-in page's address, `<team>.cloudflareaccess.com`) into `vars` in `wrangler.jsonc`, top level and `env.live`, and deploy again. Done for this account: app `Gallery admin`, team `blue-shadow-d31f`.
9. On jaygovindsahu.com, add a "Gallery" nav link to `https://gallery.jaygovindsahu.com`.
10. Set up deploys from GitHub: API token, `production` environment and secrets, as in [wiki/deploy.md → One-time setup](wiki/deploy.md#one-time-setup).

## AI suggestions

A **Suggest** button on each upload card and on the photo edit page writes three title options, a caption in three tones (field notes, poetic, playful) and hashtags. Captions are saved per tone: you choose which one the site shows, and can come back later to copy any of them, with or without the hashtags, for Instagram. Subject, hashtags and the captions you don't show stay private.

Setup, once:

1. Create an API key with a small prepaid balance and a monthly spend limit at one or both providers: [Anthropic Console](https://console.anthropic.com/) and [OpenAI Platform](https://platform.openai.com/).
2. Add `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` as GitHub secrets on the `production` environment ([wiki/deploy.md](wiki/deploy.md#secrets)).
3. Run the Deploy workflow (**Actions → Deploy → Run workflow**). It applies the migrations and sends the keys with the deploy.
4. Open `/admin/ai`: pick the model, paste a few captions you like under "Your voice", and (with both keys) turn on the blind comparison.

- **Models:** `ANTHROPIC_MODEL` (`claude-sonnet-5-5`) and `OPENAI_MODEL` (`gpt-5-mini`) in `wrangler.jsonc` `vars`. Check OpenAI's model list for the current small model and change the var if there is a newer one.
- **Cost:** about 1.5–2 cents per photo on Sonnet, well under a cent on GPT mini. Each call is logged with its token counts (`pnpm wrangler tail gallery`).
- **Subject:** fill it in when you know the species. General models are unreliable at exact species, so a name the AI came up with is marked as a guess to check.
- **Privacy:** a photo is sent only when you click Suggest for it, as a 1568 px copy, with the location's name and the month. GPS coordinates and the original are never sent.
- **Blind comparison:** every Suggest runs both models and shows two unlabeled sets; you pick one. `/admin/ai` keeps the count and reveals the winner when you ask.
- **Locally:** `AI_MOCK=1` in `.dev.vars` gives canned answers with no key and no cost. For real suggestions in `pnpm dev:live`, put the key and `AI_MOCK=0` in `.dev.vars.live` (it also needs `DEV_BYPASS_AUTH` and `OWNER_EMAIL`).

## Lightroom export settings

- **File:** JPEG, quality 90–100, color space **sRGB**
- **Size:** no resizing (full resolution)
- **Metadata:** **All Metadata** — otherwise EXIF, titles and captions are stripped and nothing pre-fills on upload. Location info can stay on; the site never publishes GPS.
- **Output sharpening:** Screen, Standard (optional)

## Decisions

- `imageService: 'passthrough'` in the Astro adapter: photos are resized by our own `/img` route via the Images binding, not by `astro:assets`.
- `OWNER_EMAIL` is a Worker secret rather than a plain var, so it isn't committed.
- The watermark PNG is rendered from SVG text with sharp; the system font is used if Instrument Sans isn't installed where the script runs.
- Package builds for esbuild, sharp and workerd are allowed in `pnpm-workspace.yaml` (`allowBuilds`), which is where pnpm 12 wants them.
- Admin auth accepts the JWT from the `Cf-Access-Jwt-Assertion` header first and falls back to the `CF_Authorization` cookie (both are set by Access). `/api/admin/*` failures return the JSON error shape; `/admin*` failures return plain-text 403.
- The middleware sets `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, a `Permissions-Policy` and (over HTTPS) HSTS on every response. HSTS has no `includeSubDomains`, which would bind every jaygovindsahu.com subdomain, and no `preload`.
- The Content-Security-Policy is Astro's built-in `security.csp`: it hashes the inline scripts and styles Astro renders, which a hand-written header couldn't. It's sent as a header on rendered pages, so `frame-ancestors` works. Style attributes get `'unsafe-inline'` (React renders them on the server); scripts never do. `astro dev` doesn't send it. react-photo-album's SSR `<style>` is replaced by classes in `global.css`, and zod runs `jitless` in the browser so its `new Function` probe isn't reported as a violation.
- Unit tests run in plain Node (`vitest`), not the Workers pool: everything tested is pure logic.
- Milestone 8 (AI suggestions) was built before milestone 7 because the owner asked for it; DESIGN.md gained an "AI suggestions" section for it.
- AI providers: Anthropic and OpenAI, approved by the owner as the only services outside Cloudflare. The provider is one function (`runModel` in `src/lib/ai.ts`), chosen by a setting, so swapping models is a config change. Claude goes through the official SDK; OpenAI through one `fetch`, to avoid a second SDK in the Worker bundle.
- Default models: `claude-sonnet-5-5` and `gpt-5-mini`. Claude started on Haiku, the cheapest tier, but it stopped at the group on hard identifications (a female House Finch) when the subject was left blank. The owner chose Sonnet for better identification at about 1.5–2 cents a photo instead of a tenth of a cent.
- The subject is an input, not something the AI is trusted to find: general models do poorly at species-level identification. A name the model proposes is shown as a guess with its confidence. Without a subject, the model lists the field marks it sees before naming, and names the species when they settle it; it stops at the group ("a finch") only when the photo can't separate the candidates. Its alternatives are one-click buttons that make one the subject.
- Suggestions run only on a click, per photo. No automatic or bulk generation: it keeps family photos out by default and the cost at zero unless asked.
- The image sent to the model is made in the browser (1568 px JPEG) from the picked file or the admin preview, so it costs no extra Images transformation and the Worker never reads an original for it.
- `photos.caption` remains the public caption and holds a copy of the saved caption being shown. A pointer would have meant a join in every public query; the copy keeps public code and the privacy filter untouched.
- Instagram has no separate caption field: any saved caption can be copied with the hashtags, and the owner said one or two sentences suits both.
- Hashtags are private and stored normalised; they are not shown as tags on the site.
- Upload visibility now defaults to draft and remembers the last choice per device.
- Upload cards stay editable during and after the upload; edits after the row exists are saved with `PATCH`.
- Resumable (multipart) uploads were left out: more moving parts than a retry of the whole file is worth until large uploads actually fail on cellular.
- The location suggestion uses the average GPS position of photos already filed at each location, within 5 km. No coordinates are stored on locations.
- Upload dimensions: the Images binding reports the stored pixel grid, the browser reports the display size after EXIF rotation. If both describe the same grid, the browser's orientation of the server's numbers is kept; otherwise the server's numbers win, swapped when the `X-Exif-Orientation` header (sent by the upload page) says the image is rotated.
- The local Images binding (miniflare + sharp) reports a non-image with error 9523 and an "unsupported image format" message rather than production's 9412; both are treated as "not an image" (415). Any other inspection failure keeps the browser's values in local dev only and is a 502 in production.
- XMP `dc:title` / IPTC ObjectName pre-fill the title and `dc:description` / IPTC Caption the caption, as Lightroom writes them.
- Test images are generated, not committed: `tests/fixtures/make-fixtures.mjs` builds the five files from the milestone 3 checks (the 30 MB one is random noise).
- Milestone 6 (admin management) was built before 4 and 5 because the owner asked for the whole admin area first. The private preview route `/api/admin/img/:id/:size` came with it, together with the pure parts of `src/lib/images.ts` (size allowlist, format negotiation, transform helper); milestone 4 adds the public `/img` route, edge cache and watermark on top. The milestone 6 check "a reorder shows on the public page within about a minute" waits for milestone 5.
- Category order is `PATCH /api/admin/categories` with `{ ids }` (listed ids first, everything else keeps its relative order after them). Location merge is `DELETE /api/admin/locations/:id?into=<otherId>`.
- Replace sends the browser-computed display size, ThumbHash and EXIF orientation as `X-Width`, `X-Height`, `X-Placeholder` and `X-Exif-Orientation` headers alongside the raw body; "re-read EXIF" is a follow-up `PATCH` from the browser, which is where the EXIF parser lives.
- Deleting a photo removes every object under `originals/<id>/` in R2, not just the current version.
- Category reordering uses up/down buttons; drag-and-drop (dnd-kit, mouse, touch with a short hold, keyboard) is reserved for photo order within a category, where it matters.
- Public image route `/img/:id/v:version/:size`: the row is read from D1 on every request (before the cache), the edge cache is `caches.default` keyed by `https://img-cache.internal/<id>/v<version>/<size>.<avif|webp>`, and the cache write happens in `waitUntil`. Only a well-formed ULID is looked up; anything else is a 404 without a query.
- The watermark PNG is read through the `ASSETS` binding (the adapter's static-asset binding, also present in `astro dev`) and kept in memory per isolate; a plain `fetch` of `/watermark.png` is the fallback if the binding is missing.
- The local Images binding (miniflare + sharp) only applies rotate, resize and the output format: it ignores `draw()` and `quality`, so derivatives in `astro dev` carry no watermark. To check the watermark locally, set `"images": { "binding": "IMAGES", "remote": true }` in `wrangler.jsonc` (needs `wrangler login`; D1 and R2 stay local) and run `REMOTE_IMAGES=1 pnpm test:e2e tests/e2e/images.spec.ts`. The metadata check passes locally because sharp strips EXIF, XMP and IPTC on output, as the production service does.
- When Cloudflare Images reports 9422 (monthly transformations used up) the route logs it and answers 503 with `Retry-After: 3600`, never the original. Any other transform failure is a 503 in production and, in local dev only, the original bytes with `no-store`.
- Home page shows the 48 most recent uploads (`created_at DESC`); the "featured set" question in the spec stays open. (Superseded on 2026-11-27: the home page is now the walk-through, below.)
- Rows and masonry come from `react-photo-album` wrapped in its `SSR` component with breakpoints 640 / 1024 / 1440: the server renders the layout for each width band and container queries show the matching one, so there is no layout shift before hydration. Captions are rendered with `render.extras` inside each tile at a fixed 44 px, which keeps rows aligned without changing the library's height maths. The uniform grid is a plain CSS grid (2 / 3 / 4 columns, 3:2 tiles, `object-fit: cover`).
- Tile images are `loading="lazy"` with `fetchpriority="high"` on the first four in the server HTML, and switch to `loading="eager"` after hydration. Eager images inside the hidden SSR width bands would otherwise be fetched too, since `display: none` doesn't stop `<img>` loads; lazy ones only load once they have a position in the viewport.
- Tile images fade in over their ThumbHash once `TileImage` knows they loaded: from `onLoad`, or at mount for an `<img>` that finished before hydration (the edge cache often beats the island's JS). Its `ref` must come after the props spread, because react-photo-album's `render.image` props carry `ref: null`. A failed load is retried three times (after 1 s, 3 s, 9 s) by re-creating the `<img>`, so a cold derivative that 503s once doesn't leave a blank tile.
- The layout toggle and the gallery are two islands (the toggle lives in the header, which is server-rendered). The toggle owns `?layout=` and localStorage and broadcasts a `gallery:layout` event; the gallery also resolves the stored choice itself on mount so order of hydration doesn't matter.
- The lightbox is `yet-another-react-lightbox` with Zoom and Fullscreen; the info panel is our own component rendered through `render.controls` (the Captions plugin can't render a location link or category chips). `i` toggles it. Opening pushes `/p/:id`, slide changes `replaceState`, closing goes back when the island pushed the entry and otherwise (direct permalink load) replaces the URL with the gallery page. Opening the lightbox from a permalink uses the photo's first category by category position, else `/all`.
- Public HTML gets `Cache-Control: public, s-maxage=60, stale-while-revalidate=600` from the middleware when the page didn't set its own.
- Visual polish, at the owner's request (2026-11-17), inside the existing look-and-feel rules: a small-caps "Gallery" label beside the site name; a hairline under the current category link; the layout toggle as a bordered segmented control with outline icons; the sticky header turns translucent with a hairline once the page scrolls; page headings get a small-caps line above them (photo count, plus the region on location pages) with the description below; a footer with a hairline, the category links and the link back. In the lightbox the container keeps a 56 px band top and bottom on phones (64 px all round on desktop) so the title bar (title, location, position) and the controls never sit on the photo; touch-first screens hide the arrow and zoom buttons in favour of swipe and pinch; icons are thin outlines. The info panel labels its date, location and camera rows.
- Unknown URLs, slugs and ids, and drafts' permalinks, get `src/pages/404.astro` with status 404: pages return an empty-bodied 404 and Astro renders the 404 page for it. It says the same thing in every case so a draft can't be told from a missing photo. `/img` and the admin keep their plain-text 404s.
- Open Graph: every gallery page has a preview image (1600 px, the watermarked size), its alt text, `og:site_name`, and a canonical URL built from `SITE_URL`. A category uses its cover when the cover is published, else its first photo; home, all and location pages use their first photo.
- `vite.optimizeDeps.include` in `astro.config.mjs` lists every runtime dependency. The Cloudflare adapter forwards it to the workerd environments; without it Vite discovers server-side dependencies on first use, re-optimises mid-session, and the request that triggered it (and any in flight) fails with "The file does not exist at `.vite/deps_ssr/...`". Add new dependencies to that list.
- Local dev against live data is opt-in through a wrangler environment (`env.live`, `pnpm dev:live`) rather than `"remote": true` on the top-level bindings plus the adapter's `remoteBindings` switch: that switch is all-or-nothing, so it would also have turned the e2e tests and the remote-Images watermark check loose on live data. Bindings don't inherit into an env, so `env.live` repeats them; it has no routes and no workers.dev URL so it can't be deployed over the real domain by accident. Images stays local in `dev:live` to save transformations.
- Deploys run on GitHub Actions, at the owner's request (free for a public repo): every push to `main`, plus a manual trigger. The job runs unit tests, build, `d1 migrations apply --remote`, then `wrangler deploy`, so migrations are no longer a separate manual step. The e2e suite isn't run there: it takes over 10 minutes and needs browsers. Third-party actions are pinned to commit SHAs.
- Worker secrets are managed as GitHub secrets on a `production` environment limited to `main`, and go up with each deploy through `wrangler deploy --secrets-file`, in the same Worker version as the code. That flag is additive, so a secret not set in GitHub keeps its value on the Worker; `wrangler secret put` still works, and removing a secret also takes `wrangler secret delete`. Syncing only the secrets that are set, rather than requiring all three, means the AI keys stay optional.
- Type changed from Newsreader + Instrument Sans to Barlow Condensed + Barlow at the owner's request, after comparing mockups. The `font-serif` token became `font-display`, since it's no longer a serif. Only weight 500 of Barlow Condensed is loaded. Title sizes went up about 18% so the condensed face holds its own. The watermark PNG wasn't regenerated: it's already rendered, and redoing it would change every derivative.
- The header and footer show "Jay’s Gallery" in the display face, one colour, at the owner's request (2026-11-18), after comparing mockups. It replaces "Jaygovind Sahu" with a small-caps "Gallery" label beside it, which looked too high next to the mostly lowercase name. Page titles and `og:site_name` (so link previews) use it too; the home title is the `site_title` setting, which `0004_site_title.sql` changes only if it still holds the seeded value. The © line, the watermark and the meta descriptions ("Photography by Jaygovind Sahu…") keep the full name, as the photographer's credit.
- `workers_dev` and `preview_urls` are set to `false` explicitly: the site is served only on gallery.jaygovindsahu.com, where Access covers the admin paths. (The Worker was first created as a placeholder from the dashboard, which enables workers.dev; the first deploy replaces it.)
- The 3200 px size is gone, at the owner's request (2026-11-21): 2400 px is the largest public size. It keeps photos sharp on phones and retina laptops, stops serving near-print-size files (3200 px is about an 11-inch print at 300 dpi, 2400 about 8), and lowers the worst case to 10 transformations per photo. Old `/3200` URLs now 404.
- The lightbox never enlarges a photo past its real pixels on the visitor's screen, at the owner's request (strict, no tolerance): the cap is the largest file's size divided by `devicePixelRatio`, and zoom stops at the same point. On 4K/5K screens a photo shows smaller, with wider black margins, instead of soft; photos with small originals show at their own size.
- The lightbox's info panel became a spec sheet, at the owner's request (2026-11-21), after comparing three mockups (a readout line, the spec sheet, a data plate): exposure as large figures, then camera, lens and the rest. It opens with every photo, on phones too, and the photo is fitted beside or above it. Exposure compensation, which isn't in the mockup, is a labelled row when set.
- The header's category links became one **Categories** menu, at the owner's request (2026-11-21), after a mockup: each category with its photo count, a dot on the current one; phones keep one menu that ends with "All photos". Categories with no published photos are hidden from the header and footer.
- Photos in no category get an automatic **Miscellaneous** entry and page (`/c/miscellaneous`), at the owner's request; the name was the owner's pick over "Uncategorized", "Other" and "More photos". It shows only while such photos exist, lists them newest first (there's no manual order), and their permalinks open over it instead of All. The slug is reserved so a real category can't take it. The admin Library got a matching "No category" filter.
- The info panel is black (hairline edge) on desktop and phones, at the owner's request. On phones its handle works: drag the sheet down to close it, and a Details bar below the photo opens it again, so opening and closing both happen at the bottom; the toolbar's i button is desktop-only.
- The walk-through (first at `/walk`, now the home page) was added at the owner's request, outside DESIGN.md's milestones: every published photo framed and hung round a ring-shaped room the visitor walks forever, with the usual lightbox for each photo. It uses three.js, bundled into that page's island only (`client:only`), so it never reaches the Worker and the CSP stays self-only. The owner tried a dark room, a spiral ramp and a small room round a pillar, and chose a lit ring at the example's proportions: a small collection repeats round the walls (13 photos hang four times each) rather than shrink the room, and from about 48 photos each hangs once. Details in [wiki/public-gallery.md](wiki/public-gallery.md#walk-through).
- The walk-through is an exception to the look-and-feel rules, on that page only, as the owner asked: a light room (`.tone-light` inverts the tokens there), soft light painted into the walls and floor (gradients), and framed, matted prints with a shadow on the wall. The rest of the site, the header elsewhere and the lightbox stay dark. Mouldings default to black with a gilt fillet; `?frame=gilt|walnut|plain` shows the others.
- The walk-through shows all categories in one room; categories are chosen only in the grid, so its header has no Categories menu.
- The walk-through hangs prints on both walls. The inner wall is convex, so a print hung flat on it faces the visitor only once they're beside it, outside a portrait phone's view (30–40° wide), and on phones the inner prints were almost never seen. Two fixes were tried and dropped: a head turn to the nearest print whenever the visitor stopped (the owner didn't like how it felt), then prints on the outer wall only with a pencil drawing on the inner wall. Now each inner print hangs on a short stretch of wall turned 25° towards the visitor walking up to it, standing out from the curve like a sawtooth, so it faces them from several metres off, and nothing moves by itself. Phones use a 70° view (as in the example) turned a little further towards the inner wall (0.4 rather than 0.3), so each inner print comes into view at the left, about a quarter of the width, while the outer wall's run keeps the middle and right. Turned to 0.5, the inner wall took over the phone's view and the outer prints felt secondary. Where an angled stretch stops the visitor stepping back far enough from an outer print, the view widens instead.
- The walk-through has no title wall, at the owner's request (2026-11-27): the two lines lettered where the visitor arrived ("Photographs by …", the count and years) are gone, and so is the blank bay they took. The room is prints all the way round, the first at the arrival point, and the map no longer marks a title. Every bay holds a print; where the smallest room is a bay too big, the outer wall's prints spread a little wider rather than leave a gap. The labels under the prints stay.
- The walk-through's ceiling is higher, 5.4 m rather than 4.6, and the room has gallery joinery, at the owner's request (2026-11-27), chosen from a list of quiet details: a picture rail near the ceiling with two steel cables down to each frame, a skirting, and a recessed light slot in the ceiling over each wall with the spots in it. Benches, faint light beams and a time-of-day tint were offered too and left for now.
- The cables from the picture rail to each frame were taken out again, at the owner's request (2026-11-27), "for now". The rail stays. They were two 1 px steel-grey lines per print, from the rail to behind the top of the frame, about a third of the frame's width either side of centre (commit 575334e has them).
- The walk-through is the home page, at the owner's request (2026-11-27), replacing the grid of the 48 latest uploads, which is gone (`listLatestPhotos` and `HOME_LIMIT` with it). `/` shows the walk, titled with the `site_title` setting; its Grid button goes to `/all`, and the Walk button on every grid page, the site name in the header and the 404 page's main button lead to `/`. Category and location pages stay grids, and so does `/all`. `/walk` redirects to `/`, keeping its query (`?frame=`). The redirect is a 302, not a 301, so browsers don't cache it for good if the home page changes again. This overrides DESIGN.md's "Home page" line, and settles its featured-set question for now.
