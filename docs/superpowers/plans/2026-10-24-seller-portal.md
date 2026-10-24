# Seller portal - build plan and API contract (2026-10-24)

Design (approved by the owner with "build", 2026-10-24): `docs/superpowers/specs/2026-10-23-seller-portal-design.md`
(consignment model: Blynk holds stock, delivers and collects cash; the seller's price is the product's
`purchase_cost`; Admin sets the customer price when approving; every seller change is a submission that
waits for Admin; manual payouts ledger). Defaults taken for the owner's open questions: commission is a
per-seller percent, default 0; seller site address `blynk-seller.valgrowlabs.com`; a phone number already used as a
CUSTOMER cannot become a seller (one number = one account).

Already in place (do not redo): migrations `051_seller_role.sql`, `052_sellers.sql` (tables `sellers`,
`seller_submissions`, `seller_payouts`, `products.seller_id`), the Kysely types in `database/types.ts`,
and two empty routers mounted in `app.ts`: `sellerRouter` at `/api/v1/seller`
(`modules/sellers/seller.routes.ts`, Agent A) and `adminSellersRouter` at `/api/v1/admin`
(`modules/sellers/admin-sellers.routes.ts`, Agent B). The backend test setup applies migrations itself.

## Ground rules (all agents)

- Work only in your own files/folders (listed per agent). Shared files: only append, never rewrite.
- Do NOT run `git add`, `git commit` or `git push`; the lead commits. Do not touch `apps/rider/android`.
- Windows + Git Bash. Prefer the Read/Edit/Write tools; long heredocs with apostrophes break the shell.
- Never run whole test suites; run only your own test files. Tests share one local Postgres: use unique
  fixture names (a `Date.now()` stamp) and clean up what you create.
- Match the surrounding code's style, comment density and naming. Money is LKR, times are Asia/Colombo.
- JSON envelope everywhere: success `{ success: true, data }`, failure `{ success: false, error: { code, message, details? } }`
  (throw `AppError(message, status, CODE, details?)`). Phone numbers: Sri Lankan, normalised E.164 (`+94...`).
- Audit every staff change with `writeAudit` (see `modules/configuration/qr-links.ts` for the pattern).

## Data model recap

- `users.role = 'SELLER'`; `sellers.user_id` unique. `sellers.status`: PENDING | APPROVED | REJECTED | SUSPENDED.
- `products.seller_id` (NULL = Blynk's own). `products.purchase_cost` = the seller's price.
- `seller_submissions`: `kind` NEW | EDIT; `status` PENDING | APPROVED | REJECTED | WITHDRAWN; `payload` JSON
  `{ name, category_id, unit, pack_size?, description?, image_url?, barcode? }`; `seller_price`;
  `approved_selling_price`; one PENDING EDIT per product (unique index) - a newer edit replaces (WITHDRAWS) the waiting one.
- Statement (computed, not stored): for a seller, over order items of **DELIVERED** orders whose product has
  `seller_id = seller`: `gross = SUM(quantity * estimated_unit_cost)` (the cost snapshot = the seller's price when
  ordered), `commission = gross * commission_percent / 100`, `earned = gross - commission`; `paid = SUM(seller_payouts.amount)`;
  `due = earned - paid`. Lines per product (units sold, gross).

## API contract

### Seller app (Agent A builds the server side) - base `/api/v1/seller`

Auth reuses the existing SMS OTP machinery (`modules/auth`, `/auth/otp/request` and `/auth/otp/verify`; rider app pattern
`app: 'rider'`): add `app: 'seller'` to the verify schema. Sign-in with `app: 'seller'`:
- phone has no account -> create a user with role SELLER (+ a `sellers` row with `status PENDING`, `shop_name` taken from an
  optional `shop_name` field of the verify body, else the phone number); returns tokens like a normal sign-in;
- phone is an existing SELLER -> normal sign-in (also while PENDING / REJECTED / SUSPENDED, so they see their status);
- phone belongs to a CUSTOMER / RIDER / staff -> 403 `PHONE_IN_USE` ("This number is already used for a Blynk account.");
- a SELLER phone using the customer / rider / staff sign-ins is refused (`requireRoles` already keeps roles apart; make sure
  `/auth/otp/verify` without `app: 'seller'` refuses SELLER users with 403 `SELLER_SIGN_IN_REQUIRED`).
Tokens/refresh/logout reuse `/auth/refresh`, `/auth/logout`, `/auth/me` (the `/auth/me` payload must include `role: 'SELLER'`).

All routes below need `requireAuth` + `requireRoles('SELLER')`; `seller` = the caller's row (404 `SELLER_NOT_FOUND` if none).

| Method + path | Body / query | Result `data` |
|---|---|---|
| GET `/seller/me` | | `{ seller: Seller, counts: { products: number, pending: number } }` |
| PUT `/seller/profile` | `{ shop_name, contact_name?, address?, note? }` (shop_name 2-80, address <=255, note <=500) | `{ seller }` (allowed in any status except SUSPENDED) |
| GET `/seller/categories` | | `{ categories: [{ id, name, parent_id }] }` (active, customer-visible) |
| GET `/seller/products` | | `{ products: SellerProduct[] }` |
| POST `/seller/products` | `{ name, category_id, unit, pack_size?, description?, image_url?, barcode?, seller_price }` | `{ submission }` (201; kind NEW, PENDING). 403 `SELLER_NOT_APPROVED` unless seller APPROVED |
| PATCH `/seller/products/:id` | any subset of the fields above for one of the seller's own products | `{ submission }` (kind EDIT, PENDING; replaces a waiting one). Fields not sent keep the live values |
| DELETE `/seller/submissions/:id` | | `{ submission }` (a PENDING one becomes WITHDRAWN) |
| POST `/seller/uploads/image` | multipart `file` (jpeg/png/webp, <= 5 MB) | `{ url }` (reuse the existing product image upload/storage helper) |
| GET `/seller/statement` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` optional (delivery date, Colombo) | `Statement` (below) |

`Seller` = `{ id, shop_name, contact_name, address, note, status, rejection_reason, commission_percent, created_at }`.

`SellerProduct` = `{ id, name, category_id, category_name, unit, pack_size, description, image_url, barcode,
is_active, is_available, seller_price, selling_price (what customers pay, null while not live),
stock_on_hand (number | null when not tracked), units_sold, live: boolean, pending: Submission | null, last_rejected: Submission | null }`.
Also include products that exist only as a PENDING NEW submission (`id` = `submission:<uuid>`, `live: false`) and rejected NEW ones.

`Submission` = `{ id, kind, status, product_id, payload, seller_price, approved_selling_price, reject_reason, created_at, reviewed_at }`.

`Statement` = `{ commission_percent, gross, commission, earned, paid, due, lines: [{ product_id, name, units, gross }], payouts: [{ id, amount, note, paid_on }] }` (numbers in LKR, 2 decimals).

Validation notes: `seller_price` > 0 and <= 1,000,000; the category must exist and be active; names unique per seller are NOT required.
SELLER users may use nothing else (the other `requireRoles` already exclude them; verify `/auth/me` and the seller routes work).

### Staff side (Agent B builds the server side) - base `/api/v1/admin`, roles ADMIN + OPERATIONS

| Method + path | Body / query | Result `data` |
|---|---|---|
| GET `/admin/sellers` | `?status=` optional, `?search=` (shop, phone) | `{ sellers: AdminSeller[] }` |
| GET `/admin/sellers/:id` | | `{ seller: AdminSeller, statement: Statement }` |
| PATCH `/admin/sellers/:id` | `{ status?: 'APPROVED'\|'REJECTED'\|'SUSPENDED', rejection_reason?, commission_percent? }` | `{ seller }`. REJECTED needs a reason. SUSPENDED switches the seller's products off (`is_active=false`); re-approving does not switch them back on. Sends the seller an SMS (see below) on APPROVED / REJECTED. Audited `SELLER_UPDATED` |
| GET `/admin/seller-submissions` | `?status=PENDING` (default), `?seller_id=` | `{ submissions: AdminSubmission[] }` oldest first |
| POST `/admin/seller-submissions/:id/approve` | `{ selling_price: number }` (required for NEW; for EDIT optional = keep the live price when the seller price did not change, required if it did), `category_id?` override | `{ submission, product }`. NEW: creates the product exactly like Admin's create (active, available, `purchase_cost = seller_price`, `pricing_mode = 'FIXED'`, `fixed_selling_price = selling_price`, `seller_id` set, an inventory row as Admin-created products get). EDIT: applies payload + price to the existing product. Audited `SELLER_SUBMISSION_APPROVED`. SMS to the seller |
| POST `/admin/seller-submissions/:id/reject` | `{ reason }` (3-300 chars) | `{ submission }`. Audited. SMS to the seller |
| POST `/admin/sellers/:id/payouts` | `{ amount, note?, paid_on? }` | `{ payout, statement }`. Audited `SELLER_PAYOUT_RECORDED` |
| DELETE `/admin/sellers/:id/payouts/:payoutId` | | `{ statement }` (mistaken entry; audited) |

`AdminSeller` = `Seller` + `{ phone, full_name, products_live, submissions_pending, due }`.
`AdminSubmission` = `Submission` + `{ seller: { id, shop_name, phone, status }, product: { id, name, selling_price, purchase_cost } | null, category_name }`.

SMS texts (via the existing SMS outbox/helper the OTP and order texts use; check `modules/notifications`): short, English,
no hours: approved ("Blynk: your seller account is approved. You can add products now: https://blynk-seller.valgrowlabs.com"), rejected
(with the reason), product approved ("Blynk: <name> is live."), product rejected ("Blynk: <name> was not approved: <reason>").
A failed SMS must never fail the approval.

### Customer app (Agent B, backend) / Agent D (app)

Customer product DTO (`toCustomerProduct` in `modules/catalog/catalog.service.ts`) gains `sold_by: string | null`
(the seller's `shop_name` while the seller is APPROVED, else null) - Agent B adds it, with a query that does not add a round trip
per product (join or one lookup per page). Agent D shows "Sold by <shop>" on the product page and card where it fits.

## Agents and their files

- **Agent A - seller API**: `backend/api/src/modules/sellers/seller.*.ts` (not `admin-sellers.*`), the OTP `app: 'seller'` change in
  `modules/auth/*`, `backend/api/tests/seller-*.test.ts`. Also owns `modules/sellers/seller.statement.ts` exporting
  `sellerStatement(sellerId, { from?, to? }): Promise<Statement>` (Agent B imports it - write it FIRST and keep that signature).
- **Agent B - staff API + customer DTO**: `backend/api/src/modules/sellers/admin-sellers.*.ts`, the `sold_by` change in
  `catalog.service.ts`, `backend/api/tests/admin-seller-*.test.ts`. Until Agent A's `seller.statement.ts` exists, code against the
  signature above (a temporary local stub file is fine; delete it once A's file lands).
- **Agent C - seller web app**: new `apps/seller/` (Vite + React + TypeScript, mobile-first responsive, same stack and tooling as
  `apps/admin`; look at its `package.json`, `vite.config.ts`, `Dockerfile`, `nginx.conf`, test setup). Nothing outside `apps/seller/`.
- **Agent D - Admin UI + customer app label**: `apps/admin/src/**` (new pages Sellers, Seller product approvals, payouts; nav + routes
  + API resources + tests; update the pinned nav tests) and the "Sold by" bits in `apps/customer-app/src/**`.

Each agent finishes with: typecheck clean, its own tests passing, and a short report (files created/changed, endpoints
implemented or consumed, anything in this contract it had to interpret or could not do).
