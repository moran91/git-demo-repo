import { useMemo } from 'react';
import { TASTE_CONSENT_VERSION, emptyTasteDoc, type DishFeedback, type Locale, type Order, type Party, type PublicPopular, type SaveTasteInput, type TasteDoc, type TastePair } from '@qareeb/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { call } from '@/lib/api';
import { createStore } from '@/lib/store';
import { useCollection, useDoc, limit, orderBy, where } from '@/lib/queries';

/** Signed-out visitors keep their taste on the device (qareeb.taste.v1) until they sign in. */
export const localTaste = createStore<{ doc: TasteDoc | null }>('taste', { doc: null });

/** The consent sheet shows once per device, even when closed without an answer. */
export const consentSeen = createStore<{ seen: boolean }>('taste-seen', { seen: false });

/** Sheets opened from the band and the knows-me page, and the knows-me entry to highlight. */
export const tasteSession = createStore<{ consentShown: boolean; gameOpen: boolean; knowsFocus: string | null; mergeLater: boolean }>('taste-session', { consentShown: false, gameOpen: false, knowsFocus: null, mergeLater: false }, { persist: false });

export interface TasteActions {
  setConsent(c: { orders: boolean; learn: boolean; ai: boolean }): Promise<void>;
  saveQuiz(q: { party?: Party; pairs: TastePair[] }): Promise<void>;
  setSuppressed(keys: string[]): Promise<void>;
  deleteAll(): Promise<void>;
}

/** Applies a saveTaste-shaped patch to a local doc with the same consent rules the server enforces. */
function applyLocal(doc: TasteDoc | null, patch: SaveTasteInput & { deleteAll?: boolean }, locale: Locale): TasteDoc {
  const now = new Date().toISOString();
  const next: TasteDoc = { ...(doc ?? emptyTasteDoc(now)) };
  if (patch.consent) next.consent = { ...patch.consent, locale, at: now };
  if (patch.clearQuiz) next.quiz = null;
  if (patch.quiz && next.consent?.learn) next.quiz = { party: patch.quiz.party ?? null, pairs: patch.quiz.pairs, at: now };
  if (patch.suppressed) next.suppressed = [...new Set(patch.suppressed)].slice(0, 100);
  if (patch.deleteAll) { next.quiz = null; next.suppressed = []; next.ignoreOrdersBefore = now; }
  if (next.consent?.learn !== true) next.quiz = null;
  if (next.consent?.ai !== true) next.lastAiSummary = null;
  next.updatedAt = now;
  return next;
}

/** The customer's taste doc: the server's when signed in, the device's otherwise, plus actions. */
export function useTaste(): { doc: TasteDoc | null; loading: boolean; signedIn: boolean; actions: TasteActions } {
  const { user, loading: authLoading } = useAuth();
  const { locale } = useI18n();
  const remote = useDoc<TasteDoc>(user ? `users/${user.uid}/taste/profile` : null);
  const local = localTaste.use();
  const signedIn = !!user;
  const doc = signedIn ? (remote.exists ? remote.data : null) : local.doc;
  const actions = useMemo<TasteActions>(() => {
    const save = async (patch: SaveTasteInput) => {
      if (signedIn) await call('saveTaste', patch);
      else localTaste.set((s) => ({ doc: applyLocal(s.doc, patch, locale) }));
    };
    return {
      setConsent: (c) => save({ consent: { ...c, version: TASTE_CONSENT_VERSION, locale } }),
      saveQuiz: (q) => save({ quiz: q }),
      setSuppressed: (keys) => save({ suppressed: keys }),
      async deleteAll() {
        if (signedIn) await call('deleteTaste', {});
        else localTaste.set((s) => ({ doc: applyLocal(s.doc, { deleteAll: true }, locale) }));
      },
    };
  }, [signedIn, locale]);
  return { doc, loading: authLoading || (signedIn && remote.loading), signedIn, actions };
}

/** The signed-in customer's last 50 orders and their dish feedback (both empty when signed out). */
export function useTasteHistory() {
  const { user } = useAuth();
  const orders = useCollection<Order>(user ? 'orders' : null, [where('customer.uid', '==', user?.uid ?? '_'), orderBy('placedAt', 'desc'), limit(50)], [user?.uid]);
  const feedback = useCollection<DishFeedback>(user ? `users/${user.uid}/dishFeedback` : null, [limit(200)], [user?.uid]);
  return { orders: orders.data, feedback: feedback.data, loading: orders.loading || feedback.loading };
}

export function usePopular(cityId: string) {
  return useDoc<PublicPopular>(cityId ? `publicPopular/${cityId}` : null);
}
