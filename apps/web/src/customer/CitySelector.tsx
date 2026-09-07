import { useMemo, useState } from 'react';
import type { City } from '@qareeb/shared';
import { normalizeDigits } from '@qareeb/shared';
import { Dialog, TextInput } from '@/design/components';
import { useI18n, useT } from '@/lib/i18n';
import { useCities } from './hooks';

export function CitySelector({ open, onClose, value, onSelect }: { open: boolean; onClose: () => void; value: string; onSelect: (c: City) => void }) {
  const t = useT();
  const { L } = useI18n();
  const { cities, loading } = useCities();
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = normalizeDigits(q.trim().toLowerCase());
    if (!needle) return cities;
    return cities.filter((c) => Object.values(c.name).some((n) => n?.toLowerCase().includes(needle)) || c.aliases.some((a) => a.includes(needle)));
  }, [cities, q]);
  return (
    <Dialog open={open} onClose={onClose} title={t('discovery.citySelectorTitle')}>
      <div className="stack">
        <TextInput label={t('discovery.citySearch')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {loading ? <div className="skeleton" style={{ height: 48 }} /> : null}
        <ul className="radio-list" role="listbox" aria-label={t('discovery.citySelectorTitle')}>
          {filtered.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={c.id === value} className={`choice ${c.id === value ? 'is-selected' : ''}`} style={{ width: '100%' }} onClick={() => { onSelect(c); onClose(); }}>
                <span className="choice__label">{L(c.name)}</span>
              </button>
            </li>
          ))}
          {!loading && filtered.length === 0 ? <li className="muted">{t('discovery.noCity')}</li> : null}
        </ul>
      </div>
    </Dialog>
  );
}
