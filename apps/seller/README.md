# Blynk Sellers (seller portal)

A responsive website (phone first, laptop friendly) where local sellers list
their products on Blynk. Blynk approves each seller and each product and sets
the customer price; Blynk holds the stock, delivers, collects the cash and
pays the seller by hand (see `docs/superpowers/specs/2026-10-23-seller-portal-design.md`).

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

- **Sign in** - phone number, then the SMS code (`/auth/otp/request`,
  `/auth/otp/verify` with `app: 'seller'`). First time: the shop name on the code
  step creates the shop. Resend timer, plain-word errors (number already used,
  wrong code, too many tries).
- **Status banner** on every screen: waiting, rejected (with the reason),
  suspended, approved. Only an APPROVED shop can add or edit products.
- **My products** - status chips (Live, Waiting for approval, Not approved with the
  reason, Off), your price vs the customer price, stock at Blynk, units sold.
  Editing makes a change that waits for Blynk; the live product stays as it is.
  A waiting change can be withdrawn.
- **Add / edit product** - category (sub-categories under their main), unit,
  pack size, description, barcode, your price, photo (camera or gallery).
- **Statement** - sold, commission, earned, paid, still due; date range; per
  product lines; payments from Blynk.
- **My shop** - shop profile.

## Deployment

`Dockerfile` + `nginx.conf` (same shape as Admin) for Coolify at
`blynk-seller.valgrowlabs.com`. The API address is a build argument:
`docker build --build-arg VITE_API_BASE_URL=https://blynk-api.valgrowlabs.com/api/v1 .`
