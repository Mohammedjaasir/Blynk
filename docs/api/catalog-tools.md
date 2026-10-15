# Catalog tools (2026-10-14)

Five owner requests, built for the Admin site and the Ops app (owner rule:
everything controllable in both, except the destructive image wipe and the
"remove all products" wipe, which are Admin-only). No database migration: everything fits the existing schema.

All endpoints are under `/api/v1`. Staff endpoints need a staff Bearer token.

---

## 1. Category levels and the category import

### The three levels

The owner's list has Main -> Category -> Sub-category. They map onto the
model that already exists (migrations 025 and 026), which is exactly how the
customer apps already show the catalog:

| Owner's level | Stored as | Customer app |
| --- | --- | --- |
| Main (`1. GROCERY`) | a **category group** (`category_groups`) | a heading/section on the home |
| Category (`- Rice & Flour`) | a **top-level category** (`parent_id = null`, `group_id` = the group) | a tile in that section |
| Sub-category (`→ Rice \| Flour`) | a **child category** (`parent_id` = the category) | the sidebar on the category screen |

So no third category level was needed. Order: groups by `sort_order`;
top-level categories and each set of sub-categories by `display_order`, then
name (the existing Arrange rule).

Customer reads (unchanged):

- `GET /catalog/home-groups` - Mains in order, each with its active
  top-level Category tiles in order (`"More"` closes the list for ungrouped
  ones).
- `GET /categories` - every active category with `parent_id`; the
  sub-categories of a tile are the ones whose `parent_id` is its id, in
  `display_order`.
- `GET /products?category_slug=<slug>` - a Category's slug includes its
  sub-categories' products; a Sub-category's slug lists only its own.
- Inactive categories (e.g. "Books & Pens (add later)") are not returned.

### Staff endpoints (ADMIN + OPERATIONS)

`GET /admin/categories/import/template` ->
`{ text: "<the owner's list>", columns: ["main","category","sub_category","active"] }`

`POST /admin/categories/import`

```json
{ "text": "1. GROCERY\n- Rice & Flour → Rice | Flour", "dry_run": true }
{ "rows": [{ "main": "Grocery", "category": "Rice & Flour", "sub_category": "Rice", "active": "yes" }], "dry_run": true }
```

Send exactly one of `text` (max 20,000 chars) or `rows` (max 1,000; the
browser parses the .xlsx/.csv). Row keys are matched loosely ("Main",
"Main category", "Sub-category", "Sidebar", "Active"...). `active` is
yes/no (blank = yes).

Text format: `N. NAME` is a Main; `- Category` (or `•`, `*`, `–`) is a
Category under the last Main; `→` (or `->`, `=>`, `›`) followed by
`Sub | Sub` lists its Sub-categories; any other line is ignored and reported
in `ignored_lines`. `(add later)` / `(hidden)` / `(inactive)` after a name
creates it switched off.

Response (`data`):

```json
{
  "dry_run": true,
  "summary": { "mains": {"create":1,"update":0,"keep":0}, "categories": {...}, "sub_categories": {...}, "others_reordered": 12 },
  "tree": [
    { "name": "Grocery", "id": null, "action": "create", "changes": [], "active": true, "warnings": [], "source": 2, "sort_order": 0,
      "categories": [
        { "name": "Rice & Flour", "id": null, "action": "create", "display_order": 10, "changes": [], "warnings": [], "active": true, "source": 3,
          "sub_categories": [ { "name": "Rice", "id": null, "action": "create", "display_order": 10, ... } ] } ] }
  ],
  "warnings": ["5 existing categories are not in this list. ..."],
  "errors": [ { "line": 4, "message": "A category comes before any main category ..." } ],
  "ignored_lines": [ { "line": 1, "message": "BLYNK – CATEGORY SETUP (Ops → Catalog)" } ]
}
```

Rules: match by name ignoring case/spaces (Main among groups, Category
among top-level categories, Sub-category among that Category's children);
matched items keep their name/slug/image/offer/markup/on-off; nothing is
deleted or switched off; products are never touched; the listed items go
first in list order and everything else keeps its relative order after them;
a matched Category listed under another Main moves there. Names in CAPITALS
become Title Case ("GROCERY" -> "Grocery"); other names are kept as written.
Slugs are generated. `action` is `create` / `update` (with `changes`) /
`keep`. An apply with errors is refused: 400 `CATEGORY_IMPORT_INVALID`
(`details.errors`). Applied in one transaction, audited
`CATEGORIES_IMPORTED`. Re-applying the same list changes nothing.

### Products in a sub-category

The product form already takes any `category_id`, sub-categories included.
The product Excel import now also accepts:

- `category` = `Rice & Flour > Rice` (also `›` or `→`), or
- `category` = `Rice & Flour` plus a `sub_category` column = `Rice`, or
- the category's slug.

A plain name that matches more than one category is a row error asking for
the parent or the slug (it is never guessed).

---

## 2. Promotion banner targets

A banner can open any level. Stored in the existing columns (no new
destination type, so older apps keep working):

| Target | `cta_destination_type` | `cta_destination_value` (stored) |
| --- | --- | --- |
| Main section | `CATALOG` | the category group id |
| Whole catalog | `CATALOG` | `null` |
| Category | `CATEGORY` | the category slug |
| Sub-category | `CATEGORY` | the sub-category slug |
| Product | `PRODUCT` | the product id |

Staff may send a category id or slug and a product id or slug; the API
stores the form above. A target that does not exist is refused: 400
`INVALID_PROMOTION_TARGET`. A switched-off target is allowed. An update
that does not touch the destination is not re-validated.

Every promotion payload (customer `GET /promotions`, staff list/create/
update) now carries `cta_target`:

```json
"cta_target": {
  "level": "SUB_CATEGORY",           // MAIN | CATEGORY | SUB_CATEGORY | PRODUCT | CATALOG
  "id": "…", "slug": "rice", "name": "Rice",
  "parent_id": "…", "parent_slug": "rice-flour", "parent_name": "Rice & Flour",
  "is_active": true
}
```

`cta_target` is `null` when there is no destination or it no longer exists:
the customer app should then show no button / make the card not tappable.

**Customer app TODO:**

- `MAIN`: open the catalog/home scrolled to (or filtered to) the group
  `cta_target.id` (same id as `GET /catalog/home-groups` `groups[].id`).
- `CATEGORY`: open the category screen for `slug` (as today).
- `SUB_CATEGORY`: open the parent's screen (`parent_slug`) with the sidebar
  item `slug` selected. (Opening `/products` with the sub-category slug alone
  also works and lists only its products.)
- `PRODUCT`: open the product `id` (as today).
- `CATALOG`: open the catalog (as today).
- Older app builds ignore the value of `CATALOG`, so a Main banner simply
  opens the catalog there.

---

## 3. Doctor channelling on/off

Setting in the existing `doctors_access` row: `show_to_customers`
(default `true` = current behaviour). ADMIN + OPERATIONS, audited
`DOCTORS_ACCESS_UPDATED`.

- `GET /admin/settings/doctors-access` -> `{ require_sign_in, show_to_customers, updated_at }`
- `PATCH /admin/settings/doctors-access` with `{ "show_to_customers": false }`
  and/or `{ "require_sign_in": … }` (either field; the other keeps its value).

When **off**:

- `GET /store` -> `doctors_enabled: false` (new field; `true` when on).
  **Customer app: hide the whole doctors section (home entry, tab, deep
  links) when `doctors_enabled` is false.** `doctors_require_sign_in` is
  still sent.
- Discovery routes answer **404** `{ error: { code: "DOCTORS_DISABLED",
  message: "Doctor channelling is not available right now." } }`:
  `GET /dental/clinics`, `/dental/clinics/:id`, `/dental/clinics/:id/doctors`,
  `/dental/doctors/:id`, `/:id/availability`, `/:id/slots` - for guests and
  signed-in customers alike.
- New bookings are refused the same way: `POST /dental/appointments/holds`
  and `POST /dental/appointments/:id/confirm`.
- A customer's **existing appointments stay available**: `GET
  /dental/appointments`, `GET /dental/appointments/:id`, `POST /:id/cancel`
  and `POST /:id/rating` work as before, so nobody loses sight of (or the
  ability to cancel) a visit already booked. The app may keep a "My
  appointments" entry (e.g. in the account screen) while the section is
  hidden.
- Staff dental admin (`/admin/dental/...`) is unaffected.

---

## 4. Remove all product images (ADMIN only)

Owner decision: clear every product's image link and delete the uploaded
files. Admin-only (not Operations) because it is destructive, store-wide and
cannot be undone.

- `GET /admin/products/remove-images/preview` ->
  `{ products, combos, files, files_on_disk, external_links }` (dry run).
- `POST /admin/products/remove-images` with `{ "confirm": "REMOVE" }` ->
  `{ products_cleared, combos_cleared, files_deleted, files_missing, files_kept_in_use }`.
  Anything else in `confirm` -> 400 `VALIDATION_ERROR`.

What it does: every product (soft-deleted ones too) gets `image_url = null`
and its focal point reset to the centre (50/50); every combo pack image is
cleared too. Files deleted: only `MEDIA_ROOT/products/<file>` that a cleared
link pointed at, through the media storage helper (containment-checked), and
only if no category, promotion or doctor photo still uses the same file.
Category, promotion and doctor images are not touched. Audited
`PRODUCT_IMAGES_REMOVED_ALL` with the counts. Idempotent.

Customer apps: products simply have `image_url: null` afterwards (already
handled by the placeholder tile).

---

## 5. Remove all products (ADMIN only)

Owner (2026-10-14): "remove all the existing products and images" - then load
a fresh product list (without images) with the Excel bulk upload. Admin-only
(Operations gets 403; not in the Ops app), like section 4.

- `GET /admin/products/remove-all/preview` (dry run) ->

```json
{
  "products": 120, "variants": 14, "products_with_images": 80,
  "combos": 3, "promotions": 2, "banners_linked": 0, "stock_alerts": 5,
  "open_orders": 4, "products_in_open_orders": 9,
  "images": { "products": 82, "combos": 1, "files": 70, "files_on_disk": 68, "external_links": 0 }
}
```

  `products` = live products; `variants` = their live sizes/packs;
  `combos` = active combo packs holding one; `promotions` = active home
  carousel banners whose button opens one; `banners_linked` = hero banner /
  promo band settings whose button opens one (left as they are, see below);
  `stock_alerts` = "notify me" subscriptions; `open_orders` = orders not yet
  DELIVERED / CANCELLED / FAILED holding one; `images` = the section 4 dry run.

- `POST /admin/products/remove-all` with
  `{ "confirm": "DELETE ALL PRODUCTS", "also_remove_images": true }`
  (`also_remove_images` optional, default `true`) ->

```json
{
  "products_removed": 120, "variants_removed": 14, "combos_switched_off": 3,
  "promotions_switched_off": 2, "stock_alerts_cleared": 5, "open_orders_kept": 4,
  "images": { "products_cleared": 82, "combos_cleared": 1, "files_deleted": 66, "files_missing": 2, "files_kept_in_use": 2 }
}
```

  `images` is `null` when `also_remove_images` is `false`. Any other
  `confirm` (or a non-boolean `also_remove_images`) -> 400 `VALIDATION_ERROR`
  and nothing changes (the same validation status as section 4).

What it changes, in ONE transaction (every live product locked first, so an
order being placed for one either commits before it or is refused after it):

| What | Change |
| --- | --- |
| products (live) | **soft-deleted**: `deleted_at` set, `is_active` / `is_available` false. Never hard-deleted (order items and inventory reference them). |
| product_variants of those products | soft-deleted the same way |
| combos holding one (active) | `is_active = false`; their items are kept |
| promotions (active) opening one | `is_active = false` (the target value is kept so staff can see what it was; re-point and switch on again) |
| stock_alerts for them | deleted |
| images (`also_remove_images`) | exactly section 4: every product (soft-deleted too) and combo image link cleared; after commit the unused files under `products/` deleted |

Promotions are switched off rather than re-pointed at the whole catalog: a
banner made for one product would otherwise keep advertising something that
no longer exists. The hero banner and promo band are settings and are not
touched: a deleted target already makes their button fall back to the app's
own behaviour.

Not touched: categories, category groups, settings, orders and order items,
inventory rows and their ledger, customers, riders, doctors.

Open orders stay fulfillable: order screens (customer, Ops, Rider) read the
order item snapshots (name, SKU, unit, variant label, prices), never the
live product; packing takes stock from the inventory rows, which stay; a
soft-deleted variant is still the row an item's `variant_id` points at.

Re-import: SKU and slug are unique only among live products (migration 017)
and variant SKUs only among live variants, so the bulk upload re-creates the
same SKUs as new products (new ids). Removed products are not restored by it.

Audited once: `PRODUCTS_REMOVED_ALL` with the result counts and
`also_remove_images`. Idempotent: a second run removes 0. Open customer apps
refresh straight away (the catalog triggers NOTIFY `catalog_changed` on
commit; the API also queues a catalog event itself). No rate limit (section 4
has none either); the typed words are the guard.
