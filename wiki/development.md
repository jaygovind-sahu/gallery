# Development

## Setup

Node 22+ and pnpm.

```sh
pnpm install
cp .dev.vars.example .dev.vars   # DEV_BYPASS_AUTH=1, OWNER_EMAIL, AI_MOCK=1
pnpm db:migrate:local            # schema + seeds into local D1
pnpm dev                         # http://localhost:4321, admin at /admin
```

The full script list is in [README.md → Local development](../README.md#local-development).

## Which server talks to what

| Command | Runtime | Data | Notes |
| --- | --- | --- | --- |
| `pnpm dev` | `astro dev` on workerd | Local D1 and R2 under `.wrangler/` | Auth bypass from `.dev.vars`. The normal way to work |
| `pnpm dev:live` | Same, with `CLOUDFLARE_ENV=live` | **Live** D1 and R2 (`env.live` in `wrangler.jsonc`; needs `wrangler login`) | Writes change the real gallery. The Images binding stays local. Reads `.dev.vars.live` instead of `.dev.vars` when it exists (no merging), which is where a real AI key goes |
| `pnpm preview` | Built Worker under `wrangler dev` | Wrangler's own local D1, separate from `astro dev`'s and empty until migrated | Closest to production |

- **Never** run e2e tests, probes that write, or scratch uploads while `dev:live` is up. Playwright reuses whatever server is on :4321.
- **Production-like auth check:** `pnpm build`, then `pnpm wrangler dev --port 8788 --var DEV_BYPASS_AUTH:0`. `/admin` should return 403.

## Dev-server traps

- **One `astro dev` per project.** Astro 7 refuses a second one on any port. Check with `pnpm astro dev status` or `lsof -nP -iTCP:4321 -sTCP:LISTEN` before starting; the owner may already have one running.
- **Throwaway second server:** `pnpm dev --port 4399 --ignore-lock`. Stop it by its LISTEN pid only.
- **Background server:** `pnpm astro dev --background`. Read its logs with `pnpm astro dev logs`, stop it with `pnpm astro dev stop`.
- **New runtime dependency:** add it to `vite.optimizeDeps.include` in [astro.config.mjs](../astro.config.mjs), then restart the dev server. Otherwise Vite re-optimises mid-session, and requests fail with "The file does not exist at `.vite/deps_ssr/...`".
- **Don't run `pnpm build` while e2e tests are using the dev server.** It triggers the same re-optimisation.
- **After editing `wrangler.jsonc`:** run `pnpm cf-typegen`. If `database_id` changed, run `pnpm db:migrate:local` again (local data is keyed by it). Keep the top level and `env.live` in sync.

## Local vs production behaviour

Code tells production from local dev by comparing the request's hostname with `SITE_URL`'s.

| | Production | Local dev |
| --- | --- | --- |
| Admin auth | Access JWT required | Bypassed with `DEV_BYPASS_AUTH=1` |
| Watermark, `quality` | Applied | Ignored by the local Images binding |
| Transform failure on `/img` | 503 | Original bytes, `no-store` |
| Upload verification can't run | 502, object deleted | Browser dimensions kept, `unverified: true` |
| Non-image upload error code | 9412 | 9523 |
| AI suggestions | Real providers, for each key that is set | `AI_MOCK=1`: two canned stand-ins, no key and no cost. For a real model, put the key and `AI_MOCK=0` in `.dev.vars.live` and use `dev:live`; keep keys out of `.dev.vars`, which the e2e tests use |

## Before committing

1. `pnpm build` must pass.
2. Run `pnpm test`, plus the e2e specs for the area you touched ([testing.md](testing.md)).
3. Update any wiki page the change made wrong.
