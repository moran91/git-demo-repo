import { useState } from 'react';
import { useI18n, useT } from '@/lib/i18n';
import { discoveryStore } from '@/lib/city';
import { Segmented, Skeleton, EmptyState, Button, Alert } from '@/design/components';
import { Icon } from '@/design/Icon';
import { ErrorView } from '@/app/Shell';
import { useCity, useCities, useDiscovery } from './hooks';
import { BusinessCard } from './BusinessCard';
import { useDeviceCity } from './useDeviceCity';
import { CitySelector } from './CitySelector';

export function DiscoveryPage() {
  const t = useT();
  const { L } = useI18n();
  const prefs = discoveryStore.use();
  const city = useCity(prefs.cityId);
  const { cities, loading: citiesLoading, error: citiesError } = useCities();
  const deviceCity = useDeviceCity(cities);
  const [cityOpen, setCityOpen] = useState(false);
  const { data, loading, error } = useDiscovery(prefs.cityId, prefs.kind);
  const cityName = city.data ? L(city.data.name) : '…';

  return (
    <div className="stack--lg stack">
      <div className="hero">
        <button type="button" className="city-pill" onClick={() => setCityOpen(true)} aria-haspopup="dialog">
          <Icon name="pin" size={18} />
          <span>{t('discovery.inCity', { city: cityName })}</span>
          <Icon name="chevronDown" size={16} />
          <span className="visually-hidden">{t('discovery.changeCity')}</span>
        </button>
        <Button variant="ghost" icon="pin" loading={deviceCity.busy} disabled={citiesLoading || !!citiesError} onClick={() => { void deviceCity.detect().then((ok) => { if (ok === false) setCityOpen(true); }); }}>{t(deviceCity.busy ? 'location.finding' : 'location.use')}</Button>
        <h1>{t('brand.tagline')}</h1>
        <p>{t('brand.subtitle')}</p>
      </div>
      {deviceCity.message ? <Alert tone="success">{deviceCity.message}</Alert> : null}
      {deviceCity.error && !cityOpen ? <Alert tone="warn"><div className="stack stack--sm"><span>{deviceCity.error}</span><Button variant="secondary" onClick={() => setCityOpen(true)}>{t('discovery.changeCity')}</Button></div></Alert> : null}
      {deviceCity.enabled ? <div className="row"><span className="muted">{t('location.enabled')}</span><Button variant="ghost" size="sm" onClick={deviceCity.disable}>{t('location.disable')}</Button></div> : null}
      <div className="controls">
        <div>
          <span className="control-label">{t('discovery.kind')}</span>
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
          <EmptyState icon={prefs.kind === 'restaurant' ? 'utensils' : 'basket'} title={t('discovery.empty', { city: cityName })} body={t('discovery.emptyHint')} action={<Button variant="secondary" onClick={() => setCityOpen(true)}>{t('discovery.changeCity')}</Button>} />
        ) : (
          <div className="grid-cards">
            {data.map((b) => (
              <BusinessCard key={b.id} branch={b} cityId={prefs.cityId} />
            ))}
          </div>
        )}
      </section>
      <CitySelector
        open={cityOpen}
        location={deviceCity}
        onClose={() => { if (deviceCity.busy) deviceCity.cancel(); setCityOpen(false); }}
        value={prefs.cityId}
        onSelect={(c) => {
          deviceCity.cancel();
          discoveryStore.set({ cityId: c.id, locationEnabled: false });
        }}
      />
    </div>
  );
}
