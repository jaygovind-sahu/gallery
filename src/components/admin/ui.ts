import { useEffect, useState } from 'react';

/** Shared Tailwind class strings for the admin islands (tokens from src/styles/global.css). */
export const btn =
  'rounded border border-divider px-3 py-1.5 text-sm text-ink transition-colors hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-40';
export const btnPrimary =
  'rounded bg-ink px-3 py-1.5 text-sm text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
export const btnDanger = 'rounded border border-divider px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-ink hover:text-ink';
export const input =
  'w-full rounded border border-divider bg-bg px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted/70 focus:border-ink-muted disabled:opacity-50';
export const label = 'text-xs uppercase tracking-wide text-ink-muted';
export const badge = 'rounded-sm border border-divider px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-ink-muted';

/** Hours since an SQLite `datetime('now')` string ("2026-11-16 17:52:20", UTC). */
export function hoursSince(sqliteUtc: string): number {
  const t = Date.parse(sqliteUtc.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : 0;
}

/**
 * True once the island has mounted in the browser. Islands put it on their root as `data-hydrated`
 * so tests (and anyone scripting the admin) can wait for interactivity instead of racing hydration.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
