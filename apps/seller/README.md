# Blynk Sellers (seller portal)

A responsive website (phone first, laptop friendly) where local sellers list
their products on Blynk. Blynk approves each seller and each product and sets
the customer price; Blynk delivers, collects the cash and pays the seller by
hand, and the seller types their own stock numbers (see `docs/superpowers/specs/2026-10-23-seller-portal-design.md`).

It talks to the same Blynk API as every other app, under `/api/v1/seller`
(contract: `docs/superpowers/plans/2026-10-24-seller-portal.md`). It shares no
code with the other apps; small helpers are copied.

## Running it

```bash
cd apps/seller
npm install
cp .env.example .env     # points at http://localhost:4000/api/v1 by default
npm run dev              # http://localhost:5176
npm test                 # vitest + testing-library, fake fetch (src/test/mockApi.ts)
npm run typecheck
npm run build
```

Outside production the API returns the SMS code in the response and the
sign-in screen shows it, labelled as a test code.

## Screens

- **Sign in** - invite-only: Blynk staff add the shop with its phone number in
  Admin / Ops, and the seller signs in with that number and the SMS code
  (`/auth/otp/request`, `/auth/otp/verify` with `app: 'seller'`). Nothing is
  created here. Resend timer, plain-word errors (number not registered as a
  seller `SELLER_NOT_REGISTERED`, number used for another account, wrong code,
  too many tries).
- **Status banner** on every screen: waiting, rejected (with the reason),
  suspended, approved. Only an APPROVED shop can add or edit products.
- **My products** - status chips (Live, Waiting for approval, Not approved with the
  reason, Off), your price vs the customer price, in stock, units sold.
  Editing makes a change that waits for Blynk; the live product stays as it is.
  A waiting change can be withdrawn.
- **Add / edit product** - category (sub-categories under their main), unit,
  pack size, description, barcode, your price, photo (camera or gallery).
- **Statement** - sold, commission, earned, paid, still due; date range; per
  product lines; payments from Blynk. "Ask for payment" (bank or cash at the
  store; one open request at a time, withdraw while it waits) and its history.
- **My stock** - every approved product with its number, a box with - / + and
  Save (`PUT /seller/products/:id/stock`: the number becomes the live stock);
  "Out of stock" at 0 and "Low" at 1-5; the API's friendly refusal (below what
  open orders reserved, not counted by Blynk, sizes) shows under the box.
  Pending or rejected products have no box.
- **Installable app + notifications** - the site is a PWA (`public/manifest.webmanifest`,
  icons in `public/icons`): an "Install the Blynk Seller app" strip (Install button on
  Android / Chrome, "Tap Share, then Add to Home Screen" on an iPhone), and on My shop a
  "Get notifications" card (Turn on / Turn off, blocked and unsupported states; on an
  iPhone the app must be installed first). Push is Firebase Cloud Messaging web push:
  `public/firebase-messaging-sw.js` at the site root, the token goes to `POST /me/devices`
  and is deleted on Turn off and on sign-out; a push while the app is open shows as a
  toast. The logic is in `src/lib/push/` and `src/lib/install.ts` (no bundled Firebase,
  the compat SDK loads from gstatic at run time). Sellers get no SMS except the sign-in code.
- **Best sellers** on the home screen (approved shops): this week or 30 days,
  trend against the period before, stock left and "Restock soon" (with an "Update stock" link).
- **My shop** - shop profile; the sign-in number is shown read-only.

Payment requests and best sellers need the seller-requests database
change. Until it is live the API answers 503 SELLER_REQUESTS_NOT_READY and the
portal quietly leaves those parts out.

## Deployment

`Dockerfile` + `nginx.conf` (same shape as Admin) for Coolify at
`blynk-seller.valgrowlabs.com`. The API address is a build argument:
`docker build --build-arg VITE_API_BASE_URL=https://blynk-api.valgrowlabs.com/api/v1 .`
