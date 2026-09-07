import type { AppNotification, Locale, NotificationKind } from '@qareeb/shared';
import { makeTranslator } from '@qareeb/shared';
import { col, db, messaging, nowIso, type Tx } from './firebase.js';

/**
 * Outbox pattern: business transactions enqueue an event document atomically. A Firestore trigger
 * processes it (inbox notification + FCM), and a scheduled sweeper retries failures. Payloads never
 * contain addresses, phones or totals — only references and deep links.
 */
export interface OutboxEvent {
  id: string;
  kind: NotificationKind;
  /** Recipient uids resolved at processing time when `audience` is set. */
  recipients?: string[];
  audience?: { businessId: string; branchId: string };
  params: { reference?: string };
  link: string;
  orderId?: string;
  businessId?: string;
  branchId?: string;
  /** Deterministic key prevents duplicate processing on retries. */
  key: string;
  attempts: number;
  status: 'pending' | 'done' | 'failed';
  lastError?: string;
  createdAt: string;
  processedAt?: string;
}

export function enqueueEvent(tx: Tx, e: Omit<OutboxEvent, 'id' | 'attempts' | 'status' | 'createdAt'>): void {
  // Deterministic document id → duplicate enqueues collapse into one.
  const ref = col.outbox().doc(e.key.replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 400));
  tx.set(ref, { ...e, id: ref.id, attempts: 0, status: 'pending', createdAt: nowIso() } satisfies OutboxEvent, { merge: true });
}

async function resolveRecipients(e: OutboxEvent): Promise<string[]> {
  const set = new Set<string>(e.recipients ?? []);
  if (e.audience) {
    const q = await col.memberships().where('businessId', '==', e.audience.businessId).where('active', '==', true).limit(200).get();
    for (const d of q.docs) {
      const m = d.data() as { uid: string; allBranches: boolean; branchIds: string[] };
      if (m.allBranches || m.branchIds.includes(e.audience.branchId)) set.add(m.uid);
    }
  }
  return Array.from(set);
}

export async function processOutboxEvent(id: string): Promise<void> {
  const ref = col.outbox().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const e = snap.data() as OutboxEvent;
  if (e.status === 'done') return;
  try {
    const recipients = await resolveRecipients(e);
    for (const uid of recipients) {
      const userSnap = await col.user(uid).get();
      const locale = ((userSnap.data()?.locale as Locale | undefined) ?? 'he') as Locale;
      const t = makeTranslator(locale);
      const title = t(`notif.${e.kind}.title` as never, e.params as never);
      const body = t(`notif.${e.kind}.body` as never, e.params as never);
      // Idempotent inbox doc id per (event, recipient).
      const inboxRef = col.notifications(uid).doc(`${e.id}_${uid}`.slice(0, 300));
      const existing = await inboxRef.get();
      if (!existing.exists) {
        const n: AppNotification = {
          id: inboxRef.id,
          uid,
          kind: e.kind,
          title,
          body,
          link: e.link,
          read: false,
          createdAt: nowIso(),
          orderId: e.orderId,
          businessId: e.businessId,
          branchId: e.branchId,
        };
        await inboxRef.set(n);
        await sendPush(uid, n);
      }
    }
    await ref.update({ status: 'done', processedAt: nowIso(), attempts: e.attempts + 1 });
  } catch (err) {
    console.error('outbox processing failed', id, err instanceof Error ? err.message : err);
    await ref.update({ status: e.attempts + 1 >= 8 ? 'failed' : 'pending', attempts: e.attempts + 1, lastError: err instanceof Error ? err.message : String(err) });
  }
}

async function sendPush(uid: string, n: AppNotification): Promise<void> {
  const tokens = await col.deviceTokens(uid).where('invalid', '==', false).limit(20).get();
  if (tokens.empty) return;
  const list = tokens.docs.map((d) => d.id);
  const res = await messaging.sendEachForMulticast({
    tokens: list,
    notification: { title: n.title, body: n.body },
    data: { link: n.link, kind: n.kind, notificationId: n.id },
    webpush: { fcmOptions: { link: n.link }, notification: { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png' } },
  });
  await Promise.all(
    res.responses.map(async (r, i) => {
      if (!r.success) {
        const code = r.error?.code ?? '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument') || code.includes('invalid-registration-token')) {
          await col.deviceTokens(uid).doc(list[i]!).set({ invalid: true, invalidatedAt: nowIso() }, { merge: true });
        }
      }
    }),
  );
}

export async function sweepOutbox(): Promise<number> {
  const q = await col.outbox().where('status', '==', 'pending').orderBy('createdAt').limit(100).get();
  let n = 0;
  for (const d of q.docs) {
    await processOutboxEvent(d.id);
    n++;
  }
  return n;
}

export { db };
