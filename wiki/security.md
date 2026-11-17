# Security and privacy

Spec: [DESIGN.md → Auth & security](../docs/DESIGN.md#auth--security).

## Admin auth

- A Cloudflare Access application covers `/admin*` and `/api/admin/*` on gallery.jaygovindsahu.com and lets in the owner's email only. The Worker doesn't trust that: [src/middleware.ts](../src/middleware.ts) verifies the Access JWT itself with `verifyAccessJwt` ([src/lib/auth.ts](../src/lib/auth.ts)).
- **Token:** the `Cf-Access-Jwt-Assertion` header first, then the `CF_Authorization` cookie.
- **Checks:**
  - signature against `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (key set cached per isolate)
  - issuer `https://<ACCESS_TEAM_DOMAIN>`
  - `aud` = `ACCESS_AUD`
  - not expired
  - `email` = `OWNER_EMAIL`, case-insensitive
- **Failure → 403.** `/api/admin/*` gets JSON `{ error: { code: 'forbidden', … } }`; `/admin*` gets plain text. If `OWNER_EMAIL` isn't set, every admin request is refused.
- **On success** the middleware sets `Astro.locals.adminEmail`.
- **Dev bypass:** `DEV_BYPASS_AUTH=1` in `.dev.vars` skips the check, unless the request's hostname is `SITE_URL`'s hostname. Never set it as a production var.
- **What counts as admin:** `/admin`, `/admin/…` and `/api/admin/…`. A new admin page or endpoint must live under one of these prefixes, or neither Access nor the middleware protects it.

## Response headers (middleware)

| Responses | Headers |
| --- | --- |
| All | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Admin | `Cache-Control: no-store`, `X-Robots-Tag: noindex` |
| Public HTML (GET, 200, no `Cache-Control` set by the page) | `Cache-Control: public, s-maxage=60, stale-while-revalidate=600` |

**Not built yet:** the Content-Security-Policy (milestone 7). It must be self-only plus the image route: no third-party scripts, styles or fonts. That's why fonts are self-hosted through `@fontsource`.

## Privacy rules (hard requirements)

Family photos taken at home make these non-negotiable. Check them for any change that touches public output:

- Public pages, island props, any public JSON, and `/img` never include `gps_lat`/`gps_lng`, R2 keys, drafts, `status`, or other internal fields.
- Public data comes only from the public functions in `db.ts` (`PublicPhoto` and friends), which filter `status = 'ready' AND published = 1` ([data-model.md](data-model.md)).
- **Island props are public.** Astro serialises them into the HTML. Never pass an admin object to a public island.
- Derivatives carry no metadata: the transform doesn't copy it, and `tests/e2e/images.spec.ts` checks for that.
- Originals are never served publicly. The R2 bucket has no public access, no `r2.dev` URL and no custom domain.
- A draft's or unknown id's permalink `/p/:id` is a 404, and so are its image URLs.
- `subject`, `hashtags`, `caption_tone` and the rows of `photo_captions` are admin-only. The public site gets `photos.caption`, the one caption the owner chose to show, and nothing else from them.

## AI providers

The only requests the Worker makes outside Cloudflare are to the Anthropic and OpenAI APIs, from `/api/admin/ai/suggest` ([ai.md](ai.md)).

- A photo is sent only when the owner clicks Suggest for it. There is no automatic or bulk sending.
- What goes out: a downscaled JPEG made in the browser, the location's name and region, the month and year, category names, gear, keywords and the owner's notes. GPS coordinates, the exact time and the original never leave.
- The API keys are Worker secrets, managed in GitHub and sent with each deploy ([deploy.md](deploy.md#secrets)). The browser never talks to a provider, so the self-only CSP is unaffected.
- `AI_MOCK=1` works only off the production hostname, like the dev bypass. Never set it as a production var.

## Input validation

- Every admin JSON body is parsed with a zod schema from [src/lib/schemas.ts](../src/lib/schemas.ts) through `parseJson`. Bad input is a 400 with `{ error: { code, message } }`. Ids are validated as ULIDs.
- Uploads go through the content-type allowlist and the 100 MB cap. Only `IMAGES.info()` is trusted for format and dimensions ([images.md](images.md)).
- SQL is prepared statements only, in `db.ts`.
