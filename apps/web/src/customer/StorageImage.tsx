import { useMemo, useState } from 'react';
import { imageSources, noteVariantMissing, type ImageSize } from '@/lib/images';
import { Icon } from '@/design/Icon';

/**
 * Image with a quiet branded fallback; never implies an illustrative image depicts a real business.
 *
 * The URL is computed synchronously (see `imageSources`), so the `<img>` is in the first render and
 * the browser fetches it immediately. A missing compressed variant surfaces as an `error` event; the
 * element then retries with the original, and only a failure of that shows the placeholder.
 */
export function StorageImage({ path, alt, size = 'thumb', square, wide, fallbackLabel, className = '', onClick, zoomLabel, priority }: { path?: string | null; alt: string; size?: ImageSize; square?: boolean; wide?: boolean; fallbackLabel: string; className?: string; /** Makes the frame a button (used to open the enlarged photo). Ignored when there is no image. */ onClick?: () => void; zoomLabel?: string; /** Above-the-fold hero: eager + high fetch priority instead of lazy. */ priority?: boolean }) {
  const sources = useMemo(() => imageSources(path, size), [path, size]);
  // Keyed by the variant URL so a new path resets the fallback state without an effect.
  const [state, setState] = useState<{ key: string; src: string; failed: boolean }>({ key: '', src: '', failed: false });
  const current = sources && state.key === sources.src ? state : sources ? { key: sources.src, src: sources.src, failed: false } : null;

  const onError = () => {
    if (!sources || !current) return;
    if (current.src === sources.src && sources.fallback) {
      noteVariantMissing(sources.src);
      setState({ key: sources.src, src: sources.fallback, failed: false });
    } else {
      setState({ key: sources.src, src: current.src, failed: true });
    }
  };

  const shape = square ? 'img-frame--square' : wide ? 'img-frame--wide' : '';
  if (!sources || !current || current.failed) {
    return (
      <div className={`img-frame ${shape} ${className}`} role="img" aria-label={fallbackLabel}>
        <Icon name="image" size={28} />
      </div>
    );
  }
  const body = <img src={current.src} alt={alt} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : 'auto'} onError={onError} />;
  if (onClick) {
    return (
      <button type="button" className={`img-frame img-frame--zoomable ${shape} ${className}`} onClick={onClick} aria-label={zoomLabel ?? alt}>
        {body}
      </button>
    );
  }
  return <div className={`img-frame ${shape} ${className}`}>{body}</div>;
}
