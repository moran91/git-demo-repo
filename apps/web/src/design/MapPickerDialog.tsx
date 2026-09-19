import { useEffect, useRef, useState } from 'react';
import * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Alert, Button, Dialog } from './components';
import type { MapPoint } from './LocationPicker';
import { useT } from '@/lib/i18n';

// tile.openstreetmap.org is a fallback for local development only: the OSMF tile policy does not allow
// production apps to depend on it. Deployments set VITE_MAP_TILE_URL to a keyed provider.
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export default function MapPickerDialog({ initial, center, onClose, onConfirm }: { initial?: MapPoint; center?: MapPoint; onClose: () => void; onConfirm: (point: MapPoint) => void }) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const alive = useRef(false);
  const locationRequest = useRef(0);
  const [point, setPoint] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tileError, setTileError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [start] = useState(initial ?? center ?? { lat: 32.9628, lng: 35.3822 });
  const initialRef = useRef(initial);

  useEffect(() => {
    if (!container.current) return;
    alive.current = true;
    const map = Leaflet.map(container.current, { zoomControl: false, scrollWheelZoom: false, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView([start.lat, start.lng], initialRef.current ? 17 : 14);
    mapRef.current = map;
    Leaflet.control.zoom({ zoomInTitle: t('map.zoomIn'), zoomOutTitle: t('map.zoomOut') }).addTo(map);
    // Only visible tiles are requested; browser HTTP caching applies. No offline tile prefetch.
    const tiles = Leaflet.tileLayer(TILE_URL, { maxZoom: 19, minZoom: 3, keepBuffer: 0, attribution: TILE_ATTRIBUTION }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    tiles.on('tileload', () => setTileError(false));
    const select = (latlng: Leaflet.LatLng) => {
      locationRequest.current++;
      setBusy(false);
      setError(null);
      const next = latlng.wrap();
      setPoint({ lat: next.lat, lng: next.lng });
    };
    map.on('click', (event: Leaflet.LeafletMouseEvent) => select(event.latlng));
    const marker = Leaflet.marker([start.lat, start.lng], { draggable: true, title: t('map.pin'), alt: t('map.pin'), icon: Leaflet.divIcon({ className: 'location-marker', html: '<span></span>', iconSize: [36, 44], iconAnchor: [18, 44] }) });
    marker.on('dragend', () => select(marker.getLatLng()));
    markerRef.current = marker;
    if (initialRef.current) marker.addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { alive.current = false; observer.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [start, attempt, t]);

  useEffect(() => {
    if (point && mapRef.current && markerRef.current) markerRef.current.setLatLng(point).addTo(mapRef.current);
  }, [point, attempt, t]);

  const locate = () => {
    setError(null);
    if (!navigator.geolocation || !window.isSecureContext) { setError(t('map.locationUnavailable')); return; }
    const request = ++locationRequest.current;
    const activeMap = mapRef.current;
    setBusy(true);
    navigator.geolocation.getCurrentPosition((position) => {
      if (!alive.current || mapRef.current !== activeMap || request !== locationRequest.current) return;
      setBusy(false);
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setPoint(next); mapRef.current?.setView(next, 17);
    }, (failure) => {
      if (!alive.current || mapRef.current !== activeMap || request !== locationRequest.current) return;
      setBusy(false); setError(t(failure.code === 1 ? 'map.locationDenied' : 'map.locationUnavailable'));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };

  return <Dialog open onClose={onClose} title={t('map.title')} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!point || busy} onClick={() => { if (point) onConfirm(point); }}>{t('map.confirm')}</Button></>}>
    <div className="stack">
      <p>{t('map.hint')}</p>
      <Button variant="secondary" icon="pin" loading={busy} onClick={locate}>{t(busy ? 'map.locating' : 'location.use')}</Button>
      {error ? <Alert tone="warn">{error}</Alert> : null}
      {tileError ? <Alert tone="warn" action={<Button variant="secondary" onClick={() => { setBusy(false); setTileError(false); setAttempt((v) => v + 1); }}>{t('common.retry')}</Button>}>{t('map.loadError')}</Alert> : null}
      <div ref={container} className="location-map" role="region" aria-label={t('map.title')} />
      <Button variant="secondary" onClick={() => { const current = mapRef.current?.getCenter(); if (current) { locationRequest.current++; setBusy(false); setError(null); setPoint({ lat: current.lat, lng: current.lng }); } }}>{t('map.center')}</Button>
      <p className="muted">{t('map.keyboard')}</p>
      <p role="status">{t(point ? 'map.selected' : 'map.empty')}</p>
      <p className="muted">{t('map.savedHint')}</p>
    </div>
  </Dialog>;
}
