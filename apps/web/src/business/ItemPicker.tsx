import { useMemo, useState, type ReactNode } from 'react';
import type { Category, Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Button, Dialog, TextInput } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { useDash } from './shell';
import { StorageImage } from '@/customer/StorageImage';

/**
 * Menu picker shared by combos (quantities + size variants) and promotions (a plain toggle per
 * product). `count` drives the badge on the add button; in `toggle` mode a selected product shows a
 * check instead of a counter and `onPick` is expected to toggle it.
 */
export function ItemPickerDialog({ products, categories, title, summary, count, pickedVariant, onPick, onVariant, withVariants, toggle, onClose }: {
  products: Product[];
  categories: Category[];
  title: string;
  summary?: ReactNode;
  count: (product: Product) => number;
  pickedVariant?: (product: Product) => string | undefined;
  onPick: (product: Product, variantId: string | undefined) => void;
  /** Size changed in the row's select (combos only). */
  onVariant?: (product: Product, variantId: string) => void;
  withVariants?: boolean;
  toggle?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { L, locale } = useI18n();
  const { business } = useDash();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const usedCategories = useMemo(() => categories.filter((c) => products.some((p) => p.categoryId === c.id)), [categories, products]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return products.filter((p) => (!cat || p.categoryId === cat) && (!n || Object.values(p.name).some((x) => x?.toLowerCase().includes(n))));
  }, [products, q, cat]);
  return (
    <Dialog open onClose={onClose} title={title} closeLabel={t('common.back')} footer={<><div className="picker-footer">{summary}</div><Button className="picker-done" onClick={onClose}>{t('deals.done')}</Button></>}>
      <div className="stack">
        <TextInput label={t('deals.searchMenu')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {usedCategories.length > 1 ? <div className="chips" role="group" aria-label={t('catalog.category')}>
          <button type="button" className="chip" aria-pressed={cat === null} onClick={() => setCat(null)}>{t('deals.allCategories')}</button>
          {usedCategories.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{L(c.name, business.defaultLocale)}</button>)}
        </div> : null}
        <div className="picker-list">
          {filtered.length === 0 ? <p className="muted">{t('deals.noMatches')}</p> : null}
          {filtered.map((p) => {
            const needsVariant = !!withVariants && p.variants.length > 0;
            const vid = needsVariant ? (pickedVariant?.(p) ?? p.variants.find((v) => v.available)?.id) : undefined;
            const n = count(p);
            const pname = L(p.name, business.defaultLocale);
            const price = needsVariant ? (p.variants.find((v) => v.id === vid)?.priceAgorot ?? p.priceAgorot) : p.priceAgorot;
            const selected = toggle && n > 0;
            return (
              <div key={p.id} className="picker-row">
                <StorageImage path={p.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} />
                <div className="picker-row__body">
                  <span className="picker-row__name">{pname} {p.pricingMode === 'unit' ? <span className="muted"><bdi>{money(price, locale)}</bdi></span> : null}</span>
                  {needsVariant ? <select className="select picker-row__variant" aria-label={t('deals.variant', { name: pname })} value={vid ?? ''} onChange={(e) => onVariant?.(p, e.target.value)}>{p.variants.filter((v) => v.available).map((v) => <option key={v.id} value={v.id}>{L(v.name, business.defaultLocale)}</option>)}</select> : null}
                </div>
                <button type="button" className={`btn--add ${selected ? 'btn--add--on' : ''}`} aria-pressed={toggle ? n > 0 : undefined} aria-label={`${selected ? t('common.remove') : t('common.add')}: ${pname}`} onClick={() => onPick(p, vid)}>
                  <Icon name={selected ? 'check' : 'plus'} size={22} />
                  {!toggle && n > 0 ? <span className="btn--add__count" aria-hidden="true">{n}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
