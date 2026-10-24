# Customer groups, ratings + tips, product requests - contract (2026-10-24)

Owner, 2026-10-24 (all "add this"): customer groups for offers (push / SMS only to people who haven't ordered in 14 days, new
customers, big spenders); "Rate the order and tip the rider - one tap after delivery"; "Can't find it? Ask us - customers request
products we don't stock, Admin sees the most-requested list". Sibling plan: 2026-10-24-buy-again-repeat.md (migration 054).
Migrations run by hand in Coolify: every new endpoint answers 503 `<FEATURE>_NOT_READY` until its migration exists (cached check),
GET /api/v1/store says whether each feature is on (`ratings_enabled`, `product_requests_enabled`), never a 500.

## A. Customer groups (no migration) - Agent P2
Audience for push broadcasts (`POST /admin/push-broadcasts`, modules/notifications/push/broadcast.ts) and SMS offers (the existing
SMS offers module) gains an optional `audience`:
```
audience: { group: 'ALL' } | { group: 'LAPSED', days: 7-90 (default 14) } | { group: 'NEW', days: 1-60 (default 14) }
        | { group: 'BIG_SPENDERS', days: 30-365 (default 90), min_spend_lkr: number (default 5000) }
        | { group: 'NEVER_ORDERED' }
```
- LAPSED: has at least one DELIVERED order, none placed in the last `days`.
- NEW: account created within `days`.
- BIG_SPENDERS: total of DELIVERED orders in the last `days` >= min_spend_lkr.
- NEVER_ORDERED: no order ever (signed up but never bought).
Only active CUSTOMER accounts; push still needs a device; SMS still needs a real phone and the existing opt-out/quiet rules.
`GET /admin/push-broadcasts/audience?group=...&days=...&min_spend_lkr=...` and the same preview for SMS offers return the counts
for that group (customers, devices / phones). Missing `audience` = ALL (unchanged behaviour). Audit rows include the audience.
Admin/Ops pickers: a "Send to" select with the five groups and their number fields, live count.

## B. Ratings + rider tips (migration 055) - Agent P1
- `order_ratings`: order_id (PK, unique), user_id, stars 1-5, tags TEXT[] (from: 'ON_TIME','LATE','FRIENDLY_RIDER','RUDE_RIDER',
  'FRESH','DAMAGED','MISSING_ITEM','WRONG_ITEM','GOOD_PACKING'), comment <=500, created_at. One rating per DELIVERED order, by its
  customer, within 14 days of delivery; can be changed within 24 h.
- Tips: at checkout the customer may add `rider_tip_lkr` (0, 50, 100, 200 or custom up to 1000) -> `orders.rider_tip` NUMERIC(10,2)
  default 0, collected with cash on delivery (part of the amount the rider collects, shown separately on the receipt), credited 100%
  to the rider who delivers it in rider earnings and cash settlement. After delivery (if no tip yet) the rating card offers a tip
  paid from the customer's Blynk Wallet only (if the balance covers it; otherwise the tip choice is hidden) -> wallet debit + rider
  earning. Rider sees tips in earnings ("Tips" line).
- Customer API: `POST /api/v1/orders/:id/rating` `{ stars, tags?, comment? }`, `GET` same path; `POST /api/v1/orders/:id/tip`
  `{ amount_lkr }` (wallet, once per order); checkout/order create accept `rider_tip_lkr`; checkout-info shows `tip_options: [50,100,200]`.
- Staff API: `GET /api/v1/admin/ratings?stars_max=&from=&to=&rider_id=` (newest first, with order number, customer, rider, stars, tags,
  comment) and summary `GET /api/v1/admin/ratings/summary?days=30` (average, count, per-star counts, top tags, per-rider average).
  Low ratings (<=2 stars) queue a staff push like the new-order alert ("2-star rating on order X: <tags>").

## C. Product requests (migration 056) - Agent P2
- `product_requests`: id, user_id NULL (guests allowed with phone NULL), name (2-80), note (<=300), category_id NULL, photo_url NULL
  (own uploads only), status 'NEW' | 'PLANNED' | 'ADDED' | 'DECLINED', product_id NULL (when ADDED), staff_note, created_at.
  Same-named requests group by a normalised name key (lowercase, trimmed, collapsed spaces).
- Customer API: `POST /api/v1/product-requests` `{ name, note?, category_id? }` (rate limited, 5 per user per day; guests allowed by
  IP limit) -> 201; `GET /api/v1/me/product-requests` -> own requests with status.
- Staff API: `GET /api/v1/admin/product-requests?status=&sort=popular|newest` -> grouped `{ key, name, count, last_requested_at,
  status, category_name, requests: [...] }`; `PATCH /api/v1/admin/product-requests/:key` `{ status, product_id?, staff_note? }`
  (applies to the whole group); when set to ADDED with a product, requesters get a push/SMS "Blynk: <name> is now available".

## Who builds what (parallel)
- Agent M: backend of buy-again + repeat baskets (054) - see the sibling plan.
- Agent P1: backend of ratings + tips (055), incl. rider earnings/cash settlement.
- Agent P2: backend of customer groups (no migration) + product requests (056).
- Agent N1: customer app Buy again + repeat baskets (sibling plan section 3).
- Agent N2: customer app rating card + tip (after delivery on the order/track screen, and a tip choice at checkout) and
  "Can't find it? Ask us" (search no-results state, end of category lists, and a small entry on Home/Account; my requests list).
- Agent O1: Admin screens for all four features (Repeat baskets, Ratings, Product requests, the "Send to" group picker on
  Notifications and SMS offers, Repeat tag on orders, rating/tip on order detail).
- Agent O2: the same in Blynk Ops (apps/operations), plus tips in rider earnings screens there.
- Rider app tip display is a later APK change (not in this round).
Shared-file rule: make small, additive edits; re-read a file right before editing it (other agents edit in parallel); never rewrite
or reformat shared files; each agent creates its own new files for its feature.
