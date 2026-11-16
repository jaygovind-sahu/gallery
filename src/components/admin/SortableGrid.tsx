import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AdminCategory, CategoryPhotoAdmin } from '../../lib/db';
import { adminImageUrl, api, RequestFailed } from '../../lib/client/http';
import { badge, useHydrated } from './ui';

interface Props {
  category: AdminCategory;
  photos: CategoryPhotoAdmin[];
}

/** Drag-to-reorder the photos of one category (mouse, touch with a short hold, keyboard) and pick its cover. */
export default function SortableGrid({ category: initialCategory, photos: initial }: Props) {
  const [photos, setPhotos] = useState(initial);
  const [cover, setCover] = useState(initialCategory.coverPhotoId);
  const hydrated = useHydrated();
  const [status, setStatus] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = photos.findIndex((p) => p.id === active.id);
    const to = photos.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const previous = photos;
    const next = arrayMove(photos, from, to);
    setPhotos(next);
    setStatus('Saving order…');
    try {
      await api('POST', `/api/admin/categories/${initialCategory.id}/move`, {
        photoId: String(active.id),
        beforeId: next[to - 1]?.id,
        afterId: next[to + 1]?.id,
      });
      setStatus('Order saved');
    } catch (err) {
      setPhotos(previous);
      setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
    }
  };

  const setAsCover = async (photoId: string | null) => {
    setStatus('Saving cover…');
    try {
      await api('PATCH', `/api/admin/categories/${initialCategory.id}`, { coverPhotoId: photoId });
      setCover(photoId);
      setStatus(photoId ? 'Cover saved' : 'Cover cleared');
    } catch (err) {
      setStatus(err instanceof RequestFailed ? err.message : (err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-hydrated={hydrated || undefined}>
      <p className="text-sm text-ink-muted" role="status">
        {status ?? 'Drag to reorder (press and hold on touch screens). The order shows on the public page within a minute.'}
      </p>
      {photos.length === 0 ? (
        <p className="py-10 text-sm text-ink-muted">No photos in this category yet.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((p, i) => (
                <Tile key={p.id} photo={p} index={i} isCover={cover === p.id} onCover={() => setAsCover(cover === p.id ? null : p.id)} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function Tile({ photo, index, isCover, onCover }: { photo: CategoryPhotoAdmin; index: number; isCover: boolean; onCover: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id });
  const style = { transform: CSS.Transform.toString(transform), transition, touchAction: 'manipulation' as const };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex select-none flex-col gap-1.5 rounded-md border bg-bg p-1.5 ${isDragging ? 'z-10 border-ink opacity-90' : 'border-divider'}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab overflow-hidden rounded bg-surface active:cursor-grabbing" style={{ aspectRatio: '4 / 3' }} aria-label={`Move ${photo.title ?? 'photo'} ${index + 1}`}>
        {photo.status === 'ready' ? (
          <img src={adminImageUrl(photo.id, 480, photo.version)} alt="" width={photo.width} height={photo.height} loading="lazy" draggable={false} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-muted">Uploading…</div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-0.5 text-xs">
        <span className="w-5 shrink-0 text-ink-muted">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate font-serif text-[14px] text-ink">{photo.title || 'Untitled'}</span>
        {!photo.published && <span className={badge}>Draft</span>}
      </div>
      <div className="flex items-center gap-2 px-0.5 pb-0.5 text-xs">
        <a href={`/admin/photos/${photo.id}`} className="text-ink-muted hover:text-ink">
          Edit
        </a>
        <button type="button" onClick={onCover} className={`ml-auto ${isCover ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}>
          {isCover ? '★ Cover' : 'Set as cover'}
        </button>
      </div>
    </li>
  );
}
