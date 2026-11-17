import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  /** ThumbHash data URL shown behind the image until it has loaded. */
  placeholder?: string | null;
}

/** Waits before each new attempt after a failed load (a cold derivative can 503 while it's first rendered). */
const RETRY_DELAYS_MS = [1000, 3000, 9000];

/**
 * An <img> that fades in over its ThumbHash. The placeholder is a background on a wrapper span so the
 * image can start fully transparent; images already complete at hydration are shown at once. A failed
 * load is retried a few times by re-creating the <img>; until one succeeds the tile shows the placeholder.
 */
export default function TileImage({ placeholder, className, style, onLoad, onError, ...img }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | undefined>(undefined);

  const scheduleRetry = (failedAttempt: number) => {
    const delay = RETRY_DELAYS_MS[failedAttempt];
    if (delay === undefined || retryTimer.current !== undefined) return;
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = undefined;
      setAttempt(failedAttempt + 1);
    }, delay);
  };

  useEffect(() => {
    // The server-rendered <img> may have finished before React attached its listeners: complete with no
    // pixels means it failed.
    const el = ref.current;
    if (el?.complete && el.getAttribute('src')) {
      if (el.naturalWidth > 0) setLoaded(true);
      else scheduleRetry(0);
    }
    return () => window.clearTimeout(retryTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      className={className}
      style={{
        ...style,
        display: 'block',
        overflow: 'hidden',
        backgroundColor: 'var(--color-surface)',
        backgroundImage: placeholder ? `url(${placeholder})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <img
        // A new element per attempt: the browser fetches again instead of keeping the broken result.
        key={attempt}
        {...img}
        // After the spread: react-photo-album's render.image props carry `ref: null`, which would replace ours.
        ref={ref}
        draggable={false}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        onError={(e) => {
          scheduleRetry(attempt);
          onError?.(e);
        }}
        className="tile-img"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </span>
  );
}
