import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { MAX_LIVE_POSTS, POST_TTL_HOURS, cleanLocalized, idSchema, publishPostSchema, type Branch, type BranchPost, type Business, type Product } from '@qareeb/shared';
import { REGION, col, db, nowIso, storage } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller, requireMembership } from '../lib/auth.js';
import { projectPostInTx } from '../lib/projections.js';
import { writeAudit } from '../lib/audit.js';
import { deleteImageWithVariants } from '../lib/images.js';

const opts = { region: REGION } as const;
const CATALOG_ROLES = ['owner', 'manager'] as const;

/**
 * Stories: a photo a branch shares for 24 hours (the circles on the customers' home page). The client picks the post id, uploads the
 * photo under businesses/{b}/branches/{br}/posts/{id}/ (Storage rules: catalog editors only), then
 * calls `publishPost`, which checks the object and publishes the post in one step. A post is never
 * edited; the owner deletes it or it expires.
 */
export const publishPost = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(publishPostSchema, req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const prefix = `businesses/${input.businessId}/branches/${input.branchId}/posts/${input.postId}/`;
  if (!input.path.startsWith(prefix) || input.path.includes('..')) fail('invalid_argument', { issues: [{ path: 'path', message: 'wrong_tenant_path' }] });
  const [meta] = await storage.bucket().file(input.path).getMetadata().catch(() => [undefined]);
  if (!meta) fail('invalid_argument', { issues: [{ path: 'path', message: 'missing_object' }] });
  const ct = String(meta.contentType ?? '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct) || Number(meta.size ?? 0) > 5 * 1024 * 1024) fail('invalid_argument', { issues: [{ path: 'path', message: 'invalid_image' }] });

  const ref = col.posts(input.businessId, input.branchId).doc(input.postId);
  const post = await db.runTransaction(async (tx) => {
    const [b, br] = await Promise.all([tx.get(col.business(input.businessId)), tx.get(col.branch(input.businessId, input.branchId))]);
    if (!b.exists || !br.exists) fail('not_found');
    const existing = await tx.get(ref);
    if (existing.exists) fail('invalid_argument', { issues: [{ path: 'postId', message: 'already_published' }] });
    const now = new Date();
    const nowStr = now.toISOString();
    const live = await tx.get(col.posts(input.businessId, input.branchId).where('expiresAt', '>', nowStr));
    if (live.size >= MAX_LIVE_POSTS) fail('invalid_argument', { issues: [{ path: 'post', message: 'too_many_posts' }] });
    if (input.productId) {
      const ps = await tx.get(col.products(input.businessId, input.branchId).doc(input.productId));
      const p = ps.data() as Product | undefined;
      if (!p || p.archived) fail('invalid_argument', { issues: [{ path: 'productId', message: 'unknown_product' }] });
    }
    const doc: BranchPost = {
      id: ref.id,
      businessId: input.businessId,
      branchId: input.branchId,
      imagePath: input.path,
      caption: cleanLocalized(input.caption),
      ...(input.productId ? { productId: input.productId } : {}),
      createdAt: nowStr,
      expiresAt: new Date(now.getTime() + POST_TTL_HOURS * 3600_000).toISOString(),
    };
    tx.set(ref, doc);
    projectPostInTx(tx, b.data() as Business, br.data() as Branch, doc);
    writeAudit(tx, { actorUid: c.uid, action: 'post.publish', targetType: 'post', targetId: `${input.branchId}/${ref.id}`, before: undefined, after: doc });
    return doc;
  });
  return { post };
}));

/** Deletes a post before it expires: private doc, public projection and photo. */
export const removePost = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, postId: idSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  let imagePath: string | undefined;
  await db.runTransaction(async (tx) => {
    const ref = col.posts(input.businessId, input.branchId).doc(input.postId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const post = snap.data() as BranchPost;
    imagePath = post.imagePath;
    tx.delete(ref);
    tx.delete(col.publicPosts(input.branchId).doc(input.postId));
    writeAudit(tx, { actorUid: c.uid, action: 'post.remove', targetType: 'post', targetId: `${input.branchId}/${input.postId}`, before: post, after: undefined });
  });
  if (imagePath) await deleteImageWithVariants(imagePath);
  return { ok: true };
}));

/**
 * Deletes expired posts, both the private documents (with their photos) and the public projections.
 * Runs from `scheduledSweeps`; the collection-group query matches both `posts` collections.
 */
export async function sweepExpiredPosts(limitCount = 200): Promise<{ deleted: number }> {
  const snap = await db.collectionGroup('posts').where('expiresAt', '<=', nowIso()).limit(limitCount).get();
  let deleted = 0;
  for (const d of snap.docs) {
    const post = d.data() as BranchPost;
    // Only the private copy (under businesses/) owns the photo; the projection just points at it.
    if (d.ref.path.startsWith('businesses/') && post.imagePath) await deleteImageWithVariants(post.imagePath);
    await d.ref.delete();
    deleted++;
  }
  return { deleted };
}
