import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { BRAND, businessQrUrl, storefrontPath } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Alert, Button, EmptyState, Segmented, Skeleton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { PageTitle, useDash } from './shell';
import './settings.css';

type Scope = 'business' | 'branch';

/** Public site origin the code must point at; overridable so a staging build can print production codes. */
const PUBLIC_ORIGIN = ((import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) || window.location.origin).replace(/\/+$/, '');

/**
 * Owner-facing QR generator. The code encodes the shared `/q/…` deep link (see
 * `packages/shared/src/links.ts`), so the same printed sticker keeps working when the Android / iOS
 * apps ship and claim that path. Generation is client-side: nothing is stored, and the page works
 * offline once loaded. Error-correction level M with a quiet zone of 2 modules is the usual
 * trade-off for a sticker that will be photographed through glass.
 */
export function QrPage() {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, branches, can } = useDash();
  const [scope, setScope] = useState<Scope>(branches.length > 1 ? 'branch' : 'business');
  // Keyed by url so a scope change shows the skeleton again without a synchronous reset in the effect.
  const [gen, setGen] = useState<{ url: string; svg: string | null; failed: boolean }>({ url: '', svg: null, failed: false });
  const [printing, setPrinting] = useState(false);
  const target = useMemo(() => (scope === 'branch' ? { businessId: business.id, branchId: branch.id } : { businessId: business.id }), [scope, business.id, branch.id]);
  const url = businessQrUrl(PUBLIC_ORIGIN, target);
  const name = L(business.name, business.defaultLocale);
  const branchName = L(branch.name, business.defaultLocale);
  const fileBase = `${BRAND.wordmark}-qr-${business.id}${scope === 'branch' ? `-${branch.id}` : ''}`;

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then((s) => { if (alive) setGen({ url, svg: s, failed: false }); })
      .catch(() => { if (alive) setGen({ url, svg: null, failed: true }); });
    return () => { alive = false; };
  }, [url]);
  const svg = gen.url === url ? gen.svg : null;
  const failed = gen.url === url && gen.failed;

  const svgDataUrl = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;

  const download = (href: string, filename: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const downloadPng = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 });
      download(dataUrl, `${fileBase}.png`);
    } catch {
      toast(t('qr.generateError'), 'danger');
    }
  };
  const downloadSvg = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    download(href, `${fileBase}.svg`);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('qr.copied'));
    } catch {
      toast(t('common.errorGeneric'), 'danger');
    }
  };

  if (!can('settings')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="sx-page">
      <PageTitle title={t('qr.title')} />
      <p className="sx-card__sub">{t('qr.intro')}</p>
      {business.approval !== 'approved' ? <Alert tone="warn">{t('qr.notApproved')}</Alert> : scope === 'branch' && branch.approval !== 'approved' ? <Alert tone="warn">{t('qr.branchNotApproved')}</Alert> : null}
      <div className="sx-qr">
        <div className="sx-qr__code" aria-busy={!svg && !failed ? true : undefined}>
          {svgDataUrl ? <img src={svgDataUrl} alt={t('qr.title')} width={512} height={512} /> : failed ? <EmptyState icon="alert" title={t('qr.generateError')} /> : <Skeleton height={280} radius={12} />}
        </div>
        <div className="sx-page">
          {branches.length > 1 ? (
            <section className="sx-card">
              <h2 className="sx-card__title">{t('qr.scope')}</h2>
              <Segmented stacked label={t('qr.scope')} value={scope} onChange={setScope} options={[{ value: 'branch', label: t('qr.scopeBranch'), icon: 'building' }, { value: 'business', label: t('qr.scopeBusiness'), icon: 'store' }]} />
              <p className="sx-card__sub">{scope === 'branch' ? t('qr.scopeBranchHint') : t('qr.scopeBusinessHint')}</p>
            </section>
          ) : null}
          <section className="sx-card">
            <h2 className="sx-card__title">{t('qr.link')}</h2>
            <code className="sx-url" dir="ltr"><bdi>{url}</bdi></code>
            <div className="sx-actions">
              <Button icon="printer" disabled={!svg} onClick={() => setPrinting(true)}>{t('qr.print')}</Button>
              <Button variant="secondary" icon="copy" onClick={() => void copy()}>{t('qr.copyLink')}</Button>
              <Button variant="secondary" icon="download" disabled={!svg} onClick={() => void downloadPng()}>{t('qr.downloadPng')}</Button>
              <Button variant="secondary" icon="download" disabled={!svg} onClick={downloadSvg}>{t('qr.downloadSvg')}</Button>
              <a className="btn btn--ghost" href={storefrontPath(target)} target="_blank" rel="noreferrer"><Icon name="external" size={18} /> {t('qr.open')}</a>
            </div>
          </section>
        </div>
      </div>
      {printing && svgDataUrl ? <PosterPrint src={svgDataUrl} name={name} branchName={scope === 'branch' && branches.length > 1 ? branchName : null} url={url} onDone={() => setPrinting(false)} /> : null}
    </div>
  );
}

/** A4/Letter poster for the OS print dialog. Mounted under #root so the receipt print rules apply. */
function PosterPrint({ src, name, branchName, url, onDone }: { src: string; name: string; branchName: string | null; url: string; onDone: () => void }) {
  const t = useT();
  useEffect(() => {
    window.addEventListener('afterprint', onDone, { once: true });
    const id = setTimeout(() => window.print(), 80);
    return () => {
      clearTimeout(id);
      window.removeEventListener('afterprint', onDone);
    };
  }, [onDone]);
  const root = document.getElementById('root');
  if (!root) return null;
  return createPortal(
    <div className="qr-print">
      <h1 className="wrap-anywhere">{name}</h1>
      {branchName ? <p className="qr-print__branch wrap-anywhere">{branchName}</p> : null}
      <p className="qr-print__scan">{t('qr.posterScan')}</p>
      <img src={src} alt="" />
      <p className="qr-print__url" dir="ltr">{url}</p>
      <p className="qr-print__brand">{t('qr.posterPowered', { brand: BRAND.name })}</p>
    </div>,
    root,
  );
}
