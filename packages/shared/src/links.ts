/**
 * Public deep-link contract shared by the web app and the future Android / iOS apps.
 *
 * A business QR code encodes `https://<origin>/q/<businessId>[/<branchId>]`. The `/q/` prefix is
 * reserved for scanned links only, so the native apps can claim exactly that path pattern as an
 * Android App Link / iOS Universal Link without swallowing every storefront URL, and the web app
 * can count scans before redirecting to the storefront at `/b/<businessId>[/<branchId>]`.
 *
 * Any change here is a breaking change for QR codes already printed and stuck on shop windows —
 * only ever add new forms, never stop accepting the old ones.
 */
export const QR_LINK_PREFIX = '/q';
/** Storefront path the landing route redirects to. */
export const STOREFRONT_PREFIX = '/b';

/** Firestore auto-ids and our own `makeId` output; anything else is rejected rather than encoded. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface BusinessLinkTarget {
  businessId: string;
  /** Omitted = the storefront opens the business's first visible branch. */
  branchId?: string;
}

export function isValidLinkId(id: string | undefined | null): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

/** `/q/<businessId>[/<branchId>]` — throws on ids that would not round-trip through a URL. */
export function businessQrPath(target: BusinessLinkTarget): string {
  if (!isValidLinkId(target.businessId)) throw new Error('invalid businessId');
  if (target.branchId !== undefined && !isValidLinkId(target.branchId)) throw new Error('invalid branchId');
  return target.branchId ? `${QR_LINK_PREFIX}/${target.businessId}/${target.branchId}` : `${QR_LINK_PREFIX}/${target.businessId}`;
}

/** Absolute URL to encode in the QR image. `origin` must be the public site origin (no path). */
export function businessQrUrl(origin: string, target: BusinessLinkTarget): string {
  return `${origin.replace(/\/+$/, '')}${businessQrPath(target)}`;
}

/** Storefront path for a target (what the landing route navigates to). */
export function storefrontPath(target: BusinessLinkTarget): string {
  return target.branchId ? `${STOREFRONT_PREFIX}/${target.businessId}/${target.branchId}` : `${STOREFRONT_PREFIX}/${target.businessId}`;
}

/**
 * Parses a scanned URL or path. Returns null for anything that is not a business QR link, so a
 * native app can fall back to opening the URL in the browser. Accepts a full URL (`https://…/q/x`)
 * or a bare path (`/q/x/y`), ignores query string and hash, and tolerates a trailing slash.
 */
export function parseBusinessQrLink(input: string): BusinessLinkTarget | null {
  let path = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/, 1)[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || `/${parts[0]}` !== QR_LINK_PREFIX) return null;
  const [, businessId, branchId] = parts;
  if (!isValidLinkId(businessId)) return null;
  if (branchId !== undefined && !isValidLinkId(branchId)) return null;
  return branchId ? { businessId, branchId } : { businessId };
}
