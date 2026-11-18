# AGENTS.md

Instructions for coding agents working in this repo. `CLAUDE.md` is a symlink to this file; edit this one.

Self-hosted photography gallery for gallery.jaygovindsahu.com on Cloudflare (Astro on Workers, D1, R2, Images binding, Access).

## Read first

- **[docs/DESIGN.md](docs/DESIGN.md)** is the spec. Read it before any work.
- **[README.md](README.md)** has milestone status, setup, deploy steps and the Decisions log.
- **[wiki/](wiki/README.md)** explains how the code works, one page per area. Read the page for the area you're changing:

| Changing… | Read |
| --- | --- |
| Routing, bindings, where code lives | [wiki/architecture.md](wiki/architecture.md) |
| Schema, queries, ordering, migrations | [wiki/data-model.md](wiki/data-model.md) |
| Uploads to R2, `/img`, sizes, watermark | [wiki/images.md](wiki/images.md) |
| Auth, headers, anything public-facing | [wiki/security.md](wiki/security.md) |
| Admin pages or `/api/admin/*` | [wiki/admin.md](wiki/admin.md) |
| AI suggestions, saved captions, hashtags | [wiki/ai.md](wiki/ai.md) |
| Public pages, layouts, lightbox, styling | [wiki/public-gallery.md](wiki/public-gallery.md) |
| Running things locally | [wiki/development.md](wiki/development.md) |
| Tests | [wiki/testing.md](wiki/testing.md) |
| Deploying or debugging production | [wiki/deploy.md](wiki/deploy.md) |

## How to work

- Build milestone by milestone in the order DESIGN.md lists; README.md's Status table says which is next. Each milestone ends with its "Done when" checks passing and one commit.
- When the spec leaves a choice open, take the simplest option that meets the requirement and record it under "Decisions" in README.md. If the spec looks wrong or contradicts itself, stop and ask the owner rather than guessing.
- `pnpm build` must pass before every commit. Run `pnpm test` and the e2e specs for what you touched.
- If a change makes a wiki page wrong, fix the page in the same commit.
- Deploys, remote migrations, and anything run against `pnpm dev:live` change the live gallery. Ask the owner first. **Pushing or merging to `main` is a deploy**: GitHub Actions applies any new migration and deploys ([deploy.md](wiki/deploy.md)).
- **Before creating a branch or worktree, pull and look at the graph.** Run `git switch main && git pull --ff-only` (or `git fetch` and branch from `origin/main`), then `git log --oneline --graph -10 origin/main`. `main` is what's deployed. A stale local `main` hides merged work and puts the new branch behind it.
- **No AI attribution in commits or PRs.** Commit messages and PR descriptions don't name an AI model or tool: no `Co-Authored-By` trailer for one, no "Generated with" line.

## Rules that must not break

Each rule is one line here; the linked page has the details.

- **Privacy:** public pages, island props, public JSON and `/img` never expose GPS, drafts, R2 keys or internal fields; public queries filter `status = 'ready' AND published = 1`. [security.md](wiki/security.md)
- **Originals are never served publicly.** Only allowlisted derivative sizes go out, through `/img`. [images.md](wiki/images.md)
- **Admin** pages and endpoints live under `/admin` or `/api/admin`, where middleware re-verifies the Access JWT. `DEV_BYPASS_AUTH=1` works only off the production hostname. [security.md](wiki/security.md)
- **SQL:** prepared statements only, all in `src/lib/db.ts`. Schema changes go in a new numbered migration; never edit an applied one. [data-model.md](wiki/data-model.md)
- **Bindings:** use `import { env } from 'cloudflare:workers'`; `Astro.locals.runtime` doesn't exist. [architecture.md](wiki/architecture.md)
- **Look and feel:** use the tokens in `src/styles/global.css`. Dark only, no accent color, no gradients, no shadows on photos, no third-party scripts or fonts (the CSP is self-only). [public-gallery.md](wiki/public-gallery.md)
- **Cost:** stay within Cloudflare free tiers. Don't add services beyond D1, R2, Images and Access without asking; the owner has approved the Anthropic and OpenAI APIs for AI suggestions only. [images.md](wiki/images.md)
- **AI:** a photo goes to a model only when the owner clicks Suggest for it, as a downscaled copy with no GPS. Subject, hashtags and unshown captions are private. [ai.md](wiki/ai.md)
