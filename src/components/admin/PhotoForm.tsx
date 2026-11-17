import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { AdminPhoto } from '../../lib/db';
import { adminImageUrl, api, confirmDanger, formatBytes, putFile, RequestFailed } from '../../lib/client/http';
import { makePreview, readMetadata } from '../../lib/client/metadata';
import { formatShutter } from '../../lib/exif-format';
import TextFields, { textPayload, type TextState } from './TextFields';
import { badge, btn, btnDanger, btnPrimary, input, label, useHydrated } from './ui';

interface Option {
  id: string;
  name: string;
}
interface Props {
  photo: AdminPhoto;
  categories: Option[];
  locations: Option[];
  /** Whether an AI provider is configured (shows the Suggest button). */
  aiEnabled: boolean;
}

interface FormState {
  takenAt: string;
  locationId: string;
  categoryIds: string[];
  published: boolean;
  watermark: boolean;
  camera: string;
  lens: string;
  focalLengthMm: string;
  aperture: string;
  shutter: string;
  iso: string;
  exposureComp: string;
}

function fromPhoto(p: AdminPhoto): FormState {
  return {
    takenAt: p.takenAt ?? '',
    locationId: p.locationId ?? '',
    categoryIds: p.categoryIds,
    published: p.published,
    watermark: p.watermark,
    camera: p.camera ?? '',
    lens: p.lens ?? '',
    focalLengthMm: p.focalLengthMm === null ? '' : String(p.focalLengthMm),
    aperture: p.aperture === null ? '' : String(p.aperture),
    shutter: p.shutterS === null ? '' : (formatShutter(p.shutterS) ?? '').replace(/ s$/, ''),
    iso: p.iso === null ? '' : String(p.iso),
    exposureComp: p.exposureComp === null ? '' : String(p.exposureComp),
  };
}

function textFromPhoto(p: AdminPhoto): TextState {
  return { title: p.title ?? '', subject: p.subject ?? '', hashtags: p.hashtags ?? '', captions: p.captions, captionTone: p.captionTone };
}

/** "1/2000" → 0.0005, "2.5" → 2.5, "" → null. */
function parseShutter(s: string): number | null {
  const t = s.trim().replace(/\s*s$/, '');
  if (!t) return null;
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function PhotoForm({ photo: initial, categories, locations, aiEnabled }: Props) {
  const [photo, setPhoto] = useState(initial);
  const [form, setForm] = useState<FormState>(() => fromPhoto(initial));
  const [text, setText] = useState<TextState>(() => textFromPhoto(initial));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const hydrated = useHydrated();
  const [rereadExif, setRereadExif] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleCategory = (id: string) =>
    set('categoryIds', form.categoryIds.includes(id) ? form.categoryIds.filter((x) => x !== id) : [...form.categoryIds, id]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus('Saving…');
    try {
      const { photo: updated } = await api<{ photo: AdminPhoto }>('PATCH', `/api/admin/photos/${photo.id}`, {
        ...textPayload(text),
        takenAt: form.takenAt || null,
        locationId: form.locationId || null,
        categoryIds: form.categoryIds,
        published: form.published,
        watermark: form.watermark,
        camera: form.camera || null,
        lens: form.lens || null,
        focalLengthMm: parseNum(form.focalLengthMm),
        aperture: parseNum(form.aperture),
        shutterS: parseShutter(form.shutter),
        iso: parseNum(form.iso),
        exposureComp: parseNum(form.exposureComp),
      });
      setPhoto(updated);
      setForm(fromPhoto(updated));
      setText(textFromPhoto(updated));
      setStatus('Saved');
    } catch (err) {
      setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const replace = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setStatus('Files must be 100 MB or smaller.');
      return;
    }
    setBusy(true);
    setStatus('Reading the new file…');
    try {
      const [preview, meta] = await Promise.all([makePreview(file, 200), readMetadata(file).catch(() => null)]);
      URL.revokeObjectURL(preview.url);
      const headers: Record<string, string> = {
        'x-width': String(preview.width),
        'x-height': String(preview.height),
        'x-placeholder': preview.placeholder,
      };
      if (meta?.orientation) headers['x-exif-orientation'] = String(meta.orientation);
      setStatus('Uploading replacement…');
      setProgress(0);
      await putFile(`/api/admin/photos/${photo.id}/replace`, file, headers, setProgress);
      if (rereadExif && meta) {
        setStatus('Updating EXIF…');
        await api('PATCH', `/api/admin/photos/${photo.id}`, {
          takenAt: meta.takenAt,
          camera: meta.camera,
          lens: meta.lens,
          focalLengthMm: meta.focalLengthMm,
          aperture: meta.aperture,
          shutterS: meta.shutterS,
          iso: meta.iso,
          exposureComp: meta.exposureComp,
          gpsLat: meta.gpsLat,
          gpsLng: meta.gpsLng,
        });
      }
      location.reload();
    } catch (err) {
      setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
      setBusy(false);
      setProgress(null);
    }
  };

  const remove = async () => {
    if (!confirmDanger('Delete this photo and its original? This cannot be undone.')) return;
    setBusy(true);
    setStatus('Deleting…');
    try {
      await api('DELETE', `/api/admin/photos/${photo.id}`);
      location.href = '/admin';
    } catch (err) {
      setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]" data-hydrated={hydrated || undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-center overflow-hidden rounded-md bg-surface" style={{ maxHeight: '70vh', aspectRatio: `${photo.width} / ${photo.height}` }}>
          {photo.status === 'ready' ? (
            <img
              src={adminImageUrl(photo.id, 1600, photo.version)}
              alt={photo.title ?? ''}
              width={photo.width}
              height={photo.height}
              draggable={false}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : (
            <p className="p-10 text-sm text-ink-muted">The original has not finished uploading.</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-ink-muted">
          <dt>File</dt>
          <dd className="truncate text-ink">{photo.originalFilename ?? '—'}</dd>
          <dt>Size</dt>
          <dd>
            {photo.width} × {photo.height}
            {photo.bytes ? ` · ${formatBytes(photo.bytes)}` : ''} · {photo.mime} · v{photo.version}
          </dd>
          <dt>Status</dt>
          <dd>
            {photo.status === 'uploading' ? 'Uploading' : photo.published ? 'Published' : 'Draft'}
          </dd>
          <dt>GPS</dt>
          <dd>{photo.gpsLat !== null && photo.gpsLng !== null ? `${photo.gpsLat.toFixed(5)}, ${photo.gpsLng.toFixed(5)} (private, never published)` : 'none'}</dd>
          <dt>Added</dt>
          <dd>{photo.createdAt} UTC</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <label className={`${btn} cursor-pointer`}>
            Replace original…
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={replace} disabled={busy} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink-muted">
            <input type="checkbox" checked={rereadExif} onChange={(e) => setRereadExif(e.target.checked)} /> Re-read EXIF from the new file
          </label>
          {progress !== null && (
            <div className="h-1 w-40 overflow-hidden rounded bg-divider" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full bg-ink" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <TextFields
          name="photo"
          value={text}
          onChange={setText}
          disabled={busy}
          aiEnabled={aiEnabled}
          getImage={
            photo.status === 'ready'
              ? async () => {
                  // The same private preview the page shows; the browser shrinks it before it is sent.
                  const res = await fetch(adminImageUrl(photo.id, 1600, photo.version), { credentials: 'same-origin' });
                  if (!res.ok) throw new Error('Could not load the photo to send.');
                  return res.blob();
                }
              : null
          }
          getContext={() => ({
            takenAt: form.takenAt || null,
            locationId: form.locationId || null,
            categoryIds: form.categoryIds,
            camera: form.camera || null,
            lens: form.lens || null,
            focalLengthMm: parseNum(form.focalLengthMm),
            keywords: [],
          })}
          categories={categories}
          categoryIds={form.categoryIds}
          onAddCategory={(id) => set('categoryIds', [...form.categoryIds, id])}
        />
        <Field label="Date taken">
          <input type="datetime-local" step={1} value={form.takenAt} onChange={(e) => set('takenAt', e.target.value)} className={input} />
        </Field>
        <Field label="Location">
          <select value={form.locationId} onChange={(e) => set('locationId', e.target.value)} className={input}>
            <option value="">No location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categories">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const on = form.categoryIds.includes(c.id);
              return (
                <label key={c.id} className={`cursor-pointer select-none rounded-full border px-3 py-1 text-sm ${on ? 'border-ink text-ink' : 'border-divider text-ink-muted hover:border-ink-muted'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleCategory(c.id)} className="sr-only" />
                  {c.name}
                </label>
              );
            })}
          </div>
        </Field>

        <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-divider p-3">
          <legend className={`${label} px-1`}>EXIF</legend>
          <Field label="Camera" className="col-span-2">
            <input value={form.camera} onChange={(e) => set('camera', e.target.value)} className={input} />
          </Field>
          <Field label="Lens" className="col-span-2">
            <input value={form.lens} onChange={(e) => set('lens', e.target.value)} className={input} />
          </Field>
          <Field label="Focal length (mm)">
            <input inputMode="decimal" value={form.focalLengthMm} onChange={(e) => set('focalLengthMm', e.target.value)} className={input} />
          </Field>
          <Field label="Aperture (f/)">
            <input inputMode="decimal" value={form.aperture} onChange={(e) => set('aperture', e.target.value)} className={input} />
          </Field>
          <Field label="Shutter (s)">
            <input value={form.shutter} onChange={(e) => set('shutter', e.target.value)} placeholder="1/2000 or 2.5" className={input} />
          </Field>
          <Field label="ISO">
            <input inputMode="numeric" value={form.iso} onChange={(e) => set('iso', e.target.value)} className={input} />
          </Field>
          <Field label="Exposure comp. (EV)">
            <input inputMode="decimal" value={form.exposureComp} onChange={(e) => set('exposureComp', e.target.value)} className={input} />
          </Field>
        </fieldset>

        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.watermark} onChange={(e) => set('watermark', e.target.checked)} /> Watermark on large sizes
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.published} onChange={(e) => set('published', e.target.checked)} /> Published
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button type="submit" className={btnPrimary} disabled={busy}>
            Save
          </button>
          {photo.published && photo.status === 'ready' ? (
            <a href={`/p/${photo.id}`} className={btn} target="_blank" rel="noreferrer">
              View on site
            </a>
          ) : (
            <span className={badge}>Not public</span>
          )}
          <button type="button" className={`${btnDanger} ml-auto`} disabled={busy} onClick={remove}>
            Delete
          </button>
        </div>
        {status && (
          <p className="text-sm text-ink-muted" role="status">
            {status}
          </p>
        )}
      </form>
    </div>
  );
}

function Field({ label: text, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className={label}>{text}</span>
      {children}
    </label>
  );
}
