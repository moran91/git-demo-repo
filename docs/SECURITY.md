# Security and privacy notes

- **Least privilege**: clients can only read public projections, their own private documents, and the
  business documents their active membership covers. Writes are limited to favourites, device tokens and
  the `read` flag of notifications. Everything else is server-only (`firestore.rules`, tested in `tests/rules`).
- **Suspension** is enforced three ways: Auth user disabled + refresh tokens revoked, `users/{uid}.suspended`
  checked by every callable, and rules re-read the user document (old ID tokens cannot bypass).
- **Membership revocation**: `updateMembership(active=false)` + refresh-token revocation; callables and rules
  check the membership document on every request; print stations stop when their heartbeat is refused.
- **Admin**: only `scripts/src/bootstrap-admin.ts` (Admin SDK, requires an existing verified email account)
  sets the `admin` custom claim and `isAdmin`. No callable can grant it. Admins cannot be suspended or
  invited into businesses by owners; phone sign-in never resolves to an admin account.
- **Phone verification**: derived from the Firebase Auth user record (`phoneNumber`), never from client input.
  WhatsApp OTP issues a custom token only after Twilio Verify reports `approved`, bound to the challenge's
  number and the requesting client; codes are never seen or logged by our code.
- **Private data**: addresses and phones live on user documents and order snapshots only. Notification
  payloads and outbox events contain references and links, not addresses. Storage paths are tenant-scoped and
  validated (type, size, content sniffing) by a trigger; no private data is stored in Storage.
- **Secrets**: Twilio credentials are Functions secrets; web config values are public by design; App Check
  (reCAPTCHA v3) is wired when a site key is configured.
- **Abuse guards**: Firestore-backed rate limits for order placement and OTP requests; bounded pagination;
  input validated with zod (strict objects, size limits).
- **Errors** are mapped to stable codes; unexpected failures are logged server-side without payloads and
  returned as `internal`.
- **Offline**: the service worker precaches only build assets; Firestore persistence is disabled against the
  emulator and enabled only for the client's own reads in production; order submission requires a live
  server response.
