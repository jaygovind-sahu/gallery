# Deploy and production

First-time account setup (bucket, database, Access application, secret) is in [README.md → First deploy](../README.md#first-deploy-cloudflare-account). This page covers what's already in place, the GitHub Actions deploy and its secrets, and debugging production.

## What's in the Cloudflare account

- **Worker** `gallery`, served only on gallery.jaygovindsahu.com (a `custom_domain` route). `workers_dev` and `preview_urls` are off, so the admin can't be reached on a URL that Access doesn't cover.
- **D1** `gallery-db`, **R2** `gallery-originals` (private), and the **Images** binding.
- **Access application** "Gallery admin" on `/admin*` and `/api/admin/*`, owner's email only. Its team domain and AUD tag are in `wrangler.jsonc` vars.
- **Worker secrets** `OWNER_EMAIL`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. The AI keys are optional: without one the provider is unavailable, and with neither the Suggest button is hidden ([ai.md](ai.md)). Where they're managed is under [Secrets](#secrets).

## Deploying

**Pushing or merging to `main` deploys the live site.** So does running the workflow by hand. Ask the owner before doing either.

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) runs on every push to `main`, and from **Actions → Deploy → Run workflow**. One deploy runs at a time; a newer push waits for the running one. The steps:

1. `pnpm install --frozen-lockfile`
2. `pnpm test` (unit tests only; the e2e suite takes over 10 minutes and needs browsers)
3. `pnpm build`
4. `pnpm db:migrate:remote`: applies only migrations production hasn't seen, so it's a no-op on most deploys. It runs before the deploy so code that needs a new column never goes out ahead of it. **A migration merged to `main` reaches production on that push.**
5. `wrangler deploy --secrets-file …` with whichever Worker secrets are set in GitHub ([Secrets](#secrets)).

If any step fails, nothing after it runs. A failed deploy after a successful migration leaves the old code running on the new schema, as a manual deploy would.

**By hand** (when GitHub is unavailable): `pnpm db:migrate:remote`, then `pnpm run deploy`. This doesn't touch secrets.

`env.live` in `wrangler.jsonc` exists only for local dev (`pnpm dev:live`). It has no routes, so a stray `--env live` deploy can't claim the domain, but don't deploy it.

## Secrets

GitHub holds the deploy credentials and, optionally, the Worker's own secrets. Keep them on the `production` environment (**Settings → Environments → production**), restricted to the `main` branch, so a workflow on any other branch can't read them. The deploy job names that environment; GitHub creates it on the first run if it doesn't exist yet, but without the branch restriction.

| GitHub secret | Used for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Migrations and the deploy. Required. |
| `CLOUDFLARE_ACCOUNT_ID` | The account to deploy to. Required. |
| `OWNER_EMAIL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Sent to the Worker with each deploy. Optional. |

- **How the Worker secrets get there:** the deploy step writes the ones that are set to a temporary JSON file and passes it to `wrangler deploy --secrets-file`. They go up in the same Worker version as the code, as ordinary secret bindings. The log lists their names, never values.
- **The file is additive.** A secret that isn't set in GitHub is left as it is on the Worker. So `pnpm wrangler secret put` still works, but a GitHub value for the same name overwrites it on the next deploy.
- **Changing one:** update it in GitHub, then run the workflow. Secrets only reach the Worker on a deploy.
- **Removing one:** delete it in GitHub **and** run `pnpm wrangler secret delete <NAME>`. Deleting it in GitHub alone leaves the old value on the Worker.
- The repo is public. GitHub doesn't give secrets to workflows triggered by pull requests from forks, and this workflow doesn't run on pull requests at all. Don't add a `pull_request_target` trigger to it.

### One-time setup

1. **Cloudflare API token:** dashboard → **My Profile → API Tokens → Create Token** → **Edit Cloudflare Workers** template. The template fills in a Zone, an Account and a User policy. Edit the **Account policy**: make sure it includes **D1 Write** (migrations need it) and covers this account only. Edit the **Zone policy** to cover only `jaygovindsahu.com`. Leave client IP filtering empty: GitHub's runners have no fixed addresses.
2. **Account ID:** shown on the dashboard's Workers & Pages overview, or by `pnpm wrangler whoami`.
3. **Environment:** GitHub → **Settings → Environments → New environment** `production`. Under **Deployment branches and tags** choose **Selected branches and tags** and add `main`. Not **Protected branches only**: `main` has no branch protection, so that option blocks every deploy.
4. **Secrets:** add them on that environment, in the dashboard or with `gh secret set <NAME> --env production` (it prompts for the value, so the value stays out of shell history).
5. Run the workflow once by hand and check the log: the migration step lists what it applied, and the deploy step lists which secrets it sent.

If the deploy step fails with an authentication or permission error on the custom domain, add **DNS Write** to the token's Zone policy. You can change a token's permissions without changing its value.

## Checks after a deploy that changes headers or pages

Scripts can't load the live pages (bot challenge, below), so the owner checks these in a normal browser. They were first run for milestone 7.

1. **No CSP errors.** Open DevTools → Console on the home page, a category, a photo (lightbox and info panel), a location, `/admin`, `/admin/upload` (pick a file) and `/admin/ai`. There should be no "Content Security Policy" errors.
   - Cloudflare can inject its own inline scripts into pages: bot detection (JavaScript detections), Web Analytics, Rocket Loader, Email Address Obfuscation. The CSP blocks them, and they show up here as blocked inline scripts or `/cdn-cgi/` URLs. Turn the feature off for this hostname, or allow it in the CSP on purpose; don't add `'unsafe-inline'`.
2. **Headers.** DevTools → Network → the document request: `content-security-policy`, `strict-transport-security`, `x-frame-options`, `permissions-policy` are present.
3. **404.** A made-up address such as `/c/nothing` shows the "Nothing here" page.
4. **Link previews.** Paste a category link and a photo link into a chat app. Each should preview with a photo (the category's cover, or the photo itself). No preview at all usually means the bot challenge is stopping the app's crawler: allow verified bots in the zone's security settings.

## Debugging production

- **Bot challenge:** curl and headless clients get a 403 with `cf-mitigated: challenge` on every Worker route; only static files (e.g. `/watermark.png`) get through. Don't try to probe pages or `/img` from scripts.
- **A failed deploy:** open the run under **Actions → Deploy**. Error codes such as 10000 or 7403 from the migration or deploy step usually mean the API token is missing a permission ([One-time setup](#one-time-setup)).
- **Logs:** run `pnpm wrangler tail gallery --format json` while the owner reproduces the problem in a browser. Stored observability logs aren't readable with wrangler's OAuth login.
- **The deployed bundle against live data, read-only:**
  1. Run `pnpm build`.
  2. Copy `dist/server/wrangler.json` to a sibling file and add `"remote": true` to its D1 and R2 bindings.
  3. Run `pnpm wrangler dev -c <that file> --port 8788`. Don't write anything.
  4. Delete the copy afterwards.
- **Dev server against live data:** `pnpm dev:live` ([development.md](development.md)). Writes are real.
- **AI suggestions failing:** the island shows the provider's reason (bad key, unknown model, rate or spend limit). `wrangler tail` shows one `ai_suggest` line per successful call with token counts. The first real calls after adding a key are the first time that provider's code path has run for real ([ai.md](ai.md#not-verified-here)).
- **Images quota:** past 5,000 unique transformations a month on the free plan, new derivatives fail with 9422. The route logs "images quota exhausted" and answers 503; cached derivatives keep working ([images.md](images.md)).
