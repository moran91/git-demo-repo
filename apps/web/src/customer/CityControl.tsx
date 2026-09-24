import { useI18n, useT } from '@/lib/i18n';
import { discoveryStore } from '@/lib/city';
import { createStore } from '@/lib/store';
import { Icon } from '@/design/Icon';
import { Spinner } from '@/design/components';
import { useCities, useCity } from './hooks';
import { useDeviceCity } from './useDeviceCity';
import { CitySelector } from './CitySelector';

/** Lets page content (e.g. an empty list's "Change city") open the header's town picker. */
export const cityPickerStore = createStore<{ open: boolean }>('cityPicker', { open: false }, { persist: false });

/**
 * The town, as a chip in the top bar. Tapping opens the picker, whose first row is "Use my location";
 * location errors live only inside the picker. A returning user who opted in is refreshed silently.
 */
export function CityControl() {
  const t = useT();
  const { L } = useI18n();
  const prefs = discoveryStore.use();
  const city = useCity(prefs.cityId);
  const { cities } = useCities();
  const deviceCity = useDeviceCity(cities);
  const { open } = cityPickerStore.use();
  const cityName = city.data ? L(city.data.name) : '…';
  return (
    <>
      <button type="button" className="city-chip city-pill" onClick={() => cityPickerStore.set({ open: true })} aria-haspopup="dialog" aria-label={`${t('discovery.changeCity')}: ${cityName}`}>
        {deviceCity.busy && !open ? <Spinner size={16} /> : <Icon name="pin" size={16} />}
        <span className="city-chip__name">{cityName}</span>
        <Icon name="chevronDown" size={16} className="icon city-chip__chev" />
      </button>
      <CitySelector
        open={open}
        location={deviceCity}
        onClose={() => { if (deviceCity.busy) deviceCity.cancel(); cityPickerStore.set({ open: false }); }}
        value={prefs.cityId}
        onSelect={(c) => {
          deviceCity.cancel();
          discoveryStore.set({ cityId: c.id, locationEnabled: false });
        }}
      />
    </>
  );
}
