import { useEffect, useRef, type CSSProperties } from 'react';
import { stopNavigationEventsPropagation } from 'yet-another-react-lightbox';
import type { PublicPhoto } from '../../lib/db';
import { cleanLens, exposureFigures, formatExposureComp, formatTakenAt } from '../../lib/exif-format';

interface Props {
  photo: PublicPhoto;
  open: boolean;
  onClose: () => void;
}

// Touches inside the panel scroll it; they must not swipe or pull-to-close the lightbox. Keys still reach
// the lightbox, so `i`, the arrows and Esc work with focus in the panel.
const { onPointerDown } = stopNavigationEventsPropagation();
/** Wheel turns scroll the panel too. The lightbox's own native listener would cancel them (scroll-to-zoom). */
const keepWheel = (event: WheelEvent) => event.stopPropagation();

/**
 * The spec sheet: title and caption, the exposure as large figures, then camera, lens, date, location and
 * category chips. A side panel on desktop, a bottom sheet on phones.
 */
export default function InfoPanel({ photo, open, onClose }: Props) {
  const ref = useRef<HTMLElement>(null);
  const date = formatTakenAt(photo.takenAt);
  const figures = exposureFigures(photo);
  const camera = photo.camera?.trim() || null;
  const lens = cleanLens(photo.lens);
  const comp = formatExposureComp(photo.exposureComp);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('wheel', keepWheel);
    // On phones the sheet covers the bottom of the lightbox; the container's bottom padding follows its
    // height (see global.css), so the photo is fitted into the space above it.
    const container = el.closest<HTMLElement>('.yarl__container');
    const observer =
      container && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => container.style.setProperty('--info-sheet-height', `${el.offsetHeight}px`)) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('wheel', keepWheel);
      observer?.disconnect();
      container?.style.removeProperty('--info-sheet-height');
    };
  }, []);

  return (
    <aside
      ref={ref}
      id="lightbox-info"
      aria-label="Photo details"
      aria-hidden={!open}
      data-open={open ? '' : undefined}
      className="info-panel"
      onPointerDown={onPointerDown}
    >
      <span className="info-panel__grabber" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5 md:gap-4">
          <h2 className="m-0 font-display text-[26px] font-medium leading-[1.1] tracking-[0.01em] text-ink md:text-[30px]">{photo.title?.trim() || 'Untitled'}</h2>
          {photo.caption && <p className="m-0 text-[14px] leading-[1.55] text-ink md:text-[15px] md:leading-relaxed">{photo.caption}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide details"
          className="-mr-3 -mt-2 flex size-11 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink md:-mr-1.5 md:-mt-1 md:size-8"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {figures.length > 0 && (
        <section aria-labelledby="lightbox-info-exposure" className="flex flex-col gap-2.5">
          <h3 id="lightbox-info-exposure" className="eyebrow m-0 hidden md:block">
            Exposure
          </h3>
          <dl className="info-panel__exposure" style={{ '--figures': figures.length } as CSSProperties}>
            {figures.map((f) => (
              <div key={f.key}>
                <dt>
                  <span className="md:hidden">{f.shortLabel}</span>
                  <span className="hidden md:inline">{f.label}</span>
                </dt>
                <dd>
                  {f.key === 'aperture' ? (
                    <>
                      <span className="italic">ƒ</span>/{f.value}
                    </>
                  ) : (
                    f.value
                  )}
                  {f.unit && <span className="info-panel__unit">{f.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(camera || lens || comp || date || photo.location) && (
        <dl className="info-panel__details">
          {camera && (
            <div>
              <dt className="eyebrow">Camera</dt>
              <dd>{camera}</dd>
            </div>
          )}
          {lens && (
            <div>
              <dt className="eyebrow">Lens</dt>
              <dd>{lens}</dd>
            </div>
          )}
          {comp && (
            <div>
              <dt className="eyebrow">Exposure comp</dt>
              <dd>{comp}</dd>
            </div>
          )}
          {date && (
            <div>
              <dt className="eyebrow">Taken</dt>
              <dd>{date}</dd>
            </div>
          )}
          {photo.location && (
            <div>
              <dt className="eyebrow">Location</dt>
              <dd>
                <a href={`/l/${photo.location.slug}`} className="underline decoration-divider underline-offset-4 transition-colors hover:decoration-ink-muted">
                  {photo.location.name}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {photo.categories.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Categories">
          {photo.categories.map((c) => (
            <li key={c.slug}>
              <a href={`/c/${c.slug}`} className="inline-block rounded-full border border-divider px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-muted hover:text-ink">
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
