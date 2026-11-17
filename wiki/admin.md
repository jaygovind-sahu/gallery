# Admin

The owner's private area, which has to work on a phone as well as a laptop. Everything lives under `/admin` and `/api/admin`; auth is in [security.md](security.md). Spec: [DESIGN.md → Upload & admin](../docs/DESIGN.md#upload--admin).

## Pages and islands

| Page | File (`src/pages/admin/`) | Island (`src/components/admin/`) |
| --- | --- | --- |
| `/admin` | `index.astro` | `Library`: filters (category, location, published / draft / uploading), multi-select bulk actions. A row stuck in `uploading` for over 24 h is flagged with retry and delete |
| `/admin/upload` | `upload.astro` | `UploadQueue` (below) |
| `/admin/photos/:id` | `photos/[id].astro` | `PhotoForm`: every field, Replace original, Re-read EXIF, Delete, View on site |
| `/admin/categories` | `categories/index.astro` | `CategoryManager`: create, rename, describe, slug, default layout, cover, reorder with up/down buttons, delete |
| `/admin/categories/:id` | `categories/[id].astro` | `SortableGrid`: drag-reorder photos with dnd-kit (mouse, touch after a short hold, keyboard) |
| `/admin/locations` | `locations.astro` | `LocationManager`: create, rename, merge, delete |

- Layout: [src/layouts/Admin.astro](../src/layouts/Admin.astro) (nav, `noindex`).
- Shared Tailwind class strings and `useHydrated` are in `components/admin/ui.ts`.
- Thumbnails use the private preview route ([images.md](images.md)).

## Upload flow

The browser reads metadata and makes previews; the Worker stores the file, re-checks it and owns the database.

1. **Pick or drop files.** JPEG, PNG or WebP only, ≤ 100 MB; anything else is rejected in the browser.
2. **`readMetadata`** ([src/lib/client/metadata.ts](../src/lib/client/metadata.ts), exifr) reads the EXIF fields, orientation, GPS, and the XMP/IPTC title and caption that Lightroom writes.
3. **`makePreview`** decodes once with orientation applied. That gives the display width/height, a ThumbHash from a ≤ 100 px copy, and a small card preview. Files are processed one at a time so phones don't run out of memory.
4. **The owner fills in fields.** Location, categories and publish/draft are set once for the batch; title and caption on each card.
5. **`POST /api/admin/photos`** creates the row (`status = 'uploading'`) and returns `{ id }`.
6. **`PUT /api/admin/photos/:id/original`** sends the raw file by XHR, for the progress bar, with an `X-Exif-Orientation` header. The server verifies it and marks it ready ([images.md](images.md)).
7. **The queue** runs 2 uploads at a time. `withRetry` makes up to 3 attempts (backoff 600 ms, then 1.2 s) and retries only network errors, 408, 429 and 5xx.

## API

All JSON, under `/api/admin/`. Errors are `{ error: { code, message } }` with a matching status.

| Method + path | Does |
| --- | --- |
| `GET photos` | Library list; query `category`, `location`, `status` (`published` / `draft` / `uploading`) |
| `POST photos` | Create the row from browser-read metadata → `{ id }` |
| `GET photos/:id` | One photo, admin view |
| `PATCH photos/:id` | Edit fields. `categoryIds` replaces membership; new memberships append at the end |
| `DELETE photos/:id` | Delete every R2 version, then the rows; covers pointing at it are cleared |
| `PUT photos/:id/original` | Raw body → R2, verify, mark ready |
| `PUT photos/:id/replace` | Raw body → new version. Headers `X-Width`, `X-Height`, `X-Placeholder`, `X-Exif-Orientation`. "Re-read EXIF" is a follow-up `PATCH` from the browser |
| `POST photos/bulk` | `{ action, ids, … }`: `publish`, `unpublish`, `addCategory`, `removeCategory`, `setLocation`, `delete` (≤ 500 ids) |
| `GET / POST / PATCH categories` | List / create / reorder with `{ ids }` (listed first, the rest keep their order) |
| `GET / PATCH / DELETE categories/:id` | Category with its photos / edit (incl. cover, default layout, slug → 409 if taken) / delete (the photos stay) |
| `POST categories/:id/move` | `{ photoId, beforeId?, afterId? }` → fractional position |
| `GET / POST locations` | List / create |
| `GET / PATCH / DELETE locations/:id` | Read / edit / delete; `DELETE …?into=<id>` merges into another location |
| `GET img/:id/:size` | Private preview |

**Server side:**
- Handlers are wrapped in `handle()` ([src/lib/api.ts](../src/lib/api.ts)). A thrown `ApiError` becomes its status and code; anything else becomes a 500.
- Bodies go through `parseJson(request, schema)`.
- SQL is in `db.ts`.

**Client side** ([src/lib/client/http.ts](../src/lib/client/http.ts)):
- `api()` throws `RequestFailed` carrying the server's code and message.
- `putFile` is the XHR PUT with progress.
- `confirmDanger` guards destructive actions.

**Adding an endpoint:**
1. Put the file under `src/pages/api/admin/` and `export const prerender = false`.
2. Add a zod schema to `schemas.ts` and wrap the handler in `handle`.
3. Put the queries in `db.ts`.
