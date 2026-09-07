# Data model (Cloud Firestore, Standard edition)

All timestamps are ISO-8601 strings written by the server clock. Money is integer agorot; weight is
integer grams. IDs are Firestore auto-ids unless noted.

| Collection | Owner / writer | Readable by | Purpose |
|---|---|---|---|
| `users/{uid}` | server | self, admin | Profile; `phoneVerified` derived from the Auth record; `suspended`, `isAdmin` server-only |
| `users/{uid}/addresses/{id}` | server (callables) | self | Saved village addresses (house description first) |
| `users/{uid}/favorites/{id}` | client (validated shape) | self | Business/product favourites |
| `users/{uid}/notifications/{id}` | server | self (may set `read`) | Inbox |
| `users/{uid}/deviceTokens/{token}` | client (validated) | self | FCM tokens; server marks `invalid` |
| `memberships/{uid}_{businessId}` | server | self, admin, business owner | Role + branch assignment (`allBranches` or `branchIds`) |
| `invitations/{id}` | server | — (callable lookup by token hash) | Email invitations |
| `businesses/{id}` | server | members, admin | Private business record incl. `approval`, `loyalty` rules (versioned) |
| `businesses/{id}/branches/{bid}` | server | members covering branch, admin | Hours (Asia/Jerusalem minutes, overnight allowed), delivery cities, pause, approval |
| `…/branches/{bid}/categories`, `…/products` | server | same | Private catalog incl. exact stock (`stockQty` units, or grams for weight items; per-variant for variants) |
| `businesses/{id}/approvalHistory` | server | owner, admin | Audit of approval changes |
| `publicBusinesses/{id}`, `publicBranches/{bid}`, `publicBranches/{bid}/{categories,products}` | server projection | everyone | Discovery/catalog; exists only when approved; stock exposed as capped `stockLeft` + `inStock` |
| `orders/{id}` | server | customer, branch members, admin | Snapshots of identity, lines, address, totals, loyalty rules; `status ∈ {placed, accepted, rejected}`; `version`, `revision`, `locked` |
| `orders/{id}/events/{id}` | server | same | placed / accepted / rejected / revised / cash_recorded / cash_reversed / printed |
| `orderRefs/{businessId}_{ref}` | server | — | Uniqueness of human references |
| `cashRecords/{id}` | server | owner/manager of branch, admin | Manual cash confirmation; `reversed` flag |
| `loyaltyAccounts/{businessId}_{uid}` | server | customer, owner/manager, admin | `available`, `reserved`, `debt` |
| `loyaltyLedger/{key}` | server (append-only, deterministic keys) | same | reserve / release / consume / earn / reverse_* / admin_adjust |
| `printers/{id}` | server | branch members | Printer config: profile, transport, paper, dots, locale, copies, role, autoPrint, `setupVerified` |
| `printStations/{id}` | server | branch members | Station registration, heartbeat, `online`, `revoked` |
| `printJobs/{id}` (+ `/attempts`) | server | branch members | Immutable receipt model, state machine, lease + fence |
| `outbox/{key}` | server | — | Notification events |
| `idempotency/{uid}_{key}` | server | — | Replay results |
| `audit/{id}` | server | admin | Admin/owner sensitive actions |
| `metricsDaily/{yyyy-mm-dd}` | server (increments) | admin | Placed/accepted/cash counters |
| `cities/{id}`, `config/platform` | server (admin callables) | everyone | Reference data |
| `otpChallenges`, `rateLimits` | server | — | WhatsApp OTP challenges, abuse guards |

## Query patterns and indexes

Composite indexes are declared in `firestore.indexes.json` for: discovery (`visible+type+deliveryCityIds`,
`visible+type+cityId`), customer orders (`customer.uid+placedAt`), branch queues (`branchId+status+placedAt`),
aging orders (`status+placedAt`), print queues (`printerId+state+requestedAt`, `orderId+printerRole+template`),
stations, memberships, ledgers, cash records, audit. All list queries are bounded (`limit`) and paginated with
cursors in the dashboards.

## Transactional invariants

1. **Placement** (one transaction): eligibility (approval, hours, pause, mode, city, minimum) → price every
   line against current products → stock check → loyalty clamp → address snapshot → unique reference →
   writes (order, events, stock decrements + projections, loyalty reserve, outbox, auto-print jobs,
   metrics, idempotency).
2. **Decision**: `placed` only; version match; rejection returns stock and releases points exactly once
   (ledger keys `${orderId}:release`); acceptance never earns points.
3. **Revision**: not `locked`, version match; removals/substitutions/increases require
   `phoneAgreement`; stock deltas checked for availability; loyalty discount re-capped and surplus released;
   `originalLines/originalTotals` never change.
4. **Cash**: `accepted`, not settled, no estimated weights, amount equals cash due; consumes reservation and
   earns once (`${orderId}:earn`); locks the order. Cash reversal applies compensating ledger entries
   (debt when points already spent) and returns stock; status stays `accepted`.
5. **Printing**: deterministic job keys for automatic copies; claims lease with an incrementing fence; reports
   with a stale fence are rejected; partial transmissions and expired leases become `needs_review`.
