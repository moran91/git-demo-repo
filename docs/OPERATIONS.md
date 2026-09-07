# Operating instructions (user-facing)

## Customers
1. Open the app, choose your city (Beit Jann is preselected), pick **Delivery** or **Pickup** and
   **Restaurants** or **Supermarkets**.
2. Open a business, add items (choose sizes/options; supermarkets show unit or per-kg pricing with an
   estimated total for weighed goods), review the cart.
3. At checkout sign in with your phone (SMS code). For delivery describe **how to find your house** —
   no street name is needed. Save addresses for next time.
4. Pay **cash** on delivery or pickup. The business accepts or rejects your order; you see the decision
   live and can **call the business** directly. Weighed items may change the final cash amount after
   weighing; the business calls you for any substitution.
5. Loyalty points (when a business enables them) are earned after the business records your cash payment
   and can be redeemed at that business only.

## Business owners, managers and staff
- Sign in at `/business/signin` with your email account. Owners register at `/business/register`; the
  business and each branch become visible after platform approval. Prepare the catalog meanwhile.
- **Incoming orders**: accept or reject (with a reason shown to the customer). Call the customer from the
  card. Delivery orders show the house description first.
- **Changes agreed by phone** (removals, replacements, actual weights) are recorded on the order detail
  page; the customer is notified and sees original vs revised totals.
- **Cash**: after acceptance and once weights are final, use **Record cash received**. This is a manual
  confirmation; it locks the order and awards loyalty points. Owners can reverse it with an audited reason.
- **Catalog**: categories, products, options, variants, stock, photos; copy to another branch.
- **Branch settings**: hours (overnight allowed, date overrides), delivery cities/fees/minimums, pause.
- **Printers**: see `docs/PRINTING.md`.
- **Staff**: owners invite managers (catalog/settings/orders for assigned branches) and staff (orders and
  cash only). Removal blocks access immediately.

## Platform admin
- `/admin`: real metrics (placed vs accepted value vs recorded cash), approvals (business and branch,
  with reasons), businesses and memberships, users (suspend/reinstate, loyalty corrections), orders
  (inspection, audited cash reconciliation), cities, audit log, platform settings (monetization is disabled
  and configuration-only at launch).
