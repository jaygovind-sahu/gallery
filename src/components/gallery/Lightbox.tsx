import { useEffect, useState } from 'react';
import YARL, { useLightboxState } from 'yet-another-react-lightbox';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import type { PublicPhoto } from '../../lib/db';
import { altText, lightboxSources } from '../../lib/gallery';
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

/** Toolbar button plus the panel itself; lives inside the lightbox so it can read the current slide. */
function InfoControls({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { currentSlide } = useLightboxState();
  const photo = currentSlide?.photo;
  if (!photo) return null;
  return <InfoPanel photo={photo} open={open} onClose={onToggle} />;
}

function InfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? 'Hide details' : 'Show details';
  return (
    <button type="button" className="yarl__button" aria-label={label} title={label} aria-pressed={open} aria-controls="lightbox-info" onClick={onToggle}>
      <svg className="yarl__icon" viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-1-9h2v6h-2v-6Zm0-4h2v2h-2V7Z" />
      </svg>
    </button>
  );
}

/**
 * yet-another-react-lightbox with Zoom and Fullscreen; swipe, arrow keys, Esc, pinch and scroll zoom come
 * with it. `i` toggles the info panel. History is the gallery's job (see Gallery.tsx).
 */
export default function Lightbox({ photos, index, open, onClose, onView, contextCategory }: Props) {
  const [info, setInfo] = useState(false);

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
      carousel={{ preload: 1, padding: 0, imageProps: { draggable: false } }}
      controller={{ closeOnPullDown: true, closeOnBackdropClick: true }}
      zoom={{ maxZoomPixelRatio: 2, scrollToZoom: true }}
      on={{ view: ({ index: i }) => onView(i) }}
      styles={{ container: { backgroundColor: '#000' } }}
      className={info ? 'lightbox lightbox--info' : 'lightbox'}
      toolbar={{ buttons: [<InfoButton key="info" open={info} onToggle={() => setInfo((v) => !v)} />, 'fullscreen', 'close'] }}
      render={{ controls: () => <InfoControls open={info} onToggle={() => setInfo((v) => !v)} /> }}
    />
  );
}
