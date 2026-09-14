import { Navigate, useParams } from 'react-router';
import { isValidLinkId, storefrontPath } from '@qareeb/shared';
import { NotFound } from '@/app/Shell';

/**
 * Target of every printed business QR code (`/q/<businessId>[/<branchId>]`, see
 * `packages/shared/src/links.ts`). Kept separate from the storefront route so the native apps can
 * claim exactly this path as an App Link / Universal Link, and so scan analytics can hook in here
 * later without touching the storefront. A malformed id gets the normal 404 rather than a redirect
 * to a storefront that would only fail later.
 */
export function QrLanding() {
  const { businessId, branchId } = useParams();
  if (!isValidLinkId(businessId) || (branchId !== undefined && !isValidLinkId(branchId))) return <NotFound />;
  return <Navigate to={storefrontPath({ businessId, branchId })} replace />;
}
