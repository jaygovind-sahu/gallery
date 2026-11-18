import { useEffect, useState } from 'react';
import { isLayout, LAYOUT_EVENT, LAYOUT_STORAGE_KEY, LAYOUTS, resolveLayout, type Layout } from '../../lib/gallery';

interface Props {
  /** The page's default (the category's `default_layout`). */
  fallback: Layout;
  /** Layout the server rendered with (`?layout=` or the fallback). */
  initial: Layout;
}

const LABELS: Record<Layout, string> = { rows: 'Rows', masonry: 'Masonry', grid: 'Grid' };

/** Outline glyphs on a 24 px grid, drawn as rounded rectangles: [x, y, width, height]. */
const ICONS: Record<Layout, [number, number, number, number][]> = {
  rows: [
    [3.75, 5, 16.5, 5.5],
    [3.75, 13.5, 16.5, 5.5],
  ],
  masonry: [
    [3.75, 3.75, 7, 9.5],
    [13.25, 3.75, 7, 5.5],
    [13.25, 11.75, 7, 8.5],
    [3.75, 15.75, 7, 4.5],
  ],
  grid: [
    [3.75, 3.75, 7, 7],
    [13.25, 3.75, 7, 7],
    [3.75, 13.25, 7, 7],
    [13.25, 13.25, 7, 7],
  ],
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
    <div role="group" aria-label="Layout" className="flex items-center gap-0.5 rounded-full border border-divider p-[3px]">
      {LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          aria-label={LABELS[l]}
          title={LABELS[l]}
          aria-pressed={l === layout}
          onClick={() => choose(l)}
          className={`rounded-full p-[5px] transition-colors ${l === layout ? 'bg-divider text-ink' : 'text-ink-muted hover:text-ink'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            {ICONS[l].map(([x, y, w, h]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="1.25" />
            ))}
          </svg>
        </button>
      ))}
    </div>
  );
}
