import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signInWithCustomToken, signOut, type Auth } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable, type Functions } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { initializeApp as adminInit, getApps } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';

export const PROJECT = 'qareeb-dev';
export const PASSWORD = 'Qareeb-Test-1234';
export const IDS = {
  restaurant: 'biz-abu-salim', branchA: 'br-abu-salim-main', branchB: 'br-abu-salim-hurfeish',
  market: 'biz-beit-jann-market', marketBranch: 'br-market-main', pending: 'biz-pending-bakery', pendingBranch: 'br-pending-bakery',
};
export const USERS = {
  admin: 'admin@qareeb.test', owner1: 'owner.restaurant@qareeb.test', owner2: 'owner.market@qareeb.test', ownerPending: 'owner.pending@qareeb.test',
  manager: 'manager.a@qareeb.test', staff: 'staff.b@qareeb.test', customer1: 'seed-customer1', customer2: 'seed-customer2',
};

if (getApps().length === 0) adminInit({ projectId: PROJECT });
export const admin = { auth: adminAuth(), db: adminFirestore() };
admin.db.settings({ ignoreUndefinedProperties: true });

export interface Client {
  app: FirebaseApp;
  auth: Auth;
  fns: Functions;
  db: Firestore;
  call<T = unknown>(name: string, data?: unknown): Promise<T>;
  close(): Promise<void>;
}

let n = 0;
export function makeClient(): Client {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key', authDomain: 'localhost' }, `client-${++n}-${randomUUID()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fns = getFunctions(app, 'me-west1');
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {
    app, auth, fns, db,
    async call<T>(name: string, data?: unknown): Promise<T> {
      const res = await httpsCallable(fns, name)(data ?? {});
      return res.data as T;
    },
    close: () => deleteApp(app),
  };
}

export async function asEmail(email: string): Promise<Client> {
  const c = makeClient();
  await signInWithEmailAndPassword(c.auth, email, PASSWORD);
  await c.call('ensureProfile', {});
  return c;
}

export async function asUid(uid: string): Promise<Client> {
  const c = makeClient();
  const token = await admin.auth.createCustomToken(uid);
  await signInWithCustomToken(c.auth, token);
  await c.call('ensureProfile', {});
  return c;
}

export async function asGuest(): Promise<Client> {
  const c = makeClient();
  await signOut(c.auth);
  return c;
}

export function key(): string {
  return randomUUID();
}

/** Extracts the structured QareebErrorCode from a callable failure. */
export async function expectCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { details?: { code?: string }; code?: string; message?: string };
    return err.details?.code ?? err.message ?? err.code ?? 'unknown';
  }
  return 'no_error';
}

export const shawarmaLine = (lineId = 'l1', overrides: Partial<{ modifiers: unknown[]; quantity: number; expectedUnitPriceAgorot: number; note: string }> = {}) => ({
  lineId,
  productId: 'p-shawarma',
  modifiers: [{ groupId: 'g-bread', optionIds: ['o-laffa'] }, { groupId: 'g-extras', optionIds: ['o-fries', 'o-spicy'] }],
  quantity: 2,
  expectedUnitPriceAgorot: 4300,
  ...overrides,
});

export const quoteBase = {
  businessId: IDS.restaurant,
  branchId: IDS.branchA,
  mode: 'delivery' as const,
  cityId: 'beit-jann',
};

export const deliveryBase = {
  businessId: IDS.restaurant,
  branchId: IDS.branchA,
  mode: 'delivery' as const,
  cityId: 'beit-jann',
  contactName: 'סמיר ח׳טיב',
  contactPhone: '050-111-1111',
  addressId: 'addr-home',
  locale: 'he' as const,
};

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await sleep(300);
  }
}
