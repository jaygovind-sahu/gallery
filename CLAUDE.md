# CLAUDE.md

Self-hosted photography gallery for gallery.jaygovindsahu.com on Cloudflare (Astro on Workers, D1, R2, Images binding, Access).

## Source of truth

**[docs/DESIGN.md](docs/DESIGN.md) is the spec.** Read it before any work. Build milestone by milestone in the order it lists; each milestone ends with its "Done when" checks passing and one commit. Milestone 1 (scaffold) is done — start at milestone 2 unless told otherwise.

When the spec leaves a choice open, take the simplest option that meets the requirement and record it under "Decisions made while scaffolding" in README.md (rename that heading to "Decisions" as it grows). If the spec looks wrong or contradicts itself, stop and ask the owner rather than guessing.

## Commands

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local      # schema + seeds into local D1
pnpm dev                   # astro dev on workerd, http://localhost:4321
pnpm build                 # must pass before every commit
pnpm cf-typegen            # after any wrangler.jsonc change
```

## Rules that matter

- **Bindings** come from `import { env } from 'cloudflare:workers'` (`env.DB`, `env.ORIGINALS`, `env.IMAGES`). `Astro.locals.runtime` no longer exists in this adapter version.
- **Database**: prepared statements only, through `src/lib/db.ts`. New schema changes go in a new numbered file in `migrations/`; never edit an applied migration.
- **Privacy is a hard requirement**: public pages, public JSON and the image route never expose GPS (`gps_lat`/`gps_lng`), drafts, R2 keys or internal fields; served derivatives carry no metadata. Public queries always filter `status = 'ready' AND published = 1`.
- **Originals are never served** publicly. Only allowlisted derivative sizes through `/img/...`.
- **Admin** (`/admin*`, `/api/admin/*`) verifies the Cloudflare Access JWT in middleware even though Access sits in front. `DEV_BYPASS_AUTH=1` works only off the production hostname.
- **Look and feel** follows the design tokens in `src/styles/global.css` (minimal dark, Newsreader + Instrument Sans, no accent color). Don't add a light theme, gradients, shadows on photos, or third-party scripts/fonts (CSP is self-only).
- Keep it cheap: stay within Cloudflare free tiers; don't add services beyond D1, R2, Images and Access without asking.
- Tests: Vitest for pure logic (EXIF formatting, ordering, size/format negotiation, JWT), Playwright for flows, as listed in the spec's testing checklist.
