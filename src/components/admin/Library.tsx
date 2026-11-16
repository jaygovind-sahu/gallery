import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { AdminPhoto } from '../../lib/db';
import { adminImageUrl, api, confirmDanger, putFile, RequestFailed } from '../../lib/client/http';
import { readMetadata } from '../../lib/client/metadata';
import { badge, btn, btnDanger, hoursSince, input, useHydrated } from './ui';

interface Option {
  id: string;
  name: string;
}
export interface LibraryFilter {
  category: string;
  location: string;
  status: '' | 'published' | 'draft' | 'uploading';
}
interface Props {
  photos: AdminPhoto[];
  categories: Option[];
  locations: Option[];
  filter: LibraryFilter;
}

export default function Library({ photos: initial, categories, locations, filter: initialFilter }: Props) {
  const [photos, setPhotos] = useState(initial);
  const [filter, setFilter] = useState(initialFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  const first = useRef(true);

  const refetch = useCallback(async (f: LibraryFilter) => {
    const q = new URLSearchParams();
    if (f.category) q.set('category', f.category);
    if (f.location) q.set('location', f.location);
    if (f.status) q.set('status', f.status);
    const qs = q.toString();
    history.replaceState(null, '', qs ? `/admin?${qs}` : '/admin');
    try {
      const { photos } = await api<{ photos: AdminPhoto[] }>('GET', `/api/admin/photos${qs ? `?${qs}` : ''}`);
      setPhotos(photos);
      setSelected((s) => new Set([...s].filter((id) => photos.some((p) => p.id === id))));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void refetch(filter);
  }, [filter, refetch]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refetch(filter);
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ids = [...selected];
  const bulk = (body: Record<string, unknown>, label: string) => run(label, () => api('POST', '/api/admin/photos/bulk', { ids, ...body }));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const retryUpload = async (photo: AdminPhoto, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run('Uploading…', async () => {
      const meta = await readMetadata(file).catch(() => null);
      const headers: Record<string, string> = {};
      if (meta?.orientation) headers['x-exif-orientation'] = String(meta.orientation);
      await putFile(`/api/admin/photos/${photo.id}/original`, file, headers, () => {});
    });
  };

  return (
    <div className="flex flex-col gap-5" data-hydrated={hydrated || undefined}>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Category" value={filter.category} onChange={(v) => setFilter({ ...filter, category: v })} options={categories} all="All categories" />
        <Select label="Location" value={filter.location} onChange={(v) => setFilter({ ...filter, location: v })} options={locations} all="All locations" />
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-muted">Status</span>
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as LibraryFilter['status'] })} className={`${input} w-auto`}>
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
            <option value="uploading">Uploading</option>
          </select>
        </label>
        <span className="pb-2 text-sm text-ink-muted">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-[92px] z-[5] flex flex-wrap items-center gap-2 rounded-md border border-divider bg-surface p-2 text-sm">
          <span className="px-1 text-ink">{selected.size} selected</span>
          <button type="button" className={btn} disabled={!!busy} onClick={() => bulk({ action: 'publish' }, 'Publishing…')}>
            Publish
          </button>
          <button type="button" className={btn} disabled={!!busy} onClick={() => bulk({ action: 'unpublish' }, 'Unpublishing…')}>
            Unpublish
          </button>
          <ActionSelect placeholder="Add to category…" options={categories} disabled={!!busy} onPick={(categoryId) => bulk({ action: 'addCategory', categoryId }, 'Updating…')} />
          <ActionSelect placeholder="Remove from category…" options={categories} disabled={!!busy} onPick={(categoryId) => bulk({ action: 'removeCategory', categoryId }, 'Updating…')} />
          <ActionSelect
            placeholder="Set location…"
            options={[{ id: '__none', name: 'No location' }, ...locations]}
            disabled={!!busy}
            onPick={(v) => bulk({ action: 'setLocation', locationId: v === '__none' ? null : v }, 'Updating…')}
          />
          <button
            type="button"
            className={btnDanger}
            disabled={!!busy}
            onClick={() => confirmDanger(`Delete ${ids.length} photo${ids.length === 1 ? '' : 's'}? This removes the originals too.`) && bulk({ action: 'delete' }, 'Deleting…')}
          >
            Delete
          </button>
          <button type="button" className="ml-auto text-ink-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {(busy || error) && <p className="text-sm text-ink-muted">{error ?? busy}</p>}

      {photos.length === 0 ? (
        <p className="py-10 text-sm text-ink-muted">
          No photos match.{' '}
          <a href="/admin/upload" className="text-ink underline">
            Upload some
          </a>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {photos.map((p) => {
            const on = selected.has(p.id);
            const stuck = p.status === 'uploading' && hoursSince(p.createdAt) > 24;
            return (
              <li key={p.id} className={`group relative flex flex-col gap-1.5 rounded-md border p-1.5 ${on ? 'border-ink' : 'border-divider'}`}>
                <label className="absolute left-3 top-3 z-[2] flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-bg/80">
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} aria-label={`Select ${p.title ?? p.originalFilename ?? p.id}`} />
                </label>
                <a href={`/admin/photos/${p.id}`} className="block overflow-hidden rounded bg-surface" style={{ aspectRatio: '4 / 3' }}>
                  {p.status === 'ready' ? (
                    <img
                      src={adminImageUrl(p.id, 480, p.version)}
                      alt=""
                      width={p.width}
                      height={p.height}
                      loading="lazy"
                      draggable={false}
                      className="h-full w-full object-contain transition-[filter] group-hover:brightness-110"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-ink-muted">Uploading…</div>
                  )}
                </a>
                <div className="flex min-w-0 items-center gap-1.5 px-0.5">
                  <a href={`/admin/photos/${p.id}`} className="min-w-0 flex-1 truncate font-serif text-[15px] text-ink" title={p.title ?? p.originalFilename ?? undefined}>
                    {p.title || p.originalFilename || 'Untitled'}
                  </a>
                  {p.status === 'uploading' ? <span className={badge}>{stuck ? 'Stuck' : 'Uploading'}</span> : !p.published ? <span className={badge}>Draft</span> : null}
                </div>
                {p.status === 'uploading' && (
                  <div className="flex gap-3 px-0.5 pb-1 text-xs">
                    <label className="cursor-pointer text-ink underline">
                      Retry upload
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => retryUpload(p, e)} />
                    </label>
                    <button
                      type="button"
                      className="text-ink-muted hover:text-ink"
                      onClick={() => confirmDanger('Delete this unfinished upload?') && run('Deleting…', () => api('DELETE', `/api/admin/photos/${p.id}`))}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: Option[]; all: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${input} w-auto`}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionSelect({ placeholder, options, disabled, onPick }: { placeholder: string; options: Option[]; disabled: boolean; onPick: (id: string) => void }) {
  return (
    <select
      value=""
      disabled={disabled}
      aria-label={placeholder}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
        e.target.value = '';
      }}
      className={`${input} w-auto`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
