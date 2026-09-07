import { useState } from 'react';
import { normalizeIsraeliPhone, type SavedAddress } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Button, TextArea, TextInput, Select, Checkbox } from '@/design/components';
import { Icon } from '@/design/Icon';
import { useCities } from './hooks';
import type { AddressInput } from '@qareeb/shared';

export type AddressFormValue = AddressInput;

export function emptyAddress(cityId: string, name = '', phone = ''): AddressFormValue {
  return { houseDescription: '', cityId, recipientName: name, recipientPhone: phone, label: '' };
}

export function fromSaved(a: SavedAddress): AddressFormValue {
  const { id: _i, isDefault, createdAt: _c, updatedAt: _u, ...rest } = a;
  return { ...rest, isDefault };
}

/**
 * Village address editor. The house description comes FIRST and is the only required location field;
 * street/building are optional and grouped after it. Used by checkout and the account address book.
 */
export function AddressForm({ initial, onSubmit, submitLabel, submitting, showDefault, compact }: { initial: AddressFormValue; onSubmit: (v: AddressFormValue) => void; submitLabel: string; submitting?: boolean; showDefault?: boolean; compact?: boolean }) {
  const t = useT();
  const { L } = useI18n();
  const { cities } = useCities();
  const [v, setV] = useState<AddressFormValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<AddressFormValue>) => setV((s) => ({ ...s, ...patch }));
  const validate = () => {
    const e: Record<string, string> = {};
    if (v.houseDescription.trim().length < 3) e.houseDescription = t('validation.houseDescription');
    if (!v.cityId) e.cityId = t('validation.required');
    if (!v.recipientName.trim()) e.recipientName = t('validation.required');
    if (!normalizeIsraeliPhone(v.recipientPhone)) e.recipientPhone = t('validation.phone');
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (validate()) onSubmit({ ...v, houseDescription: v.houseDescription.trim(), recipientName: v.recipientName.trim(), recipientPhone: normalizeIsraeliPhone(v.recipientPhone) ?? v.recipientPhone });
      }}
    >
      {!compact ? (
        <div className="stack--sm stack">
          <h2>{t('address.headline')}</h2>
          <p className="muted">{t('address.subtitle')}</p>
        </div>
      ) : null}
      <div className="address-block">
        <div className="address-block__title"><Icon name="house" size={20} /> {t('address.houseDescription')}</div>
        <TextArea
          label={t('address.houseDescriptionShort')}
          required
          value={v.houseDescription}
          onChange={(e) => set({ houseDescription: e.target.value })}
          placeholder={t('address.houseDescriptionExample', { family: '…' })}
          hint={t('address.houseDescriptionHelp')}
          error={errors.houseDescription}
          maxLength={600}
          rows={4}
        />
      </div>
      <Select label={t('address.city')} required value={v.cityId} onChange={(e) => set({ cityId: e.target.value })} error={errors.cityId}>
        {cities.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}
      </Select>
      <div className="two-col">
        <TextInput label={t('address.recipientName')} required value={v.recipientName} onChange={(e) => set({ recipientName: e.target.value })} error={errors.recipientName} autoComplete="name" />
        <TextInput label={t('address.recipientPhone')} required value={v.recipientPhone} onChange={(e) => set({ recipientPhone: e.target.value })} error={errors.recipientPhone} inputMode="tel" autoComplete="tel" ltr hint={t('auth.phoneHint')} />
      </div>
      <TextInput label={t('address.neighborhood')} optional value={v.neighborhood ?? ''} onChange={(e) => set({ neighborhood: e.target.value || undefined })} />
      <details className="card card--flat">
        <summary style={{ cursor: 'pointer', fontWeight: 500, minHeight: 44, display: 'flex', alignItems: 'center' }}>{t('address.optionalFields')} <span className="muted" style={{ marginInlineStart: 8 }}>· {t('address.optionalFieldsHint')}</span></summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="two-col">
            <TextInput label={t('address.street')} optional value={v.street ?? ''} onChange={(e) => set({ street: e.target.value || undefined })} />
            <TextInput label={t('address.building')} optional value={v.buildingNumber ?? ''} onChange={(e) => set({ buildingNumber: e.target.value || undefined })} />
          </div>
          <div className="row">
            <TextInput label={t('address.apartment')} optional value={v.apartment ?? ''} onChange={(e) => set({ apartment: e.target.value || undefined })} />
            <TextInput label={t('address.floor')} optional value={v.floor ?? ''} onChange={(e) => set({ floor: e.target.value || undefined })} />
            <TextInput label={t('address.entrance')} optional value={v.entrance ?? ''} onChange={(e) => set({ entrance: e.target.value || undefined })} />
          </div>
          <TextInput label={t('address.mapPin')} optional hint={t('address.mapPinHint')} ltr placeholder="32.9628, 35.3822" value={v.lat !== undefined && v.lng !== undefined ? `${v.lat}, ${v.lng}` : ''} onChange={(e) => { const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(e.target.value); set(m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: undefined, lng: undefined }); }} />
        </div>
      </details>
      <TextArea label={t('address.instructions')} optional value={v.deliveryInstructions ?? ''} onChange={(e) => set({ deliveryInstructions: e.target.value || undefined })} style={{ minHeight: 72 }} maxLength={500} />
      <TextInput label={t('address.label')} optional hint={t('address.labelHint')} value={v.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} maxLength={40} />
      {showDefault ? <Checkbox label={t('address.setDefault')} checked={!!v.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} /> : null}
      <p className="muted">{t('address.privateNote')}</p>
      <Button type="submit" loading={submitting} block>{submitLabel}</Button>
    </form>
  );
}

export function AddressSummary({ a }: { a: Pick<SavedAddress, 'houseDescription' | 'recipientName' | 'recipientPhone' | 'neighborhood' | 'street' | 'buildingNumber' | 'apartment' | 'floor' | 'entrance' | 'deliveryInstructions'> & { label?: string; cityName?: Record<string, string> } }) {
  const t = useT();
  const { L } = useI18n();
  const line2 = [a.cityName ? L(a.cityName) : null, a.neighborhood, [a.street, a.buildingNumber].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const line3 = [a.apartment && `${t('address.apartment')} ${a.apartment}`, a.floor && `${t('address.floor')} ${a.floor}`, a.entrance && `${t('address.entrance')} ${a.entrance}`].filter(Boolean).join(', ');
  return (
    <div className="stack--sm stack" style={{ minWidth: 0 }}>
      {a.label ? <span className="badge badge--neutral">{a.label}</span> : null}
      <div className="address-card__desc wrap-anywhere">{a.houseDescription}</div>
      {line2 ? <div className="muted wrap-anywhere">{line2}</div> : null}
      {line3 ? <div className="muted">{line3}</div> : null}
      <div className="muted">{a.recipientName} · <bdi className="num">{a.recipientPhone}</bdi></div>
      {a.deliveryInstructions ? <div className="muted wrap-anywhere">{a.deliveryInstructions}</div> : null}
    </div>
  );
}
