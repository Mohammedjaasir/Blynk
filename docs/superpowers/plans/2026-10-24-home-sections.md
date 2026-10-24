# Home sections (timed offer rails) - contract (2026-10-24)

Owner's brother, 2026-10-24 (screenshot of Home: the "Under LKR 300" rail and the "Earn Blynk points" offer
tiles): "How can we add things here? Like if we need snacks, if we need juices to come, and showcase timely
offers also with a countdown timer. Not only countdown offers: if some product is no sale after a specific
time we need to show that."

So staff can add their own product rails to the customer app's Home (Snacks, Juices, "Weekend offers"...),
each optionally with a start / end time and a live countdown, and the app says when something is only
orderable until a time.

## Data (no migration)

`system_configurations` key `home_sections`: `{ sections: HomeSection[] }`, at most 8. No row = no sections.

```
HomeSection = {
  id: string,                 // uuid, assigned by the server on first save when missing
  title: string,              // 2-28 chars, one line  e.g. "Fresh juices"
  subtitle: string | null,    // up to 40 chars        e.g. "Cold and ready until 6 pm"
  source:
    | { kind: 'CATEGORY', category_id: string }     // the products of a category (and its sub-categories)
    | { kind: 'PRODUCTS', product_ids: string[] },  // 1-12 hand-picked products, shown in this order
  is_active: boolean,
  starts_at: string | null,   // ISO datetime with offset; before it the section is hidden
  ends_at: string | null,     // ISO datetime with offset; after it the section is hidden; > starts_at
  show_countdown: boolean,    // true: the app shows "Ends in 02:14:09" counting down to ends_at (needs ends_at)
  max_items: number           // 4-12, default 8: how many products the rail shows (CATEGORY source)
}
```
Array order = order on Home.

## API (Agent E1, backend)

- Staff `GET|PUT /api/v1/admin/settings/home-sections` (ADMIN + OPERATIONS; PUT replaces the whole list; audited
  `HOME_SECTIONS_UPDATED`). GET returns `{ sections: (HomeSection & { status: 'LIVE'|'SCHEDULED'|'ENDED'|'OFF', source_name: string })[], updated_at }`.
  Validate: ids of categories/products must exist (400 `CATEGORY_NOT_FOUND` / `PRODUCT_NOT_FOUND`), `show_countdown`
  needs `ends_at`, `ends_at` after `starts_at`, product ids unique, max 8 sections.
- Public `GET /api/v1/store` gains `home_sections`: only the LIVE ones (active, inside their schedule), in order, as
  `{ id, title, subtitle, ends_at, show_countdown, max_items, category: { id, slug } | null, product_ids: string[] | null }`
  (CATEGORY source -> `category`, PRODUCTS source -> `product_ids`). Missing/empty = `[]`. The 30 s /store cache applies.
- Module: `backend/api/src/modules/configuration/home-sections.ts` (pattern: `availability-windows.ts`, `qr-links.ts`),
  routes in `configuration/index.ts`, public part in `settings.service.ts getPublicStore`.

## Staff screens (Agent E1)

Admin page "Home sections" (nav group Home, route `/home-sections`) and the same page in Ops (Catalog hub card
"Home sections", route `/catalog/home-sections`): list in order with up/down buttons, add/edit/remove, title, subtitle,
source picker (category dropdown, or search-and-pick up to 12 products - reuse the pickers in AvailableHours.tsx /
Promotions.tsx), schedule (datetime-local start/end), "Show a countdown to the end" switch, status chip, Save.
A small live preview of the rail header (title, subtitle, countdown text) is nice to have.

## Customer app (Agent E2)

New component(s) under `apps/customer-app/src/components/` (`HomeSections.tsx` + pure helpers/tests under
`apps/customer-app/src/blynk/promo/homeSections.ts`) and a one-line mount in `app/(tabs)/home.tsx`
(directly after the "Under LKR 300" rail; keep the edit to home.tsx minimal). Each live section is a horizontal rail like
the "Under LKR 300" one (reuse the same ProductCard / rail components and spacing), header = title (+ subtitle), "See all"
opening the category when the source is a category. Products come from the catalogue the app already loads
(`useCatalog`); PRODUCTS source keeps staff order and skips products missing/unavailable; hide a section with no products.
With `show_countdown` + `ends_at`: a pill on the header "Ends in 02:14:09" (days when >= 24 h: "2d 04:10"), ticking
every second, reduced-motion safe, turns into nothing after the end (the section then disappears without a reload).
Pure code (countdown text, section list from /store data + catalogue) goes in `src/blynk/promo/homeSections.ts` with
vitest tests; add `home_sections?: PublicHomeSection[]` to `StoreInfo` in `src/blynk/api/types.ts`.
