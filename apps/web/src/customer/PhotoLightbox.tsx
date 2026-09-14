import { useEffect, useRef, useState } from 'react';
import { imageSources, noteVariantMissing } from '@/lib/images';
import { useT } from '@/lib/i18n';
import { IconButton } from '@/design/components';

/**
 * Full-screen view of a product photo. Uses the `display` variant (the thumb is 96px and looks
 * blurry when stretched). A native <dialog> opened with showModal so it lands in the top layer
 * ABOVE the product sheet (which is itself a modal dialog) — a plain fixed overlay is hidden
 * behind it no matter the z-index. A tap anywhere outside the image closes it.
 */
export function PhotoLightbox({ path, alt, onClose }: { path: string; alt: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const sources = imageSources(path, 'display')!;
  const [src, setSrc] = useState(sources.src);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener('cancel', onCancel);
    return () => {
      d?.removeEventListener('cancel', onCancel);
      if (d?.open) d.close();
    };
  }, [path, onClose]);
  return (
    <dialog ref={ref} className="lightbox" aria-label={alt} onClick={onClose}>
      <div className="lightbox__close"><IconButton icon="x" label={t('common.close')} onClick={onClose} /></div>
      {!loaded ? <div className="skeleton" style={{ width: 240, height: 240 }} aria-busy="true" /> : null}
      <img
        className="lightbox__img"
        src={src}
        alt={alt}
        decoding="async"
        style={loaded ? undefined : { display: 'none' }}
        onLoad={() => setLoaded(true)}
        onClick={(e) => e.stopPropagation()}
        onError={() => {
          if (src === sources.src && sources.fallback) {
            noteVariantMissing(sources.src);
            setSrc(sources.fallback);
          } else onClose();
        }}
      />
    </dialog>
  );
}
