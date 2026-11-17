# Wiki

How the gallery is built today, one page per area. Written for coding agents working in the repo and for the owner coming back to the code.

Three places document the project, and each has its own job:

| Where | Holds | When it disagrees |
| --- | --- | --- |
| [docs/DESIGN.md](../docs/DESIGN.md) | The spec: what to build and why. | It wins on intent. If code or wiki contradicts it, ask the owner. |
| [README.md](../README.md) | Milestone status, setup, first deploy, Lightroom settings, and the **Decisions** log (why things are the way they are). | — |
| `wiki/` | How the code works: where things live, the invariants, the traps. | The code wins. Fix the page. |

## Pages

| Page | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Request flow, bindings and vars, source layout, module conventions |
| [data-model.md](data-model.md) | D1 tables, the `db.ts` data layer, ordering, migrations, seeds |
| [images.md](images.md) | Originals in R2, upload verification, the `/img` route, sizes, watermark, edge cache, admin preview |
| [security.md](security.md) | Access JWT check, dev bypass, response headers, privacy rules, input validation |
| [admin.md](admin.md) | Admin pages and islands, the upload flow, the admin JSON API |
| [ai.md](ai.md) | AI suggestions: providers, what is sent, saved captions per tone, the blind comparison |
| [public-gallery.md](public-gallery.md) | Public routes, layouts, tiles, lightbox, deterrents, caching, look and feel |
| [development.md](development.md) | Local setup, `dev` vs `dev:live`, dev-server traps, local-vs-production differences |
| [testing.md](testing.md) | Vitest and Playwright: what's covered, how to run, how to write tests that don't flake |
| [deploy.md](deploy.md) | Cloudflare resources, the GitHub Actions deploy and its secrets, debugging production |

## Keeping it current

- A change that makes a page wrong updates that page in the same commit.
- Pages describe behaviour and point at code; they don't copy code, SQL or the spec's tables. Link to the file or the DESIGN.md section instead.
- New "why" decisions go in README.md → Decisions, not here.
