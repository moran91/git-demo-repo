import type { Combo, Product } from '@qareeb/shared';
import { StorageImage } from './StorageImage';

/** Photos of the combo's members, one per distinct product that has a picture, in combo order. */
export function comboMemberImages(combo: Pick<Combo, 'items'>, products: Product[]): string[] {
  const paths: string[] = [];
  for (const it of combo.items) {
    const p = products.find((x) => x.id === it.productId);
    if (p?.imagePath && !paths.includes(p.imagePath)) paths.push(p.imagePath);
  }
  return paths;
}

/**
 * The combo's picture: the generated promo image when one exists, otherwise a collage of the
 * member products' photos (up to four), and the branded placeholder only when none has a photo.
 * A generated promo image already carries the discount sticker, badge pill and title, so callers
 * overlay their own `deal-card__badge` only when `imagePath` is unset.
 */
export function ComboMedia({ combo, products, fallbackLabel, priority }: { combo: Pick<Combo, 'items' | 'imagePath'>; products: Product[]; fallbackLabel: string; priority?: boolean }) {
  if (combo.imagePath) return <StorageImage path={combo.imagePath} size="display" alt="" wide fallbackLabel={fallbackLabel} priority={priority} />;
  const paths = comboMemberImages(combo, products).slice(0, 4);
  if (paths.length === 0) return <StorageImage path={undefined} size="display" alt="" wide fallbackLabel={fallbackLabel} />;
  if (paths.length === 1) return <StorageImage path={paths[0]} size="display" alt="" wide fallbackLabel={fallbackLabel} priority={priority} />;
  return (
    <div className={`combo-collage combo-collage--${paths.length}`} role="img" aria-label={fallbackLabel}>
      {paths.map((p) => <StorageImage key={p} path={p} size="display" alt="" fallbackLabel={fallbackLabel} priority={priority} />)}
    </div>
  );
}
