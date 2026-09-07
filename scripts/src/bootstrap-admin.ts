/**
 * First-admin bootstrap. Grants platform admin to an EXISTING, email-verified Firebase Auth account.
 * Never run against a project you do not control. Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... GCLOUD_PROJECT=<project> node --experimental-strip-types src/bootstrap-admin.ts admin@example.com
 * Against the emulator:
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=qareeb-dev node --experimental-strip-types src/bootstrap-admin.ts admin@example.com
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const email = process.argv[2];
if (!email) {
  console.error('usage: bootstrap-admin <email-of-existing-verified-account>');
  process.exit(1);
}
initializeApp();
const auth = getAuth();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const user = await auth.getUserByEmail(email);
if (!user.emailVerified && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('refusing: account email is not verified');
  process.exit(2);
}
const now = new Date().toISOString();
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
await db.collection('users').doc(user.uid).set(
  { uid: user.uid, email: user.email, displayName: user.displayName ?? '', phoneVerified: !!user.phoneNumber, phone: user.phoneNumber, locale: 'he', suspended: false, isAdmin: true, createdAt: now, updatedAt: now },
  { merge: true },
);
await db.collection('audit').add({ actorUid: 'bootstrap-script', action: 'admin.bootstrap', targetType: 'user', targetId: user.uid, at: now });
await auth.revokeRefreshTokens(user.uid);
console.log(`granted platform admin to ${email} (${user.uid}). The user must sign in again to receive the claim.`);
