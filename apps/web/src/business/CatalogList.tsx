import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { Category, Localized, Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, orderBy, limit } from '@/lib/queries';
import { Button, Dialog, IconButton, Badge, EmptyState, Skeleton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { PageTitle, useDash } from './shell';
import { LoadError } from './BusinessExperience';
import { StorageImage } from '@/customer/StorageImage';
import { LocalizedInput } from './LocalizedInput';
import { ActionSheet, Switch, type SheetAction } from './CatalogControls';
import { CopyDialog, ProductEditor } from './CatalogPages';
import './catalog.css';
import './catalog-list.css';

const COLLAPSED_KEY = (branchId: string) => `qareeb.catalog.collapsed.${branchId}`;
function readCollapsed(branchId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY(branchId)) ?? '[]') as string[]); } catch { return new Set(); }
}
function writeCollapsed(branchId: string, ids: Set<string>) {
  try { localStorage.setItem(COLLAPSED_KEY(branchId), JSON.stringify([...ids])); } catch { /* per-viewer convenience only */ }
}

/** Catalog: one-line item rows (tap to edit, one availability switch), collapsible category cards, a
 *  sticky bar whose chips jump to a category and follow the scroll, and a reorder mode with drag handles. */
export function CatalogPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, branches, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const cats = useCollection<Category>(`${base}/categories`, [orderBy('sortOrder'), limit(200)], [branch.id]);
  const prods = useCollection<Product>(`${base}/products`, [orderBy('sortOrder'), limit(1000)], [branch.id]);
  const [catEdit, setCatEdit] = useState<{ id?: string; name: Localized } | null>(null);
  const [prodEdit, setProdEdit] = useState<{ product?: Product; categoryId: string } | null>(null);
  const [copyAll, setCopyAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(branch.id));
  const [active, setActive] = useState<string | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const chipRefs = useRef(new Map<string, HTMLElement>());
  // A tapped chip stays active while the smooth scroll runs, even when the page end stops it short.
  const spyPause = useRef(0);
  const term = search.trim().toLocaleLowerCase();
  const matches = (l: Localized) => Object.values(l).some((text) => text?.toLocaleLowerCase().includes(term));
  const name = (l: Localized) => L(l, business.defaultLocale);
  const fail = (e: unknown) => toast(t(errorKey(e)), 'danger');
  const grouped = useMemo(() => { const m = new Map<string, Product[]>(); for (const p of prods.data) { if (!m.has(p.categoryId)) m.set(p.categoryId, []); m.get(p.categoryId)!.push(p); } return m; }, [prods.data]);
  const liveCats = cats.data.filter((c) => !c.archived);
  const shownCats = cats.data.filter((c) => showArchived || !c.archived);
  const itemsOf = (c: Category) => (grouped.get(c.id) ?? []).filter((p) => (showArchived || !p.archived) && (!term || matches(c.name) || matches(p.name)));
  const visibleCats = shownCats.filter((c) => !term || matches(c.name) || itemsOf(c).length > 0);

  // Scroll spy: the active chip is the last section whose top has passed under the sticky bars.
  useEffect(() => {
    if (sorting) return;
    const onScroll = () => {
      if (performance.now() < spyPause.current) return;
      const line = 64 + 72;
      let current: string | null = null;
      for (const c of visibleCats) {
        const el = sectionRefs.current.get(c.id);
        if (el && el.getBoundingClientRect().top <= line) current = c.id;
      }
      setActive(current ?? visibleCats[0]?.id ?? null);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
  useEffect(() => { if (active) chipRefs.current.get(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active]);

  const toggle = (id: string) => setCollapsed((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); writeCollapsed(branch.id, next); return next; });
  const jump = (id: string, at: number) => {
    if (collapsed.has(id)) toggle(id);
    spyPause.current = at + 900;
    setActive(id);
    requestAnimationFrame(() => sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const saveCategory = async () => {
    if (!catEdit || !Object.values(catEdit.name).some((v) => v?.trim())) return toast(t('validation.atLeastOneLanguage'), 'danger');
    setBusy(true);
    try { await call('saveCategory', { businessId: business.id, branchId: branch.id, categoryId: catEdit.id, category: { name: catEdit.name } }); setCatEdit(null); toast(t('catalog.savedOk')); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  /** Save only availability so another editor's changes remain intact. */
  const setAvailable = async (p: Product, available: boolean) => {
    setPending((ids) => new Set(ids).add(p.id));
    try { await call('setProductAvailable', { businessId: business.id, branchId: branch.id, productId: p.id, available }); }
    catch (e) { fail(e); }
    finally { setPending((ids) => { const next = new Set(ids); next.delete(p.id); return next; }); }
  };
  const categoryActions = (c: Category): SheetAction[] => [
    { label: t('catalog.editCategory'), icon: 'edit', onSelect: () => setCatEdit({ id: c.id, name: c.name }) },
    { label: c.archived ? t('catalog.unarchive') : t('catalog.archive'), icon: c.archived ? 'refresh' : 'trash', danger: !c.archived, onSelect: () => void call('setCategoryArchived', { businessId: business.id, branchId: branch.id, categoryId: c.id, archived: !c.archived }).catch((e) => toast(e?.details?.issues?.[0]?.message === 'category_has_products' ? t('catalog.deleteCategoryBlocked') : t(errorKey(e)), 'danger')) },
  ];
  const priceLabel = (p: Product) => {
    if (!p.variants.length) return money(p.priceAgorot, locale);
    const prices = p.variants.map((v) => v.priceAgorot);
    const lo = Math.min(...prices); const hi = Math.max(...prices);
    return lo === hi ? money(lo, locale) : `${money(lo, locale)}–${money(hi, locale)}`;
  };

  if (!can('catalog')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  if (cats.error || prods.error) return <LoadError />;
  if (cats.loading || prods.loading) return <Skeleton height={260} />;

  if (sorting) {
    return <ReorderView categories={liveCats} archivedIds={cats.data.filter((c) => c.archived).map((c) => c.id)} grouped={grouped} name={name} onDone={() => setSorting(false)} />;
  }

  const closeSearch = () => { setSearch(''); setSearching(false); };
  return (
    <div className="stack catalog cat2">
      <PageTitle title={t('dash.catalog')}>
        <IconButton icon="sort" size={22} label={t('catalog.reorder')} disabled={liveCats.length === 0} onClick={() => { closeSearch(); setShowArchived(false); setSorting(true); }} />
        <Link className="btn--icon" to="extras" aria-label={t('catalog.library')} title={t('catalog.library')}><Icon name="layers" size={22} /></Link>
        <Button icon="plus" disabled={liveCats.length === 0} onClick={() => setProdEdit({ categoryId: (active && liveCats.find((c) => c.id === active)?.id) || liveCats[0]!.id })}>{t('catalog.newProduct')}</Button>
      </PageTitle>
      {cats.data.length > 0 ? (
        <div className={`cbar ${searching ? 'cbar--search' : ''}`}>
          {searching ? (
            <>
              <label htmlFor="catalog-search" className="visually-hidden">{t('owner.searchCatalog')}</label>
              <Icon name="search" size={22} className="icon cbar__search-icon" />
              <input id="catalog-search" type="search" className="input cbar__input" placeholder={t('owner.searchCatalog')} value={search} autoFocus onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }} />
              <IconButton icon="x" label={t('common.close')} onClick={closeSearch} />
            </>
          ) : (
            <>
              <IconButton icon="search" size={22} label={t('common.search')} className="cbar__search" onClick={() => setSearching(true)} />
              <nav className="cbar__chips" aria-label={t('catalog.category')}>
                {visibleCats.map((c) => (
                  <button key={c.id} ref={(el) => { if (el) chipRefs.current.set(c.id, el); else chipRefs.current.delete(c.id); }} type="button" className="cbar__chip" aria-current={active === c.id ? 'true' : undefined} onClick={(e) => jump(c.id, e.timeStamp)}>
                    {name(c.name)} <small>{itemsOf(c).length}</small>
                  </button>
                ))}
                <button type="button" className="cbar__chip cbar__chip--toggle" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>{t('catalog.archived')}</button>
              </nav>
            </>
          )}
        </div>
      ) : null}
      {liveCats.length === 0 && !showArchived ? <EmptyState icon="basket" title={t('catalog.noCategories')} body={t('owner.catalogStart')} action={<Button icon="plus" onClick={() => setCatEdit({ name: {} })}>{t('catalog.newCategory')}</Button>} /> : visibleCats.length === 0 ? <EmptyState title={t('owner.noMatches')} /> : null}
      <div className="cat2-list">
        {visibleCats.map((c) => {
          const items = itemsOf(c);
          const closed = collapsed.has(c.id) && !term;
          return (
            <section key={c.id} ref={(el) => { if (el) sectionRefs.current.set(c.id, el); else sectionRefs.current.delete(c.id); }} className={`csec ${closed ? 'csec--closed' : ''}`} aria-labelledby={`c-${c.id}`}>
              <div className="csec__head">
                <h2 id={`c-${c.id}`} className="csec__h">
                  <button type="button" className="csec__toggle" aria-expanded={!closed} aria-controls={`cl-${c.id}`} onClick={() => toggle(c.id)}>
                    <Icon name="chevronDown" size={22} className="icon csec__chev" />
                    <span className="csec__name">{name(c.name)}</span>
                    <span className="csec__count">{items.length}</span>
                    {c.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}
                  </button>
                </h2>
                <IconButton icon="plus" size={22} label={`${t('catalog.newProduct')}: ${name(c.name)}`} className="csec__add" disabled={c.archived} onClick={() => setProdEdit({ categoryId: c.id })} />
                <ActionSheet title={name(c.name)} actions={categoryActions(c)} />
              </div>
              {closed ? null : items.length === 0 ? <p className="muted csec__empty" id={`cl-${c.id}`}>{t('catalog.categoryEmpty')}</p> : (
                <ul className="csec__list" id={`cl-${c.id}`}>
                  {items.map((p) => (
                    <li key={p.id} className={`list__item--catalog irow ${p.available ? '' : 'irow--off'} ${p.archived ? 'irow--archived' : ''}`}>
                      <StorageImage path={p.imagePath} alt="" square className="irow__img" fallbackLabel={t('discovery.imageFallback')} />
                      <button type="button" className="irow__main" aria-label={`${t('common.edit')}: ${name(p.name)}`} onClick={() => setProdEdit({ product: p, categoryId: p.categoryId })}>
                        <span className="irow__name">{name(p.name)}</span>
                        <span className="irow__meta">
                          {p.mostOrdered ? <Icon name="star" size={14} className="icon irow__star" aria-label={t('product.mostOrdered')} role="img" /> : null}
                          <bdi className="irow__price">{priceLabel(p)}{p.pricingMode === 'weight' ? ` ${t('common.perKg')}` : ''}</bdi>
                          {p.variants.length ? <span>· {t(p.variants.length === 1 ? 'catalog.variantCount.one' : 'catalog.variantCount.other', { count: p.variants.length })}</span> : null}
                          {p.trackInventory ? <span>· {t('dash.stock')} <bdi>{p.variants.length ? p.variants.reduce((n, v) => n + (v.stockQty ?? 0), 0) : p.stockQty ?? 0}</bdi></span> : null}
                          {p.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}
                        </span>
                      </button>
                      <Switch checked={p.available} label={`${t('catalog.available')}: ${name(p.name)}`} busy={pending.has(p.id)} disabled={pending.has(p.id) || p.archived} onChange={(available) => void setAvailable(p, available)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {liveCats.length > 0 ? (
        <div className="catalog-foot">
          <Button variant="secondary" icon="plus" block onClick={() => setCatEdit({ name: {} })}>{t('catalog.newCategory')}</Button>
          {branches.length > 1 ? <Button variant="ghost" icon="copy" block onClick={() => setCopyAll(true)}>{t('catalog.copyTo')}</Button> : null}
        </div>
      ) : null}
      <Dialog open={!!catEdit} onClose={() => setCatEdit(null)} title={catEdit?.id ? t('catalog.editCategory') : t('catalog.newCategory')} footer={<><Button variant="secondary" onClick={() => setCatEdit(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={saveCategory}>{t('common.save')}</Button></>}>
        {catEdit ? <LocalizedInput tabbed label={t('common.name')} value={catEdit.name} required onChange={(n) => setCatEdit({ ...catEdit, name: n })} /> : null}
      </Dialog>
      {prodEdit ? <ProductEditor initial={prodEdit.product} categoryId={prodEdit.categoryId} categories={liveCats} onClose={() => setProdEdit(null)} /> : null}
      {copyAll ? <CopyDialog onClose={() => setCopyAll(false)} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

/** Local drag order for one list. The server order wins again as soon as a snapshot matches it. */
function useSortable(serverIds: string[], commit: (ids: string[]) => Promise<unknown>) {
  const [local, setLocal] = useState<string[] | null>(null);
  const serverKey = serverIds.join(',');
  const [dragging, setDragging] = useState<string | null>(null);
  // Once a snapshot carries the committed order, the local copy is no longer needed.
  if (local && !dragging && local.join(',') === serverKey) setLocal(null);
  const ids = local && local.length === serverIds.length && local.every((id) => serverIds.includes(id)) ? local : serverIds;
  const refs = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ id: string; pointerId: number; grabOffset: number; y: number; start: string; raf: number } | null>(null);
  const idsRef = useRef(ids);
  useLayoutEffect(() => { idsRef.current = ids; });

  const place = () => {
    const d = drag.current;
    if (!d) return;
    const el = refs.current.get(d.id);
    if (!el) return;
    el.style.transform = '';
    const natural = el.getBoundingClientRect().top;
    el.style.transform = `translateY(${d.y - d.grabOffset - natural}px)`;
  };
  useLayoutEffect(place);

  const settle = async () => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    const el = refs.current.get(d.id);
    if (el) el.style.transform = '';
    drag.current = null;
    setDragging(null);
    const next = idsRef.current;
    if (next.join(',') !== d.start) {
      setLocal(next);
      try { await commit(next); } catch (e) { setLocal(null); throw e; }
    }
  };
  const step = () => {
    const d = drag.current;
    if (!d) return;
    // Edge auto-scroll keeps a long list reachable while the finger is held still.
    const edge = 96;
    const bottomBar = 64 + 24;
    if (d.y < 64 + edge) window.scrollBy(0, -8);
    else if (d.y > window.innerHeight - bottomBar - edge / 2) window.scrollBy(0, 8);
    const list = idsRef.current;
    const i = list.indexOf(d.id);
    const el = refs.current.get(d.id);
    if (el && i >= 0) {
      const top = d.y - d.grabOffset;
      const center = top + el.offsetHeight / 2;
      const prev = list[i - 1] ? refs.current.get(list[i - 1]!) : undefined;
      const next = list[i + 1] ? refs.current.get(list[i + 1]!) : undefined;
      const mid = (n: HTMLElement) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
      if (prev && center < mid(prev)) { const nextIds = [...list]; [nextIds[i - 1], nextIds[i]] = [nextIds[i]!, nextIds[i - 1]!]; setLocal(nextIds); }
      else if (next && center > mid(next)) { const nextIds = [...list]; [nextIds[i + 1], nextIds[i]] = [nextIds[i]!, nextIds[i + 1]!]; setLocal(nextIds); }
      else place();
    }
    d.raf = requestAnimationFrame(step);
  };
  const handleProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag.current) return;
      const el = refs.current.get(id);
      if (!el) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id, pointerId: e.pointerId, grabOffset: e.clientY - el.getBoundingClientRect().top, y: e.clientY, start: idsRef.current.join(','), raf: 0 };
      setDragging(id);
      drag.current.raf = requestAnimationFrame(step);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => { if (drag.current?.pointerId === e.pointerId) drag.current.y = e.clientY; },
    onPointerUp: () => void settle().catch(() => undefined),
    onPointerCancel: () => void settle().catch(() => undefined),
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!dir) return;
      e.preventDefault();
      const list = [...idsRef.current];
      const i = list.indexOf(id); const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j]!, list[i]!];
      setLocal(list);
      void commit(list).catch(() => setLocal(null));
      requestAnimationFrame(() => (e.target as HTMLElement).focus());
    },
  });
  const itemRef = (id: string) => (el: HTMLElement | null) => { if (el) refs.current.set(id, el); else refs.current.delete(id); };
  return { ids, dragging, handleProps, itemRef };
}

function ReorderView({ categories, archivedIds, grouped, name, onDone }: { categories: Category[]; archivedIds: string[]; grouped: Map<string, Product[]>; name: (l: Localized) => string; onDone: () => void }) {
  const t = useT();
  const { business, branch } = useDash();
  const fail = (e: unknown) => { toast(t(errorKey(e)), 'danger'); throw e; };
  // Archived categories keep their places after the live ones so every sortOrder stays unique.
  const cats = useSortable(categories.map((c) => c.id), (ids) => call('reorderCategories', { businessId: business.id, branchId: branch.id, orderedIds: [...ids, ...archivedIds] }).catch(fail));
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (
    <div className="stack catalog cat2 cat2--sort">
      <div className="sort-bar">
        <h1>{t('catalog.reorderTitle')}</h1>
        <Button onClick={onDone}>{t('deals.done')}</Button>
      </div>
      <ul className="cat2-list">
        {cats.ids.map((id) => {
          const c = byId.get(id)!;
          return (
            <li key={id} ref={cats.itemRef(id)} className={`csec ${cats.dragging === id ? 'is-lifted' : ''}`}>
              <div className="csec__head">
                <button type="button" className="grip" aria-label={`${t('catalog.move')}: ${name(c.name)}`} {...cats.handleProps(id)}><Icon name="grip" size={22} /></button>
                <h2 className="csec__h csec__toggle"><span className="csec__name">{name(c.name)}</span><span className="csec__count">{(grouped.get(id) ?? []).filter((p) => !p.archived).length}</span></h2>
              </div>
              <SortableItems products={grouped.get(id) ?? []} name={name} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SortableItems({ products, name }: { products: Product[]; name: (l: Localized) => string }) {
  const t = useT();
  const { business, branch } = useDash();
  const live = products.filter((p) => !p.archived);
  const archived = products.filter((p) => p.archived).map((p) => p.id);
  const list = useSortable(live.map((p) => p.id), (ids) => call('reorderProducts', { businessId: business.id, branchId: branch.id, orderedIds: [...ids, ...archived] }).catch((e) => { toast(t(errorKey(e)), 'danger'); throw e; }));
  const byId = new Map(live.map((p) => [p.id, p]));
  if (!live.length) return null;
  return (
    <ul className="csec__list">
      {list.ids.map((id) => {
        const p = byId.get(id)!;
        return (
          <li key={id} ref={list.itemRef(id)} className={`irow ${list.dragging === id ? 'is-lifted' : ''}`}>
            <button type="button" className="grip" aria-label={`${t('catalog.move')}: ${name(p.name)}`} {...list.handleProps(id)}><Icon name="grip" size={22} /></button>
            <StorageImage path={p.imagePath} alt="" square className="irow__img" fallbackLabel={t('discovery.imageFallback')} />
            <span className="irow__name">{name(p.name)}</span>
          </li>
        );
      })}
    </ul>
  );
}
