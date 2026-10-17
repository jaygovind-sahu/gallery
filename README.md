# Gallery

Self-hosted photography portfolio for **gallery.jaygovindsahu.com**, running entirely on Cloudflare: an Astro app on Workers, originals in a private R2 bucket, metadata in D1, and resizing plus watermarking through the Cloudflare Images binding. A private admin (behind Cloudflare Access) handles uploads from laptop or phone.

The full design — scope, data model, image pipeline, admin, look and feel, milestones — is in [docs/DESIGN.md](docs/DESIGN.md).

## Status

| Milestone | State |
| --- | --- |
| 1. Scaffold (Astro + Cloudflare, D1 schema and seeds, watermark) | done |
| 2. Auth + admin shell | next |
| 3. Upload | — |
| 4. Image route | — |
| 5. Public gallery | — |
| 6. Admin management | — |
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

## Decisions made while scaffolding

- `imageService: 'passthrough'` in the Astro adapter: photos are resized by our own `/img` route via the Images binding, not by `astro:assets`.
- `OWNER_EMAIL` is a Worker secret rather than a plain var, so it isn't committed.
- The watermark PNG is rendered from SVG text with sharp; the system font is used if Instrument Sans isn't installed where the script runs.
