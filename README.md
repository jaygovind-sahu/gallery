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
| 7. Polish + deploy | next |

## Stack

- [Astro](https://astro.build) with `@astrojs/cloudflare` (server output, one Worker)
- Cloudflare D1 (`DB`), R2 (`ORIGINALS`), Images (`IMAGES`), Access
- React islands, Tailwind CSS v4, self-hosted Newsreader + Instrument Sans
- pnpm, Node 22+

## Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars     # local-only settings (auth bypass, owner email)
pnpm db:migrate:local              # creates the schema and seeds in a local D1
pnpm dev                           # http://localhost:4321
```

`astro dev` runs on Cloudflare's `workerd` runtime with local D1 and R2 stored under `.wrangler/`. Bindings are typed from `wrangler.jsonc`; after changing it, run `pnpm cf-typegen`.

Other scripts:

| Script | Does |
| --- | --- |
| `pnpm build` | production build into `dist/` |
| `pnpm test` | unit tests (Vitest) |
| `pnpm fixtures` | generate the test JPEGs in `tests/fixtures/` (needs sharp) |
| `pnpm test:e2e` | Playwright flows against the dev server (run `pnpm fixtures` once first) |
| `pnpm preview` | build, then run the built Worker locally with `wrangler dev` |
| `pnpm watermark ["© Name"]` | regenerate `public/watermark.png` |
| `pnpm db:migrate:remote` | apply migrations to the production D1 |
| `pnpm run deploy` | build and deploy to Cloudflare |

## First deploy (Cloudflare account)

1. `pnpm wrangler login`
2. `pnpm wrangler r2 bucket create gallery-originals` — keep public access **off**.
3. `pnpm wrangler d1 create gallery-db`, then paste the printed `database_id` into `wrangler.jsonc`.
4. `pnpm db:migrate:remote`
5. In the Cloudflare dashboard, open **Images** and confirm transformations / the Images binding are enabled.
6. `pnpm wrangler secret put OWNER_EMAIL` — the only email allowed into the admin.
7. `pnpm run deploy` — the `custom_domain` route creates the DNS record for `gallery.jaygovindsahu.com`.
8. **Zero Trust → Access → Applications → Add (self-hosted)**: domain `gallery.jaygovindsahu.com`, paths `/admin*` and `/api/admin/*`, policy "Allow" for your email only. Copy the **AUD tag** and your team domain into `vars` in `wrangler.jsonc` and deploy again.
9. On jaygovindsahu.com, add a "Gallery" nav link to `https://gallery.jaygovindsahu.com`.

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
- The middleware also sets `X-Content-Type-Options` and `Referrer-Policy` on every response now; the CSP arrives with milestone 7.
- Unit tests run in plain Node (`vitest`), not the Workers pool: everything tested is pure logic.
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
- Home page shows the 48 most recent uploads (`created_at DESC`); the "featured set" question in the spec stays open.
- Rows and masonry come from `react-photo-album` wrapped in its `SSR` component with breakpoints 640 / 1024 / 1440: the server renders the layout for each width band and container queries show the matching one, so there is no layout shift before hydration. Captions are rendered with `render.extras` inside each tile at a fixed 44 px, which keeps rows aligned without changing the library's height maths. The uniform grid is a plain CSS grid (2 / 3 / 4 columns, 3:2 tiles, `object-fit: cover`).
- Tile images are `loading="lazy"` with `fetchpriority="high"` on the first four in the server HTML, and switch to `loading="eager"` after hydration. Eager images inside the hidden SSR width bands would otherwise be fetched too, since `display: none` doesn't stop `<img>` loads; lazy ones only load once they have a position in the viewport.
- The layout toggle and the gallery are two islands (the toggle lives in the header, which is server-rendered). The toggle owns `?layout=` and localStorage and broadcasts a `gallery:layout` event; the gallery also resolves the stored choice itself on mount so order of hydration doesn't matter.
- The lightbox is `yet-another-react-lightbox` with Zoom and Fullscreen; the info panel is our own component rendered through `render.controls` (the Captions plugin can't render a location link or category chips). `i` toggles it. Opening pushes `/p/:id`, slide changes `replaceState`, closing goes back when the island pushed the entry and otherwise (direct permalink load) replaces the URL with the gallery page. Opening the lightbox from a permalink uses the photo's first category by category position, else `/all`.
- Public HTML gets `Cache-Control: public, s-maxage=60, stale-while-revalidate=600` from the middleware when the page didn't set its own.
- Category and location pages return a plain-text 404 for unknown slugs until milestone 7 adds the 404 page.
- `vite.optimizeDeps.include` in `astro.config.mjs` lists every runtime dependency. The Cloudflare adapter forwards it to the workerd environments; without it Vite discovers server-side dependencies on first use, re-optimises mid-session, and the request that triggered it (and any in flight) fails with "The file does not exist at `.vite/deps_ssr/...`". Add new dependencies to that list.
