import type { PublicPhoto } from '../../lib/db';
import { exifLine, formatTakenAt } from '../../lib/exif-format';

interface Props {
  photo: PublicPhoto;
  open: boolean;
  onClose: () => void;
}

/** Title, caption, date, location link, category chips and the EXIF line; a side panel on desktop, a sheet on phones. */
export default function InfoPanel({ photo, open, onClose }: Props) {
  const date = formatTakenAt(photo.takenAt);
  const exif = exifLine(photo);
  return (
    <aside
      id="lightbox-info"
      aria-label="Photo details"
      aria-hidden={!open}
      data-open={open ? '' : undefined}
      className="info-panel"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="m-0 font-serif text-2xl leading-tight text-ink">{photo.title?.trim() || 'Untitled'}</h2>
        <button type="button" onClick={onClose} aria-label="Hide details" className="-mr-1 -mt-1 p-1 text-ink-muted hover:text-ink">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {photo.caption && <p className="m-0 text-sm leading-relaxed text-ink">{photo.caption}</p>}
      <dl className="m-0 flex flex-col gap-1.5 text-[13px] text-ink-muted">
        {date && (
          <div>
            <dt className="sr-only">Date</dt>
            <dd className="m-0">{date}</dd>
          </div>
        )}
        {photo.location && (
          <div>
            <dt className="sr-only">Location</dt>
            <dd className="m-0">
              <a href={`/l/${photo.location.slug}`} className="underline decoration-divider underline-offset-4 hover:text-ink">
                {photo.location.name}
              </a>
            </dd>
          </div>
        )}
        {exif && (
          <div>
            <dt className="sr-only">Camera settings</dt>
            <dd className="m-0">{exif}</dd>
          </div>
        )}
      </dl>
      {photo.categories.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Categories">
          {photo.categories.map((c) => (
            <li key={c.slug}>
              <a href={`/c/${c.slug}`} className="rounded-full border border-divider px-3 py-1 text-xs text-ink-muted hover:border-ink-muted hover:text-ink">
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
