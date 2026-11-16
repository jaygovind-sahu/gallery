import { useEffect, useState } from 'react';
import { isLayout, LAYOUT_EVENT, LAYOUT_STORAGE_KEY, LAYOUTS, resolveLayout, type Layout } from '../../lib/gallery';

interface Props {
  /** The page's default (the category's `default_layout`). */
  fallback: Layout;
  /** Layout the server rendered with (`?layout=` or the fallback). */
  initial: Layout;
}

const LABELS: Record<Layout, string> = { rows: 'Rows', masonry: 'Masonry', grid: 'Grid' };

const ICONS: Record<Layout, string> = {
  rows: 'M3 5h18v5H3zM3 14h18v5H3z',
  masonry: 'M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z',
  grid: 'M3 3h5v5H3zM10 3h4v5h-4zM16 3h5v5h-5zM3 10h5v4H3zM10 10h4v4h-4zM16 10h5v4h-5zM3 16h5v5H3zM10 16h4v5h-4zM16 16h5v5h-5z',
};

/**
 * Segmented three-icon switch in the header. It owns the URL param and localStorage; the gallery island
 * listens for the `gallery:layout` event so the two islands never need shared React state.
 */
export default function LayoutToggle({ fallback, initial }: Props) {
  const [layout, setLayout] = useState<Layout>(initial);

  // After hydration, honour the visitor's stored choice unless the URL pins a layout.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('layout');
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    } catch {
      /* private mode or storage disabled */
    }
    const resolved = resolveLayout(param, stored, fallback);
    if (resolved !== initial) {
      setLayout(resolved);
      window.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: resolved }));
    }
  }, [fallback, initial]);

  const choose = (next: Layout) => {
    if (!isLayout(next) || next === layout) return;
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    // Update the param in place; not while the lightbox owns the URL (/p/:id).
    if (!window.location.pathname.startsWith('/p/')) {
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete('layout');
      else url.searchParams.set('layout', next);
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    }
    window.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: next }));
  };

  return (
    <div role="group" aria-label="Layout" className="flex items-center gap-0.5">
      {LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          aria-label={LABELS[l]}
          title={LABELS[l]}
          aria-pressed={l === layout}
          onClick={() => choose(l)}
          className={`rounded p-1.5 transition-colors hover:text-ink ${l === layout ? 'text-ink' : 'text-ink-muted'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={ICONS[l]} />
          </svg>
        </button>
      ))}
    </div>
  );
}
