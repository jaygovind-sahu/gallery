import { useState, type FormEvent } from 'react';
import type { AdminCategory, Layout } from '../../lib/db';
import { adminImageUrl, api, confirmDanger, RequestFailed } from '../../lib/client/http';
import { btn, btnDanger, btnPrimary, input, label, useHydrated } from './ui';

interface Props {
  categories: AdminCategory[];
}

const LAYOUTS: Array<{ value: Layout; name: string }> = [
  { value: 'rows', name: 'Justified rows' },
  { value: 'masonry', name: 'Masonry' },
  { value: 'grid', name: 'Grid' },
];

/** Create, rename, describe and reorder categories; set each one's default layout. Covers are picked on the category's photo page. */
export default function CategoryManager({ categories: initial }: Props) {
  const [categories, setCategories] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const hydrated = useHydrated();
  const [newLayout, setNewLayout] = useState<Layout>('rows');

  const report = (err: unknown) => setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);

  const refresh = async () => {
    const { categories } = await api<{ categories: AdminCategory[] }>('GET', '/api/admin/categories');
    setCategories(categories);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setStatus('Creating…');
    try {
      await api('POST', '/api/admin/categories', { name: newName.trim(), defaultLayout: newLayout });
      setNewName('');
      await refresh();
      setStatus('Created');
    } catch (err) {
      report(err);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
    setStatus('Saving order…');
    try {
      const res = await api<{ categories: AdminCategory[] }>('PATCH', '/api/admin/categories', { ids: next.map((c) => c.id) });
      setCategories(res.categories);
      setStatus('Order saved');
    } catch (err) {
      report(err);
      await refresh();
    }
  };

  const save = async (c: AdminCategory, patch: Partial<Pick<AdminCategory, 'name' | 'slug' | 'description' | 'defaultLayout'>>) => {
    setStatus('Saving…');
    try {
      const { category } = await api<{ category: AdminCategory }>('PATCH', `/api/admin/categories/${c.id}`, patch);
      setCategories((cs) => cs.map((x) => (x.id === c.id ? category : x)));
      setStatus('Saved');
    } catch (err) {
      report(err);
    }
  };

  const remove = async (c: AdminCategory) => {
    if (!confirmDanger(`Delete the category "${c.name}"? Its ${c.totalCount} photos stay in the library.`)) return;
    setStatus('Deleting…');
    try {
      await api('DELETE', `/api/admin/categories/${c.id}`);
      await refresh();
      setStatus('Deleted');
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
      <ol className="flex flex-col gap-3">
        {categories.map((c, i) => (
          <Row key={c.id} category={c} first={i === 0} last={i === categories.length - 1} onMove={(d) => move(i, d)} onSave={(p) => save(c, p)} onDelete={() => remove(c)} />
        ))}
      </ol>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-divider p-4">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={label}>New category</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Default layout</span>
          <select value={newLayout} onChange={(e) => setNewLayout(e.target.value as Layout)} className={input}>
            {LAYOUTS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btnPrimary} disabled={!newName.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function Row({
  category: c,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  category: AdminCategory;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onSave: (patch: Partial<Pick<AdminCategory, 'name' | 'slug' | 'description' | 'defaultLayout'>>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(c.name);
  const [slug, setSlug] = useState(c.slug);
  const [description, setDescription] = useState(c.description ?? '');
  const [layout, setLayout] = useState<Layout>(c.defaultLayout);
  const dirty = name !== c.name || slug !== c.slug || description !== (c.description ?? '') || layout !== c.defaultLayout;

  return (
    <li className="grid gap-3 rounded-md border border-divider bg-surface p-3 sm:grid-cols-[96px_1fr_auto]">
      <a href={`/admin/categories/${c.id}`} className="block h-18 w-24 overflow-hidden rounded bg-bg" style={{ aspectRatio: '4 / 3' }} aria-label={`Photos in ${c.name}`}>
        {c.coverPhotoId ? (
          <img src={adminImageUrl(c.coverPhotoId, 480)} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-ink-muted">No cover</div>
        )}
      </a>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} font-display text-lg font-medium`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Slug</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className={input} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={label}>Description (one line)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Default layout</span>
          <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)} className={input}>
            {LAYOUTS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3 text-xs text-ink-muted">
          <a href={`/admin/categories/${c.id}`} className="text-ink underline">
            Photos, order &amp; cover ({c.totalCount})
          </a>
          <span>{c.photoCount} published</span>
        </div>
      </div>
      <div className="flex flex-row flex-wrap gap-2 sm:flex-col">
        <button type="button" className={btnPrimary} disabled={!dirty || !name.trim() || !slug} onClick={() => onSave({ name: name.trim(), slug, description: description || null, defaultLayout: layout })}>
          Save
        </button>
        <div className="flex gap-1">
          <button type="button" className={btn} disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${c.name} up`}>
            ↑
          </button>
          <button type="button" className={btn} disabled={last} onClick={() => onMove(1)} aria-label={`Move ${c.name} down`}>
            ↓
          </button>
        </div>
        <button type="button" className={btnDanger} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
