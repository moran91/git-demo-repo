import { useEffect, useState } from 'react';
import { imageUrl } from '@/lib/images';
import { Icon } from '@/design/Icon';

/** Image with a quiet branded fallback; never implies an illustrative image depicts a real business. */
export function StorageImage({ path, alt, size = 'thumb', square, wide, fallbackLabel, className = '' }: { path?: string | null; alt: string; size?: 'thumb' | 'display'; square?: boolean; wide?: boolean; fallbackLabel: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    const p = imageUrl(path, size);
    if (!p) return;
    p.then((u) => alive && setUrl(u)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path, size]);
  const shape = square ? 'img-frame--square' : wide ? 'img-frame--wide' : '';
  if (!path || failed) {
    return (
      <div className={`img-frame ${shape} ${className}`} role="img" aria-label={fallbackLabel}>
        <Icon name="image" size={28} />
      </div>
    );
  }
  return (
    <div className={`img-frame ${shape} ${className}`}>
      {url ? <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} /> : <div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} aria-hidden="true" />}
    </div>
  );
}
