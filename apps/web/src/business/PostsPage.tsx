import { useEffect, useMemo, useState } from 'react';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { MAX_LIVE_POSTS, makeId, type BranchPost, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { storage } from '@/lib/firebase';
import { call, ApiError } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload, type PreparedImage } from '@/lib/images';
import { Alert, Button, ConfirmDialog, EmptyState, IconButton, Select, TextArea, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { StorageImage } from '@/customer/StorageImage';
import { useNow } from '@/customer/hooks';
import { PageTitle, useDash } from './shell';
import { LoadError } from './BusinessExperience';
import './settings.css';
import './posts.css';

/**
 * Stories: photos the branch shares for 24 hours in the story circles on the customers' home page. Publishing is one
 * step for the owner (photo, optional caption, optional dish); the server stamps the expiry, and
 * the post disappears by itself.
 */
export function PostsPage() {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const allowed = can('catalog');
  // The query bound is fixed at mount; `useNow` below hides posts that expire while the page is open.
  const [since] = useState(() => new Date().toISOString());
  const posts = useCollection<BranchPost>(allowed ? `${base}/posts` : null, [where('expiresAt', '>', since), orderBy('expiresAt', 'desc'), limit(MAX_LIVE_POSTS * 2)], [branch.id]);
  const products = useCollection<Product>(allowed ? `${base}/products` : null, [where('archived', '==', false), limit(500)], [branch.id]);
  const now = useNow(30000);
  const [remove, setRemove] = useState<BranchPost | null>(null);
  const [removing, setRemoving] = useState(false);

  if (!allowed) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  if (posts.error || products.error) return <LoadError />;
  const live = posts.data.filter((p) => new Date(p.expiresAt).getTime() > now.getTime());
  const productName = (id?: string) => {
    const p = id ? products.data.find((x) => x.id === id) : undefined;
    return p ? L(p.name, business.defaultLocale) : null;
  };

  return (
    <div className="sx-page">
      <PageTitle title={t('posts.manage')} />
      <Composer products={products.data} full={live.length >= MAX_LIVE_POSTS} />

      <section className="sx-section" aria-labelledby="posts-live-h">
        <div className="sx-section__head"><div><h2 id="posts-live-h">{t('posts.live')}</h2></div></div>
        {live.length === 0 && !posts.loading ? <p className="muted">{t('posts.empty')}</p> : null}
        <div className="px-grid">
          {live.map((p) => {
            const left = Math.max(0, new Date(p.expiresAt).getTime() - now.getTime());
            const hours = Math.floor(left / 3600000);
            const caption = L(p.caption, business.defaultLocale);
            const dish = productName(p.productId);
            return (
              <article key={p.id} className="px-post" aria-label={caption || t('stories.label')}>
                <StorageImage path={p.imagePath} alt={caption} square className="px-post__img" fallbackLabel={t('discovery.imageFallback')} />
                <div className="px-post__body">
                  <span className="px-post__left"><Icon name="clock" size={14} /> {hours >= 1 ? t('posts.hoursLeft', { count: hours }) : t('posts.minutesLeft', { count: Math.max(1, Math.ceil(left / 60000)) })}</span>
                  {caption ? <p className="px-post__caption">{caption}</p> : null}
                  {dish ? <span className="px-post__dish"><Icon name="utensils" size={14} /> {dish}</span> : null}
                </div>
                <IconButton icon="trash" label={t('posts.delete')} onClick={() => setRemove(p)} />
              </article>
            );
          })}
        </div>
      </section>

      <ConfirmDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        danger
        loading={removing}
        title={t('posts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          const p = remove!;
          setRemoving(true);
          try {
            await call('removePost', { businessId: business.id, branchId: branch.id, postId: p.id });
            toast(t('posts.deleted'));
            setRemove(null);
          } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setRemoving(false); }
        }}
      />
    </div>
  );
}

function Composer({ products, full }: { products: Product[]; full: boolean }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [caption, setCaption] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (image ? URL.createObjectURL(image.blob) : null), [image]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const sorted = useMemo(() => [...products].sort((a, b) => L(a.name, business.defaultLocale).localeCompare(L(b.name, business.defaultLocale))), [products, L, business.defaultLocale]);

  const pick = async (file: File) => {
    setError(null);
    try { setImage(await prepareImageUpload(file)); } catch (e) { setError(t(uploadErrorKey(e))); }
  };

  const publish = async () => {
    if (!image) { setError(t('posts.photoRequired')); return; }
    setBusy(true);
    setError(null);
    try {
      // The post id comes from here so the photo can sit under it before the post exists.
      const postId = makeId(20);
      const path = `businesses/${business.id}/branches/${branch.id}/posts/${postId}/${makeId(10)}.${image.ext}`;
      await uploadBytes(sref(storage, path), image.blob, { contentType: image.contentType });
      const text = caption.trim();
      await recordUpload(path, () => call('publishPost', {
        businessId: business.id,
        branchId: branch.id,
        postId,
        path,
        caption: text ? { [business.defaultLocale]: text } : {},
        ...(productId ? { productId } : {}),
      }));
      toast(t('posts.published'));
      setImage(null);
      setCaption('');
      setProductId('');
    } catch (e) {
      const issue = e instanceof ApiError ? (e.details.issues as Array<{ message?: string }> | undefined)?.[0]?.message : undefined;
      setError(issue === 'too_many_posts' ? t('posts.limit', { max: MAX_LIVE_POSTS }) : t(e instanceof ApiError ? errorKey(e) : uploadErrorKey(e)));
    } finally { setBusy(false); }
  };

  return (
    <section className="sx-card px-compose" aria-labelledby="posts-new-h">
      <h2 id="posts-new-h" className="px-compose__title">{t('posts.new')}</h2>
      <div className="px-compose__row">
        <label className={`px-photo ${preview ? 'px-photo--set' : ''} ${busy ? 'is-busy' : ''}`}>
          {preview ? <img src={preview} alt="" /> : <span className="px-photo__empty"><Icon name="image" size={28} /><span>{t('posts.pickPhoto')}</span></span>}
          {preview ? <span className="px-photo__change">{t('posts.changePhoto')}</span> : null}
          <input type="file" accept={UPLOAD_ACCEPT} className="visually-hidden" disabled={busy} aria-label={preview ? t('posts.changePhoto') : t('posts.pickPhoto')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
        </label>
        <div className="px-compose__fields">
          <TextArea label={t('posts.caption')} optional value={caption} maxLength={300} rows={3} onChange={(e) => setCaption(e.target.value)} lang={business.defaultLocale} />
          <Select label={t('posts.linkDish')} optional value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{t('posts.noDish')}</option>
            {sorted.map((p) => <option key={p.id} value={p.id}>{L(p.name, business.defaultLocale)}</option>)}
          </Select>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {full ? <Alert tone="info">{t('posts.limit', { max: MAX_LIVE_POSTS })}</Alert> : null}
      <div><Button icon="clock" onClick={() => void publish()} disabled={busy || !image || full} aria-busy={busy || undefined}>{t('posts.publish')}</Button></div>
    </section>
  );
}
