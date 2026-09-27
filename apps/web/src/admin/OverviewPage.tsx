import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toLocal } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { money } from '@/lib/format';
import { Alert, Skeleton } from '@/design/components';

interface Daily { date: string; placedCount?: number; placedValueAgorot?: number; acceptedValueAgorot?: number; cashRecordedAgorot?: number }
/** A number is null when its query failed on the server (e.g. a missing index); the rest still show. */
type N = number | null;
interface Metrics {
  last30Days: { placedCount: N; placedValueAgorot: N; acceptedCount: N; acceptedValueAgorot: N; cashRecordsCount: N; cashRecordedAgorot: N };
  pendingBusinessApprovals: N;
  pendingBranchApprovals?: N;
  agingPlacedOrders: N;
  totalUsers: N;
  approvedBusinesses: N;
  daily: Daily[];
}

const num = (v: N | undefined) => (v === null || v === undefined ? '—' : String(v));

const dayLabel = (date: string) => date.split('-').reverse().slice(0, 2).join('.');
const ordersText = (t: ReturnType<typeof useT>, count: number) => (count === 1 ? t('admin.metrics.oneOrder') : t('admin.metrics.ordersCount', { count }));

export function OverviewPage() {
  const t = useT();
  const { locale } = useI18n();
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { call<Metrics>('getAdminMetrics', {}).then(setM).catch((e) => setError(t(errorKey(e)))); }, [t]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!m) return <div className="stack" aria-busy="true"><Skeleton height={40} width={200} /><div className="metrics">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={96} radius={16} />)}</div></div>;
  const d = m.last30Days;
  const approvals = m.pendingBusinessApprovals === null && m.pendingBranchApprovals === null ? null : (m.pendingBusinessApprovals ?? 0) + (m.pendingBranchApprovals ?? 0);
  const rate = d.placedCount && d.acceptedCount !== null ? Math.round((d.acceptedCount / d.placedCount) * 100) : null;
  const cash = (v: N) => (v === null ? '—' : money(v, locale));
  return (
    <div className="stack">
      <h1>{t('admin.overview')}</h1>
      <div className="metrics">
        <Link to="/admin/approvals" className={`metric metric--link${approvals ? ' metric--accent' : ''}`}><span className="metric__value num">{num(approvals)}</span><span className="metric__label">{t('admin.metrics.pendingApprovals')}</span></Link>
        <Link to="/admin/orders?filter=placed" className={`metric metric--link${m.agingPlacedOrders ? ' metric--danger' : ''}`}><span className="metric__value num">{num(m.agingPlacedOrders)}</span><span className="metric__label">{t('admin.metrics.agingOrders')}</span></Link>
        <Link to="/admin/businesses" className="metric metric--link"><span className="metric__value num">{num(m.approvedBusinesses)}</span><span className="metric__label">{t('admin.metrics.approvedBusinesses')}</span></Link>
        <Link to="/admin/users" className="metric metric--link"><span className="metric__value num">{num(m.totalUsers)}</span><span className="metric__label">{t('admin.users')}</span></Link>
      </div>
      <h2>{t('admin.metrics.last30')}</h2>
      <Alert tone="info">{t('admin.metrics.note')}</Alert>
      <div className="metrics metrics--3">
        <div className="metric"><span className="metric__value num">{num(d.placedCount)}</span><span className="metric__label">{t('admin.metrics.placedCount')}</span><span className="metric__sub"><bdi className="money">{cash(d.placedValueAgorot)}</bdi></span></div>
        <div className="metric"><span className="metric__value"><bdi className="money">{cash(d.acceptedValueAgorot)}</bdi></span><span className="metric__label">{t('admin.metrics.acceptedValue')}</span><span className="metric__sub">{d.acceptedCount === null ? '—' : ordersText(t, d.acceptedCount)}{rate === null ? null : <> · {t('admin.metrics.acceptanceRate', { rate })}</>}</span></div>
        <div className="metric"><span className="metric__value"><bdi className="money">{cash(d.cashRecordedAgorot)}</bdi></span><span className="metric__label">{t('admin.metrics.cashRecorded')}</span><span className="metric__sub">{d.cashRecordsCount === null ? '—' : ordersText(t, d.cashRecordsCount)}</span></div>
      </div>
      <DailyChart daily={m.daily} />
    </div>
  );
}

/** Orders per day for the last 30 Israeli calendar days, quiet days included, with the numbers behind it. */
function DailyChart({ daily }: { daily: Daily[] }) {
  const t = useT();
  const { locale } = useI18n();
  const byDate = new Map(daily.map((x) => [x.date, x]));
  const [dates] = useState(() => { const now = Date.now(); return [...new Set(Array.from({ length: 30 }, (_, i) => toLocal(new Date(now - (29 - i) * 86400000)).date))]; });
  const days = dates.map((date) => ({ date, count: byDate.get(date)?.placedCount ?? 0, value: byDate.get(date)?.placedValueAgorot ?? 0, accepted: byDate.get(date)?.acceptedValueAgorot ?? 0, cash: byDate.get(date)?.cashRecordedAgorot ?? 0 }));
  const max = Math.max(1, ...days.map((x) => x.count));
  const [active, setActive] = useState<number | null>(null);
  const shown = days[active ?? days.length - 1]!;
  const total = days.reduce((s, x) => s + x.count, 0);
  const describe = (x: typeof shown) => t('admin.metrics.chartLabel', { date: dayLabel(x.date), orders: ordersText(t, x.count), value: money(x.value, locale) });
  return (
    <section className="card stack achart" aria-labelledby="achart-title">
      <div className="achart__head">
        <h2 id="achart-title">{t('admin.metrics.perDay')}</h2>
        <span className="achart__readout" aria-live="polite"><bdi>{describe(shown)}</bdi></span>
      </div>
      <div className="achart__plot" role="img" aria-label={`${t('admin.metrics.perDay')}: ${ordersText(t, total)}`} onPointerLeave={() => setActive(null)}>
        <span className="achart__max" aria-hidden="true">{max}</span>
        {days.map((x, i) => (
          <span key={x.date} className={`achart__col${active === i ? ' is-active' : ''}`} onPointerEnter={() => setActive(i)} title={describe(x)}>
            <span className={`achart__bar${x.count ? '' : ' achart__bar--zero'}`} style={x.count ? { height: `${(x.count / max) * 100}%` } : undefined} />
          </span>
        ))}
      </div>
      <div className="achart__axis" aria-hidden="true"><bdi>{dayLabel(days[0]!.date)}</bdi><bdi>{dayLabel(days[days.length - 1]!.date)}</bdi></div>
      <details className="achart__table">
        <summary>{t('admin.details')}</summary>
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('admin.metrics.placedCount')}</th><th>{t('admin.metrics.placedValue')}</th><th>{t('admin.metrics.acceptedValue')}</th><th>{t('admin.metrics.cashRecorded')}</th></tr></thead><tbody>{[...days].reverse().filter((x) => x.count || x.cash).map((x) => <tr key={x.date}><td><bdi>{x.date.split('-').reverse().join('.')}</bdi></td><td className="num">{x.count}</td><td><bdi className="money">{money(x.value, locale)}</bdi></td><td><bdi className="money">{money(x.accepted, locale)}</bdi></td><td><bdi className="money">{money(x.cash, locale)}</bdi></td></tr>)}</tbody></table></div>
      </details>
    </section>
  );
}
