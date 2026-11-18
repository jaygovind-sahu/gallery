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

## Response headers

Set by [src/middleware.ts](../src/middleware.ts), except the CSP:

| Responses | Headers |
| --- | --- |
| All | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment, USB and topics off) |
| All over HTTPS | `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`: it would bind every jaygovindsahu.com subdomain) |
| Rendered pages, built only | `Content-Security-Policy`, from Astro (below) |
| Admin | `Cache-Control: no-store`, `X-Robots-Tag: noindex` |
| Public HTML (GET, 200, no `Cache-Control` set by the page) | `Cache-Control: public, s-maxage=60, stale-while-revalidate=600` |

## Content-Security-Policy

Astro's `security.csp` in [astro.config.mjs](../astro.config.mjs) sends it as a header on every page Astro renders, 404 page included. It hashes the inline scripts and styles Astro renders itself (island bootstrap, small CSS), so nothing inline needs `'unsafe-inline'` except style attributes.

```
default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none';
script-src 'self' <hashes>; style-src 'self' <hashes>; style-src-attr 'unsafe-inline'
```

- **Why each exception:**
  - `style-src-attr 'unsafe-inline'`: React renders `style="…"` on the server (tile caption height, ThumbHash backgrounds, the album's sizes).
  - `img-src data:`: ThumbHash placeholders.
  - `img-src blob:`: upload previews in the admin.
- **Only in the build.** `astro dev` sends no CSP (Vite injects inline scripts), so the e2e suite doesn't exercise it. Check a change that adds scripts, styles or external URLs against the built Worker ([development.md](development.md#checking-the-csp)).
- **Things the CSP would block, already handled:**
  - react-photo-album's SSR wrapper renders an inline `<style>` with per-render class names. `Gallery.tsx` passes `unstyled` and its own band classes, styled in `global.css` (`.ssr-band`).
  - zod probes `new Function` in the browser; `ai-pure.ts` sets `z.config({ jitless: true })` so the probe never runs.
- **Never add:** a third-party script, stylesheet, font or `connect-src` origin, `'unsafe-inline'` or `'unsafe-eval'` for scripts. Fonts are self-hosted through `@fontsource` for this reason. The AI providers are called from the Worker, never the browser.
- **The build warns** that `style-src` resources don't apply to `style-src-attr`. That's intended: only attributes get `'unsafe-inline'`.

## Privacy rules (hard requirements)

Family photos taken at home make these non-negotiable. Check them for any change that touches public output:

- Public pages, island props, any public JSON, and `/img` never include `gps_lat`/`gps_lng`, R2 keys, drafts, `status`, or other internal fields.
- Public data comes only from the public functions in `db.ts` (`PublicPhoto` and friends), which filter `status = 'ready' AND published = 1` ([data-model.md](data-model.md)).
- **Island props are public.** Astro serialises them into the HTML. Never pass an admin object to a public island.
- Derivatives carry no metadata: the transform doesn't copy it, and `tests/e2e/images.spec.ts` checks for that.
- Originals are never served publicly. The R2 bucket has no public access, no `r2.dev` URL and no custom domain.
- A draft's or unknown id's permalink `/p/:id` is a 404, and so are its image URLs. The 404 page reads the same for both, so it doesn't reveal that a draft exists.
- A category's cover is used as its Open Graph image only if that photo is published (`getPublicCoverPhotoId`); otherwise the first public photo is.
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
