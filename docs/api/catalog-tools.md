# Catalog tools (2026-10-14)

Four owner requests, built for the Admin site and the Ops app (owner rule:
everything controllable in both, except the destructive image wipe, which is
Admin-only). No database migration: everything fits the existing schema.

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
