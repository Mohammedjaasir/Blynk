# Seller app, push notifications instead of SMS, sellers manage their own stock (contract)

Owner (2026-10-26), after seeing a seller's feature phone get "Blynk: Apple Pie is live." and the Ops seller screen
with "Stock coming in": "We don't need this. Let's put an app kind of thing and send notifications. Stock they must
manage themselves, and for stock received we got an SMS - no need."

Owner's answers to our three questions:
1. The seller "app" is an **installable web app (PWA)** of the existing seller site (apps/seller,
   blynk-seller.valgrowlabs.com): install icon on the phone + push notifications. No Play Store, no APK.
2. **Sellers type the quantity** of each of their products themselves; that number becomes the live stock. Ops no
   longer receives stock on a seller's behalf: the "Stock coming in" card and the "stock received" SMS go.
3. **No SMS to sellers except the sign-in code** (the OTP SMS stays: sellers log in with it). Everything else that was
   an SMS (account approved / not approved, product live / not approved, stock received, payout paid / declined)
   becomes a push notification.

Three builders work in parallel on separate areas. Do not edit another builder's area. Do not commit or push.
Preserve each file's line endings (read with Read, edit with Edit; backend files are a mix of LF and CRLF).
Run `npx tsc --noEmit` and the whole `npx vitest run` of the app you touched before reporting (the machine is loaded:
`--testTimeout=120000`, and if a file times out re-run it alone before calling it a failure).

## A. Backend (`backend/api`) - builder B

### A1. Push instead of SMS for sellers
* `modules/sellers/admin-sellers.service.ts` has `textSeller(user, type, text, key)` queuing an SMS (types in
  `SellerSmsType`); `modules/sellers/seller-requests.service.ts` uses it for stock received and payout paid /
  declined. Replace it with `notifySeller(user, type, { title, body }, key)` that queues a **push** through the
  existing outbox (`modules/notifications/push`: `enqueuePush`, `PUSH_TYPES`, the PUSH provider sends to every
  device the user registered through `POST /me/devices`; no devices = a no-op that counts as sent). Add one new
  push type `PUSH_SELLER` (or one per event, your choice, keep the style of the existing types). The push `data`
  carries `{ type: 'SELLER_PRODUCT_APPROVED' ..., url: '/' }` (the seller site root; the service worker opens it).
  Idempotency keys stay as they are today (`seller-product-approved:<id>:...`).
* Messages (English, short, title / body):
  - SELLER_APPROVED: "Your seller account is approved" / "You can add products now."
  - SELLER_REJECTED: "Seller application not approved" / reason (max 120 chars as today)
  - SELLER_PRODUCT_APPROVED: "<name> is live" / "Customers can order it now."
  - SELLER_PRODUCT_REJECTED: "<name> was not approved" / reason
  - SELLER_PAYOUT_PAID: "Payment sent" / "We paid you LKR 1,500.00 (bank transfer)." (or cash)
  - SELLER_PAYOUT_DECLINED: "Payout request declined" / "LKR 1,500.00: <reason>"
* **No SMS is sent to a seller for any of these any more**, and the "stock received" notification is dropped
  entirely (the receive flow is no longer used by the apps; keep the staff routes so an older Ops/Admin app does not
  break, but they send nothing).
* The sign-in OTP SMS is untouched.
* Remove the now-dead SMS text helpers/exports only if nothing else uses them (check tests); update the doc comments.
* Existing tests that pin the seller SMS texts / outbox SMS rows (grep `is live`, `SELLER_PRODUCT_APPROVED`,
  `stockReceivedSms`, `payoutPaidSms`, outbox channel 'SMS' in tests/seller*.test.ts) now pin the PUSH outbox rows
  instead, and assert that **no SMS row** is queued for those events. Add a test that the OTP SMS still works.

### A2. Sellers set their own stock
* `PUT /seller/products/:id/stock` body `{ quantity: int 0..100000 }` (SELLER role, own products only, behind the
  same readiness guard as the other seller routes). It sets the product's on-hand quantity to `quantity`:
  delta = quantity - current on-hand, written through the canonical writer `recordStockMovement`
  (`modules/inventory/stock-ledger.ts`, the stock-ledger-guard test forbids any other writer): positive delta =
  `PURCHASE_RESTOCK` (so back-in-stock alerts fire as for any restock), negative delta =
  `INVENTORY_AUDIT_ADJUSTMENT`; `actorId` = the seller's user id; notes "Seller <shop> set stock (was N)". Zero delta
  = no ledger row, 200.
* Rules: only an APPROVED / live product of theirs (404 PRODUCT_NOT_FOUND for anyone else's, 409
  PRODUCT_NOT_APPROVED while pending/rejected); a product without an inventory row gets a TRACKED one first (as the
  receive flow did); a product staff switched to UNTRACKED -> 409 PRODUCT_NOT_TRACKED with a friendly message;
  going below what open orders have reserved -> 400 with message "N are already reserved for open orders, so the
  stock cannot go below N." (map INSUFFICIENT_AVAILABLE_INVENTORY). Row-lock the inventory row like the receive flow.
* Audit (action `SELLER_STOCK_SET`, old / new quantity).
* Response `{ product_id, stock_on_hand, stock_reserved, previous }`. `GET /seller/products` items additionally
  carry `stock_reserved: number | null` and `stock_tracked: boolean` next to the existing `stock_on_hand`.
* Variants: if seller products can have sizes (migration 045), support `variant_id` in the body only if the
  existing stock-note code handled variants; otherwise reject a variant product with 409
  PRODUCT_HAS_VARIANTS "Ask Blynk to update this product's sizes" and say so in your report.
* Tests: real-Postgres test for the route (role matrix 401/403, own vs other seller's product, set up / down / same,
  reserved floor, untracked, unapproved, ledger rows with the right types and actor, audit row).
* Device registration for sellers: confirm `POST /me/devices` / `DELETE /me/devices/:token` accept the SELLER role
  (they are "any signed-in user"; add a test that a seller can register a web token).

## B. Seller site (`apps/seller`) - builder S

### B1. Installable app
* `public/manifest.webmanifest` (name "Blynk Seller", short_name "Seller", `start_url` "/", `display` "standalone",
  `theme_color` and `background_color` from the site's existing palette, icons 192 and 512 PNG incl. a maskable one,
  generated from the existing logo/favicon in the repo; look at `apps/customer-site` and `apps/seller/public`),
  `<link rel="manifest">`, `theme-color`, apple-touch-icon and the iOS meta tags in `index.html`.
* A service worker at the site root `/firebase-messaging-sw.js` (Firebase Cloud Messaging web push) modelled on
  `apps/customer-site/firebase-messaging-sw.js` (same public Firebase web config and VAPID key as
  `apps/customer-app/src/blynk/push/webPlatform.ts`, same pinned SDK version loaded from gstatic): shows the
  notification (title, body, icon) while the site is closed; a tap focuses an open seller tab or opens the
  `data.url` (default `/`).
* `nginx.conf`: serve `/firebase-messaging-sw.js` and the manifest with `Cache-Control: no-cache` and the right
  content types; repeat the security headers in that location (nginx drops the server-level ones in a location
  that sets its own add_header, see the file's comment). The Dockerfile must copy the new public files.
* An "Install app" prompt: capture `beforeinstallprompt` and show a small "Install the Blynk Seller app" button
  (header or Shop page); on iOS Safari (no such event) show the one-line hint "Tap Share, then Add to Home Screen".
  Hide it once installed (`display-mode: standalone`) or dismissed (remember in localStorage, wrapped in try/catch).

### B2. Notifications on / off
* A "Get notifications" card (Shop page or top of Products) with a button **Turn on notifications** (browsers need a
  tap): requests permission, gets the FCM token with the VAPID key, `POST /me/devices { token, platform: 'web' }`,
  remembers the state. Explain what they get: "Know when a product goes live, is not approved, or a payout is sent."
  States: unsupported browser (say so; iOS needs the installed app: "Install the app first, then turn on
  notifications"), permission denied (how to re-enable), on (with a Turn off button that `DELETE /me/devices/:token`).
* On sign-out delete the device token for this user, like the customer app's push manager
  (`apps/customer-app/src/blynk/push/manager.ts`); on sign-in with permission already granted, re-register quietly.
* While the app is open, show a foreground notification as an in-app toast (Firebase `onMessage`).
* Keep this logic in plain `.ts` modules with unit tests (state machine, token registration calls with a mocked
  API), as the customer app does; no new bundled Firebase dependency (load the compat SDK from gstatic at run time).

### B3. Stock managed by the seller
* Replace the "send stock to Blynk" notes UI (`pages/Stock.tsx`, the "Bring more" button and notes list in
  `pages/Products.tsx`, `api` calls for `/seller/stock-notes`) with **My stock**: every approved product shows its
  on-hand number with a numeric input (+ / - steppers) and **Save**; saves with `PUT /seller/products/:id/stock`
  (contract in A2) and shows the new number; badges "Out of stock" (0) and "Low" (1-5); the API's friendly error
  (reserved floor, untracked, variants) is shown under the field. Products still pending/rejected show no stock input.
* Remove every mention of "goods on the way", "send stock", "Blynk will receive" and the stock-note API client.
* Tests: stock editor (render, step, save, error), notification card states, install prompt, `vitest` as before.

## C. Ops and Admin (`apps/operations`, `apps/admin`) - builder O

* Remove the **"Stock coming in"** card and everything that exists only for receiving seller stock notes: in Ops
  `pages/Sellers/SellerDetail.tsx` (+ its dialogs/parts), the "goods on their way" badges/counts on the Sellers list
  and hub cards (`HubCards`, `Sellers.tsx`), any stock-notes list/page and its route and More entry; in Admin the
  same in `pages/SellerDetail.tsx` and `pages/Sellers.tsx` (the Sellers page badge "goods on their way"). Keep the
  seller statement, payout requests, commission, location approval and product approval exactly as they are.
* Remove the unused API client functions/types for stock notes in both apps (`sellerStockNotes`, receive / cancel
  note calls) once nothing uses them; update or delete the tests that only covered them (do not weaken unrelated
  tests; say in your report which test files changed).
* Show each seller product's current stock (read-only: "Stock 12") in the seller's product list in Ops and Admin
  if the data is already in the existing responses (the seller product rows carry stock fields); if it is not, skip
  this and say so.
* Wherever staff-facing text says "the seller gets an SMS", change it to "the seller gets an app notification".
