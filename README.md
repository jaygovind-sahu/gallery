# Gallery

Self-hosted photography portfolio for **gallery.jaygovindsahu.com**, running entirely on Cloudflare: an Astro app on Workers, originals in a private R2 bucket, metadata in D1, and resizing plus watermarking through the Cloudflare Images binding. A private admin (behind Cloudflare Access) handles uploads from laptop or phone.

The full design — scope, data model, image pipeline, admin, look and feel, milestones — is in [docs/DESIGN.md](docs/DESIGN.md).

## Status

| Milestone | State |
| --- | --- |
| 1. Scaffold (Astro + Cloudflare, D1 schema and seeds, watermark) | done |
| 2. Auth + admin shell | done |
| 3. Upload | done |
| 4. Image route | next (the private admin preview route is already in) |
| 5. Public gallery | — |
| 6. Admin management | done |
| 7. Polish + deploy | — |

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
