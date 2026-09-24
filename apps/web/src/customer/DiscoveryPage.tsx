import { useI18n, useT } from '@/lib/i18n';
import { discoveryStore } from '@/lib/city';
import { Segmented, Skeleton, EmptyState, Button } from '@/design/components';
import { ErrorView } from '@/app/Shell';
import { useCity, useDiscovery } from './hooks';
import { BusinessCard } from './BusinessCard';
import { cityPickerStore } from './CityControl';

export function DiscoveryPage() {
  const t = useT();
  const { L } = useI18n();
  const prefs = discoveryStore.use();
  const city = useCity(prefs.cityId);
  const { data, loading, error } = useDiscovery(prefs.cityId, prefs.kind);
  const cityName = city.data ? L(city.data.name) : '…';

  return (
    <div className="stack--lg stack">
      <div className="hero">
        <h1>{t('brand.tagline')}</h1>
        <p>{t('brand.subtitle')}</p>
      </div>
      <div className="controls">
        <div>
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
      </div>
      <section aria-labelledby="around">
        <div className="section-title"><h2 id="around">{t('discovery.around')}</h2></div>
        {error ? <ErrorView message={t('common.errorGeneric')} /> : null}
        {loading ? (
          <div className="grid-cards" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="biz-card"><Skeleton height={0} style={{ aspectRatio: '16/9', borderRadius: 0 }} /><div className="biz-card__body"><Skeleton height={20} width="60%" /><Skeleton height={14} width="80%" /></div></div>
            ))}
          </div>
        ) : data.length === 0 && !error ? (
          <EmptyState icon={prefs.kind === 'restaurant' ? 'utensils' : 'basket'} title={t('discovery.empty', { city: cityName })} body={t('discovery.emptyHint')} action={<Button variant="secondary" onClick={() => cityPickerStore.set({ open: true })}>{t('discovery.changeCity')}</Button>} />
        ) : (
          <div className="grid-cards">
            {data.map((b) => (
              <BusinessCard key={b.id} branch={b} cityId={prefs.cityId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
