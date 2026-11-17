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

- An unknown slug or id returns a plain-text 404. The real 404 page comes with milestone 7.
- Every page renders through [GalleryPage.astro](../src/components/gallery/GalleryPage.astro), which wraps [Base.astro](../src/layouts/Base.astro): header, footer, meta and Open Graph tags, and the hide-on-scroll header script.
- Each page has two islands: `LayoutToggle` in the header's `header-end` slot, and `Gallery`.

## Layouts

- **Rows and masonry:** `react-photo-album` inside its `SSR` wrapper, with breakpoints 640 / 1024 / 1440. The server renders every width band and container queries show the matching one, so nothing shifts before hydration.
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

- [Lightbox.tsx](../src/components/gallery/Lightbox.tsx) wraps `yet-another-react-lightbox` with the Zoom and Fullscreen plugins. Sources come from `lightboxSources` (1600 / 2400 / 3200).
- **Info panel:** [InfoPanel.tsx](../src/components/gallery/InfoPanel.tsx) is our own component, rendered through `render.controls`, and `i` toggles it. It shows the title, caption, date, a location link, category chips, and the EXIF line (`exifLine` in `exif-format.ts`).
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

- **Tokens:** `@theme` in [src/styles/global.css](../src/styles/global.css) defines `bg`, `surface`, `divider`, `ink`, `ink-muted`, `font-serif` (Newsreader) and `font-sans` (Instrument Sans). Use them through Tailwind (`bg-bg`, `text-ink`, `text-ink-muted`, `border-divider`, `font-serif`), not raw hex values.
- **Hard rules:**
  - Dark only.
  - No accent color: active states use `ink` against `ink-muted`.
  - No gradients, and no borders or shadows on photos.
  - `prefers-reduced-motion` is respected globally.
  - No third-party scripts or fonts.
- Full direction, sizes and spacing: [DESIGN.md → Look and feel](../docs/DESIGN.md#public-gallery).
