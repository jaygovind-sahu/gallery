# Admin

The owner's private area, which has to work on a phone as well as a laptop. Everything lives under `/admin` and `/api/admin`; auth is in [security.md](security.md). Spec: [DESIGN.md → Upload & admin](../docs/DESIGN.md#upload--admin).

## Pages and islands

| Page | File (`src/pages/admin/`) | Island (`src/components/admin/`) |
| --- | --- | --- |
| `/admin` | `index.astro` | `Library`: filters (category, location, published / draft / uploading), multi-select bulk actions. A row stuck in `uploading` for over 24 h is flagged with retry and delete |
| `/admin/upload` | `upload.astro` | `UploadQueue` (below) |
| `/admin/photos/:id` | `photos/[id].astro` | `PhotoForm`: every field, Replace original, Re-read EXIF, Delete, View on site. Title, subject, saved captions and hashtags are the shared `TextFields` island ([ai.md](ai.md)) |
| `/admin/categories` | `categories/index.astro` | `CategoryManager`: create, rename, describe, slug, default layout, cover, reorder with up/down buttons, delete |
| `/admin/categories/:id` | `categories/[id].astro` | `SortableGrid`: drag-reorder photos with dnd-kit (mouse, touch after a short hold, keyboard) |
| `/admin/locations` | `locations.astro` | `LocationManager`: create, rename, merge, delete |
| `/admin/ai` | `ai.astro` | `AiSettings`: which model writes suggestions, the blind comparison and its results, the owner's voice notes |

- Layout: [src/layouts/Admin.astro](../src/layouts/Admin.astro) (nav, `noindex`).
- Shared Tailwind class strings and `useHydrated` are in `components/admin/ui.ts`.
- Thumbnails use the private preview route ([images.md](images.md)).

## Upload flow

The browser reads metadata and makes previews; the Worker stores the file, re-checks it and owns the database.

1. **Pick or drop files.** JPEG, PNG or WebP only, ≤ 100 MB; anything else is rejected in the browser.
2. **`readMetadata`** ([src/lib/client/metadata.ts](../src/lib/client/metadata.ts), exifr) reads the EXIF fields, orientation, GPS, and the XMP/IPTC title and caption that Lightroom writes.
3. **`makePreview`** decodes once with orientation applied. That gives the display width/height, a ThumbHash from a ≤ 100 px copy, and a small card preview. Files are processed one at a time so phones don't run out of memory.
4. **Checks on each card**, once it is read:
   - **Duplicate:** `POST /api/admin/photos/duplicates` reports a library photo with the same size and the same filename or capture time. The card links to it; the owner decides. Two cards with the same name and size are flagged too.
   - **Location from GPS:** `nearestLocation` ([src/lib/geo.ts](../src/lib/geo.ts)) picks the location whose earlier photos were taken within 5 km. It applies when the batch has no location; otherwise the card offers it with a "Use" link.
5. **The owner fills in fields.** Location, categories and publish/draft are set once for the batch. Visibility defaults to **draft** and remembers the last choice on that device (`localStorage`). Each card has title, subject, caption and a Suggest button (`TextFields`, [ai.md](ai.md)).
6. **`POST /api/admin/photos`** creates the row (`status = 'uploading'`) and returns `{ id }`. From then on the card keeps its own copy of the batch settings.
7. **`PUT /api/admin/photos/:id/original`** sends the raw file by XHR, for the progress bar, with an `X-Exif-Orientation` header. The server verifies it and marks it ready ([images.md](images.md)).
8. **The queue** runs 2 uploads at a time. `withRetry` makes up to 3 attempts (backoff 600 ms, then 1.2 s) and retries only network errors, 408, 429 and 5xx.
9. **Cards stay editable** while the file uploads and after. Changes made once the row exists are compared with what the server last received (`editablePayload`): they are sent with `PATCH` when the upload finishes, and afterwards through the card's "Save changes" link.
10. **Leaving the page** with uploads in flight or unsaved card edits triggers the browser's leave warning.

## API

All JSON, under `/api/admin/`. Errors are `{ error: { code, message } }` with a matching status.

| Method + path | Does |
| --- | --- |
| `GET photos` | Library list; query `category`, `location`, `status` (`published` / `draft` / `uploading`) |
| `POST photos` | Create the row from browser-read metadata → `{ id }`. Takes `subject`, `hashtags`, `captions` and `captionTone` as well as the older `caption` |
| `POST photos/duplicates` | `{ files: [{ key, originalFilename, bytes, takenAt }] }` → `{ matches: { [key]: [{ id, title, originalFilename }] } }` |
| `GET photos/:id` | One photo, admin view |
| `PATCH photos/:id` | Edit fields. `categoryIds` replaces membership; new memberships append at the end. `captions` replaces the saved captions and `captionTone` picks the one shown ([ai.md](ai.md#saved-captions)) |
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
| `POST ai/suggest` | A downscaled image plus context → `{ sets: [{ token, suggestion }], blind, note? }`. Stores nothing |
| `GET / PATCH ai/settings` | Provider, blind comparison, voice notes; returns the available models and the comparison tally. `resetVotes: true` clears the tally |
| `POST ai/votes` | `{ winner, loser }` tokens from a blind comparison |

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
