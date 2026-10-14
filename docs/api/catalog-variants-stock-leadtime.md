# Catalog: variants, customer-hidden stock, delivery lead time (migration 045)

Owner requests, 2026-10-14:

- **A. Variants** - "chilli powder has 50g, 100g, 250g, 500g with different prices"; "show LKR 50-350, then the proper price for the gram they pick".
- **B. Stock** - "set a stock count in the product edit; it must not show to the customer; low stock I see in Ops; out of stock they can't order". Rule chosen: customers can order until stock reaches 0.
- **C. Delivery lead time** - "items that can only be delivered after two days or some days".

Everything is controllable in **both Admin and Ops** (roles `ADMIN`, `OPERATIONS`). Customers never receive a purchase cost, markup, pricing source or stock count.

All responses use the usual envelope `{ "success": true, "data": ... }`; errors are `{ "success": false, "error": { "code", "message", "details" } }`.

---

## 1. Customer catalog

### `GET /api/v1/products` (and `/api/v1/catalog/products`)

Query parameters are unchanged (`page`, `limit`, `category_id`, `category_slug`, `search`, `is_available`, `on_offer`).

- `is_available=true` now means **orderable now**: switched on and, when its stock is tracked, not sold out (for a product with variants: at least one variant is).
- `on_offer=true` also lists a product with variants when one of its active variants is on offer (its own offer price or the category %).

Every product gains these fields (all products, with or without variants):

| field | type | meaning |
|---|---|---|
| `has_variants` | boolean | The customer must pick a variant; the order line then carries `variant_id`. |
| `variant_count` | number | Active variants (0 without variants). |
| `price_min` | number | What one unit costs right now (offers included). Without variants = `offer_price ?? selling_price`. With variants = the cheapest **available** variant (or the cheapest active one when all are sold out). |
| `price_max` | number | Same, the dearest. Show "LKR 50 - 350" when `price_min !== price_max`. |
| `is_available` | boolean | Orderable now (see above). A tracked product whose stock is used up is `false`. Never a count. |
| `delivery_lead_days` | number | 0 = same day / as soon as possible. N = can be delivered from today + N days. |
| `earliest_delivery_date` | string \| null | `YYYY-MM-DD` (Asia/Colombo) of the first delivery day when `delivery_lead_days > 0`, else `null`. Show "Delivered from Fri 17 Oct". |

For a product **with variants**, `selling_price`, `offer_price`, `offer_ends_at`, `offer_kind` describe the cheapest variant (so older apps still show a sensible price). New apps should show `price_min`-`price_max` on tiles.

Example list item (product with variants):

```json
{
  "id": "6f1c...",
  "name": "Chilli Powder",
  "slug": "chilli-powder",
  "category_id": "...", "category_name": "Spices",
  "sku": "CHILLI-PWD", "barcode": null, "unit": "1 pack", "pack_size": null,
  "description": null, "image_url": "https://...", "image_focal_x": 50, "image_focal_y": 50,
  "selling_price": 50, "offer_price": null, "offer_ends_at": null, "offer_kind": null,
  "is_available": true,
  "has_variants": true,
  "variant_count": 4,
  "price_min": 50,
  "price_max": 350,
  "delivery_lead_days": 0,
  "earliest_delivery_date": null
}
```

### `GET /api/v1/products/:idOrSlug`

Same fields as the list, plus `variants` (always present on the detail; `[]` without variants) and the existing `notify_me_subscribed`:

```json
"variants": [
  {
    "id": "a1...",
    "label": "50 g",
    "sku": "CHILLI-PWD-50G",
    "barcode": null,
    "sort_order": 0,
    "selling_price": 60,
    "offer_price": 50,
    "offer_ends_at": "2026-10-31T18:29:59.000Z",
    "offer_kind": "PRODUCT",
    "price": 50,
    "is_available": true
  },
  {
    "id": "a2...", "label": "100 g", "sku": null, "barcode": null, "sort_order": 1,
    "selling_price": 110, "offer_price": null, "offer_ends_at": null, "offer_kind": null,
    "price": 110, "is_available": false
  }
]
```

- Only **active** variants are listed, in staff order (`sort_order`). A sold-out one is listed with `is_available: false` (show it greyed out / "Sold out").
- `price` = what one unit costs now (`offer_price ?? selling_price`) - exactly what the basket will charge. `offer_kind` is `PRODUCT` (the variant's own offer) or `CATEGORY` (the category %; the lower of the two wins).
- No cost, markup, pricing source or stock count is ever included.

### Combos (`GET /api/v1/catalog/combos`, `/combos/:id`)

Each combo gains `delivery_lead_days` (the longest of its items). Each item gains `variant_id` and `variant_label` (null when the combo holds the product itself). A combo item that names a variant is priced, stocked and ordered as that variant.

---

## 2. Cart and orders

### `POST /api/v1/orders` (and `POST /api/v1/orders/validate-coupon`)

Order lines gain an optional `variant_id`:

```json
{
  "address_id": "...",
  "items": [
    { "product_id": "6f1c...", "variant_id": "a1...", "quantity": 2 },
    { "product_id": "9b2e...", "quantity": 1 }
  ],
  "delivery_slot_start": "2026-10-16T02:30:00.000Z"
}
```

- The server prices the variant itself (its fixed price, or its cost x its own / the product's / category / parent / global markup; its own offer or the category %, the lower). Any price the app sends is ignored.
- Each order item now also returns `variant_id` and `variant_label_snapshot` (null for products without variants); `unit_snapshot` is the variant label (e.g. "100 g") on variant lines.

New errors:

| HTTP | code | when |
|---|---|---|
| 400 | `VARIANT_REQUIRED` | A product with variants was sent without `variant_id`. `details: { product_id, name }` |
| 400 | `VARIANT_NOT_FOUND` | `variant_id` is not a live variant of that product. |
| 400 | `VARIANT_UNAVAILABLE` | The variant is switched off / marked unavailable. `details: { product_id, variant_id, name, label }` |
| 409 | `OUT_OF_STOCK` | A tracked item (product or variant) has nothing left. Message: "Sorry, Chilli Powder 100 g is sold out." `details: { product_id, variant_id, name, available: 0, requested }` |
| 409 | `INSUFFICIENT_STOCK` | Asked for more than is left. Message: "Only 3 left of Chilli Powder 100 g. Please lower the quantity." `details: { ..., available: 3, requested: 5 }` |
| 422 | `LEAD_TIME_REQUIRES_SLOT` | The cart holds an item with a lead time and no `delivery_slot_start` was sent (as soon as possible is not possible). `details: { lead_days, earliest_delivery_date, slots_enabled }` |
| 422 | `SLOT_BEFORE_LEAD_TIME` | The chosen slot is before today + lead days. `details: { lead_days, earliest_delivery_date }` |

Stock rule: customers can order a tracked product or variant until its **sellable** stock reaches 0, where sellable = on hand - reserved - units in open orders not yet packed (stock leaves the shelf when the order is packed). Loose items, combo items and variants are all checked together, under a row lock, so two customers can never both buy the last unit. Combos keep `COMBO_OUT_OF_STOCK` for their own advisory check. Untracked items are never limited.

### `GET /api/v1/orders/slots?product_ids=a,b,c` (or `?lead_days=N`)

`product_ids` (comma-separated, up to 100: the cart's product ids incl. combo item products) makes the server work out the cart's longest lead time. Response adds:

```json
{
  "enabled": true,
  "asap_available": false,
  "is_open_now": true,
  "lead_days": 2,
  "earliest_delivery_date": "2026-10-16",
  "earliest_delivery_label": "Fri 16 Oct",
  "slots": [ { "start": "2026-10-16T02:30:00.000Z", "end": "...", "label": "Fri 16 Oct 8:00-9:00 AM", "remaining": 5, "available": true } ]
}
```

- With `lead_days > 0` only slots from `earliest_delivery_date` onward are listed (the usual `days_ahead` window starts on that day), and `asap_available` is `false`.
- Without the parameters the answer is as before plus `lead_days: 0` and today's date.
- If slots are switched off and the cart has a lead time, the cart cannot be ordered: show the `LEAD_TIME_REQUIRES_SLOT` message ("... scheduled delivery is not available right now. Please remove it to order now.").

### `GET /api/v1/orders/checkout-info?product_ids=a,b,c` (or `?lead_days=N`)

Adds:

```json
"delivery_lead": {
  "lead_days": 2,
  "earliest_delivery_date": "2026-10-16",
  "earliest_delivery_label": "Fri 16 Oct",
  "asap_allowed": false
}
```

Without the parameters: `lead_days: 0`, today, `asap_allowed: true`.

---

## 3. Staff (Admin and Ops) - variants

All under `/api/v1/admin`, roles `ADMIN`, `OPERATIONS`. Every write is audited (`audit_logs`, entity `PRODUCT`, actions `PRODUCT_VARIANT_CREATED / _UPDATED / _DELETED`, `PRODUCT_VARIANTS_REORDERED`).

| method | path | body / answer |
|---|---|---|
| GET | `/products/:id/variants` | `{ variants: StaffVariant[] }` (inactive ones too) |
| POST | `/products/:id/variants` | create (below) -> 201 `{ variant }` |
| PATCH | `/products/:id/variants/:variantId` | any subset of the create fields (not the stock ones) -> `{ variant }` |
| DELETE | `/products/:id/variants/:variantId` | never ordered -> removed (`mode: "HARD"`); ordered -> soft-deleted (`mode: "SOFT"`) |
| PUT | `/products/:id/variants/order` | `{ variant_ids: [...] }` every live variant once, new order -> `{ variants }` |

Create body:

```json
{
  "label": "100 g",
  "sku": "CHILLI-PWD-100G",
  "barcode": null,
  "sort_order": 1,
  "purchase_cost": 70,
  "pricing_mode": "MARKUP",
  "custom_markup_percent": 30,
  "fixed_selling_price": null,
  "offer_price": null,
  "offer_ends_at": null,
  "is_active": true,
  "is_available": true,
  "track_stock": true,
  "stock_count": 15,
  "low_stock_threshold": 5
}
```

- `label` 1-64 chars, unique per product ignoring case (409 `VARIANT_LABEL_EXISTS`). `sku` optional, 3-64, unique across products and variants (409 `VARIANT_SKU_EXISTS`; product create/edit now also refuses a variant's SKU with `PRODUCT_SKU_EXISTS`).
- `pricing_mode` `MARKUP` (default) or `FIXED` (needs `fixed_selling_price` > 0). MARKUP: the variant's `custom_markup_percent`, else the product's custom markup, else category / parent / global.
- `offer_price` must be below the variant's selling price (400 `OFFER_PRICE_NOT_LOWER`); a new `offer_ends_at` must be in the future.
- `track_stock` / `stock_count` / `low_stock_threshold` (create only) set the variant's stock in the same request; later use the stock endpoint below.

`StaffVariant`:

```json
{
  "id": "...", "product_id": "...", "label": "100 g", "sku": "CHILLI-PWD-100G", "barcode": null,
  "sort_order": 1, "is_active": true, "is_available": true,
  "purchase_cost": 70, "pricing_mode": "MARKUP", "fixed_selling_price": null,
  "custom_markup_percent": 30, "product_markup_percent": null,
  "category_markup_percent": 25, "parent_category_markup_percent": null, "global_markup_percent": 20,
  "effective_markup_percent": 30, "pricing_source": "VARIANT_MARKUP",
  "selling_price": 91, "price_warning": null,
  "offer_price": null, "offer_ends_at": null, "offer_active": false, "customer_price": 91,
  "is_orderable": true,
  "stock": { "inventory_id": "...", "tracked": true, "on_hand": 15, "reserved": 0, "in_open_orders": 2,
             "sellable": 13, "low_stock_threshold": 5, "is_low_stock": false, "is_out_of_stock": false },
  "created_at": "...", "updated_at": "..."
}
```

`pricing_source` for variants: `FIXED`, `VARIANT_MARKUP`, `PRODUCT_MARKUP`, `CATEGORY_MARKUP`, `PARENT_CATEGORY_MARKUP`, `GLOBAL_MARKUP`. The live price preview in the forms uses the same rule client-side (the product response carries `custom_markup_percent`, `category_markup_percent`, `parent_category_markup_percent`, `global_markup_percent`).

### Staff product responses (`GET /admin/products`, `GET/POST/PATCH /admin/products/:id`)

Added fields: `delivery_lead_days`, `has_variants`, `is_orderable`, `variant_count`, `active_variant_count`, `price_min`, `price_max` (regular selling prices of the active variants; the product's own price without variants - "Product list shows price range"), `stock` (the product-level `StaffStock`, as above). The detail (`GET /admin/products/:id`, and the create/update answers) also carries `variants: StaffVariant[]`.

`POST/PATCH /admin/products` accept `delivery_lead_days` (whole days 0-30, default 0).

---

## 4. Staff - stock (product and variant)

Tracked vs untracked (unchanged meaning): an UNTRACKED product has no count and is never limited (sourced on order). A TRACKED one has an on-hand count in the ledger; its sellable stock limits orders and it appears on the Running low list at or below its low-stock level.

### `PUT /api/v1/admin/inventory/:productId/stock` (ADMIN, OPERATIONS) - new

The product form's Stock section in one call:

```json
{ "variant_id": null, "tracked": true, "stock_count": 24, "low_stock_threshold": 5, "reason": "Shelf count" }
```

- `tracked` required; `stock_count` (0-100000) needs `tracked: true` (409 `PRODUCT_NOT_TRACKED` / 400); `low_stock_threshold` 0-100000; `variant_id` targets a variant's stock (404 `VARIANT_NOT_FOUND` if it is not this product's).
- A changed count writes ONE ledger row (`INVENTORY_AUDIT_ADJUSTMENT`, before/after, who, "Stock count set to 24 (was 20): Shelf count"); tracking/threshold changes are written to `audit_logs` (`STOCK_SETTINGS_UPDATED`). Setting the count below the reserved units is refused (`INSUFFICIENT_AVAILABLE_INVENTORY`).
- Answer: `{ product_id, variant_id, stock: StaffStock }`.

### Existing inventory endpoints accept a variant

`PATCH /admin/inventory/:productId/mode`, `PATCH /admin/inventory/:productId/threshold` and `POST /admin/inventory/:productId/adjust` accept an optional `variant_id` in the body; `GET /admin/inventory/:productId?variant_id=` reads a variant's stock row. Without it they work on the product-level row exactly as before.

### `GET /admin/inventory/low-stock` and `GET /admin/inventory/purchase-list`

Now include variant rows. Each item gains `variant_id`, `variant_label`, `variant_sku`, `display_name` ("Chilli Powder - 100 g"); low-stock items also `quantity_in_open_orders` and `quantity_sellable`; purchase-list unit cost is the variant's purchase cost.

---

## 5. Excel import (`POST /api/v1/admin/products/import`)

Same Products sheet; three new optional columns: `parent_sku`, `variant`, `delivery_lead_days` (template in `apps/*/src/lib/importTemplate.ts`, identical in Admin and Ops, with a "How to fill" explanation and examples).

- A row with `variant` (or `parent_sku`) filled is a **variant row** of the product whose SKU is `parent_sku`. Needs `parent_sku`, `variant`, `purchase_cost`; `name`/`category`/`unit` are ignored. `sku`/`barcode` are the variant's own (optional). Pricing as for products; blank price cells keep an existing variant's pricing. `tracked`/`opening_stock` are the variant's stock (opening stock only when created).
- Product rows run first, so the product may be in the same file. Idempotent: variants match by product + label (ignoring case).
- Each result row gains `kind` (`product` | `variant`), and for variants `parent_sku`, `variant`, `variant_id`; dry run reports what would happen (`created` / `updated` / `skipped` / `error`) with the variant's price.
- `delivery_lead_days` on a product row: 0-30; blank = 0 for new products, unchanged for existing.

---

## 6. Database (migration 045)

`product_variants` (new), `products.delivery_lead_days`, `inventory.variant_id` (+ partial unique indexes replacing `UNIQUE (dark_store_id, product_id)`), `order_items.variant_id` / `variant_label_snapshot`, `combo_items.variant_id` (+ surrogate id), views `v_inventory_stock` (sellable stock), `v_product_variant_catalog`, and `v_product_catalog` with appended `delivery_lead_days`, `has_variants`, `stock_tracked`, `stock_sellable`, `is_orderable`. Products without variants behave exactly as before.
