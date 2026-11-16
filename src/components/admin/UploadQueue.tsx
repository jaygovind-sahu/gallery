import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { EMPTY_METADATA, makePreview, readMetadata, type ParsedMetadata, type Preview } from '../../lib/client/metadata';
import { api, formatBytes, putFile, withRetry, RequestFailed } from '../../lib/client/http';
import { exifLine, formatTakenAt } from '../../lib/exif-format';
import { useHydrated } from './ui';

export interface CategoryOption {
  id: string;
  name: string;
}
export interface LocationOption {
  id: string;
  name: string;
  region: string | null;
}

interface Props {
  categories: CategoryOption[];
  locations: LocationOption[];
}

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 100 * 1024 * 1024;
const CONCURRENCY = 2;

type Status = 'reading' | 'ready' | 'queued' | 'creating' | 'uploading' | 'done' | 'error';

interface Shared {
  locationId: string;
  categoryIds: string[];
  published: boolean;
}

interface Item {
  key: string;
  file: File;
  status: Status;
  progress: number;
  error?: string;
  note?: string;
  meta: ParsedMetadata;
  preview?: Preview;
  title: string;
  caption: string;
  /** Per-photo override of the shared fields; null = use shared. */
  override: Shared | null;
  /** Server id once the row exists (kept across retries so a retry never creates a second row). */
  id?: string;
}

let counter = 0;

export default function UploadQueue({ categories, locations }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [shared, setShared] = useState<Shared>({ locationId: '', categoryIds: [], published: true });
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  const sharedRef = useRef(shared);
  const inflight = useRef(0);
  const readChain = useRef<Promise<void>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();

  itemsRef.current = items;
  sharedRef.current = shared;

  const patch = useCallback((key: string, changes: Partial<Item> | ((it: Item) => Partial<Item>)) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...(typeof changes === 'function' ? changes(it) : changes) } : it)));
  }, []);

  // Step 2–3: read metadata and build the preview, one file at a time (phones have little memory).
  const readItem = useCallback(
    (key: string, file: File) => {
      readChain.current = readChain.current.then(async () => {
        if (!itemsRef.current.some((it) => it.key === key)) return; // removed before its turn
        let meta: ParsedMetadata = EMPTY_METADATA;
        try {
          meta = await readMetadata(file);
        } catch {
          /* keep empty */
        }
        try {
          const preview = await makePreview(file);
          patch(key, { status: 'ready', meta, preview, title: meta.title ?? '', caption: meta.caption ?? '' });
        } catch (err) {
          patch(key, { status: 'error', meta, error: (err as Error).message || 'Could not read this image.' });
        }
      });
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const next: Item[] = [];
      for (const file of Array.from(files)) {
        const key = `f${++counter}`;
        const base: Item = { key, file, status: 'reading', progress: 0, meta: EMPTY_METADATA, title: '', caption: '', override: null };
        if (!ACCEPT.includes(file.type)) {
          next.push({ ...base, status: 'error', error: 'Only JPEG, PNG and WebP are accepted.' });
        } else if (file.size > MAX_BYTES) {
          next.push({ ...base, status: 'error', error: `Too large (${formatBytes(file.size)}); the limit is 100 MB.` });
        } else {
          next.push(base);
        }
      }
      setItems((prev) => [...prev, ...next]);
      for (const it of next) if (it.status === 'reading') readItem(it.key, it.file);
    },
    [readItem],
  );

  const removeItem = useCallback((key: string) => {
    setItems((prev) => {
      const it = prev.find((x) => x.key === key);
      if (it?.preview?.url) URL.revokeObjectURL(it.preview.url);
      return prev.filter((x) => x.key !== key);
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) if (it.preview?.url) URL.revokeObjectURL(it.preview.url);
    };
  }, []);

  // Steps 5–7: create the row, then PUT the file; two at a time; retries with backoff.
  const uploadOne = useCallback(
    async (item: Item) => {
      const fields = item.override ?? sharedRef.current;
      try {
        let id = item.id;
        if (!id) {
          patch(item.key, { status: 'creating', error: undefined, note: undefined });
          const created = await withRetry(
            () =>
              api<{ id: string }>('POST', '/api/admin/photos', {
                originalFilename: item.file.name,
                mime: item.file.type,
                bytes: item.file.size,
                width: item.preview?.width ?? 1,
                height: item.preview?.height ?? 1,
                placeholder: item.preview?.placeholder ?? null,
                title: item.title || null,
                caption: item.caption || null,
                takenAt: item.meta.takenAt,
                locationId: fields.locationId || null,
                categoryIds: fields.categoryIds,
                published: fields.published,
                watermark: true,
                gpsLat: item.meta.gpsLat,
                gpsLng: item.meta.gpsLng,
                camera: item.meta.camera,
                lens: item.meta.lens,
                focalLengthMm: item.meta.focalLengthMm,
                aperture: item.meta.aperture,
                shutterS: item.meta.shutterS,
                iso: item.meta.iso,
                exposureComp: item.meta.exposureComp,
              }),
            3,
            (n) => patch(item.key, { note: `Retrying (${n})…` }),
          );
          id = created.id;
          patch(item.key, { id });
        }
        patch(item.key, { status: 'uploading', progress: 0, note: undefined });
        const headers: Record<string, string> = {};
        if (item.meta.orientation) headers['x-exif-orientation'] = String(item.meta.orientation);
        const result = await withRetry(
          () => putFile(`/api/admin/photos/${id}/original`, item.file, headers, (f) => patch(item.key, { progress: f })),
          3,
          (n) => patch(item.key, { note: `Retrying (${n})…`, progress: 0 }),
        );
        patch(item.key, { status: 'done', progress: 1, note: result.unverified ? 'Stored (not verified by the Images binding in dev).' : undefined });
      } catch (err) {
        const message = err instanceof RequestFailed ? err.message : (err as Error).message || 'Upload failed';
        patch(item.key, { status: 'error', error: message, note: undefined });
      }
    },
    [patch],
  );

  const pump = useCallback(() => {
    while (inflight.current < CONCURRENCY) {
      const next = itemsRef.current.find((it) => it.status === 'queued');
      if (!next) return;
      inflight.current += 1;
      // Mark synchronously in the ref so the next loop iteration sees it, then in state.
      itemsRef.current = itemsRef.current.map((it) => (it.key === next.key ? { ...it, status: 'creating' } : it));
      patch(next.key, { status: 'creating' });
      uploadOne(next).finally(() => {
        inflight.current -= 1;
        pump();
      });
    }
  }, [patch, uploadOne]);

  // Whenever something becomes queued, start it.
  useEffect(() => {
    if (items.some((it) => it.status === 'queued')) pump();
  }, [items, pump]);

  const startAll = () => {
    setItems((prev) => prev.map((it) => (it.status === 'ready' ? { ...it, status: 'queued' } : it)));
  };
  const retry = (key: string) => patch(key, { status: 'queued', error: undefined, progress: 0 });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = '';
  };

  const readyCount = items.filter((it) => it.status === 'ready').length;
  const busy = items.some((it) => it.status === 'reading' || it.status === 'queued' || it.status === 'creating' || it.status === 'uploading');
  const doneCount = items.filter((it) => it.status === 'done').length;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="flex flex-col gap-8"
      data-hydrated={hydrated || undefined}
    >
      <section
        className={`flex flex-col items-start gap-4 rounded-md border border-dashed p-5 transition-colors ${dragging ? 'border-ink bg-surface' : 'border-divider'}`}
      >
        <input ref={fileInput} type="file" multiple accept={ACCEPT.join(',')} onChange={onPick} className="sr-only" id="upload-files" />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => fileInput.current?.click()} className={btn}>
            Add photos
          </button>
          <span className="text-sm text-ink-muted">JPEG, PNG or WebP up to 100 MB each. Drop files anywhere on this page.</span>
        </div>

        <SharedFields shared={shared} onChange={setShared} categories={categories} locations={locations} />

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" onClick={startAll} disabled={readyCount === 0} className={btnPrimary}>
            Upload {readyCount > 0 ? readyCount : ''} {readyCount === 1 ? 'photo' : 'photos'}
          </button>
          {doneCount > 0 && (
            <span className="text-sm text-ink-muted">
              {doneCount} uploaded ·{' '}
              <a href="/admin" className="text-ink underline">
                Open library
              </a>
            </span>
          )}
          {busy && <span className="text-sm text-ink-muted">Working…</span>}
        </div>
      </section>

      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((it) => (
            <Card
              key={it.key}
              item={it}
              shared={shared}
              categories={categories}
              locations={locations}
              onChange={(changes) => patch(it.key, changes)}
              onRemove={() => removeItem(it.key)}
              onRetry={() => retry(it.key)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const btn =
  'rounded border border-divider px-3 py-1.5 text-sm text-ink transition-colors hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-40';
const btnPrimary =
  'rounded bg-ink px-3 py-1.5 text-sm text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
const input = 'w-full rounded border border-divider bg-bg px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted/70 focus:border-ink-muted';
const label = 'text-xs uppercase tracking-wide text-ink-muted';

function SharedFields({
  shared,
  onChange,
  categories,
  locations,
  compact = false,
}: {
  shared: Shared;
  onChange: (s: Shared) => void;
  categories: CategoryOption[];
  locations: LocationOption[];
  compact?: boolean;
}) {
  const toggle = (id: string) =>
    onChange({
      ...shared,
      categoryIds: shared.categoryIds.includes(id) ? shared.categoryIds.filter((x) => x !== id) : [...shared.categoryIds, id],
    });
  return (
    <div className={`grid w-full gap-4 ${compact ? '' : 'sm:grid-cols-3'}`}>
      <div className="flex flex-col gap-1.5">
        <span className={label}>Location</span>
        <select value={shared.locationId} onChange={(e) => onChange({ ...shared, locationId: e.target.value })} className={input}>
          <option value="">No location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.region ? ` — ${l.region}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={label}>Categories</span>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = shared.categoryIds.includes(c.id);
            return (
              <label
                key={c.id}
                className={`cursor-pointer select-none rounded-full border px-3 py-1 text-sm transition-colors ${on ? 'border-ink text-ink' : 'border-divider text-ink-muted hover:border-ink-muted'}`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(c.id)} className="sr-only" />
                {c.name}
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={label}>Visibility</span>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={shared.published} onChange={() => onChange({ ...shared, published: true })} /> Publish now
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!shared.published} onChange={() => onChange({ ...shared, published: false })} /> Save as draft
          </label>
        </div>
      </div>
    </div>
  );
}

function Card({
  item,
  shared,
  categories,
  locations,
  onChange,
  onRemove,
  onRetry,
}: {
  item: Item;
  shared: Shared;
  categories: CategoryOption[];
  locations: LocationOption[];
  onChange: (changes: Partial<Item>) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const editable = item.status === 'ready' || item.status === 'error';
  const exif = exifLine(item.meta);
  const date = formatTakenAt(item.meta.takenAt);
  const dims = item.preview ? `${item.preview.width} × ${item.preview.height}` : null;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-divider bg-surface p-3">
      <div className="flex gap-3">
        <div className="aspect-[4/3] w-32 shrink-0 overflow-hidden rounded bg-bg">
          {item.preview?.url ? (
            <img src={item.preview.url} alt="" className="h-full w-full object-contain" draggable={false} />
          ) : (
            <div className="h-full w-full animate-pulse bg-divider/40" />
          )}
        </div>
        <div className="min-w-0 flex-1 text-xs text-ink-muted">
          <p className="truncate text-sm text-ink" title={item.file.name}>
            {item.file.name}
          </p>
          <p>
            {formatBytes(item.file.size)}
            {dims ? ` · ${dims}` : ''}
          </p>
          {date && <p>{date}</p>}
          {exif && <p className="line-clamp-2">{exif}</p>}
          {item.meta.gpsLat !== null && <p>GPS present (kept private)</p>}
          <StatusLine item={item} />
        </div>
      </div>

      {item.status !== 'done' && (
        <div className="flex flex-col gap-2">
          <input
            value={item.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Title"
            disabled={!editable}
            className={`${input} font-serif text-[15px]`}
            aria-label="Title"
          />
          <textarea
            value={item.caption}
            onChange={(e) => onChange({ caption: e.target.value })}
            placeholder="Caption"
            disabled={!editable}
            rows={2}
            className={input}
            aria-label="Caption"
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">
              {item.override ? 'Custom location, categories and visibility' : 'Use different location, categories or visibility'}
            </summary>
            <div className="pt-3">
              <SharedFields
                compact
                shared={item.override ?? shared}
                onChange={(s) => onChange({ override: s })}
                categories={categories}
                locations={locations}
              />
              {item.override && (
                <button type="button" onClick={() => onChange({ override: null })} className="mt-2 text-xs text-ink-muted underline hover:text-ink">
                  Back to shared settings
                </button>
              )}
            </div>
          </details>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {item.status === 'uploading' || item.status === 'creating' ? (
          <div className="h-1 flex-1 overflow-hidden rounded bg-divider" role="progressbar" aria-valuenow={Math.round(item.progress * 100)}>
            <div className="h-full bg-ink transition-[width] duration-200" style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-3 text-xs">
          {item.status === 'error' && item.preview && (
            <button type="button" onClick={onRetry} className="text-ink underline">
              Retry
            </button>
          )}
          {item.status === 'done' && item.id && (
            <a href={`/admin/photos/${item.id}`} className="text-ink underline">
              Edit
            </a>
          )}
          {(editable || item.status === 'done') && (
            <button type="button" onClick={onRemove} className="text-ink-muted hover:text-ink">
              {item.status === 'done' ? 'Dismiss' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusLine({ item }: { item: Item }) {
  const text: Record<Status, string> = {
    reading: 'Reading…',
    ready: 'Ready',
    queued: 'Waiting…',
    creating: 'Creating…',
    uploading: `Uploading ${Math.round(item.progress * 100)}%`,
    done: 'Uploaded',
    error: item.error ?? 'Failed',
  };
  return (
    <p className={`pt-1 ${item.status === 'error' ? 'text-ink' : item.status === 'done' ? 'text-ink' : ''}`}>
      {text[item.status]}
      {item.note ? ` · ${item.note}` : ''}
    </p>
  );
}
