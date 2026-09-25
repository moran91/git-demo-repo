import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

/**
 * Storage rules.
 *
 * Emulator limitation: the Storage emulator does not resolve cross-service `firestore.get` /
 * `firestore.exists`; those expressions always evaluate falsy, so every rule guarded by a Firestore
 * lookup denies locally regardless of the data. Verified with a minimal probe rule
 * (`allow write: if firestore.exists(/databases/(default)/documents/users/$(request.auth.uid))`),
 * which denies even when the document exists, while the same rule with `request.auth != null`
 * allows. Both `membership()` and `notSuspended()` depend on such a lookup, so the *positive* owner
 * path and the suspended-member path cannot be asserted here — they hold only in production.
 *
 * What this file does pin down is everything decided without a Firestore lookup: guests, content
 * type, size limits and the tenant path layout.
 *
 * The same limitation applies to the platform-admin bypass (`isAdmin()`, a token claim). It needs no
 * Firestore lookup, but `notSuspended()` still does, so an admin upload denies here too and the
 * positive admin path is likewise only observable in production.
 */
let env: RulesTestEnvironment;
const PROJECT = 'qareeb-rules-test-storage';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const meta = { contentType: 'image/png' };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: fs.readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/owner1'), { uid: 'owner1', suspended: false, isAdmin: false });
    await setDoc(doc(db, 'memberships/owner1_biz1'), { uid: 'owner1', businessId: 'biz1', role: 'owner', allBranches: true, branchIds: [], active: true });
  });
});
afterAll(async () => env?.cleanup());

/**
 * The cap that has no other guard.
 *
 * Cross-service Rules allow at most TWO unique Firestore documents per evaluation; a third makes
 * the rules service deny every request with a bare 403. Neither the emulator (which does not
 * resolve these lookups at all) nor the Rules simulator (which only ever sees mocks) can catch it,
 * and the client surfaces it as an ordinary `storage/unauthorized` — the exact signature of the
 * outage that kept photo upload dead on qareeb-dev from 2026-09-07 to 2026-09-09. So the budget is
 * asserted statically, against the source.
 */
describe('storage rules cross-service budget', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8');

  it('reads no more than two unique Firestore documents', () => {
    // `/databases/(default)/documents/users/$(...)` -> `users`. The interpolated segment is the
    // document id, so the collection prefix is what distinguishes one document from another here.
    const matches = source.matchAll(/\/databases\/\(default\)\/documents\/([A-Za-z0-9_]+)\//g);
    const collections = [...new Set([...matches].map((m) => m[1]))].sort();
    expect(collections, `storage.rules reads ${collections.length} document(s): ${collections.join(', ')}`).toEqual(['memberships', 'users']);
  });

  it('guards every firestore.get with an exists() on the same path', () => {
    // `firestore.get` on a missing document is an evaluation error, which denies the whole request
    // — including for a platform admin, who has no membership document at all.
    const gets = [...source.matchAll(/firestore\.get\(([A-Za-z]+)\(/g)].map((m) => m[1]);
    const exists = new Set([...source.matchAll(/firestore\.exists\(([A-Za-z]+)\(/g)].map((m) => m[1]));
    expect(gets.length).toBeGreaterThan(0);
    for (const helper of gets) expect(exists, `firestore.get(${helper}(...)) has no exists() guard`).toContain(helper);
  });
});

describe('storage rules', () => {
  it('guests cannot upload anywhere', async () => {
    const s = env.unauthenticatedContext();
    await assertFails(uploadBytes(ref(s.storage(), 'businesses/biz1/logo-1.png'), png, meta));
    await assertFails(uploadBytes(ref(s.storage(), 'businesses/biz1/branches/brA/products/p1/a.png'), png, meta));
  });

  it('rejects non-image content types and oversized files', async () => {
    const s = env.authenticatedContext('owner1');
    await assertFails(uploadBytes(ref(s.storage(), 'businesses/biz1/branches/brA/products/p1/a.pdf'), png, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(s.storage(), 'businesses/biz1/branches/brA/products/p1/big.png'), new Uint8Array(5 * 1024 * 1024 + 1), meta));
  });

  // The emulator cannot resolve the membership lookup (see the budget note above), so the "editor may
  // upload" half is asserted statically: the posts block grants exactly what the promotions block does.
  it('explore-post photos: same grant as promotion banners; guests and non-images refused', async () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8');
    const grant = (seg: string) => src.split(`/branches/{branchId}/${seg}/`)[1]?.split('}\n')[0]?.split('\n').slice(1, 4).join('\n');
    expect(grant('posts')).toBeTruthy();
    expect(grant('posts')).toBe(grant('promotions'));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), 'businesses/biz1/branches/brA/posts/post1/b.png'), png, meta));
    await assertFails(uploadBytes(ref(env.authenticatedContext('owner1').storage(), 'businesses/biz1/branches/brA/posts/post1/c.pdf'), png, { contentType: 'application/pdf' }));
  });

  it('closes every path outside the tenant layout, including branding files not named logo/cover', async () => {
    const s = env.authenticatedContext('owner1');
    await assertFails(uploadBytes(ref(s.storage(), 'receipts/secret.png'), png, meta));
    await assertFails(uploadBytes(ref(s.storage(), 'businesses/biz1/notlogo.png'), png, meta));
    await assertFails(uploadBytes(ref(s.storage(), 'anything/else.png'), png, meta));
  });
});
