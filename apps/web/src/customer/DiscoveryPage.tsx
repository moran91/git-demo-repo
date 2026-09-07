import { useState } from 'react';
import { useI18n, useT } from '@/lib/i18n';
import { discoveryStore } from '@/lib/city';
import { setCartMode, cartStore } from '@/lib/cart';
import { Segmented, Skeleton, EmptyState, Button } from '@/design/components';
import { Icon } from '@/design/Icon';
import { ErrorView } from '@/app/Shell';
import { useCity, useDiscovery } from './hooks';
import { BusinessCard } from './BusinessCard';
import { CitySelector } from './CitySelector';

export function DiscoveryPage() {
  const t = useT();
  const { L } = useI18n();
  const prefs = discoveryStore.use();
  const city = useCity(prefs.cityId);
  const [cityOpen, setCityOpen] = useState(false);
  const { data, loading, error } = useDiscovery(prefs.cityId, prefs.mode, prefs.kind);
  const cart = cartStore.use();
  const cityName = city.data ? L(city.data.name) : '…';

  return (
    <div className="stack--lg stack">
      <div className="hero">
        <button type="button" className="city-pill" onClick={() => setCityOpen(true)} aria-haspopup="dialog">
          <Icon name="pin" size={18} />
          <span>{prefs.mode === 'delivery' ? t('discovery.deliveringTo', { city: cityName }) : t('discovery.pickupIn', { city: cityName })}</span>
          <Icon name="chevronDown" size={16} />
          <span className="visually-hidden">{t('discovery.changeCity')}</span>
        </button>
        <h1>{t('brand.tagline')}</h1>
        <p>{t('brand.subtitle')}</p>
      </div>
      <div className="controls">
        <div>
          <span className="control-label" id="mode-label">{t('discovery.mode')}</span>
          <Segmented
            label={t('discovery.mode')}
            value={prefs.mode}
            onChange={(mode) => {
              discoveryStore.set({ mode });
              if (cart.cart) setCartMode(mode, prefs.cityId);
            }}
            options={[
              { value: 'delivery', label: t('common.delivery'), icon: 'truck' },
              { value: 'pickup', label: t('common.pickup'), icon: 'bag' },
            ]}
          />
        </div>
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
              <BusinessCard key={b.id} branch={b} mode={prefs.mode} cityId={prefs.cityId} />
            ))}
          </div>
        )}
      </section>
      <CitySelector
        open={cityOpen}
        onClose={() => setCityOpen(false)}
        value={prefs.cityId}
        onSelect={(c) => {
          discoveryStore.set({ cityId: c.id });
          if (cart.cart) setCartMode(prefs.mode, c.id);
        }}
      />
    </div>
  );
}
