import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicPhoto } from '../../lib/db';
import { lightboxSources } from '../../lib/gallery';
import { lightboxRect, planRoom, type Rect } from '../../lib/walk';
import Lightbox from './Lightbox';
import { createRoom, FRAME_STYLES, type RoomHandle } from './walk/room';

interface Props {
  photos: PublicPhoto[];
  /** The room's name, for screen readers and beside the map at the title wall (not lettered on the wall). */
  heading: string;
  /** The first small line under it, e.g. "Photographs by …"; the count and years follow. */
  byline: string;
  /** The same photos as a grid page, for the WebGL fallback. */
  gridUrl: string;
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const LEFT = 'M19 12H5M11 6l-6 6 6 6';
const RIGHT = 'M5 12h14M13 6l6 6-6 6';

/** "2024–2026", or one year, from the photos' capture dates. */
function yearSpan(photos: PublicPhoto[]): string | null {
  const years = photos.map((p) => Number(p.takenAt?.slice(0, 4))).filter((y) => Number.isFinite(y) && y > 0);
  if (years.length === 0) return null;
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/** The room map: an 88 px plan of the ring, title wall at the top, walking clockwise. */
const MAP = { size: 88, centre: 44, radius: 34 };
/** A point on the map at `r` from the centre, angle θ from the top, clockwise. */
const onMap = (r: number, angle: number) => [MAP.centre + r * Math.sin(angle), MAP.centre - r * Math.cos(angle)] as const;

/**
 * The walk-through: the photos framed and hung round a ring-shaped room the visitor can walk forever (wheel, drag,
 * keys, the map). Clicking a print steps up to it; clicking it again, View photo or Enter steps into it, and
 * the usual lightbox fades in exactly where the print was. Loaded `client:only`, so three.js never reaches
 * the Worker bundle.
 */
export default function WalkGallery({ photos, heading, byline, gridUrl }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<RoomHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [moved, setMoved] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [touch, setTouch] = useState(false);
  const pushed = useRef(false);
  const returnUrl = useRef('');
  /** The lightbox's photo, so closing it steps out of that print. */
  const viewed = useRef(0);
  const reducedMotion = useRef(false);

  // The map's marks: the title wall, and a tick per print, outside the circle for the outer wall and inside
  // for the inner, so it reads as a floor plan.
  const marks = useMemo(() => {
    const plan = planRoom(photos.length);
    return plan.slots.map((s, i) => {
      const [r0, r1] = s.wall === 'outer' ? [MAP.radius + 2, MAP.radius + 6] : [MAP.radius - 6, MAP.radius - 2];
      return { key: i, from: onMap(r0, s.angle), to: onMap(r1, s.angle) };
    });
  }, [photos.length]);

  /** Where the lightbox will draw photo i on this screen. */
  const rectFor = useCallback(
    (i: number): Rect => {
      const photo = photos[i]!;
      const largest = lightboxSources(photo).at(-1) ?? { width: photo.width, height: photo.height };
      return lightboxRect(largest, { width: window.innerWidth, height: window.innerHeight }, window.devicePixelRatio || 1);
    },
    [photos],
  );

  /** Fetch and decode the file the lightbox will pick, so it is ready the moment it fades in (at most 1.5 s). */
  const preload = useCallback(
    (i: number, rect: Rect) =>
      new Promise<void>((resolve) => {
        const sources = lightboxSources(photos[i]!);
        const img = new Image();
        img.decoding = 'async';
        img.sizes = `${Math.ceil(rect.width)}px`;
        img.srcset = sources.map((s) => `${s.src} ${s.width}w`).join(', ');
        img.src = sources.at(-1)?.src ?? '';
        const timeout = window.setTimeout(resolve, 1500);
        img
          .decode()
          .catch(() => undefined)
          .then(() => {
            window.clearTimeout(timeout);
            resolve();
          });
      }),
    [photos],
  );

  const showLightbox = useCallback(
    (i: number) => {
      const photo = photos[i];
      if (!photo) return;
      returnUrl.current = window.location.pathname + window.location.search;
      window.history.pushState({ lightbox: photo.id }, '', `/p/${photo.id}`);
      pushed.current = true;
      viewed.current = i;
      setIndex(i);
      setOpen(true);
      setStepping(false);
      roomRef.current?.setPaused(true);
    },
    [photos],
  );

  /** Step into print i, then fade the lightbox in over it. */
  const openAt = useCallback(
    (i: number) => {
      const room = roomRef.current;
      if (!room || reducedMotion.current) {
        showLightbox(i);
        return;
      }
      const rect = rectFor(i);
      setStepping(true);
      const arrived = new Promise<void>((resolve) => room.stepIn(i, rect, resolve));
      void Promise.all([arrived, preload(i, rect)]).then(() => showLightbox(i));
    },
    [rectFor, preload, showLightbox],
  );

  const afterClose = useCallback(() => {
    setOpen(false);
    roomRef.current?.setPaused(false);
    roomRef.current?.stepOut(viewed.current);
  }, []);

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', returnUrl.current);
    }
    afterClose();
  }, [afterClose]);

  const onView = useCallback(
    (i: number) => {
      viewed.current = i;
      setIndex(i);
      const photo = photos[i];
      if (photo) window.history.replaceState({ lightbox: photo.id }, '', `/p/${photo.id}`);
      // Behind the lightbox, stand in this print, so closing reveals it where the lightbox had it.
      roomRef.current?.standIn(i, rectFor(i));
    },
    [photos, rectFor],
  );

  // Back closes the lightbox.
  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      afterClose();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [afterClose]);

  useEffect(() => {
    setTouch(window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // The room itself.
  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root || photos.length === 0) return;
    const years = yearSpan(photos);
    const count = `${photos.length} ${photos.length === 1 ? 'photograph' : 'photographs'}`;
    let room: RoomHandle;
    try {
      room = createRoom(
        host,
        root,
        photos,
        { lines: [byline, years ? `${count} · ${years}` : count] },
        {
          onCurrent: setCurrent,
          onFocus: setFocused,
          onOpen: (i) => openAt(i),
          onMove: () => setMoved(true),
          // Every frame the visitor moves: turn the map's hand without a React render.
          onAngle: (angle) => mapRef.current?.style.setProperty('--walk-angle', angle.toFixed(4)),
        },
        {
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          // ?frame=gilt|walnut|plain shows another moulding, to compare; the default is `gallery`.
          frame: FRAME_STYLES.find((f) => f === new URLSearchParams(window.location.search).get('frame')),
        },
      );
    } catch {
      setFailed(true);
      return;
    }
    roomRef.current = room;
    root.setAttribute('data-hydrated', '');
    return () => {
      room.dispose();
      roomRef.current = null;
    };
  }, [photos, heading, byline, openAt]);

  // Keys: right, down and Page Down walk on (or move to the next print); left, up and Page Up go back. Home
  // returns to the title wall. Enter steps closer, then in; Escape steps back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const room = roomRef.current;
      if (!room || open || stepping || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], details[open]')) return;
      const onControl = Boolean(target?.closest('button, a'));
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown'];
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'];
      if (forward.includes(e.key) || back.includes(e.key)) {
        e.preventDefault();
        room.step(forward.includes(e.key) ? 1 : -1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        room.walkTo(0);
      } else if (e.key === 'Enter' && !onControl) {
        e.preventDefault();
        if (focused !== null) openAt(focused);
        else room.focusCurrent();
      } else if (e.key === 'Escape' && focused !== null) {
        e.preventDefault();
        room.unfocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, stepping, focused, openAt]);

  // The map: press or drag on it to walk to that point of the ring.
  const mapDrag = useRef(false);
  const walkToPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    roomRef.current?.walkTo(Math.atan2(x, -y));
  };

  if (photos.length === 0 || failed) {
    return (
      <div className="tone-light flex h-full flex-col items-start justify-end gap-3 bg-bg px-4 pb-10 sm:px-8">
        <p className="m-0 max-w-[48ch] text-[15px] text-ink-muted">
          {photos.length === 0 ? 'No photos here yet.' : 'This walk-through needs WebGL, which this browser has turned off.'}{' '}
          <a href={gridUrl} className="text-ink underline decoration-divider underline-offset-4">
            See them in the grid
          </a>
        </p>
      </div>
    );
  }

  const shown = focused ?? current;
  const photo = shown === null ? null : photos[shown]!;
  const label = photo ? photo.title?.trim() || photo.location?.name || `Photo ${shown! + 1}` : heading;
  const caption = photo?.caption?.trim() || null;
  const [titleFrom, titleTo] = [onMap(MAP.radius - 8, 0), onMap(MAP.radius + 8, 0)];

  return (
    <div
      ref={rootRef}
      className="walk tone-light relative h-full w-full overflow-hidden bg-bg"
      data-focused={focused !== null ? '' : undefined}
      data-stepping={stepping ? '' : undefined}
      data-moved={moved ? '' : undefined}
      onContextMenu={(e) => e.preventDefault()}
      role="region"
      aria-roledescription="walk-through gallery"
      aria-label={`${heading}. Arrow keys walk round the room, Enter steps up to a photo and Enter again opens it, Escape steps back.`}
    >
      <div ref={hostRef} className="absolute inset-0" />

      {/* Where you are: a plan of the ring with the title wall at the top; the dot goes round as you walk. */}
      <div ref={mapRef} className="walk-map absolute right-4 top-[72px] flex items-center gap-3 sm:bottom-8 sm:right-8 sm:top-auto">
        <span className="walk-map__label eyebrow" aria-hidden="true">
          {label}
        </span>
        <div
          className="relative shrink-0 cursor-pointer touch-none rounded-full"
          style={{ width: MAP.size, height: MAP.size }}
          role="slider"
          tabIndex={0}
          aria-label="Where you are in the room"
          aria-valuemin={1}
          aria-valuemax={photos.length}
          aria-valuenow={(shown ?? 0) + 1}
          aria-valuetext={label}
          onPointerDown={(e) => {
            mapDrag.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            walkToPointer(e);
          }}
          onPointerMove={(e) => mapDrag.current && walkToPointer(e)}
          onPointerUp={() => (mapDrag.current = false)}
          onPointerCancel={() => (mapDrag.current = false)}
        >
          <svg className="absolute inset-0" width={MAP.size} height={MAP.size} viewBox={`0 0 ${MAP.size} ${MAP.size}`} aria-hidden="true">
            <circle className="walk-map__ring" cx={MAP.centre} cy={MAP.centre} r={MAP.radius} />
            {marks.map((m) => (
              <line key={m.key} className="walk-map__tick" x1={m.from[0]} y1={m.from[1]} x2={m.to[0]} y2={m.to[1]} />
            ))}
            <line className="walk-map__title" x1={titleFrom[0]} y1={titleFrom[1]} x2={titleTo[0]} y2={titleTo[1]} />
          </svg>
          <span className="walk-map__hand" aria-hidden="true">
            <span className="walk-map__dot" style={{ top: MAP.centre - MAP.radius }} />
          </span>
        </div>
      </div>

      <p className="walk-hint eyebrow pointer-events-none absolute inset-x-0 bottom-6 m-0 px-16 text-center sm:bottom-9 sm:px-48" aria-hidden="true">
        {touch ? 'Swipe to walk round · Tap a print to step closer' : 'Scroll or drag to walk round · Click a print to step closer'}
      </p>

      {/* Standing at a print: the wall label has its title, so this adds the caption and what to do next. */}
      <div className="walk-caption pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-5 sm:pb-8" aria-hidden={focused === null}>
        <div className="pointer-events-auto flex max-w-[min(600px,100%)] flex-col items-center gap-4 text-center">
          {caption && <p className="walk-caption__text m-0 text-pretty text-[15px] leading-relaxed text-ink-muted">{caption}</p>}
          <div className="flex items-center gap-2">
            <button type="button" className="walk-button" aria-label="Previous photo" tabIndex={focused === null ? -1 : 0} onClick={() => roomRef.current?.step(-1)}>
              <Glyph d={LEFT} />
            </button>
            <button
              type="button"
              tabIndex={focused === null ? -1 : 0}
              onClick={() => focused !== null && openAt(focused)}
              className="h-11 rounded-full border border-ink px-5 text-sm font-medium text-ink transition-colors hover:bg-ink hover:text-bg"
            >
              View photo
            </button>
            <button
              type="button"
              tabIndex={focused === null ? -1 : 0}
              onClick={() => roomRef.current?.unfocus()}
              className="h-11 rounded-full border border-divider px-5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Back<span className="hidden sm:inline"> to walking</span>
            </button>
            <button type="button" className="walk-button" aria-label="Next photo" tabIndex={focused === null ? -1 : 0} onClick={() => roomRef.current?.step(1)}>
              <Glyph d={RIGHT} />
            </button>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {focused !== null && photo ? `${label}. ${focused + 1} of ${photos.length}.` : ''}
      </p>

      {/* Like the grid: no download button anywhere. Hydrated only, so it never server-renders. */}
      <Lightbox photos={photos} index={index} open={open} onClose={close} onView={onView} />
    </div>
  );
}
