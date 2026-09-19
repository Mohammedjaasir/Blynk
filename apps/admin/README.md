# Blynk Ops (Admin)

Internal operations web app for the Blynk platform: catalog, product images
and the customer Home promotions.

It is a separate interface, not a separate system — it talks to the same
Blynk API and the same PostgreSQL database as the customer Flutter app.

```
apps/admin (this app) ─┐
                       ├─► Blynk API ─► PostgreSQL
apps/customer (Flutter)┘
```

## Running it

```bash
cd apps/admin
npm install
cp .env.example .env     # points at http://localhost:4000/api/v1 by default
npm run dev              # http://localhost:5173
```

The backend must be running (`cd backend/api && npm run dev`) with its
database migrated and seeded.

Sign in with a phone number whose account has the **ADMIN** role; the dev
seed ships one (`+94775551122`). Outside production the API returns the OTP
in the response and the sign-in screen shows it, clearly labelled.

## What it can do

- **Products** — list (including inactive), search, filter by category and
  status, add, edit, enable/disable, upload/replace/remove the product image.
- **Categories** — add, edit, activate/deactivate. The API has no delete
  endpoint, so the app doesn't offer one.
- **Home promotions** — create, edit, activate/deactivate, reorder, delete,
  upload a visual, and preview how the card will read.

Inventory and Riders are later phases and appear only as inert labels.

## Notes

- **Security is enforced by the API, not here.** Every admin route requires
  `requireAuth` + `requireRoles('ADMIN')` server side; route guards in this
  app are a convenience for the operator.
- **No secrets belong in `VITE_*` variables** — they are compiled into the
  browser bundle. The only one used is the API base URL.
- Images are downscaled in the browser (≤1200 px, WebP) before upload; the
  API caps a file at 2 MB and verifies the format by magic number.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and production build |
| `npm run typecheck` | Types only |
| `npm test` | Vitest suite |
