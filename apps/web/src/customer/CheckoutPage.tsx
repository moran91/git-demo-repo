import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { normalizeIsraeliPhone, type SavedAddress } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { cartStore, clearCart } from '@/lib/cart';
import { useCollection, limit } from '@/lib/queries';
import { Button, TextInput, TextArea, Alert, EmptyState, Dialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { call, newIdempotencyKey, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useOnline } from '@/lib/online';
import { money } from '@/lib/format';
import { useQuote } from './quote';
import { Summary } from './Summary';
import { AddressForm, AddressSummary, emptyAddress, type AddressFormValue } from './AddressForm';
import { useCity } from './hooks';

export function CheckoutPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { user, profile, loading: authLoading } = useAuth();
  const state = cartStore.use();
  const navigate = useNavigate();
  const online = useOnline();
  const cart = state.cart;
  const city = useCity(cart?.cityId ?? 'beit-jann');
  const addresses = useCollection<SavedAddress>(user ? `users/${user.uid}/addresses` : null, [limit(20)], [user?.uid]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState<AddressFormValue | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [redeem, setRedeem] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [idem] = useState(() => newIdempotencyKey());
  const { quote, error: quoteError, loading: quoting } = useQuote(cart, redeem);
  // Persist in-progress form data so language switching / verification round-trips keep it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('qareeb.checkout.form');
      if (raw) {
        const f = JSON.parse(raw) as { contactName?: string; contactPhone?: string; note?: string; addressId?: string | null; newAddress?: AddressFormValue | null; redeem?: number };
        setContactName(f.contactName ?? '');
        setContactPhone(f.contactPhone ?? '');
        setNote(f.note ?? '');
        setAddressId(f.addressId ?? null);
        setNewAddress(f.newAddress ?? null);
        setRedeem(f.redeem ?? 0);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem('qareeb.checkout.form', JSON.stringify({ contactName, contactPhone, note, addressId, newAddress, redeem }));
    } catch {
      /* ignore */
    }
  }, [contactName, contactPhone, note, addressId, newAddress, redeem]);
  useEffect(() => {
    if (profile) {
      setContactName((n) => n || profile.displayName || '');
      setContactPhone((p) => p || (profile.phone ? profile.phone : ''));
    }
  }, [profile]);
  useEffect(() => {
    if (!addressId && !newAddress && addresses.data.length > 0) {
      const def = addresses.data.find((a) => a.isDefault) ?? addresses.data[0]!;
      const eligible = addresses.data.filter((a) => a.cityId === cart?.cityId);
      setAddressId((eligible.find((a) => a.isDefault) ?? eligible[0] ?? def).id);
    }
  }, [addresses.data, addressId, newAddress, cart?.cityId]);

  const selectedSaved = useMemo(() => addresses.data.find((a) => a.id === addressId) ?? null, [addresses.data, addressId]);

  if (!cart || !state.meta) return <EmptyState icon="cart" title={t('cart.empty')} action={<Link className="btn btn--primary" to="/">{t('cart.browse')}</Link>} />;
  if (authLoading) return <div className="skeleton" style={{ height: 200 }} aria-busy="true" />;
  if (!user || !profile?.phoneVerified) {
    return (
      <div className="stack auth-card">
        <h1>{t('checkout.title')}</h1>
        <Alert tone="info">{t('checkout.signInRequired')}</Alert>
        <Button block onClick={() => navigate('/signin', { state: { from: '/checkout' } })}>{t('checkout.verifyPhone')}</Button>
      </div>
    );
  }
  const dl = state.meta.businessDefaultLocale;
  const cityName = city.data ? L(city.data.name) : cart.cityId;
  const addressOk = cart.mode === 'pickup' || (selectedSaved && selectedSaved.cityId === cart.cityId) || (newAddress && newAddress.cityId === cart.cityId);
  const phoneOk = !!normalizeIsraeliPhone(contactPhone);
  const canPlace = online && !!quote && !quoteError && addressOk && phoneOk && contactName.trim().length > 0 && !submitting;

  const place = async () => {
    if (!quote) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await call<{ orderId: string; reference: string }>('placeOrder', {
        businessId: cart.businessId,
        branchId: cart.branchId,
        mode: cart.mode,
        cityId: cart.cityId,
        lines: cart.lines,
        redeemPoints: redeem || undefined,
        idempotencyKey: idem,
        contactName: contactName.trim(),
        contactPhone,
        addressId: cart.mode === 'delivery' && selectedSaved ? selectedSaved.id : undefined,
        address: cart.mode === 'delivery' && !selectedSaved && newAddress ? newAddress : undefined,
        saveAddress: cart.mode === 'delivery' && !selectedSaved && !!newAddress,
        customerNote: note.trim() || undefined,
        expectedCashDueAgorot: quote.totals.cashDueAgorot,
        locale,
      });
      clearCart();
      try {
        sessionStorage.removeItem('qareeb.checkout.form');
        sessionStorage.removeItem('qareeb.cart.quotedTotal');
      } catch {
        /* ignore */
      }
      navigate(`/orders/${res.orderId}`, { replace: true, state: { placed: true } });
    } catch (e) {
      setSubmitError(e as ApiError);
    } finally {
      setSubmitting(false);
    }
  };

  const rules = quote?.rules;
  const loyalty = quote?.loyalty;
  const maxPoints = rules && quote ? Math.min(loyalty?.available ?? 0, Math.floor(Math.floor((quote.totals.merchandiseSubtotalAgorot * rules.maxDiscountPercent) / 100) / rules.redeemValueAgorot)) : 0;

  return (
    <div className="stack">
      <h1>{t('checkout.title')}</h1>
      <div className="checkout-layout">
        <div className="stack--lg stack">
          <section className="card stack">
            <div className="row row--between">
              <strong>{cart.mode === 'delivery' ? t('checkout.deliveryTo') : t('checkout.pickupAt')} {cart.mode === 'delivery' ? cityName : L(state.meta.branchName, dl)}</strong>
              <Link className="btn btn--ghost btn--sm" to="/">{t('checkout.changeMode')}</Link>
            </div>
            <div className="muted">{L(state.meta.businessName, dl)}</div>
          </section>

          {cart.mode === 'delivery' ? (
            <section className="stack" aria-labelledby="addr-h">
              <div className="stack--sm stack">
                <h2 id="addr-h">{t('address.headline')}</h2>
                <p className="muted">{t('address.subtitle')}</p>
              </div>
              {addresses.data.length > 0 ? (
                <div className="stack--sm stack" role="radiogroup" aria-label={t('checkout.savedAddresses')}>
                  {addresses.data.map((a) => {
                    const wrongCity = a.cityId !== cart.cityId;
                    const selected = addressId === a.id && !newAddress;
                    return (
                      <label key={a.id} className={`address-card ${selected ? 'is-selected' : ''}`} style={{ opacity: wrongCity ? 0.6 : 1 }}>
                        <input type="radio" name="addr" checked={selected} disabled={wrongCity} onChange={() => { setAddressId(a.id); setNewAddress(null); }} style={{ width: 22, height: 22, marginTop: 4, accentColor: 'var(--color-primary)' }} />
                        <AddressSummary a={a} />
                        {wrongCity ? <span className="badge badge--muted">{t('checkout.deliveryUnavailable', { city: cityName })}</span> : null}
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {newAddress ? (
                <div className="address-card is-selected">
                  <Icon name="house" size={20} />
                  <AddressSummary a={{ ...newAddress, cityName: city.data?.name }} />
                  <Button size="sm" variant="ghost" onClick={() => setShowAddressForm(true)}>{t('common.edit')}</Button>
                </div>
              ) : null}
              <Button variant="secondary" icon="plus" onClick={() => setShowAddressForm(true)}>{t('checkout.newAddress')}</Button>
            </section>
          ) : null}

          <section className="card stack" aria-labelledby="contact-h">
            <h2 id="contact-h">{t('checkout.contact')}</h2>
            <TextInput label={t('checkout.contactName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" />
            <TextInput label={t('checkout.contactPhone')} required value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" ltr error={contactPhone && !phoneOk ? t('validation.phone') : undefined} hint={t('auth.phoneHint')} />
            <TextArea label={t('checkout.orderNote')} optional hint={t('checkout.orderNoteHint')} value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 72 }} maxLength={500} />
          </section>

          {rules?.enabled && loyalty ? (
            <section className="card stack" aria-labelledby="loy-h">
              <h2 id="loy-h">{t('checkout.loyalty')}</h2>
              <p>{t('checkout.loyaltyAvailable', { points: loyalty.available, business: L(state.meta.businessName, dl) })}</p>
              {loyalty.debt > 0 ? <Alert tone="warn">{t('checkout.loyaltyDebt')}</Alert> : (
                <TextInput label={t('checkout.loyaltyRedeem')} type="number" inputMode="numeric" min={0} max={maxPoints} value={redeem} onChange={(e) => setRedeem(Math.max(0, Math.min(maxPoints, Number(e.target.value) || 0)))} hint={`${t('common.minimum')} 0 · max ${maxPoints}`} ltr />
              )}
              <p className="muted">{t('checkout.loyaltyRule', { percent: rules.maxDiscountPercent })}</p>
            </section>
          ) : null}
        </div>

        <aside className="stack">
          <h2>{t('checkout.summary')}</h2>
          {quote ? <ul className="order-lines card">
            {quote.lines.map((l) => (
              <li key={l.lineId} className="order-line">
                <span className="wrap-anywhere">{l.pricingMode === 'weight' ? `${(l.requestedGrams ?? 0) / 1000} kg` : `${l.quantity} ×`} {L(l.name, dl)}{l.variantName ? ` (${L(l.variantName, dl)})` : ''}{l.modifiers.length ? <span className="muted"> · {l.modifiers.map((m) => L(m.optionName, dl)).join(', ')}</span> : null}</span>
                <bdi className="num">{money(l.lineTotalAgorot, locale)}</bdi>
              </li>
            ))}
          </ul> : null}
          {quote ? <Summary totals={quote.totals} mode={cart.mode} /> : quoting ? <div className="skeleton" style={{ height: 140 }} /> : null}
          {quote?.totals.isEstimated ? <Alert tone="info">{t('checkout.weightNotice')}</Alert> : null}
          {quoteError ? <Alert tone="danger">{quoteError.code === 'below_minimum' ? t('checkout.belowMinimum', { city: cityName, amount: money(Number(quoteError.details.minSubtotalAgorot ?? 0), locale) }) : quoteError.code === 'delivery_not_available' ? t('checkout.deliveryUnavailable', { city: cityName }) : quoteError.code === 'branch_closed' ? t('checkout.closed') : quoteError.code === 'orders_paused' ? t('checkout.paused') : t(errorKey(quoteError))} <Link to="/cart">{t('nav.cart')}</Link></Alert> : null}
          {!online ? <Alert tone="warn">{t('checkout.offlineBlock')}</Alert> : null}
          {submitError ? <Alert tone="danger">{submitError.code === 'price_changed' ? t('checkout.reviewPrices') : t(errorKey(submitError))}</Alert> : null}
          {cart.mode === 'delivery' && !addressOk ? <Alert tone="warn">{t('validation.houseDescription')}</Alert> : null}
          <Button block loading={submitting} disabled={!canPlace} onClick={place}>{submitting ? t('checkout.placing') : t('checkout.placeOrder')}</Button>
        </aside>
      </div>
      <Dialog open={showAddressForm} onClose={() => setShowAddressForm(false)} title={t('checkout.newAddress')}>
        <AddressForm initial={newAddress ?? emptyAddress(cart.cityId, contactName, contactPhone)} submitLabel={t('address.save')} onSubmit={(v) => { setNewAddress(v); setAddressId(null); setShowAddressForm(false); }} compact />
      </Dialog>
    </div>
  );
}
