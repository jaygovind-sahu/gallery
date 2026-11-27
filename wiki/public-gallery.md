# Public gallery

Server-rendered Astro pages, with React islands for the gallery and the layout toggle. Spec: [DESIGN.md → Public gallery](../docs/DESIGN.md#public-gallery).

## Routes

| Path | File (`src/pages/`) | Photos | Default layout |
| --- | --- | --- | --- |
| `/` | `index.astro` | Latest 48 uploads | `settings.default_layout` |
| `/c/:slug` | `c/[slug].astro` | The category, in its manual order | The category's `default_layout` |
| `/c/miscellaneous` | `c/miscellaneous.astro` | Published photos in no category, newest upload first (`listUncategorizedPhotos`); a 404 while there are none. The static route wins over `[slug]`, and the slug is reserved (below) | `settings.default_layout` |
| `/all` | `all.astro` | Every published photo, by `sort_order` | `settings.default_layout` |
| `/l/:slug` | `l/[slug].astro` | Photos at the location, newest taken first | `settings.default_layout` |
| `/p/:id` | `p/[id].astro` | Opens the lightbox over the photo's first category (by category position), else Miscellaneous. Server-renders the title, caption and Open Graph tags with the 1600 px image | That gallery's |
| `/walk` | `walk/index.astro` | Every published photo, by `sort_order`, as one room to walk through ([below](#walk-through)) | — |

- **404:** an unknown URL, slug or id, or a draft's permalink, gets [404.astro](../src/pages/404.astro) with status 404. Pages trigger it by returning `new Response(null, { status: 404 })`: Astro renders the 404 page for an empty-bodied 404. A body (like `/img`'s plain text) is sent as is. The wording is the same in every case.
- Every page renders through [GalleryPage.astro](../src/components/gallery/GalleryPage.astro), which wraps [Base.astro](../src/layouts/Base.astro): header, footer, meta and Open Graph tags, and the header script (hides on scroll down; sets `data-scrolled` once the page has scrolled, which turns the header translucent with a hairline).
- The heading block takes `heading`, an `eyebrow` (small caps above it: the photo count, plus the region on location pages) and a `subline` (the category description). The home page has none.
- Each page has two islands: `LayoutToggle` in the header's `header-end` slot, and `Gallery`.
- **Header and footer menus** come from `getPublicNav()` in `db.ts`, which every page loads and passes down as `nav`: the categories with published photos (empty ones are left out), the count of published photos in no category, and the total.
  - Desktop: a **Categories** `<details>` menu and an **All** link. The menu lists each category with its count ([NavMenuItem.astro](../src/components/NavMenuItem.astro)), a dot on the current one, then Miscellaneous after a hairline when its count is above 0. On a category page the summary gets `data-active`, which underlines it like a current link.
  - Phones: one `<details>` menu with the same rows, a hairline, Miscellaneous, then "All photos" with the total.
  - The header script closes an open menu on a click outside it or on Escape. The footer lists the same categories, Miscellaneous and All.
  - **Reserved slug:** `miscellaneous` (`RESERVED_CATEGORY_SLUGS` in `slug.ts`). Creating a category with that name gives it `miscellaneous-2`, and a PATCH to that slug is a 409 `slug_taken`.
- **Open Graph** (in `Base.astro`): canonical link and `og:url` from `SITE_URL`, `og:site_name`, title, description, and a preview image at 1600 px with its size and alt text. `GalleryPage` takes `ogPhoto`, defaulting to the first photo on the page. Category pages pass their cover if it's public, the permalink passes its photo. Without a photo the card is `summary`. The 404 page has no canonical or `og:url`.

## Layouts

- **Rows and masonry:** `react-photo-album` inside its `SSR` wrapper, with breakpoints 640 / 1024 / 1440. The server renders every width band and container queries show the matching one, so nothing shifts before hydration.
  - The wrapper runs `unstyled` with our band classes (`SSR_CLASSES`); the container queries live in `global.css` (`.ssr-band`). Its own inline `<style>` would be blocked by the CSP. If you change `BREAKPOINTS`, change both.
- **Grid:** a plain CSS grid (2 / 3 / 4 columns, 3:2 tiles, `object-fit: cover`).
- **Captions:** every tile has a caption at a fixed 44 px (`CAPTION_HEIGHT`). It's rendered through `render.extras`, so the library's row-height maths still holds.
- **Which layout:** `?layout=` beats the visitor's stored choice (localStorage `gallery:layout`), which beats the page default (`resolveLayout` in [src/lib/gallery.ts](../src/lib/gallery.ts)).
  - The server can't see localStorage, so it renders with `?layout=` or the default.
  - `LayoutToggle` owns the URL param and storage and dispatches a `gallery:layout` window event. `Gallery` listens for it and also reads storage itself on mount, so the order of hydration doesn't matter.
  - `withLayoutParam` drops the param when it equals the default.

## Tiles

- [TileImage.tsx](../src/components/gallery/TileImage.tsx) fades the `<img>` in over its ThumbHash (`placeholderDataUrl`).
  - It also shows images that finished loading before hydration.
  - A failed load is retried 3 times (after 1 s, 3 s, 9 s) by re-creating the `<img>`.
  - Its `ref` must come after the props spread, because react-photo-album passes `ref: null`.
- Every `<img>` has explicit `width`/`height` and a `srcset` from `tileSources` (480 / 768 / 1080).
- **Loading:** the first 4 tiles get `fetchpriority="high"`. Every tile is `loading="lazy"` in the server HTML, because eager images in the hidden SSR width bands would be fetched too. The first 4 switch to eager after hydration.
- **Alt text** (`altText`): the title, else "<category> photo, <location>, <date>".

## Lightbox

- [Lightbox.tsx](../src/components/gallery/Lightbox.tsx) wraps `yet-another-react-lightbox` with the Zoom and Fullscreen plugins. Sources come from `lightboxSources` (1600 / 2400).
- **Real size, never enlarged:** `carousel.imageProps` caps each photo at its largest file's pixels divided by `devicePixelRatio` (`realSizeLimit` in `gallery.ts`), so on a big high-resolution screen it sits smaller, with more black around it, rather than going soft. Zoom's `maxZoomPixelRatio` is `1 / devicePixelRatio`, so zoom also stops at one image pixel per screen pixel; where the photo is already at that size the zoom buttons are disabled. `useDevicePixelRatio` follows browser zoom and moves between monitors.
- **Info panel (spec sheet):** [InfoPanel.tsx](../src/components/gallery/InfoPanel.tsx) is our own component, rendered through `render.controls`.
  - It opens with every photo (`Lightbox` sets it open whenever the lightbox opens); `i` or the info button hides and shows it, and a hide lasts until the lightbox closes. It's black like the lightbox, with a hairline on the edge facing the photo.
  - Content: title, caption, the exposure as large figures (`exposureFigures` in `exif-format.ts`: focal length, aperture shown as italic ƒ, shutter, ISO), then camera, lens, exposure compensation, date and a location link, then category chips. Missing values are left out, and the exposure block goes when there are none.
  - Desktop: a 340 px side panel; `.lightbox--info .yarl__container` shrinks so the photo fits beside it. The figures are a 2×2 grid.
  - Phones: a bottom sheet (up to 60vh) with the figures in one row. A `ResizeObserver` copies the sheet's height into `--info-sheet-height` on the container, whose bottom padding follows it, so the photo fits above the sheet.
    - Drag to close: pointer handlers on the handle (a button that also closes on a tap) and on the title block. The sheet follows the finger with an inline `transform`; past 96 px, or on a quick flick, it slides away and closes, otherwise it snaps back. Those two areas are `touch-action: none`, so the browser doesn't scroll from them.
    - Closed: `DetailsBar` in `Lightbox.tsx` sits in the 56 px band below the photo with the same handle and a "Details" label; a tap or a swipe up opens the sheet. It stops pointer-downs so a swipe on it doesn't change photo.
    - The toolbar's i button (`.lightbox-info-button`) is hidden below 768 px; `i` on a keyboard still works.
  - Pointer-downs inside the panel don't reach the lightbox (`stopNavigationEventsPropagation`), so scrolling the sheet never swipes or pull-closes. A native wheel listener stops wheel events too: the lightbox's own listener would cancel them for scroll-to-zoom, and the panel couldn't scroll. Keys aren't stopped, so `i`, the arrows and Esc work with focus in the panel.
- **Title bar and reserved band:** `render.controls` also draws the title bar (title, location, "3 / 18") top left. CSS padding on `.yarl__container` keeps a band free at the top (and gutters for the arrows on desktop); the library measures the container minus its padding, so the image fits the space left and no control sits on it.
- **Icons and touch:** the toolbar and arrows use our thin outline icons (`render.icon*`). On touch-first screens (`(hover: none) and (pointer: coarse)`) the arrow and zoom buttons are hidden; swipe and pinch do the job.
- **History** (in `Gallery.tsx`):
  - Opening pushes `/p/:id`, and changing slides uses `replaceState`.
  - Closing calls `history.back()` if the island pushed the entry. On a direct permalink load it instead replaces the URL with the gallery page.
  - Back (`popstate`) closes the lightbox.

## Walk-through

Added at the owner's request, outside DESIGN.md's milestones (README → Decisions). The photos hang framed round a lit, ring-shaped corridor that the visitor can walk forever: there is no end to reach.

A spiral ramp round an open atrium was tried and dropped: the owner chose the ring because it never stops.

- **One room, everything in it.** The walk always shows every published photo, by `sort_order`; there is no per-category walk. Categories are chosen in the grid, so the walk's header shows only the site name and a Grid button (`Base` with `nav={null}`), and the page doesn't load the menu.
- **Entry:** every grid page (`GalleryPage`) has a "Walk" pill beside the layout toggle, linking to `/walk`. The walk page's Grid button goes to `/all`.
- **Page:** [walk/index.astro](../src/pages/walk/index.astro) renders `Base` with `immersive` and `tone="light"`, and the [WalkGallery.tsx](../src/components/gallery/WalkGallery.tsx) island with `client:only`, so three.js stays out of the Worker bundle.
  - `immersive`: no footer, no page scroll, and the header floats over the room (`.site-header--overlay`: transparent, and only its links take the pointer).
  - `immersive` also makes `<html>` full height. Otherwise the lightbox's no-scroll rule (`height: 100%` on body) collapses the page under it, and the room, which measures the canvas to step in and out of prints, would measure 1 px. The room also ignores a collapsed size when resizing.
  - `tone="light"`: the header and the walk root carry `.tone-light`, which redefines the colour tokens as dark ink on the room's off-white, so every `text-ink` / `bg-bg` class inside follows. The lightbox renders outside that scope and stays black.
- **Geometry** (pure, [walk.ts](../src/lib/walk.ts), unit-tested): `planRoom` gives each wall its own bays, `ROOM.spacing` (3.9) centre to centre, so the longer outer wall holds more. The corridor is always 6.
  - The title takes the outer wall's bay 0. Prints fill the rest in order of angle, so walking forward passes the photos in order, on whichever wall comes next.
  - **The room keeps its natural size** (inner radius `ROOM.innerRadius`, 12.2). A collection that would leave it more than half empty repeats round the walls in whole runs, as many as fill it best (`repeats`), and the room is sized to fit them exactly; 13 photos hang four times each.
  - From about 47 photos each hangs once, in a room just big enough. Any spare bays (rounding) are blank wall before the title.
  - Prints are **slots** (`plan.slots`, each with its `photoIndex`). The room works in slots: picking, focus, stepping, the map. Textures, labels and the lightbox work in photos. Stepping into a photo, or back out of it, uses the print the visitor stands at, else the nearest print of that photo.
  - `lightboxRect` is where the lightbox will draw a photo (its padding, the 340 px info panel, real-size cap).
  - `lookSlot` is the print a visitor who stops turns to, and `smoothDamp` the spring that turns them (Input → Looking round, below).
- **Room:** [walk/room.ts](../src/components/gallery/walk/room.ts) builds walls, floor and ceiling as rings sampled round the angle. Their texture u counts bays, so each bay's light pool lines up with its print.
  - Every architectural mesh also blocks clicks, so prints hidden behind the inner wall can't be picked.
- **Look:** warm off-white plaster, a plain white ceiling with a recessed light over each bay, and pale oak boards running round the corridor.
  - Every material is unlit, so the prints keep their exact colours. Light and shade are painted into canvas textures: a pool of light round each print, falloff under the ceiling and towards the floor, and spill on the floor.
  - Prints are framed (`framedSize`): a moulding, a white mat that is deeper at the bottom, a bright bevel round the opening, and a soft shadow on the wall below.
  - **Mouldings** (`MOULDINGS` in room.ts) are steps from the outer edge in, each with a face width, a depth off the wall and a finish. Every finish has a shade per face (lit tops, dark undersides), and each is drawn as one instanced mesh.
  - Styles: `gallery` (the default: black, stepped up to a ridge, with a gilt fillet against the mat), `gilt` (a museum gold frame), `walnut` (wide walnut with a gilt fillet) and `plain` (the earlier thin black). `?frame=` shows another, to compare them on the page.
  - The light pools on each wall follow that wall's bays. The floor is two halves, each with the spill under its own wall's prints. Each wall's light pools follow its own bays.
  - **Wall labels:** title; then the exposure as figures with small units, like the info panel (`exposureFigures`); then place and year. Missing lines are left out.
  - **Title wall:** the visitor arrives facing it, and passes it again each lap. It carries two lines at eye level: "Photographs by …", and the count with the year span.
  - **Exceptions to the hard rules below** (dark only; no gradients; no borders or shadows on photos) apply to this page only. The owner asked for a lighter room with frames on 2026-11-26 (README → Decisions).
- **Screen:** no title over the scene (it's on the title wall).
  - **Room map**, bottom right (under the header on phones): a ring with the title wall marked at the top and a tick per print, outside the ring for the outer wall and inside for the inner.
  - A dot goes round clockwise as the visitor walks. The room sets `--walk-angle` every frame without React. The current print's title sits beside the map.
  - Press or drag on the map to walk to that point, the short way round.
  - A hint at the bottom until the visitor first moves, and the caption with its buttons while standing at a print.
- **Input:**
  - The wheel and a drag walk with exponential damping, round and round. Moves longer than `WALK.jump` (map jumps, Home) dip the view out and back in instead of spinning the camera.
  - While walking, the view looks along the corridor, turned a little towards the inner wall. The inner wall is convex, so its prints only face the visitor once they're beside them, outside that view (on a portrait phone the view is only 30–40° wide).
  - **Looking round:** `WALK.rest` ms after the last wheel, drag, key or map move, with under `WALK.settle` metres left to glide, the visitor turns to face the print nearest where they'll stop (`lookSlot`: the print nearest `aheadAngle` ahead, on either wall). A spring (`smoothDamp`) eases the turn in and out, and turns back to the corridor as soon as they walk on.
    - The turn is an offset on the walking heading (`look`), so walking, the map and stepping are unchanged.
    - Only walking starts it: going back to walking from a print (Back to walking, Escape) doesn't turn straight back to that print.
    - Nothing to turn to near the title wall, or under `prefers-reduced-motion`.
  - Keys: right, down and Page Down walk on, or move to the next print when standing at one; left, up and Page Up go back. Home returns to the title wall. Enter steps closer, then in; Escape steps back.
  - **Step into the photo:** View photo, Enter or a second click moves the camera square on to the print, on either wall, until it fills `lightboxRect`. The island preloads that file, then opens the lightbox, whose 250 ms fade makes the room go dark around the print.
  - While the lightbox is open, each slide change puts the camera inside that print (`standIn`), drawn once behind the lightbox. Closing (the lightbox calls `close` after its fade-out) reveals the print where the lightbox had it, then steps back out to stand in front of it. Reduced motion opens the lightbox directly.
- **Textures:** existing sizes only, so there are no new transformations. Each photo starts as its ThumbHash, then the 480. Prints within a couple of bays of the view get the 1080, and the focused one the 1600; sharper copies are dropped when the visitor walks away.
- **Fallbacks:** without WebGL, or with no photos, the island shows a line and a link to the grid. `prefers-reduced-motion` cuts the glides and fades, shortens the damping, and turns off looking round.

## Download deterrents

They deter, they don't prevent:
- The context menu is blocked on the gallery and, while the lightbox is open, on the document.
- CSS in `global.css` sets `user-select: none`, `-webkit-touch-callout: none` (no iOS save sheet) and no dragging.
- There's no download button anywhere.

## Caching

- Public HTML: `s-maxage=60, stale-while-revalidate=600` from the middleware, so admin changes show within about a minute.
- Images: versioned, immutable URLs ([images.md](images.md)).

## Look and feel

- **Tokens:** `@theme` in [src/styles/global.css](../src/styles/global.css) defines `bg`, `surface`, `divider`, `ink`, `ink-muted`, `font-display` (Barlow Condensed, for titles) and `font-sans` (Barlow, for everything else). Use them through Tailwind (`bg-bg`, `text-ink`, `text-ink-muted`, `border-divider`, `font-display`), not raw hex values. Only weight 500 of Barlow Condensed is loaded, so pair `font-display` with `font-medium`; Barlow has 400 and 500.
- **Hard rules:**
  - Dark only.
  - No accent color: active states use `ink` against `ink-muted` (the current nav link adds an `ink` hairline; the selected layout button sits on a `divider` pill).
  - No gradients, and no borders or shadows on photos.
  - `prefers-reduced-motion` is respected globally.
  - No third-party scripts or fonts.
- **Shared classes** in `global.css`: `.eyebrow` (11 px tracked small caps in `ink-muted`, for labels), `.site-header`, `.nav-link`, `.footer-link`, `.lightbox-titlebar`, `.info-panel__details`, `.sheet-handle`, `.nav-menu`.
- Full direction, sizes and spacing: [DESIGN.md → Look and feel](../docs/DESIGN.md#public-gallery).
