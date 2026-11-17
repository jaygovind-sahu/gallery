# Deploy and production

First-time account setup (bucket, database, Access application, secret) is in [README.md → First deploy](../README.md#first-deploy-cloudflare-account). This page covers what's already in place and day-to-day work.

## What's in the Cloudflare account

- **Worker** `gallery`, served only on gallery.jaygovindsahu.com (a `custom_domain` route). `workers_dev` and `preview_urls` are off, so the admin can't be reached on a URL that Access doesn't cover.
- **D1** `gallery-db`, **R2** `gallery-originals` (private), and the **Images** binding.
- **Access application** "Gallery admin" on `/admin*` and `/api/admin/*`, owner's email only. Its team domain and AUD tag are in `wrangler.jsonc` vars.
- **Secret** `OWNER_EMAIL` (`pnpm wrangler secret put OWNER_EMAIL`).
- **Secrets** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` for AI suggestions, once the owner has added them. Either can be missing: the provider is then unavailable, and with neither the Suggest button is hidden ([ai.md](ai.md)).

## Deploying

**These commands change the live site. Ask the owner before running them.**

1. If the release adds a migration, run `pnpm db:migrate:remote` first. Code that depends on a new column shouldn't go out before the column exists.
2. Run `pnpm run deploy` (build + `wrangler deploy`).

`env.live` in `wrangler.jsonc` exists only for local dev (`pnpm dev:live`). It has no routes, so a stray `--env live` deploy can't claim the domain, but don't deploy it.

## Debugging production

- **Bot challenge:** curl and headless clients get a 403 with `cf-mitigated: challenge` on every Worker route; only static files (e.g. `/watermark.png`) get through. Don't try to probe pages or `/img` from scripts.
- **Logs:** run `pnpm wrangler tail gallery --format json` while the owner reproduces the problem in a browser. Stored observability logs aren't readable with wrangler's OAuth login.
- **The deployed bundle against live data, read-only:**
  1. Run `pnpm build`.
  2. Copy `dist/server/wrangler.json` to a sibling file and add `"remote": true` to its D1 and R2 bindings.
  3. Run `pnpm wrangler dev -c <that file> --port 8788`. Don't write anything.
  4. Delete the copy afterwards.
- **Dev server against live data:** `pnpm dev:live` ([development.md](development.md)). Writes are real.
- **AI suggestions failing:** the island shows the provider's reason (bad key, unknown model, rate or spend limit). `wrangler tail` shows one `ai_suggest` line per successful call with token counts. The first real calls after adding a key are the first time that provider's code path has run for real ([ai.md](ai.md#not-verified-here)).
- **Images quota:** past 5,000 unique transformations a month on the free plan, new derivatives fail with 9422. The route logs "images quota exhausted" and answers 503; cached derivatives keep working ([images.md](images.md)).
