import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  /** ThumbHash data URL shown behind the image until it has loaded. */
  placeholder?: string | null;
}

/**
 * An <img> that fades in over its ThumbHash. The placeholder is a background on a wrapper span so the
 * image can start fully transparent; images already complete at hydration are shown at once.
 */
export default function TileImage({ placeholder, className, style, onLoad, ...img }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
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
        ref={ref}
        {...img}
        draggable={false}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        className="tile-img"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </span>
  );
}
