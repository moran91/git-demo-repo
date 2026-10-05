import { useMemo } from 'react';
import { evaluateOpen } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { discoveryStore } from '@/lib/city';
import { Segmented, Skeleton, EmptyState, Button } from '@/design/components';
import { Icon } from '@/design/Icon';
import { ErrorView } from '@/app/Shell';
import { useCity, useDiscovery, useNow, type PublicBranch } from './hooks';
import { PlaceRow } from './BusinessCard';
import { cityPickerStore } from './CityControl';
import { StoriesBar } from './StoriesBar';
import { AssistantHome } from './assistant/AssistantHome';
import './cravings.css';

/**
 * Customer home: stories on a green band, then the assistant (ask box, suggestions, a greeting with
 * ready picks), then the places: open ones first, closed and paused ones folded away.
 */
export function DiscoveryPage() {
  const t = useT();
  const { L } = useI18n();
  const prefs = discoveryStore.use();
  const city = useCity(prefs.cityId);
  // The assistant reads restaurants itself; the places list follows the restaurants/supermarkets switch.
  const restaurants = useDiscovery(prefs.cityId, 'restaurant');
  const markets = useDiscovery(prefs.cityId, 'supermarket');
  const { data, loading, error } = prefs.kind === 'restaurant' ? restaurants : markets;
  const cityName = city.data ? L(city.data.name) : '…';
  const now = useNow();
  const [openNow, closedNow] = useMemo(() => splitOpen(data, now), [data, now]);
  const multiBranch = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of data) counts.set(b.businessId, (counts.get(b.businessId) ?? 0) + 1);
    return counts;
  }, [data]);

  const row = (b: PublicBranch) => <PlaceRow key={b.id} branch={b} cityId={prefs.cityId} showBranch={(multiBranch.get(b.businessId) ?? 0) > 1} />;

  return (
    <div className="home">
      <div className="crave-band">
        <StoriesBar cityId={prefs.cityId} />
      </div>
      {/* The page title stays for screen readers and the document outline; the band opens the page visually. */}
      <h1 className="visually-hidden">{t('brand.tagline')}</h1>
      <AssistantHome cityId={prefs.cityId} />
      <section className="places" aria-labelledby="places">
        <div className="discovery-head">
          <h2 id="places">{t('discovery.places')}</h2>
          <Segmented
            label={t('discovery.kind')}
            value={prefs.kind}
            onChange={(kind) => discoveryStore.set({ kind })}
            options={[
              { value: 'restaurant', label: t('common.restaurants'), icon: 'utensils' },
              { value: 'supermarket', label: t('common.supermarkets'), icon: 'basket' },
            ]}
          />
        </div>
        {error ? <ErrorView message={t('common.errorGeneric')} /> : null}
        {loading ? (
          <ul className="place-list" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="place-row">
                <span className="place-row__main">
                  <Skeleton height={64} width={64} radius={14} />
                  <span className="place-row__text"><Skeleton height={18} width="55%" /><Skeleton height={14} width="75%" /></span>
                </span>
              </li>
            ))}
          </ul>
        ) : data.length === 0 && !error ? (
          <EmptyState icon={prefs.kind === 'restaurant' ? 'utensils' : 'basket'} title={t('discovery.empty', { city: cityName })} body={t('discovery.emptyHint')} action={<Button variant="secondary" onClick={() => cityPickerStore.set({ open: true })}>{t('discovery.changeCity')}</Button>} />
        ) : (
          <>
            {openNow.length ? <ul className="place-list">{openNow.map(row)}</ul> : null}
            {closedNow.length ? (
              // Nothing open: the closed ones are all there is, so they start unfolded.
              <details className="places-closed" open={openNow.length === 0}>
                <summary>
                  <span>{t('discovery.closedCount', { count: closedNow.length })}</span>
                  <Icon name="chevronDown" size={20} />
                </summary>
                <ul className="place-list">{closedNow.map(row)}</ul>
              </details>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/** Orderable now, and the rest (paused first, then closed); the query order is kept within each group. */
function splitOpen(list: PublicBranch[], now: Date): [PublicBranch[], PublicBranch[]] {
  const rank = (b: PublicBranch) => (!evaluateOpen(now, b.hours, b.hoursOverrides ?? []).open ? 2 : b.ordersPaused ? 1 : 0);
  const sorted = list.map((b, i) => ({ b, i, r: rank(b) })).sort((x, y) => x.r - y.r || x.i - y.i);
  return [sorted.filter((x) => x.r === 0).map((x) => x.b), sorted.filter((x) => x.r > 0).map((x) => x.b)];
}
