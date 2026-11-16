import { useState, type FormEvent } from 'react';
import type { Location } from '../../lib/db';
import { api, confirmDanger, RequestFailed } from '../../lib/client/http';
import { btn, btnDanger, btnPrimary, input, label, useHydrated } from './ui';

interface Props {
  locations: Location[];
}

/** Create, rename, merge or delete locations. */
export default function LocationManager({ locations: initial }: Props) {
  const [locations, setLocations] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const hydrated = useHydrated();
  const [newRegion, setNewRegion] = useState('');

  const report = (err: unknown) => setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
  const refresh = async () => {
    const { locations } = await api<{ locations: Location[] }>('GET', '/api/admin/locations');
    setLocations(locations);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setStatus('Creating…');
    try {
      await api('POST', '/api/admin/locations', { name: newName.trim(), region: newRegion.trim() || null });
      setNewName('');
      setNewRegion('');
      await refresh();
      setStatus('Created');
    } catch (err) {
      report(err);
    }
  };

  const save = async (l: Location, patch: { name: string; region: string | null }) => {
    setStatus('Saving…');
    try {
      await api('PATCH', `/api/admin/locations/${l.id}`, patch);
      await refresh();
      setStatus('Saved');
    } catch (err) {
      report(err);
    }
  };

  const remove = async (l: Location) => {
    const note = l.photoCount ? ` Its ${l.photoCount} photo${l.photoCount === 1 ? '' : 's'} will have no location.` : '';
    if (!confirmDanger(`Delete "${l.name}"?${note}`)) return;
    setStatus('Deleting…');
    try {
      await api('DELETE', `/api/admin/locations/${l.id}`);
      await refresh();
      setStatus('Deleted');
    } catch (err) {
      report(err);
    }
  };

  const merge = async (l: Location, intoId: string) => {
    const into = locations.find((x) => x.id === intoId);
    if (!into || !confirmDanger(`Merge "${l.name}" into "${into.name}"? Its photos move there and "${l.name}" is deleted.`)) return;
    setStatus('Merging…');
    try {
      await api('DELETE', `/api/admin/locations/${l.id}?into=${encodeURIComponent(intoId)}`);
      await refresh();
      setStatus('Merged');
    } catch (err) {
      report(err);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-hydrated={hydrated || undefined}>
      {status && (
        <p className="text-sm text-ink-muted" role="status">
          {status}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {locations.map((l) => (
          <Row key={l.id} location={l} others={locations.filter((x) => x.id !== l.id)} onSave={(p) => save(l, p)} onDelete={() => remove(l)} onMerge={(into) => merge(l, into)} />
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-divider p-4">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={label}>New location</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={input} />
        </label>
        <label className="flex min-w-40 flex-col gap-1">
          <span className={label}>Region</span>
          <input value={newRegion} onChange={(e) => setNewRegion(e.target.value)} placeholder="Pennsylvania" className={input} />
        </label>
        <button type="submit" className={btnPrimary} disabled={!newName.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function Row({
  location: l,
  others,
  onSave,
  onDelete,
  onMerge,
}: {
  location: Location;
  others: Location[];
  onSave: (patch: { name: string; region: string | null }) => void;
  onDelete: () => void;
  onMerge: (intoId: string) => void;
}) {
  const [name, setName] = useState(l.name);
  const [region, setRegion] = useState(l.region ?? '');
  const dirty = name !== l.name || region !== (l.region ?? '');
  return (
    <li className="grid gap-3 rounded-md border border-divider bg-surface p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="flex flex-col gap-1">
        <span className={label}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Region</span>
        <input value={region} onChange={(e) => setRegion(e.target.value)} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pr-1 text-xs text-ink-muted">
          {l.photoCount} {l.photoCount === 1 ? 'photo' : 'photos'}
        </span>
        <button type="button" className={btnPrimary} disabled={!dirty || !name.trim()} onClick={() => onSave({ name: name.trim(), region: region.trim() || null })}>
          Save
        </button>
        <select
          value=""
          aria-label={`Merge ${l.name} into`}
          className={`${btn} w-auto`}
          onChange={(e) => {
            if (e.target.value) onMerge(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">Merge into…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button type="button" className={btnDanger} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
