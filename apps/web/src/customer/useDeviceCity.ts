import { useCallback, useEffect, useRef, useState } from 'react';
import { nearestSupportedCity, type City, type TranslationKey } from '@qareeb/shared';
import { discoveryStore } from '@/lib/city';
import { useI18n } from '@/lib/i18n';

/** Coordinates remain in memory for this lookup only. Existing carts and saved addresses are untouched. */
export function useDeviceCity(cities: City[]) {
  const { t } = useI18n();
  const prefs = discoveryStore.use();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  /** True once the browser reports the permission as hard-denied: the native prompt will not show again until the user allows the site. */
  const [blocked, setBlocked] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const attemptedAutomatic = useRef(false);
  const cancel = useCallback(() => { generation.current++; pending.current = false; setBusy(false); setError(null); setBlocked(false); }, []);
  useEffect(() => () => { generation.current++; }, []);

  const detect = useCallback(async (): Promise<boolean | null> => {
    if (pending.current || cities.length === 0) return false;
    attemptedAutomatic.current = true;
    setError(null); setBlocked(false);
    if (!navigator.geolocation || !window.isSecureContext) { setError('location.unsupported'); return false; }
    const request = ++generation.current;
    pending.current = true; setBusy(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }));
      if (request !== generation.current) return null;
      if (position.coords.accuracy > 5000) { setError('location.imprecise'); return false; }
      const city = nearestSupportedCity(cities, position.coords.latitude, position.coords.longitude);
      if (!city) { setError('location.outside'); return false; }
      discoveryStore.set({ cityId: city.id, locationEnabled: true });
      return true;
    } catch (e) {
      if (request !== generation.current) return null;
      if (request === generation.current) {
        const code = (e as GeolocationPositionError).code;
        setError(code === 1 ? 'location.denied' : code === 3 ? 'location.timeout' : 'location.unavailable');
        if (code === 1) {
          discoveryStore.set({ locationEnabled: false });
          // Only a hard "Block" needs the in-app enable guide; a dismissed prompt can simply be asked again.
          void navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (request === generation.current && p.state === 'denied') setBlocked(true); }).catch(() => undefined);
        }
      }
      return false;
    } finally {
      if (request === generation.current) { pending.current = false; setBusy(false); }
    }
  }, [cities]);

  useEffect(() => {
    if (!prefs.locationEnabled || !cities.length || attemptedAutomatic.current) return;
    attemptedAutomatic.current = true;
    let active = true;
    // A returning user who opted in can refresh silently; a new permission prompt needs a click.
    void navigator.permissions?.query({ name: 'geolocation' }).then((permission) => {
      if (active && permission.state === 'granted' && discoveryStore.get().locationEnabled) void detect();
    }).catch(() => undefined);
    return () => { active = false; };
  }, [prefs.locationEnabled, cities.length, detect]);

  return {
    busy, blocked, error: error ? t(error) : null,
    detect, cancel,
  };
}
