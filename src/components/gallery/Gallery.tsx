import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MasonryPhotoAlbum, RowsPhotoAlbum, type Photo, type Render, type RenderImageContext, type RenderImageProps } from 'react-photo-album';
import SSR from 'react-photo-album/ssr';
import 'react-photo-album/rows.css';
import 'react-photo-album/masonry.css';
import type { PublicPhoto } from '../../lib/db';
import { altText, CAPTION_HEIGHT, isLayout, LAYOUT_EVENT, LAYOUT_STORAGE_KEY, placeholderDataUrl, resolveLayout, tileCaption, tileSources, type Layout } from '../../lib/gallery';
import Lightbox from './Lightbox';
import TileImage from './TileImage';

interface Props {
  photos: PublicPhoto[];
  /** Layout the server rendered with (`?layout=` or the page default). */
  initialLayout: Layout;
  /** The page's default, for resolving the visitor's stored choice. */
  defaultLayout: Layout;
  /** Path of the gallery page the lightbox returns to on close, e.g. `/c/birds`. */
  galleryUrl: string;
  /** Open the lightbox on this photo at load (permalink). */
  initialPhotoId?: string | null;
  /** Category name for alt text fallbacks. */
  contextCategory?: string | null;
}

interface TilePhoto extends Photo {
  id: string;
  placeholder: string | null;
  captionTitle: string | null;
  captionLocation: string | null;
}

/** Breakpoints the server renders the rows/masonry layouts for; the client keeps the matching one. */
const BREAKPOINTS = [640, 1024, 1440];
const EAGER = 4;
/**
 * Classes for the SSR width bands (the library adds a half-width band below the first breakpoint). They are
 * styled in global.css, so the library's own inline <style> (which the CSP would block) stays off.
 */
const SSR_CLASSES = {
  container: 'ssr-bands',
  breakpoints: { 320: 'ssr-band ssr-band--320', 640: 'ssr-band ssr-band--640', 1024: 'ssr-band ssr-band--1024', 1440: 'ssr-band ssr-band--1440' },
};

const SIZES = { size: 'calc(100vw - 64px)', sizes: [{ viewport: '(max-width: 639px)', size: 'calc(100vw - 32px)' }] };

function Caption({ title, location }: { title: string | null; location: string | null }) {
  return (
    <span className="tile-caption" style={{ height: CAPTION_HEIGHT }}>
      {title && <span className="tile-caption__title">{title}</span>}
      {location && <span className="tile-caption__location">{location}</span>}
    </span>
  );
}

/**
 * One gallery: the photos in rows, masonry or grid, captions under every tile, and the lightbox with
 * `/p/:id` history. The layout toggle in the header talks to it through the `gallery:layout` event.
 */
export default function Gallery({ photos, initialLayout, defaultLayout, galleryUrl, initialPhotoId = null, contextCategory = null }: Props) {
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const [hydrated, setHydrated] = useState(false);
  const initialIndex = initialPhotoId ? photos.findIndex((p) => p.id === initialPhotoId) : -1;
  const [index, setIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [open, setOpen] = useState(initialIndex >= 0);
  /** True when this island pushed the /p/:id entry, so closing can go back instead of replacing. */
  const pushed = useRef(false);
  const returnUrl = useRef(galleryUrl);

  useEffect(() => {
    setHydrated(true);
    // Same resolution as the toggle, in case its event fired before this island was listening.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    setLayout(resolveLayout(new URLSearchParams(window.location.search).get('layout'), stored, defaultLayout));
    const onLayout = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (isLayout(next)) setLayout(next);
    };
    window.addEventListener(LAYOUT_EVENT, onLayout);
    return () => window.removeEventListener(LAYOUT_EVENT, onLayout);
  }, [defaultLayout]);

  // History: Back closes the lightbox; Forward reopens it.
  useEffect(() => {
    if (initialIndex >= 0) window.history.replaceState({ lightbox: photos[initialIndex]?.id }, '', window.location.pathname + window.location.search);
    const onPop = (e: PopStateEvent) => {
      const id = (e.state as { lightbox?: string } | null)?.lightbox;
      const i = id ? photos.findIndex((p) => p.id === id) : -1;
      if (i >= 0) {
        setIndex(i);
        setOpen(true);
      } else {
        pushed.current = false;
        setOpen(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAt = useCallback(
    (i: number) => {
      const photo = photos[i];
      if (!photo) return;
      returnUrl.current = window.location.pathname + window.location.search;
      window.history.pushState({ lightbox: photo.id }, '', `/p/${photo.id}`);
      pushed.current = true;
      setIndex(i);
      setOpen(true);
    },
    [photos],
  );

  const onView = useCallback(
    (i: number) => {
      setIndex(i);
      const photo = photos[i];
      if (photo && open) window.history.replaceState({ lightbox: photo.id }, '', `/p/${photo.id}`);
    },
    [photos, open],
  );

  const close = useCallback(() => {
    setOpen(false);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', returnUrl.current);
    }
  }, []);

  const tiles = useMemo<TilePhoto[]>(
    () =>
      photos.map((p) => {
        const sources = tileSources(p);
        const largest = sources[sources.length - 1] ?? { src: '', width: p.width, height: p.height };
        const caption = tileCaption(p);
        return {
          key: p.id,
          id: p.id,
          src: largest.src,
          width: p.width,
          height: p.height,
          srcSet: sources,
          alt: altText(p, contextCategory),
          href: `/p/${p.id}`,
          placeholder: placeholderDataUrl(p.placeholder),
          captionTitle: caption.title,
          captionLocation: caption.location,
        };
      }),
    [photos, contextCategory],
  );

  const render: Render<TilePhoto> = {
    image: (props: RenderImageProps, { photo, index: i }: RenderImageContext<TilePhoto>) => (
      <TileImage
        {...props}
        // The library would append the main src at the original's width; list the allowlisted sizes only.
        srcSet={photo.srcSet?.map((s) => `${s.src} ${s.width}w`).join(', ')}
        width={photo.width}
        height={photo.height}
        placeholder={photo.placeholder}
        // Hidden SSR copies must not fetch; lazy images only load once they have a position in the viewport.
        loading={hydrated && i < EAGER ? 'eager' : 'lazy'}
        fetchPriority={i < EAGER ? 'high' : 'auto'}
        decoding="async"
      />
    ),
    extras: (_, { photo }) => <Caption title={photo.captionTitle} location={photo.captionLocation} />,
  };

  const onClick = ({ event, index: i }: { event: React.MouseEvent; index: number }) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openAt(i);
  };

  const common = {
    photos: tiles,
    render,
    onClick,
    sizes: SIZES,
    spacing: (w: number) => (w < 640 ? 8 : 12),
    componentsProps: { link: { className: 'tile' } },
  };

  return (
    <div data-gallery data-layout={layout} data-hydrated={hydrated ? '' : undefined} onContextMenu={(e) => e.preventDefault()}>
      {photos.length === 0 ? (
        <p className="pb-16 text-sm text-ink-muted">No photos yet.</p>
      ) : layout === 'rows' ? (
        <SSR breakpoints={BREAKPOINTS} unstyled classNames={SSR_CLASSES}>
          <RowsPhotoAlbum {...common} targetRowHeight={(w) => (w < 640 ? 180 : 280)} rowConstraints={{ singleRowMaxHeight: 480 }} />
        </SSR>
      ) : layout === 'masonry' ? (
        <SSR breakpoints={BREAKPOINTS} unstyled classNames={SSR_CLASSES}>
          <MasonryPhotoAlbum {...common} columns={(w) => (w < 640 ? 2 : w < 1024 ? 3 : 4)} />
        </SSR>
      ) : (
        <ul className="tile-grid">
          {tiles.map((t, i) => (
            <li key={t.id}>
              <a
                href={t.href}
                className="tile"
                onClick={(event) => onClick({ event, index: i })}
              >
                <TileImage
                  src={t.src}
                  srcSet={t.srcSet?.map((s) => `${s.src} ${s.width}w`).join(', ')}
                  sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
                  width={t.width}
                  height={t.height}
                  alt={t.alt}
                  placeholder={t.placeholder}
                  className="tile-grid__image"
                  loading={hydrated && i < EAGER ? 'eager' : 'lazy'}
                  fetchPriority={i < EAGER ? 'high' : 'auto'}
                  decoding="async"
                />
                <Caption title={t.captionTitle} location={t.captionLocation} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {hydrated && photos.length > 0 && (
        <Lightbox photos={photos} index={index} open={open} onClose={close} onView={onView} contextCategory={contextCategory} />
      )}
    </div>
  );
}
