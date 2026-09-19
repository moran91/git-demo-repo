import { lazy, Suspense, useState } from 'react';
import { Button, Skeleton } from './components';
import { useT } from '@/lib/i18n';
import './location.css';

export interface MapPoint { lat: number; lng: number }
const MapPickerDialog = lazy(() => import('./MapPickerDialog'));

export function LocationPicker({ label, value, center, onChange }: { label: string; value?: MapPoint; center?: MapPoint; onChange: (point: MapPoint | undefined) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <div className="field stack stack--sm">
    <span className="field__label">{label} <span className="field__optional">({t('common.optional')})</span></span>
    <p className="muted" role="status">{t(value ? 'map.selected' : 'map.empty')}</p>
    <div className="row"><Button variant="secondary" icon="pin" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t(value ? 'map.change' : 'map.choose')}</Button>{value ? <Button variant="ghost" onClick={() => onChange(undefined)}>{t('map.remove')}</Button> : null}</div>
    {open ? <Suspense fallback={<Skeleton height={60} />}><MapPickerDialog initial={value} center={center} onClose={() => setOpen(false)} onConfirm={(point) => { onChange(point); setOpen(false); }} /></Suspense> : null}
  </div>;
}
