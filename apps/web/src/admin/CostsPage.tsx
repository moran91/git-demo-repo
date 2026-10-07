import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, limit as fbLimit, onSnapshot, orderBy as fbOrderBy, query, where } from 'firebase/firestore';
import { DEFAULT_AI_CAP_MICRO_USD, TRANSLATE_FREE_CHARS, dayTotal, hourTotal, israelDay, israelHour, projectEndOfDay, projectMonth, type PlatformConfig, type SpendDay } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { db } from '@/lib/firebase';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { Badge, Button, Skeleton, TextInput, toast } from '@/design/components';

/** Rough shekel equivalent beside dollars: the rate qareeb-dev's billing account used in October 2026. */
const ILS_PER_USD = 3.07;
const MODEL_NAMES: Record<string, string> = { 'claude-haiku-4-5@20251001': 'Claude Haiku 4.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'gemini-2.5-flash': 'Gemini 2.5 Flash', 'gemini-3-flash-preview': 'Gemini 3 Flash', stub: 'Stub (emulator)' };

const usd = (micro: number, digits = 2) => `$${(micro / 1_000_000).toFixed(digits)}`;
const ils = (micro: number) => `≈ ₪${((micro / 1_000_000) * ILS_PER_USD).toFixed(2)}`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

type Day = SpendDay & { id: string };

/** Live: today's ledger doc, the last 30 days, the month's translation total and the cap. */
function useSpend() {
  const [state, setState] = useState<{ today: Day | null; days: Day[]; monthChars: number; cap: number; at: Date | null; error: boolean; loading: boolean }>({ today: null, days: [], monthChars: 0, cap: DEFAULT_AI_CAP_MICRO_USD, at: null, error: false, loading: true });
  const todayId = israelDay(new Date());
  useEffect(() => {
    const fail = () => setState((s) => ({ ...s, error: true, loading: false }));
    const offs = [
      onSnapshot(doc(db, `spendDaily/${todayId}`), (s) => setState((p) => ({ ...p, today: s.exists() ? ({ ...(s.data() as SpendDay), id: s.id }) : null, at: new Date(), loading: false })), fail),
      // Ids are Israeli dates, so a key range is a date range (descending key scans are unsupported).
      onSnapshot(query(collection(db, 'spendDaily'), where(documentId(), '>=', israelDay(new Date(Date.now() - 31 * 86_400_000))), fbOrderBy(documentId()), fbLimit(32)), (s) => setState((p) => ({ ...p, days: s.docs.map((d) => ({ ...(d.data() as SpendDay), id: d.id })).reverse(), at: new Date() })), fail),
      onSnapshot(doc(db, `spendMonthly/${todayId.slice(0, 7)}`), (s) => setState((p) => ({ ...p, monthChars: (s.data()?.translateChars as number | undefined) ?? 0 })), fail),
      onSnapshot(doc(db, 'config/platform'), (s) => { const c = s.data() as PlatformConfig | undefined; setState((p) => ({ ...p, cap: typeof c?.aiDailyCapMicroUsd === 'number' ? c.aiDailyCapMicroUsd : DEFAULT_AI_CAP_MICRO_USD })); }, fail),
    ];
    return () => offs.forEach((o) => o());
  }, [todayId]);
  return { ...state, todayId };
}

/**
 * What the AI and menu translation cost, live: today against the daily cap with an end-of-day
 * projection, by hour, where the money went, how wishes were answered, the last 30 days, and the cap.
 */
export function CostsPage() {
  const t = useT();
  const { locale } = useI18n();
  const s = useSpend();
  const [capInput, setCapInput] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const now = new Date();
  const hourNow = Number(israelHour(now));

  const previous7 = useMemo(() => s.days.filter((d) => d.id < s.todayId).slice(0, 7), [s.days, s.todayId]);
  if (s.loading) return <div className="stack" aria-busy="true"><Skeleton height={36} width="30%" /><Skeleton height={220} radius={16} /><Skeleton height={220} radius={16} /></div>;
  if (s.error) return <div className="stack"><h1>{t('admin.costs')}</h1><p className="muted">{t('common.errorGeneric')}</p></div>;

  const today = s.today;
  const spent = dayTotal(today);
  const aiSpent = today?.ai?.microUsd ?? 0;
  const expected = projectEndOfDay(today, previous7, hourNow);
  const scale = Math.max(s.cap, expected, spent, 1);
  const ai = today?.ai;
  const calls = ai?.calls ?? 0;
  const ok = ai?.ok ?? 0;
  const fallback = { timeout: 0, invalid: 0, error: 0, capped: 0, ...(ai?.fallback ?? {}) };
  const aiCalled = ok + fallback.timeout + fallback.invalid + fallback.error;
  const models = Object.entries(ai?.byModel ?? {}).sort((a, b) => b[1].calls - a[1].calls);
  const monthDays = s.days.map((d) => ({ id: d.id, total: dayTotal(d) }));
  const month = projectMonth(monthDays, now);
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const hourMax = Math.max(1, ...hours.map((h) => hourTotal(today?.byHour?.[h])));
  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86_400_000);
    const id = israelDay(d);
    const day = s.days.find((x) => x.id === id);
    return { id, total: dayTotal(day), ai: day?.ai?.microUsd ?? 0 };
  });
  const dayMax = Math.max(s.cap, 1, ...last30.map((d) => d.total));
  const hovered = hover ? last30.find((d) => d.id === hover) : last30[last30.length - 1];
  const dayLabel = (id: string) => id.slice(5).split('-').reverse().join('.');
  const billing = `https://console.cloud.google.com/billing/linkedaccount?project=${import.meta.env.VITE_FIREBASE_PROJECT_ID as string}`;
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const translateChars = today?.translate?.chars ?? 0;

  const saveCap = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(capInput ?? (s.cap / 1_000_000).toFixed(2));
    if (!Number.isFinite(v) || v < 0 || v > 50) { toast(t('common.errorGeneric'), 'danger'); return; }
    setSaving(true);
    try {
      await call('setAiDailyCap', { usd: v });
      setCapInput(null);
      toast(t('common.saved'));
    } catch (err) {
      toast(t(errorKey(err)), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack costs">
      <div className="costs__head">
        <h1>{t('admin.costs')}</h1>
        <Badge tone="success"><span className="costs__live" aria-hidden="true" />{t('admin.costs.live')}</Badge>
        {s.at ? <span className="muted costs__at">{t('admin.costs.updated', { time: s.at.toLocaleTimeString(locale === 'en' ? 'en-GB' : locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</span> : null}
      </div>

      <section className="card stack costs__today" aria-labelledby="costs-today">
        <h2 id="costs-today">{t('admin.costs.today')}</h2>
        <div className="costs__big">
          <strong className="costs__amount num">{usd(spent)}</strong>
          <span className="costs__of">{t('admin.costs.ofCap', { cap: usd(s.cap) })}</span>
          <span className="muted">{ils(spent)}</span>
        </div>
        <div className="costs__meter" role="img" aria-label={`${usd(spent)} ${t('admin.costs.ofCap', { cap: usd(s.cap) })}. ${t('admin.costs.expected', { amount: usd(expected) })}`}>
          <span className="costs__seg costs__seg--in" style={{ width: pct(ai?.inMicroUsd ?? 0) }} />
          <span className="costs__seg costs__seg--out" style={{ width: pct(ai?.outMicroUsd ?? 0) }} />
          <span className="costs__seg costs__seg--tr" style={{ width: pct(today?.translate?.microUsd ?? 0) }} />
          {expected > spent ? <span className="costs__expect" style={{ insetInlineStart: pct(expected) }}><span>{t('admin.costs.expected', { amount: usd(expected) })}</span></span> : null}
          <span className="costs__cap" style={{ insetInlineStart: pct(s.cap) }} aria-hidden="true" />
        </div>
        <div className="costs__scale muted"><bdi>$0</bdi><span>{t('admin.costs.capHint')}</span></div>
        {spent === 0 ? <p className="muted" style={{ margin: 0 }}>{t('admin.costs.empty')}</p> : null}
        <div>
          <h3 className="costs__sub">{t('admin.costs.byHour')}</h3>
          <div className="costs__hours" role="img" aria-label={t('admin.costs.byHour')}>
            {hours.map((h) => {
              const v = today?.byHour?.[h];
              const total = hourTotal(v);
              return (
                <span key={h} className={`costs__hour ${Number(h) === hourNow ? 'is-now' : ''} ${Number(h) > hourNow ? 'is-future' : ''}`} title={`${h}:00 · ${usd(total, 4)}`}>
                  <span className="costs__stack" style={{ height: `${(total / hourMax) * 100}%` }}>
                    {v?.translate ? <span className="costs__seg--tr" style={{ flex: v.translate }} /> : null}
                    {v?.aiOut ? <span className="costs__seg--out" style={{ flex: v.aiOut }} /> : null}
                    {v?.aiIn ? <span className="costs__seg--in" style={{ flex: v.aiIn }} /> : null}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="achart__axis costs__axis" aria-hidden="true"><bdi>00</bdi><bdi>06</bdi><bdi>12</bdi><bdi>18</bdi><bdi>23</bdi></div>
          <ul className="costs__legend">
            <li><i className="costs__seg--in" />{t('admin.costs.aiIn')}</li>
            <li><i className="costs__seg--out" />{t('admin.costs.aiOut')}</li>
            <li><i className="costs__seg--tr" />{t('admin.costs.translate')}</li>
          </ul>
        </div>
      </section>

      <div className="costs__pair">
        <section className="card stack" aria-labelledby="costs-where">
          <h2 id="costs-where">{t('admin.costs.where')}</h2>
          <dl className="costs__rows">
            <div className="costs__row costs__row--lead"><dt><i className="costs__seg--in" />{t('admin.costs.wishes')}</dt><dd className="num">{usd(aiSpent)}</dd></div>
            <div className="costs__row costs__row--note"><dt>{t('admin.costs.wishCount', { n: calls })}</dt><dd /></div>
            <div className="costs__row costs__row--note"><dt>{t('admin.costs.tokens', { in: compact(ai?.inTok ?? 0), inCost: usd(ai?.inMicroUsd ?? 0), out: compact(ai?.outTok ?? 0), outCost: usd(ai?.outMicroUsd ?? 0) })}</dt><dd /></div>
            <div className="costs__row costs__row--lead"><dt><i className="costs__seg--tr" />{t('admin.costs.translation')}</dt><dd className="num">{usd(today?.translate?.microUsd ?? 0)}</dd></div>
            <div className="costs__row costs__row--note"><dt>{t('admin.costs.chars', { n: translateChars.toLocaleString('en-US') })} · {t('admin.costs.free', { used: compact(s.monthChars), total: compact(TRANSLATE_FREE_CHARS) })}</dt><dd /></div>
            <div className="costs__free" aria-hidden="true"><span style={{ width: `${Math.min(100, (s.monthChars / TRANSLATE_FREE_CHARS) * 100)}%` }} /></div>
            <div className="costs__row costs__row--total"><dt>{t('common.total')}</dt><dd className="num">{usd(spent)}</dd></div>
          </dl>
        </section>

        <section className="card stack" aria-labelledby="costs-how">
          <h2 id="costs-how">{t('admin.costs.how')}</h2>
          <div className="costs__split" aria-hidden="true">
            <span className="costs__seg--in" style={{ flex: ok || (calls ? 0 : 1) }} />
            <span className="costs__seg--code" style={{ flex: calls - ok }} />
          </div>
          <dl className="costs__rows">
            <div className="costs__row"><dt>{t('admin.costs.byAi')}</dt><dd className="num">{ok}</dd></div>
            <div className="costs__row"><dt>{t('admin.costs.byCode')}</dt><dd className="num">{calls - ok}</dd></div>
            {(['timeout', 'invalid', 'error', 'capped'] as const).map((k) => <div key={k} className="costs__row costs__row--note"><dt>{t(`admin.costs.reason.${k}`)}</dt><dd className="num">{fallback[k] ?? 0}</dd></div>)}
            <div className="costs__row costs__row--note"><dt>{t('admin.costs.reason.skipped')}</dt><dd className="num">{ai?.skipped ?? 0}</dd></div>
            <div className="costs__row"><dt>{t('admin.costs.fast')}</dt><dd className="num">{aiCalled ? `${Math.round(((ai?.fast ?? 0) / aiCalled) * 100)}%` : '—'}</dd></div>
            <div className="costs__row"><dt>{t('admin.costs.perWish')}</dt><dd className="num">{aiCalled ? usd(aiSpent / aiCalled, 4) : '—'}</dd></div>
            <div className="costs__row"><dt>{t('admin.costs.model')}</dt><dd>{models[0] ? MODEL_NAMES[models[0][0]] ?? models[0][0] : t('admin.costs.noModel')}</dd></div>
          </dl>
        </section>
      </div>

      <section className="card stack achart" aria-labelledby="costs-month">
        <div className="achart__head">
          <h2 id="costs-month">{t('admin.costs.month')}</h2>
          <span className="achart__readout">{t('admin.costs.mtd', { amount: usd(month.monthToDate) })} · {t('admin.costs.projection', { amount: usd(month.projection) })}</span>
        </div>
        <div className="costs__days" role="img" aria-label={`${t('admin.costs.month')}: ${t('admin.costs.mtd', { amount: usd(month.monthToDate) })}`} onPointerLeave={() => setHover(null)}>
          <span className="costs__capline" style={{ bottom: `${(s.cap / dayMax) * 100}%` }}><span>{t('admin.costs.capLine')} {usd(s.cap)}</span></span>
          {last30.map((d) => (
            <span key={d.id} className={`achart__col ${hover === d.id ? 'is-active' : ''}`} onPointerEnter={() => setHover(d.id)} title={t('admin.costs.dayValue', { date: dayLabel(d.id), amount: usd(d.total) })}>
              <span className={`achart__bar ${d.total ? '' : 'achart__bar--zero'} ${d.ai >= s.cap && s.cap > 0 ? 'costs__bar--cap' : ''}`} style={d.total ? { height: `${(d.total / dayMax) * 100}%` } : undefined} />
            </span>
          ))}
        </div>
        <div className="achart__axis" aria-hidden="true"><bdi>{dayLabel(last30[0]!.id)}</bdi><bdi>{dayLabel(last30[29]!.id)}</bdi></div>
        {hovered ? <p className="achart__readout" aria-live="polite" style={{ margin: 0 }}><bdi>{t('admin.costs.dayValue', { date: dayLabel(hovered.id), amount: usd(hovered.total) })}</bdi>{hovered.ai >= s.cap && s.cap > 0 ? ` · ${t('admin.costs.hitCap')}` : ''}</p> : null}
      </section>

      <section className="card stack" aria-labelledby="costs-cap">
        <h2 id="costs-cap">{t('admin.costs.cap')}</h2>
        <form className="row row--end" onSubmit={(e) => void saveCap(e)}>
          <div style={{ flex: '0 1 180px' }}>
            <TextInput id="costs-cap-input" label={t('admin.costs.capLabel')} type="number" inputMode="decimal" min={0} max={50} step={0.01} ltr value={capInput ?? (s.cap / 1_000_000).toFixed(2)} onChange={(e) => setCapInput(e.target.value)} />
          </div>
          <Button type="submit" loading={saving}>{t('common.save')}</Button>
        </form>
        <p className="muted" style={{ margin: 0 }}>{t('admin.costs.footnote')} <a href={billing} target="_blank" rel="noreferrer">{t('admin.costs.billing')}</a></p>
      </section>
    </div>
  );
}
