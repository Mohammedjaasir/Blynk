# Catalog: MRP (Maximum Retail Price) (migration 048)

Owner decisions, 2026-10-14:

- Every **product** and every **size** (variant) has an optional MRP (LKR, above 0, up to 2 decimals).
- **Cap at MRP.** When the selling price the rule gives (markup or fixed price) is higher than the MRP, the customer pays the MRP. Staff see "Capped at MRP (markup would give LKR X)".
- An offer must be **below** the (capped) selling price, so an offer at or above the MRP is refused.
- **Customers see the MRP only when our price is lower**: "~~MRP LKR 300~~ LKR 280". When the price equals the MRP only the price shows.
- Everything is controllable in **both Admin and Ops** (roles `ADMIN`, `OPERATIONS`).

Envelope as usual: `{ "success": true, "data": ... }`; errors `{ "success": false, "error": { "code", "message", "details" } }`.

---

## 1. Where the cap is applied (one rule, server side)

| layer | where |
|---|---|
| SQL | `v_product_catalog.calculated_selling_price` and `v_product_variant_catalog.calculated_selling_price` are `LEAST(computed, mrp)` (a NULL MRP never caps). Every view reader - catalog list, product page, size list, offers and the `on_offer` filter, combos, staff screens - gets the capped price. |
| TypeScript | `src/modules/pricing/index.ts` `capAtMrp`, used by `resolveSellingPrice` / `resolveVariantPrice` (the views' twins). Order creation (`priceCart`: checkout, coupon preview, order), the offer checks and the Excel import all go through them. |

The server always prices the cart itself; the app never sends a price. A size's MRP is its **own**: a size without an MRP is not capped by its product's MRP.

Order lines snapshot the MRP: `order_items.mrp_snapshot` (NULL when none). When a line was capped, `markup_percentage_applied` is the markup the MRP gives over cost (reporting only).

---

## 2. Staff (Admin and Ops)

### Product create / update

`POST /api/v1/admin/products`, `PATCH /api/v1/admin/products/:id`

| field | type | rule |
|---|---|---|
| `mrp` | number \| null | Optional. Above 0, at most 99,999,999.99, at most 2 decimals. `null` clears it (PATCH); omitted = unchanged. |

Changing the MRP re-checks a running offer: `400 OFFER_PRICE_NOT_LOWER` when the offer would no longer be below the (capped) price; the message then says "capped at the MRP" and `details.mrp_capped = true`.

### Size (variant) create / update

`POST /api/v1/admin/products/:id/variants`, `PATCH /api/v1/admin/products/:id/variants/:variantId` accept the same `mrp` field (the size's own).

### Staff responses

`GET /api/v1/admin/products`, `GET /api/v1/admin/products/:id`, product create/update, and every staff variant object gain:

| field | type | meaning |
|---|---|---|
| `mrp` | number \| null | The MRP (null = none). |
| `computed_selling_price` | number | What the markup / fixed price gives **before** the cap. |
| `mrp_capped` | boolean | `computed_selling_price > mrp`: `selling_price` (and `calculated_selling_price`) is the MRP. |

`selling_price` / `calculated_selling_price` are the capped price. `effective_markup_percent` and `pricing_source` still describe the rule that produced `computed_selling_price`. `price_warning` (`SELLING_BELOW_COST`) now also appears when an MRP under the purchase cost caps the price.

Example (cost 100, markup 50%, MRP 120):

```json
{ "purchase_cost": 100, "effective_markup_percent": 50, "pricing_source": "PRODUCT_MARKUP",
  "computed_selling_price": 150, "mrp": 120, "mrp_capped": true,
  "selling_price": 120, "calculated_selling_price": 120 }
```

---

## 3. Customers

`GET /api/v1/products`, `GET /api/v1/products/:idOrSlug` (and the `/catalog` aliases): every product and every size in `variants[]` gains

| field | type | meaning |
|---|---|---|
| `mrp` | number \| null | The MRP **only when it is above the price the customer pays right now** (`offer_price ?? selling_price`; a size's `price`); otherwise `null` (no MRP, or the price is the MRP). For a product with sizes: the cheapest size's (the same size `selling_price` / `offer_price` describe). |

Chosen design: the server decides whether the MRP is worth showing, so an older app that ignores the field is unaffected and a new app only needs `mrp != null`. `selling_price` is already capped. Customers never receive `computed_selling_price` or `mrp_capped`.

### Display rule (customer app, `src/blynk/lib/pricing.ts` `priceDisplay`)

The struck reference follows Admin's `show_offer_savings` switch exactly like the struck offer price did before (off = no struck price at all).

| case | shows |
|---|---|
| MRP above the price, no offer | **LKR 280** MRP ~~LKR 300~~ |
| price == MRP (e.g. capped) | **LKR 300** |
| offer, MRP at/above the selling price | **LKR 250** (green) MRP ~~LKR 300~~ |
| offer, no MRP | **LKR 250** (green) ~~LKR 280~~ (as before) |
| no offer, no MRP | **LKR 280** |

Sizes: each row in the size picker applies the rule with its own `mrp`. A tile with sizes strikes the product-level `mrp` (its cheapest size's) only where it shows one starting price ("From LKR 50" on a narrow tile, or one price); beside a full range ("LKR 50 - 350") no MRP is struck, and on an offer the regular price stays the reference as before (`sizedStruck`). The tile keeps at most one small label (the struck price never adds a caption).

Order on screen follows the existing offer layout (clean pass, 2026-10-14): our price first and prominent, then "MRP ~~LKR 300~~" (only the amount struck). The product page's "Save LKR X" (offers only) counts from the struck reference. Cart lines strike MRP x quantity. Offer savings in the bill are unchanged (regular price - offer price); MRP differences are not counted as savings.

---

## 4. Excel import (Admin Bulk upload, Ops Bulk upload)

`POST /api/v1/admin/products/import` (unchanged envelope), new optional column **`mrp`** on product rows and size rows.

- Blank = no MRP for a new product/size, **unchanged** for an existing one (like every blank price cell). Remove an MRP in the product form.
- Invalid cells: `MRP must be a number`, `MRP must be above 0`, `MRP is too large`, `MRP can have at most 2 decimals` (field `mrp`).
- Each row's `pricing` gains `mrp`, `computed_selling_price`, `mrp_capped`; a capped row also gets the warning `Capped at MRP LKR 120.00 (the price would be LKR 150.00)`.
- The response gains `mrp_capped`: how many rows (created / updated / skipped) are priced at their MRP. `summary` is unchanged.

```json
{ "dry_run": true,
  "summary": { "created": 3, "updated": 0, "skipped": 0, "errors": 1 },
  "mrp_capped": 2,
  "results": [ { "row": 2, "status": "created", "pricing": { "selling_price": 120, "computed_selling_price": 150, "mrp": 120, "mrp_capped": true }, "warnings": ["Capped at MRP LKR 120.00 (the price would be LKR 150.00)"] } ] }
```

---

## 5. Migration

`backend/api/src/database/migrations/048_product_mrp.sql` (046 was never used):

- `products.mrp NUMERIC(12,2) NULL CHECK (mrp > 0)`, `product_variants.mrp` the same, `order_items.mrp_snapshot NUMERIC(12,2) NULL`.
- `v_product_catalog` and `v_product_variant_catalog` recreated: `calculated_selling_price` capped; `mrp`, `computed_selling_price`, `mrp_capped` appended.
- Additive: every MRP starts NULL, so no price moves. `048_product_mrp_down.sql` restores the 045 views and drops the columns.

Tests: `backend/api/tests/product-mrp.test.ts`.
