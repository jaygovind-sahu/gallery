# Public gallery

Server-rendered Astro pages, with React islands for the gallery and the layout toggle. Spec: [DESIGN.md → Public gallery](../docs/DESIGN.md#public-gallery).

## Routes

| Path | File (`src/pages/`) | Photos | Default layout |
| --- | --- | --- | --- |
| `/` | `index.astro` | Latest 48 uploads | `settings.default_layout` |
| `/c/:slug` | `c/[slug].astro` | The category, in its manual order | The category's `default_layout` |
| `/all` | `all.astro` | Every published photo, by `sort_order` | `settings.default_layout` |
| `/l/:slug` | `l/[slug].astro` | Photos at the location, newest taken first | `settings.default_layout` |
| `/p/:id` | `p/[id].astro` | Opens the lightbox over the photo's first category (by category position), else `/all`. Server-renders the title, caption and Open Graph tags with the 1600 px image | That gallery's |

- **404:** an unknown URL, slug or id, or a draft's permalink, gets [404.astro](../src/pages/404.astro) with status 404. Pages trigger it by returning `new Response(null, { status: 404 })`: Astro renders the 404 page for an empty-bodied 404. A body (like `/img`'s plain text) is sent as is. The wording is the same in every case.
- Every page renders through [GalleryPage.astro](../src/components/gallery/GalleryPage.astro), which wraps [Base.astro](../src/layouts/Base.astro): header, footer, meta and Open Graph tags, and the header script (hides on scroll down; sets `data-scrolled` once the page has scrolled, which turns the header translucent with a hairline).
- The heading block takes `heading`, an `eyebrow` (small caps above it: the photo count, plus the region on location pages) and a `subline` (the category description). The home page has none.
- Each page has two islands: `LayoutToggle` in the header's `header-end` slot, and `Gallery`.
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
- **Info panel:** [InfoPanel.tsx](../src/components/gallery/InfoPanel.tsx) is our own component, rendered through `render.controls`, and `i` toggles it. It shows the title, caption, then labelled rows for the date, a location link and the EXIF line (`exifLine` in `exif-format.ts`), then category chips.
- **Title bar and reserved band:** `render.controls` also draws the title bar (title, location, "3 / 18") top left. CSS padding on `.yarl__container` keeps a band free at the top (and gutters for the arrows on desktop); the library measures the container minus its padding, so the image fits the space left and no control sits on it.
- **Icons and touch:** the toolbar and arrows use our thin outline icons (`render.icon*`). On touch-first screens (`(hover: none) and (pointer: coarse)`) the arrow and zoom buttons are hidden; swipe and pinch do the job.
- **History** (in `Gallery.tsx`):
  - Opening pushes `/p/:id`, and changing slides uses `replaceState`.
  - Closing calls `history.back()` if the island pushed the entry. On a direct permalink load it instead replaces the URL with the gallery page.
  - Back (`popstate`) closes the lightbox.

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
- **Shared classes** in `global.css`: `.eyebrow` (11 px tracked small caps in `ink-muted`, for labels), `.site-header`, `.nav-link`, `.footer-link`, `.lightbox-titlebar`, `.info-panel__details`.
- Full direction, sizes and spacing: [DESIGN.md → Look and feel](../docs/DESIGN.md#public-gallery).
