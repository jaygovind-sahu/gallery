import { useEffect, useRef, useState, type ReactNode } from 'react';
import YARL, { useLightboxState } from 'yet-another-react-lightbox';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import type { PublicPhoto } from '../../lib/db';
import { altText, lightboxSources, realSizeLimit } from '../../lib/gallery';
import InfoPanel from './InfoPanel';

declare module 'yet-another-react-lightbox' {
  interface SlideImage {
    /** The gallery photo behind this slide, for the info panel. */
    photo?: PublicPhoto;
  }
}

interface Props {
  photos: PublicPhoto[];
  index: number;
  open: boolean;
  onClose: () => void;
  onView: (index: number) => void;
  contextCategory?: string | null;
}

/** A thin outline icon in the lightbox's icon slot; `yarl__icon` gives it the toolbar's size. */
function icon(children: ReactNode) {
  return () => (
    <svg className="yarl__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  iconPrev: icon(<path d="M15 5l-7 7 7 7" />),
  iconNext: icon(<path d="M9 5l7 7-7 7" />),
  iconClose: icon(<path d="M6 6l12 12M18 6L6 18" />),
  iconZoomIn: icon(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20M10.5 8v5M8 10.5h5" />
    </>,
  ),
  iconZoomOut: icon(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20M8 10.5h5" />
    </>,
  ),
  iconEnterFullscreen: icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
  iconExitFullscreen: icon(<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />),
};
const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.75v.01" />
  </>,
);

/** True on touch-first devices, where swipe and pinch replace the arrow and zoom buttons. */
function useTouchFirst(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return touch;
}

/** Screen pixels per CSS pixel. It changes with browser zoom and when the window moves to another monitor. */
function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const update = () => {
      query?.removeEventListener('change', update);
      const current = window.devicePixelRatio || 1;
      setRatio(current);
      // A resolution query only reports leaving this exact ratio, so re-arm it for each new one.
      query = window.matchMedia(`(resolution: ${current}dppx)`);
      query.addEventListener('change', update);
    };
    update();
    return () => query?.removeEventListener('change', update);
  }, []);
  return ratio;
}

/** Title, location and position of the current photo, in the band above it; plus the info panel. */
function Controls({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { currentSlide, currentIndex, slides } = useLightboxState();
  const photo = currentSlide?.photo;
  if (!photo) return null;
  const title = photo.title?.trim() || null;
  const location = photo.location?.name ?? null;
  const position = `${currentIndex + 1} / ${slides.length}`;
  return (
    <>
      <div className="lightbox-titlebar">
        <span className="lightbox-titlebar__title">{title ?? location ?? 'Untitled'}</span>
        <span className="lightbox-titlebar__meta">{title && location ? `${location} · ${position}` : position}</span>
      </div>
      <InfoPanel photo={photo} open={open} onClose={onToggle} />
      {!open && <DetailsBar onOpen={onToggle} />}
    </>
  );
}

/** Phones, with the sheet closed: the bar below the photo that opens it again, by a tap or a swipe up. */
function DetailsBar({ onOpen }: { onOpen: () => void }) {
  const startY = useRef<number | null>(null);
  return (
    <button
      type="button"
      className="lightbox-details-bar"
      aria-label="Show details"
      aria-controls="lightbox-info"
      onPointerDown={(event) => {
        // Not a swipe to the next photo, and the finger may leave the bar on the way up.
        event.stopPropagation();
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (startY.current !== null && startY.current - event.clientY > 24) onOpen();
        startY.current = null;
      }}
      onClick={onOpen}
    >
      <span className="sheet-handle" aria-hidden="true" />
      <span className="eyebrow">Details</span>
    </button>
  );
}

function InfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? 'Hide details' : 'Show details';
  return (
    <button type="button" className="yarl__button lightbox-info-button" aria-label={label} title={label} aria-pressed={open} aria-controls="lightbox-info" onClick={onToggle}>
      <InfoIcon />
    </button>
  );
}

/**
 * yet-another-react-lightbox with Zoom and Fullscreen; swipe, arrow keys, Esc, pinch and scroll zoom come
 * with it. The info panel opens with every photo; `i` or its button toggles it. History is the gallery's
 * job (see Gallery.tsx).
 */
export default function Lightbox({ photos, index, open, onClose, onView, contextCategory }: Props) {
  const [info, setInfo] = useState(true);
  const touchFirst = useTouchFirst();
  const pixelRatio = useDevicePixelRatio();
  const hidden = () => null;

  // The spec sheet shows each time a visitor opens a photo; hiding it lasts until the lightbox closes.
  useEffect(() => {
    if (open) setInfo(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'i' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setInfo((v) => !v);
      }
    };
    // Deterrent: no context menu on lightbox images (the portal sits outside the gallery root).
    const onContextMenu = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('.yarl__root')) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [open]);

  const slides = photos.map((photo) => {
    const sources = lightboxSources(photo);
    const largest = sources[sources.length - 1] ?? { src: '', width: photo.width, height: photo.height };
    return { src: largest.src, width: largest.width, height: largest.height, srcSet: sources, alt: altText(photo, contextCategory), photo };
  });

  return (
    <YARL
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom, Fullscreen]}
      carousel={{
        preload: 1,
        padding: 0,
        // Never enlarge a photo: cap it at its largest file's real pixels on this screen. On a big
        // high-resolution monitor it then sits smaller, with more black around it, instead of going soft.
        imageProps: (slide) => {
          if (!('width' in slide) || !slide.width || !slide.height) return { draggable: false };
          const limit = realSizeLimit(slide.width, slide.height, pixelRatio);
          return { draggable: false, style: { maxWidth: `min(${limit.width}px, 100%)`, maxHeight: `min(${limit.height}px, 100%)` } };
        },
      }}
      controller={{ closeOnPullDown: true, closeOnBackdropClick: true }}
      // The same rule for zoom: it stops at one image pixel per screen pixel.
      zoom={{ maxZoomPixelRatio: 1 / pixelRatio, scrollToZoom: true }}
      on={{ view: ({ index: i }) => onView(i) }}
      styles={{ container: { backgroundColor: '#000' } }}
      className={info ? 'lightbox lightbox--info' : 'lightbox'}
      toolbar={{ buttons: [<InfoButton key="info" open={info} onToggle={() => setInfo((v) => !v)} />, 'fullscreen', 'close'] }}
      render={{
        ...ICONS,
        controls: () => <Controls open={info} onToggle={() => setInfo((v) => !v)} />,
        // Touch-first screens swipe and pinch instead of tapping buttons that sit over the photo.
        ...(touchFirst ? { buttonPrev: hidden, buttonNext: hidden, buttonZoom: hidden } : {}),
      }}
    />
  );
}
