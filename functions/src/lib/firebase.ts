import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const auth = getAuth();
export const messaging = getMessaging();
export const storage = getStorage();
export { FieldValue, Timestamp };
export type Tx = Transaction;

export const REGION = process.env.FUNCTIONS_REGION || 'me-west1';
export const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';

export function nowIso(): string {
  return new Date().toISOString();
}

/** Collection helpers keep paths in one place (documented in docs/DATA_MODEL.md). */
export const col = {
  users: () => db.collection('users'),
  user: (uid: string) => db.collection('users').doc(uid),
  addresses: (uid: string) => db.collection('users').doc(uid).collection('addresses'),
  notifications: (uid: string) => db.collection('users').doc(uid).collection('notifications'),
  deviceTokens: (uid: string) => db.collection('users').doc(uid).collection('deviceTokens'),
  favorites: (uid: string) => db.collection('users').doc(uid).collection('favorites'),
  memberships: () => db.collection('memberships'),
  membership: (uid: string, businessId: string) => db.collection('memberships').doc(`${uid}_${businessId}`),
  invitations: () => db.collection('invitations'),
  businesses: () => db.collection('businesses'),
  business: (id: string) => db.collection('businesses').doc(id),
  branches: (businessId: string) => db.collection('businesses').doc(businessId).collection('branches'),
  branch: (businessId: string, branchId: string) => db.collection('businesses').doc(businessId).collection('branches').doc(branchId),
  categories: (businessId: string, branchId: string) => db.collection('businesses').doc(businessId).collection('branches').doc(branchId).collection('categories'),
  products: (businessId: string, branchId: string) => db.collection('businesses').doc(businessId).collection('branches').doc(branchId).collection('products'),
  approvalHistory: (businessId: string) => db.collection('businesses').doc(businessId).collection('approvalHistory'),
  publicBusinesses: () => db.collection('publicBusinesses'),
  publicBusiness: (id: string) => db.collection('publicBusinesses').doc(id),
  publicBranches: () => db.collection('publicBranches'),
  publicBranch: (branchId: string) => db.collection('publicBranches').doc(branchId),
  publicCategories: (branchId: string) => db.collection('publicBranches').doc(branchId).collection('categories'),
  publicProducts: (branchId: string) => db.collection('publicBranches').doc(branchId).collection('products'),
  orders: () => db.collection('orders'),
  order: (id: string) => db.collection('orders').doc(id),
  orderEvents: (orderId: string) => db.collection('orders').doc(orderId).collection('events'),
  orderRefs: () => db.collection('orderRefs'),
  cashRecords: () => db.collection('cashRecords'),
  loyaltyAccounts: () => db.collection('loyaltyAccounts'),
  loyaltyAccount: (businessId: string, uid: string) => db.collection('loyaltyAccounts').doc(`${businessId}_${uid}`),
  loyaltyLedger: () => db.collection('loyaltyLedger'),
  idempotency: (uid: string, key: string) => db.collection('idempotency').doc(`${uid}_${key}`),
  outbox: () => db.collection('outbox'),
  audit: () => db.collection('audit'),
  cities: () => db.collection('cities'),
  city: (id: string) => db.collection('cities').doc(id),
  config: () => db.collection('config').doc('platform'),
  printers: () => db.collection('printers'),
  printer: (id: string) => db.collection('printers').doc(id),
  printStations: () => db.collection('printStations'),
  printStation: (id: string) => db.collection('printStations').doc(id),
  printJobs: () => db.collection('printJobs'),
  printJob: (id: string) => db.collection('printJobs').doc(id),
  printAttempts: (jobId: string) => db.collection('printJobs').doc(jobId).collection('attempts'),
  otpChallenges: () => db.collection('otpChallenges'),
  rateLimits: () => db.collection('rateLimits'),
  metricsDaily: (date: string) => db.collection('metricsDaily').doc(date),
};
