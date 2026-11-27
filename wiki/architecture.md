# Architecture

One Astro app, deployed as one Cloudflare Worker, serves everything: public pages, the image route, the admin pages and the admin JSON API. D1 holds metadata, a private R2 bucket holds the originals, and the Images binding resizes and watermarks. Cloudflare Access sits in front of the admin paths. The diagram is in [DESIGN.md → Architecture](../docs/DESIGN.md#architecture).

## Request flow

1. **[src/middleware.ts](../src/middleware.ts)** runs on every request. Admin paths (`/admin`, `/admin/…`, `/api/admin/…`) must pass the Access JWT check first ([security.md](security.md)). After the handler it adds security headers and, for public HTML, the edge-cache header. The Content-Security-Policy itself comes from Astro's `security.csp` in `astro.config.mjs`, on rendered pages only ([security.md](security.md#content-security-policy)).
2. **Routes** in [src/pages/](../src/pages/):
   - Public pages (`/`, `/c/:slug`, `/l/:slug`, `/all`, `/p/:id`) are server-rendered `.astro` pages. They read D1 through `db.ts` and hand plain data to React islands ([public-gallery.md](public-gallery.md)). `404.astro` answers unknown URLs and pages that return an empty 404.
   - `/img/:id/v:version/:size` is an endpoint that streams a resized derivative ([images.md](images.md)).
   - `/admin/*` pages are Astro shells around React islands; `/api/admin/*` are JSON endpoints ([admin.md](admin.md)).
3. **Bindings** come from `import { env, waitUntil } from 'cloudflare:workers'`. `Astro.locals.runtime` does not exist in this adapter version.

## Bindings and vars

| Name | What | Set in |
| --- | --- | --- |
| `DB` | D1 database `gallery-db` | `wrangler.jsonc` |
| `ORIGINALS` | R2 bucket `gallery-originals` (private) | `wrangler.jsonc` |
| `IMAGES` | Cloudflare Images binding | `wrangler.jsonc` |
| `ASSETS` | Static-asset binding added by the adapter; used to read `watermark.png` | adapter |
| `SITE_URL` | Production origin. Its hostname is also how code tells production from local dev | `wrangler.jsonc` vars |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Access JWT verification | `wrangler.jsonc` vars |
| `OWNER_EMAIL` | The only email allowed into the admin | Worker secret in production, sent from GitHub with each deploy ([deploy.md](deploy.md#secrets)); `.dev.vars` locally |
| `DEV_BYPASS_AUTH` | `1` skips the admin check off the production hostname | `.dev.vars` only |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | AI providers; a provider is available when its key is set ([ai.md](ai.md)) | Worker secrets in production, sent from GitHub with each deploy ([deploy.md](deploy.md#secrets)); `.dev.vars` locally |
| `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | Which model each provider runs | `wrangler.jsonc` vars |
| `AI_MOCK` | `1` replaces the providers with canned answers off the production hostname | `.dev.vars` only |

`wrangler.jsonc` also has an `env.live` block for local dev against live data. Bindings and vars don't inherit into an env, so it repeats them: keep the two in sync ([development.md](development.md)). After any `wrangler.jsonc` change run `pnpm cf-typegen`, which regenerates `worker-configuration.d.ts`.

## Source layout

```
src/
  middleware.ts         admin auth, response headers
  lib/
    db.ts               every D1 query (data-model.md)
    images.ts           size allowlist, format negotiation, URLs, cache keys, transform
    originals.ts        store + verify an uploaded original (Worker only)
    originals-pure.ts   dimension reconciliation (pure)
    auth.ts             Access JWT verification (jose)
    api.ts              JSON responses, error shape, handle(), parseJson()
    schemas.ts          zod schemas for every admin request body
    gallery.ts          pure helpers for public pages and islands: layouts, srcsets, alt text, captions
    exif-format.ts      EXIF display formatting ("1/2000 s", "f/6.3")
    order.ts            fractional positions
    slug.ts             slugify
    host.ts             production hostname check, public origin for absolute URLs (pure)
    ai.ts               AI provider calls and settings (Worker only; ai.md)
    ai-pure.ts          prompt, output schema, tidying, blind-comparison tokens (pure)
    captions.ts         tones, saved-caption rules, hashtags (pure)
    geo.ts              nearest known location for a GPS position (pure)
    walk.ts             walk-through room geometry: bays round the ring, frames, lightbox rect (pure)
    client/             browser only: http.ts (fetch, XHR upload, retry), metadata.ts (exifr, ThumbHash, previews),
                        suggest.ts (downscaled image for the AI, suggest and vote calls)
  components/
    gallery/            public islands + GalleryPage.astro shell
    admin/              admin islands + ui.ts (shared classes, useHydrated)
  layouts/              Base.astro (public), Admin.astro
  pages/                routes
  styles/global.css     design tokens and global CSS
migrations/             numbered SQL: 0001 schema, 0002 seeds, 0003 saved captions and AI votes
scripts/                make-watermark.mjs
public/                 favicon.svg, watermark.png
tests/                  unit/ (Vitest), e2e/ (Playwright), fixtures/ (generated JPEGs)
```

## Module conventions

- **Pure vs Worker code.** Modules that import `cloudflare:workers` (`db.ts`, `originals.ts`, routes) can't run under Vitest or in the browser. Logic worth testing lives in modules with no Worker imports: `gallery.ts`, `images.ts`, `order.ts`, `exif-format.ts`, `originals-pure.ts`, `auth.ts`, `ai-pure.ts`, `captions.ts`, `geo.ts`, `host.ts`, `walk.ts`. Follow the `originals.ts` / `originals-pure.ts` split when a Worker module grows logic that needs tests.
- **Islands never touch D1.** Pages load data and pass it as props. Public islands receive `PublicPhoto` objects only. Island props are serialised into the HTML, so anything passed to a `client:*` component is public ([security.md](security.md)).
- **Admin islands** call `/api/admin/*` through `src/lib/client/http.ts`.
- **`data-hydrated`.** Each island's root element gets this attribute once it has mounted (`useHydrated` in `components/admin/ui.ts`; `Gallery` does the same). Tests wait on it.
- **Endpoints** export `prerender = false`, like every existing one.
- **New runtime dependency:** add it to `vite.optimizeDeps.include` in [astro.config.mjs](../astro.config.mjs), or the dev server breaks mid-session ([development.md](development.md)).
