# Blynk Frontend Data Layer — Implementation Report

## Scope note

This report covers the **data layer connection** phase, per your explicit redirect: "Build the data layer first... Do NOT start redesigning every screen yet." The full visual UI-kit redesign described in the original request (screen-by-screen premium restyling against the reference kit) has **not** been done — this phase connects the *existing* screens to real backend data and real state management, replacing hardcoded placeholder content. Visual redesign remains a separate, later phase.

## 1. Reference UI kit analysis

Not applicable to this phase — no visual redesign work was done. See the scope note above.

## 2. Existing Blynk components reused

- `ApiService.requestMethods` (`lib/Infrastructure/HttpMethods/requesting_methods.dart`) — the existing Dio client with auth-token interceptor and 401 auto-refresh. Every new provider calls through this; no second API client was created.
- `AuthProvider` pattern (`ChangeNotifierProvider`, loading/error state fields, `notifyListeners()`) — followed exactly for all four new providers.
- `UserModel` (`lib/Models/user_model.dart`) — its `fromJson`/snake_case-with-camelCase-fallback convention was mirrored for every new model.
- `ApiException` — reused unchanged for all error handling.
- Existing Atomic Design structure (`Atoms`/`Organisms`/`Screens`) — no new top-level architecture introduced.

## 3. What was actually investigated first (Graphify-equivalent)

Before writing code: inspected `lib/Screens`, `lib/UI/Widgets`, `lib/Services/Providers`, `lib/Models`, and the running backend's actual source (`backend/api/src/modules/{catalog,orders,users,payments}`) — controllers, Zod schemas, and the Postgres migration (`001_initial_schema.sql`) — to get the **exact** field names and response envelopes, rather than guessing. Confirmed:
- Only `AuthProvider` existed; no cart/product/address/order state anywhere.
- The backend already has full modules for catalog, orders, and address CRUD — it was the frontend, not the backend, that had no data layer.
- `payments` is a deliberate stub (`GET /status` → `"ready"`) — confirms COD-only Phase 1 is correct as-is, nothing to wire there.
- No favorites/wishlist backend module exists at all.

## 4. Providers created (new)

| Provider | File | Backend endpoints used |
|---|---|---|
| `ProductProvider` | `lib/Services/Providers/product.provider.dart` | `GET /catalog/categories`, `GET /catalog/products` (category filter + free-text search) |
| `CartProvider` | `lib/Services/Providers/cart.provider.dart` | none — client-side by design; the backend has no cart endpoint (orders are created directly from line items) |
| `AddressProvider` | `lib/Services/Providers/address.provider.dart` | `GET/POST /me/addresses`, `GET/PATCH/DELETE /me/addresses/:id`, `POST /me/addresses/:id/default` |
| `OrderProvider` | `lib/Services/Providers/order.provider.dart` | `POST /orders`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel` |

All four registered in `main.dart`'s `MultiProvider` alongside the existing `AuthProvider`.

## 5. Models created (new)

`CategoryModel`, `ProductModel` + `ProductPage`, `AddressModel`, `OrderModel` + `OrderItemModel` (`lib/Models/`). Each field name matches the backend's actual DTO/schema exactly (verified against source, not assumed) — e.g. `ProductModel` has **no** `purchaseCost`/`markup` fields at all, mirroring the backend's `CustomerProductDto`, which strips those server-side before the customer response is even sent.

## 6. Screens/components reused-and-rewired (not recreated)

Existing files were rewired to real data in place rather than duplicated:

- **Catalog**: `HomeScreenCateogoryWidget`, `CatgorywithProducts`, `ProductsScreen`, `products_screen_grid.dart`, `ProductCard`, `ProductCardForList`, `AddToCartButton` (now shows a real `[-] qty [+]` stepper backed by `CartProvider`), `product_description_modal_opener.dart`.
- **Search**: `ProductsSearchDelegate` — was hardcoded `kDummyProducts` string matching; now calls `ProductProvider.search()` against the live catalog, with a real "no results" empty state.
- **Cart**: `CartScreen`, `CartProductCard`, `CartPriceDetailWidget`, `CartTimeandTotalItemCard`, `CartScreenAddressContainer`, `CartScreenPaymentContainer`. `CartScreen` now shows a real empty-cart state when `CartProvider.isEmpty`.
- **Address**: `UserAddressScreen`, `AddressCard`, `AddNewAddressCard` — now list/select/edit/delete/set-default against real data.
- **Orders**: `OrdersScreen`, `OrderSummaryScreen`, `OrderDetailsCard`, `OrderSummaryProductsDetails`, `OrderSummaryProductCard`, `OrderConfirmationScreen`.
- **Navigation**: `route_generator.dart` — `/products` now takes a category slug, `/order` now takes an order ID.

## 7. Components created (genuinely new)

- `AddEditAddressScreen` (`lib/Screens/add_edit_address_screen.dart`) — didn't exist before; the backend's `createAddressSchema` requires explicit numeric `latitude`/`longitude`, so this is a plain form (no map picker exists in this project) defaulted to the real Dharga Town hub coordinates, editable by the user.
- `CategorySidebar` (replacing `products_screen_sub_category_list.dart`'s fake `subCategory` list) — the backend's catalog is flat (no subcategory concept in the schema), so this was repurposed as a real "browse other categories" rail using the same category data shown on Home, instead of an invented taxonomy.

## 8. Fake data removed

- The horizontal product carousel's `₹100 / ₹120 struck-through` fake discount (`card_product_list.dart`) — deleted; no discount concept exists in the backend.
- The cart's itemized "Handling Charge" / "Late Night Convenience Charge" (`card_individual_price.dart`) — file deleted entirely; replaced with real Subtotal / Delivery Fee (`Rs. 70` estimate, backend-authoritative at checkout) / Total.
- The "Delivery in 28 minutes" / "Delivered in 10 minutes" fabricated ETA claims on the cart and orders screens — removed; no ETA data exists in the backend.
- "Download Invoice" / "Arrived at 9:29pm" on the order summary screen — removed (no invoice or arrival-time data exists).

## 9. Checkout flow

`CartScreenPaymentContainer`'s "Place Order" now calls `OrderProvider.placeOrder(cart, addressId)`, which submits `{address_id, items: [{product_id, quantity}]}` to `POST /orders`. The backend independently re-verifies the delivery geofence and recalculates all prices/totals from its own catalog data — the client's `CartProvider.subtotal` is shown as an estimate during shopping only; `OrderModel.totalAmount` from the server response is what's actually authoritative and displayed on confirmation/order-detail screens. On success, the cart is cleared and the app navigates to `OrderConfirmationScreen`, which shows the real order number and offers **Track Your Order** / **Back to Home** (previously this screen showed generic "Thank you" copy and auto-redirected after a fixed 5-second timer with no real order data at all).

## 10. Cancellation

`OrderModel.isCancellable` mirrors the backend's rule exactly (`PLACED`/`PACKED` only) — verified in `order_model_test.dart`. The Cancel button on `OrderDetailsCard` only renders when this is true, so the UI never offers an action the backend would reject.

## 11. Performance considerations

No change to rendering strategy — grids already used `GridView.builder`/`SliverGrid`. `ProductProvider` caches products per category slug (`_productsByCategory` map) so revisiting an already-loaded category doesn't refetch.

## 12. Backend environment (for this session's live verification)

The backend was not running at the start of this task. Brought up for real (not mocked) verification:
- Started Docker Desktop, then `postgres:16-alpine` via `backend/docker-compose.yml` (already-cached image; the `api`/`worker`/`migration` Docker services could not be built in this offline sandbox — DNS resolution to Docker Hub failed — so the Node API server was run directly via `npm run dev`, per the root README's own documented local-dev path).
- `npm run migrate:up` (already applied — persisted volume), `npm run seed`, `npm run dev`.
- Backend confirmed live at `http://localhost:4000`, seeded with 2 categories ("Dairy & Eggs", "Biscuits & Snacks") and 5 products.

## 13. Live verification performed

- Direct `curl` calls to `/catalog/categories` and `/catalog/products` confirmed the real response shapes used to write the models (not assumed).
- Ran the actual Windows app against the live backend and confirmed via screenshot that Home now shows the real seeded categories ("Dairy & Eggs", "Biscuits & Snacks") instead of the old 20 hardcoded placeholder names.
- Confirmed via the backend's own request log that the running app made **6 real HTTP requests** (`GET /catalog/categories` ×2, `GET /catalog/products?category_slug=dairy-eggs`, `GET /catalog/products?category_slug=biscuits-snacks`, plus 2 from direct curl verification), **all returning `200 OK`** — concrete proof of working end-to-end integration, not just plausible-looking code.
- One transient `RenderFlex overflow` was logged in the promo carousel on the very first frame after a fresh launch; it did not reproduce in the settled screenshot or on recalculation at the app's actual window width, and is noted here rather than silently ignored (see §14).

**Not live-verified in this session**: Cart, Address CRUD, Checkout submission, and Orders list/detail all require an authenticated session (`requireAuth` on those backend routes), and completing a live OTP login was not exercised end-to-end via UI automation in this session (see the mouse-click-reliability note from earlier work in this conversation). Confidence for these flows comes from: (a) the code following the identical, now-verified pattern as the catalog integration, (b) `flutter analyze` clean, and (c) unit tests asserting the exact request/response field names against real captured backend JSON. This is a real gap between "compiles and matches the verified contract" and "clicked through and watched it work" — flagged honestly rather than claimed as fully tested.

## 14. Flutter analyze result

Clean. 4 pre-existing `info`-level lints remain, all in files untouched by this phase (`otp_verification_screen.dart` ×2, `coupons_screeen.dart`, `login_screen_otp_sheet.dart`) — down from 8 at the start of this phase, since several touched files' pre-existing lints were fixed incidentally.

## 15. Flutter test result

**30/30 passing** (was 16 before this phase). 14 new tests added: `product_model_test.dart` (3), `cart_provider_test.dart` (6), `address_model_test.dart` (2), `order_model_test.dart` (3) — all using real JSON shapes captured from the live backend, not invented fixtures.

## 16. Remaining gaps / next steps

- **Favorites**: no backend module exists at all. Not implemented, and not fakeable without inventing a persistence layer the backend doesn't have. Flagging as an API gap per your own instruction, not building around it with local-only fake state.
- **Product images**: seeded products all have `image_url: null`; the UI now shows a clean icon fallback rather than a broken image, but no product photography exists yet.
- **Visual/premium redesign**: entirely separate from this phase — the screens above now show *real* data but are still using the existing (pre-redesign) visual styling, per your explicit "don't redesign yet" instruction.
- **Repeat Order** button on the order summary screen still just navigates to the cart (unchanged behavior) rather than re-adding that order's specific items — scoped out of this phase for time; would need a `getProductById` lookup per item to fetch current price/availability before re-adding.

---

# Live Customer Flow Verification

This phase's mandate was to verify — not redesign — the real customer flow end to end, with the previous phase's own flagged gap ("Cart/Address/Checkout/Orders were never exercised through a live login") as the top priority. Per your instruction, Graphify-equivalent inspection was done first (`AuthProvider`, `ApiService`, the four data providers, the auth/checkout/address/order screens) before writing anything.

**This verification found and fixed a critical, previously-unreported bug: login itself was broken against the real backend.** Every claim in §13 of the prior report about the data layer being "connected" was true for catalog (which was actually called), but auth/cart/address/checkout/orders had only been verified by reading schemas, not by an actual call — and the actual call failed every time.

### Root cause: authentication was completely non-functional

`AuthProvider.verifyOtp()`, `AuthProvider.refreshToken()`, and the Dio 401-refresh interceptor all expected tokens nested under a `data.tokens` object (`{accessToken, refreshToken}`). Calling the real, running `POST /auth/otp/verify` directly showed the actual shape is flat:

```json
{ "success": true, "data": {
  "access_token": "...", "refresh_token": "...", "token_type": "Bearer",
  "expires_in": 900, "user": { "id": "...", "phone": "...", "role": "CUSTOMER" }
}}
```

Since `data['tokens']` was always `null`, every verify attempt — correct OTP or not — fell through to `throw ApiException(400, 'Invalid response from authentication server')`. **No customer could ever have logged in.** The same nested-shape assumption also broke `refreshToken()` and the interceptor's silent 401 retry.

A second, related bug: `GET /auth/me` returns the user object flat on `data` (`data.id`, `data.phone`, ...), not nested under `data.user` as `loadCurrentUser()` assumed — so even a hypothetically-successful login's session restore (`restoreSession()` on app relaunch) would silently fail to refresh the cached user.

**Fixed**: extracted the parsing into two shared, independently-testable pure functions in the new `lib/Infrastructure/HttpMethods/auth_response_parsing.dart` (`extractAuthTokens`, `extractUserJson`), used by `AuthProvider` and the Dio interceptor alike so the two can't drift again. Both still accept the old nested shape as a fallback. Regression tests added in `test/auth_provider_test.dart` using the exact JSON captured from the live backend (8 new tests).

### Other real bugs found and fixed during this pass

- **Fake hardcoded cart badge**: `BottomStickyContainer` (the floating "N ITEM / NEXT" bar shown on Home and the products grid) rendered a hardcoded `'25 ITEM'` regardless of what was actually in the cart, and was never wired to `CartProvider` in the earlier data-layer phase — an oversight that slipped through because that phase's checklist didn't include this specific shared widget. Fixed: now reads `CartProvider.itemCount` and hides itself entirely when the cart is empty instead of lying about it.
- **Stale state after cancelling an order**: `OrderDetailsCard`'s Cancel Order button called `OrderProvider.cancelOrder()`, which updates the *orders list* provider state, but the order-detail screen holds its own local snapshot that was never refreshed — so immediately after a real, backend-confirmed cancellation, the screen kept showing the pre-cancel status and still offered a Cancel button the backend would now reject. Fixed: `OrderDetailsCard` now takes an `onCancelled` callback; `OrderSummaryScreen` passes its own reload function so the screen re-fetches the real order after a successful cancel.
- **Fluttertoast has no Windows implementation at all** (confirmed directly: its package ships only `android/` and `ios/` platform folders — no `windows/`, `macos/`, `linux/`, or web support). Every `Fluttertoast.showToast()` call — invalid OTP, address save failure, checkout error, "OTP resent", empty-address-on-checkout — threw `MissingPluginException` on the Windows desktop target, meaning the customer got **no feedback whatsoever** for any error, not even a raw one. This directly violated the "user must see friendly messages, never fail silently" requirement and was blocking this very verification. Fixed with a new `lib/UI/Widgets/Atoms/app_toast.dart`: native toast on Android/iOS, a real `SnackBar` (via a `scaffoldMessengerKey` on `MaterialApp`) everywhere else. All 8 real call sites migrated.
- **Address form's lat/lng defaults could read as real GPS detection**: added an explicit disclaimer above the coordinate fields in `AddEditAddressScreen` stating there's no map picker and the fields default to the Dharga Town hub, per your instruction to verify this wasn't misleading.

### Live verification method

Two independent, both against the same real running backend (Postgres seeded data, Node API on `localhost:4000`) and both re-run clean *after* the fixes above:

1. **`integration_test/live_customer_flow_test.dart`** (new) — drives the actual compiled Windows `ecom.exe`, real Flutter engine, real gesture/rendering pipeline, via `flutter test integration_test/live_customer_flow_test.dart -d windows`. No mocked HTTP. Covers the full requested flow: onboarding → phone entry → real `POST /auth/otp/request` → real server-generated `dev_otp` (dev/test-only, clearly labeled "Dev Code: ... (auto-filled)" in the UI, never a client bypass) → real `POST /auth/otp/verify` → authenticated session → Home shows real categories/products → add to cart (real `CartProvider` state, not the fake badge) → cart → create a real address via the actual UI form → edit it via the actual UI form → checkout submits to `POST /orders` → backend-computed totals asserted (`delivery_fee == 70.0`, `total == subtotal + delivery_fee`, `status == PLACED`) → order tracking screen → real cancellation via the UI, screen re-fetches and the Cancel button disappears → orders list shows the real cancelled order → logout. **Result: full pass.**
   - Getting here took several real iterations, each surfacing genuine issues rather than test artifacts: the auth bug above (found via this test failing deterministically at the verify step, confirmed independently by direct API calls); a wrong assumption in the test itself about which screen the cart's "Add address" link opens (it opens the address *list*, not the form directly); and a UI-testing detail worth recording — at this window's actual height (~682px), `AddEditAddressScreen`'s save button sits below the fold in a `ListView`, and Flutter's sliver lists only *build* widgets near the viewport, so a plain `ensureVisible()` can't find something that doesn't exist yet. Fixed by switching to `dragUntilVisible()`-based scrolling in the test helper.
2. **Direct backend contract script** (`live_backend_flow.py`, run via `python3`, not committed — ad hoc verification) — exercises every relevant endpoint directly over HTTP, independent of the Flutter client, as a cross-check: OTP request → **wrong OTP rejected cleanly** (`401`, `{"code":"INVALID_OTP","message":"Invalid OTP code. 2 attempt(s) remaining."}`, no SQL/stack-trace leakage) → correct OTP verified → `GET /auth/me` → catalog (asserted no `purchase_cost`/`cost_price`/`markup`/`wholesale` keys anywhere in the product response) → address create/list/edit → checkout (asserted `delivery_fee == 70.0`, order `status == PLACED`, no cost/markup leakage in the order response either) → orders list/detail → cancel while `PLACED` (allowed) → **cancel again** (correctly blocked: `400 ORDER_ALREADY_CANCELLED`) → refresh token → logout → **refresh with the now-revoked token correctly rejected with `401`** (proving logout revokes server-side, not just a local token wipe) → address delete. **Result: full pass.**

### Verification checklist

| Item | Result |
|---|---|
| Categories load from API | PASS — automated/test verified (this + prior phase) |
| Products load from API | PASS — automated/test verified |
| Search uses real catalog data | PASS — code verified (unchanged since prior phase; not re-driven through the UI this pass) |
| Cart works with real products | PASS — automated/test verified (real add, real item count, real subtotal) |
| Address CRUD works | PASS — automated/test verified (create + edit via real UI; delete + set-default verified via the direct backend script) |
| Checkout submits correctly | PASS — automated/test verified (backend-authoritative totals asserted) |
| Orders load from API | PASS — automated/test verified |
| Order details/status load correctly | PASS — automated/test verified, including post-cancel refresh |
| Authentication/session state works | PASS — automated/test verified (was previously **broken**; root-caused and fixed this phase) |
| Cancellation eligibility (PLACED/PACKED allowed, terminal states blocked) | PASS — automated/test verified both directions (allowed while PLACED; a second cancel attempt correctly rejected by the backend) |
| No PACKING status introduced | PASS — code verified (`OrderStatus` enum unchanged, still matches the canonical lifecycle) |
| No purchase cost / markup exposed to customer | PASS — automated/test verified directly against real product and order JSON |
| Error handling shows friendly messages, never raw errors | PASS — automated/test verified for the wrong-OTP case (clean JSON, no SQL/stack trace); the Windows toast-crash gap is fixed (see above) |
| Session refresh / token revocation on logout | PASS — automated/test verified (post-logout refresh correctly rejected) |

**Manual verification limitations**: everything above marked "automated/test verified" was exercised through the actual compiled app and/or the actual running backend this session — not hand-clicked by a person watching the screen in real time. Earlier attempts at OS-level mouse-click automation were established as unreliable in prior phases of this session; `flutter test -d windows` integration tests were used instead specifically because they drive the real engine/gesture pipeline without relying on synthetic OS-level clicks. A few early runs hit transient hit-testing/pointer diagnostics from the real windowing environment (not from the app) before the test helpers were made robust (`dragUntilVisible` instead of `ensureVisible` for below-the-fold content) — the final runs of both verification methods are clean.

### Tests after this phase

- `flutter analyze`: clean, same 4 pre-existing `info`-level lints as before (none introduced this phase).
- `flutter test`: **37/37 passing** (was 30 at the end of the prior phase) — 8 new regression tests for the auth-parsing bug (`extractAuthTokens`/`extractUserJson`, in `test/auth_provider_test.dart`), against the exact JSON shapes captured from the live backend so this specific bug class can't silently return.
- `integration_test/live_customer_flow_test.dart`: full pass against the live backend (not part of `flutter test`'s default run; invoked separately with `-d windows`, requires the backend up).

---

STATUS: CUSTOMER DATA FLOW VERIFIED — READY FOR UI KIT

---

# Premium UI Kit Implementation

## Scope and honesty note

The UI kit spec defines **17 phases across ~21 screens**. This entry covers the phases completed so far, in the order the spec itself set out. It is **not** the complete kit, and the phases not yet done are listed explicitly at the end rather than glossed. Per §41, each item below is marked with what was actually verified, not what merely compiles.

**Phases completed this pass:** 1 (design system), 2 (Categories), 9 (product card), 10 (add interaction), 17 (floating cart), 20 (Help), 31 (bottom navigation), plus the parts of 15/28 (Home integration), 34 (loading states) and 35 (error states) those depend on.

## Design system (Phase 1)

New `lib/app_design.dart` holds the tokens the rest of the kit builds on: `AppSpacing` (4→32 scale), `AppRadius` (cards 16, buttons 14, sheets 22, fields 12), `AppElevation` (deliberately soft — a dense catalog grid with heavy drop shadows on every tile reads as noise), `AppTextColors` (dark navy `#1A1D2E` body text rather than pure black) and `AppSurfaces`.

`app_theme.dart` was **refined, not replaced** — the existing `AppTheme.appTHeme` now consumes those tokens and gains `ColorScheme`, elevated/outlined/text button themes, `InputDecorationTheme`, `ChipThemeData`, `BottomSheetThemeData`, `DividerThemeData` and `SnackBarThemeData`. No second theme was introduced.

**Colour usage** follows §3 exactly: Blynk Yellow `#FFE141` is the primary action colour (ADD buttons, quantity steppers, active bottom-nav pill, primary CTAs); Blynk Green `#0C831F` is reserved for success/positive/brand accents (delivery-window line, cart badge, carousel CTA, selection states). The UI is **not** green-dominant — verified visually at both mobile and desktop widths.

## Screens and components

| Item | State |
|---|---|
| **Categories screen** (`categories_screen.dart`, new) | IMPLEMENTED — TESTED (renders real backend categories; reached via "See all") |
| **Category tile** (`category_widget.dart`, refined) | IMPLEMENTED — TESTED |
| **ProductCard** (`card_product.dart`, refined) | IMPLEMENTED — TESTED (real names/units/prices confirmed on screen) |
| **Add → quantity stepper** (`add_to_cart_button.dart`, refined) | IMPLEMENTED — TESTED (animated swap, live `CartProvider`) |
| **Floating cart bar** (`bottom_cart_container.dart`, redesigned) | IMPLEMENTED — TESTED |
| **Bottom navigation + shell** (`customer_shell.dart`, new) | IMPLEMENTED — TESTED (Shop/Orders/Help/Profile, stays fixed while Home scrolls) |
| **Help screen** (`help_screen.dart`, new) | IMPLEMENTED — TESTED (renders and builds cleanly; individual FAQ expand/collapse NOT MANUALLY VERIFIED) |
| **Address form** (`add_edit_address_screen.dart`, refined) | IMPLEMENTED — TESTED (pinned Cancel/Save footer; create + edit both exercised end to end) |
| **Home integration** (`home_screen.dart`, `home_product_sections.dart`) | IMPLEMENTED — TESTED |
| **Skeleton loaders** (`app_skeleton.dart`, new) | IMPLEMENTED — TESTED (observed on Home while the catalog loads) |
| **Empty/error states** (`app_state_views.dart`, new) | IMPLEMENTED — NOT MANUALLY VERIFIED (the error paths weren't force-triggered this pass) |

### Components reused, not rebuilt

`ProductProvider`, `CartProvider`, `AddressProvider`, `OrderProvider`, `AuthProvider`, `ApiService`, all models, `AppColors`, `AppTheme`, `Responsive`/`AppBreakpoints`, `route_generator`, and every existing screen. No new API client, no new cart state, no duplicated provider.

### Duplicate removed

`ProductCardForList` (`card_product_list.dart`) was a **second, divergent product-card implementation** used by Home's rails — deleted. The rails now render the same `ProductCard` as the grids, so there is exactly one product card in the app, as §9/§12 require.

## Two fabricated-data bugs found and fixed

Both were pre-existing template leftovers that the visual pass surfaced:

1. **Home header showed an invented ETA and address**: `DELIVERY IN / 25 Minutes / HOME- Floor 9, Delhi`. There is no ETA field anywhere in the backend and that address is fiction (wrong country, even). Replaced with the customer's **real** default address from `AddressProvider`, plus the genuine Phase 1 service window ("Delivering 8 AM - 9 PM") — which is a real business rule, not a delivery-time promise. Falls back to an honest "Log in to set your delivery address" / "Add a delivery address" prompt.
2. **Home hardcoded two category slugs** (`dairy-eggs`, `biscuits-snacks`), so any category added server-side would never appear. Replaced with `HomeProductSections`, which renders one rail per real backend category.

## Layout bugs caught by the regression run and fixed

Running the live flow against the redesign surfaced four further defects, all fixed:

1. **Help FAQ tiles swallowed their ink splashes** — a `ListTile` wrapped in a decorated `Container` (Flutter raises this as a framework assertion). Rebuilt on a proper `Material`.
2. **Category tile overflowed by 14 px** at narrow widths — a fixed `AspectRatio` image plus a two-line label ("Biscuits & Snacks") exceeded the grid cell. The label now takes the height it needs and the image absorbs the remainder, so the tile can't overflow its cell.
3. **Promo carousel chip cluster overflowed by 7.6 px** on a phone-width viewport — the two chips are fixed-size (58 + 8 + 46 = 112 px) but the hero region gives ~104 px there. Wrapped in a `FittedBox(scaleDown)`, which shrinks the cluster only where it doesn't fit.
4. **Address form's Save button was buried below the fold.** On a phone-height viewport the primary action required scrolling to reach — and because `ListView` only builds what's near the viewport, it wasn't even in the widget tree until scrolled to. Cancel/Save are now a **pinned footer**, which is better form UX and removes the reachability problem entirely.

Verified after the fixes: **zero render-overflow warnings** across the whole flow.

## Scrolling architecture

Home remains a single `CustomScrollView` (header → search → carousel → categories sliver-grid → one sliver-list rail per category → bottom spacer clearing the floating cart bar). Rails are horizontal `ListView.builder`s inside it; grids are `SliverGrid`/`GridView.builder`. No nested vertical scrollables, so there are no scroll-conflict traps. The shell uses `IndexedStack`, so switching tabs preserves each tab's scroll position and loaded data instead of refetching.

## Cart interactions

`ADD` swaps to a `[−] qty [+]` stepper through an `AnimatedSwitcher` (scale + fade, 180 ms). The floating cart bar slides and fades in when the cart becomes non-empty and out when it empties, showing the live item count and client-side subtotal estimate; the bottom-nav Shop tab carries a live count badge. All of it reads from the one `CartProvider` — **the hardcoded "25 ITEM" bar is gone**, and the live flow test asserts the real count renders.

## Responsive implementation

Category grid: 3 columns mobile / 5 tablet / 6–8 desktop. Product grids continue to use the existing `Responsive.gridColumns` (2 / 3 / 4–6). Content is capped and centred via `Responsive.contentMaxWidth` on wide viewports rather than stretching a mobile layout across 1300 px. Verified by screenshot at ~438 px and ~1300 px window widths.

## Animations

Carousel auto-scroll with staggered entrance (pre-existing, retained); ADD→stepper swap; floating cart slide/fade; bottom-nav active-pill `AnimatedContainer`; category tile selection transition; product image fade-in on first paint; skeleton pulse. All short (180–260 ms) and easing-based.

## Performance

`ListView.builder` / `GridView.builder` / `SliverGrid` throughout, so nothing renders the full catalog at once. `AppSkeleton` disposes its `AnimationController`. No new packages were added (the skeleton shimmer is a hand-rolled opacity tween rather than a dependency).

## Test results

- `flutter analyze`: **2 issues**, both pre-existing `use_build_context_synchronously` infos in auth files untouched by this pass. (Down from 4 — `dart fix` also cleared two pre-existing deprecations.)
- `flutter test`: **37/37 passing**, unchanged.
- `integration_test/live_customer_flow_test.dart`: **full pass against the live backend after the redesign** — login → catalog → cart → address CRUD → checkout → orders → cancel → logout, with **zero render-overflow warnings**. The test was updated for the new UI (`ADD`, `1 item`, `View Cart`, shell tabs). This is the §39 guarantee that the redesign didn't break verified functionality.

  The test harness itself needed two fixes that are worth recording, because both were caused by real characteristics of the new UI rather than by flakiness:
  - `find.byType(Scrollable).last` became ambiguous once `CustomerShell` kept four tab scrollables mounted simultaneously, so scroll-to-target was driving the wrong list and taps silently hit nothing. The helper now takes a `within:` screen finder and scopes the scroll to that screen's own scrollable.
  - `find.text()` matches an `EditableText`'s contents as well as `Text` widgets, so asserting the edited address label right after Save could pass against the still-open form's own input field. That assertion now checks provider state (which only changes if the PATCH actually landed) plus the form having closed.

## Manual verification

Ran the real Windows build and captured window-only screenshots at two widths. Confirmed on screen: real header, real seeded products with real prices (Farm Fresh Brown Eggs Rs. 605, Kotmale Fresh Milk 1L Rs. 540, Pelwatte Salted Butter 200g Rs. 805), yellow ADD buttons, category tiles, both category rails, "See all" links, promo carousel with indicators, and the bottom navigation with Shop active in Blynk Yellow.

Note on method: an earlier screenshot attempt appeared to show clipped content; that turned out to be a DPI-virtualisation artifact of the capture script (PowerShell was DPI-unaware and measured a smaller rect than the real surface), not an app layout bug — fixed by making the capture process DPI-aware, after which the layout captured correctly.

## Remaining gaps — phases NOT yet implemented

Not started, and not claimed: **3** (category listing polish + filter chips), **4** (search/results redesign), **5** (product details screen — still the existing bottom sheet), **6** (cart redesign), **7** (favorites — still blocked by the absent backend module), **8** (address screens polish), **9–10 for checkout**, **11** (checkout redesign), **12** (order confirmation polish), **13** (orders/order details redesign), **14** (order tracking screen — does not exist), **16** (systematic responsive pass at the six listed viewports), **21** (checkout step indicator), **25** (visual order-status tracker), **27** (track-order screen), **37** (accessibility audit — semantics were added to new interactive widgets, but no audit was run).

Those screens all still work and still show real data; they simply haven't received the premium visual pass yet.

---

STATUS: CUSTOMER UI KIT — PHASES 1, 2, 9, 10, 17, 20, 31 COMPLETE AND VERIFIED; REMAINING PHASES PENDING

---

## Phase 3 — Search & Search Results

### Existing implementation found

Search already worked against the real catalog, but in basic form: a stock Flutter `SearchDelegate` (`lib/UI/custom_search_delegate.dart`) calling `ProductProvider.search()`. That call hits the backend's server-side `GET /catalog/products?search=` (which matches name, description, SKU and barcode). Its shortcomings:

- It fired a request on every keystroke.
- It had no recent searches and no category filter.
- The result count was never shown.
- Loading used a full-screen spinner.
- The stale-result guard compared the query only, so a response for the same text under a different filter could overwrite newer results.

The backend already supports `search` + `category_slug` + `page`/`limit`, and returns a real `pagination.total`. **No backend change was needed.**

### Reused, modified, created

| Item | Change |
|---|---|
| `ProductProvider` | **Extended, not replaced.** Search now takes an optional category filter, stores the backend's `pagination.total`, supports paging (`loadMoreSearchResults`, 40 per page) and exposes `retrySearch()`. A generation counter discards superseded responses. It also takes an optional `CatalogRequest` defaulting to the existing `ApiService` (no new API client); tests use this to replay captured backend JSON. |
| `ProductCard`, `AddToCartButton`, `CartProvider`, floating cart bar, `AppStateView`, skeletons, design tokens, `Responsive` | Reused unchanged, except one `ProductCard` fix: the name area now always reserves two lines, so one-line and two-line names no longer give tiles in the same row different image heights. The fix applies to every grid. |
| `lib/Screens/search_screen.dart` | **New.** The dedicated search screen, registered as the `/search` route. |
| `lib/Infrastructure/LocalStorage/recent_searches_storage.dart` | **New.** Recent-search persistence plus the pure `addRecentSearch()` rule. It uses `flutter_secure_storage`, the app's only existing persistence mechanism, so no new package or storage system was added. |
| `home_screen_search_bar.dart` | Redesigned: a 48 px tappable field that opens `/search`. It's a semantic button rather than a read-only `TextField`, so Home never rebuilds as the customer types. |
| `products_screen.dart` | The search icon now opens `/search` with the current category pre-selected. |
| `custom_search_delegate.dart` | **Deleted.** It was fully replaced, and keeping it would have left two search implementations. |

### Behavior

- **Input:** auto-focus, yellow active border, a clear button that appears only when there's text (tooltip/semantic label "Clear search"), and the keyboard search action. Typing is debounced by 350 ms, so typing "milk" sends one request instead of four (covered by a test). Submitting searches immediately.
- **Initial state:** real recent searches (with Clear) and real categories under "Browse categories". Nothing is labelled "popular" because the backend has no popularity data. With neither available, a short prompt is shown instead.
- **Recent searches:** newest first, trimmed, empty queries ignored, case-insensitive de-duplication, capped at 8. Tapping one re-runs it. A search is saved when submitted, or when the customer leaves the screen after getting results.
- **Results:** a "Search results / "query" / N products" header, where N is the backend's `pagination.total`. Category filter chips are built from real categories ("All" plus each category); the selected chip is Blynk Yellow. Results use the shared `ProductCard` in a lazily built `SliverGrid` (2 / 3 / 4–6 columns). Tiles are sized from the image width plus a fixed text block that scales with text size, rather than a fixed aspect ratio that stretched tiles on wide columns. More results load on scroll when the backend reports more pages.
- **Loading / empty / error:** product-card skeletons while loading. "Sorry! We couldn't find anything for "…" [in {category}]", with a *Browse Categories* CTA, when nothing matches. "Couldn't load results / Check your connection and try again / Try Again" on failure. The raw backend message is never shown (a test asserts this).
- **Cart:** ADD from search uses the same `CartProvider`. The floating cart bar is shown on the search screen too, and the count carries back to Home.
- **Navigation:** Home → Search → product (the existing detail sheet, untouched per the Phase 5 boundary) → close → results still there → back → Home.

### Tests

- `test/search_screen_test.dart`: 11 widget tests using JSON captured verbatim from the running backend. They cover:
  - clean initial state with no fake recents
  - plain prompt when no data exists
  - debounce firing exactly one request, plus real results and the real count
  - clear
  - empty state and its CTA
  - skeletons while in flight
  - friendly error plus Try Again recovery, with the raw error not shown
  - category chip sending `category_slug`
  - recent searches: submit, persist, re-run, clear
  - tapping a result opens that product
  - ADD updating `CartProvider` and the floating bar
- `test/recent_searches_test.dart`: 5 unit tests for the recent-search rules.
- `flutter test`: **53/53 passing** (up from 37). `flutter analyze`: the same 2 pre-existing infos.
- `integration_test/live_customer_flow_test.dart` now puts search in the real path, against the live backend: a no-results query shows "Sorry!", "milk" returns the real product with "1 product", clear shows it as a recent search, tapping the recent search re-runs it, opening the product shows its real pack size, closing keeps the results, ADD happens from search, back on Home the cart bar shows "1 item", then cart → address CRUD → checkout → orders → cancel → logout. **Full pass, zero render-overflow warnings.**

### Manual verification

I ran the real Windows app and exercised it with real keyboard input and window-only screenshots:

- Initial state: yellow focused field, real categories, no recents on a clean install.
- Typing "milk" returned **Kotmale Fresh Milk 1L, Rs. 540, "1 product"**.
- After submitting and restarting the app, "milk" appeared under Recent searches.
- "zzqx" showed the Sorry state.
- The query "e" at ~1440 px wide showed **all 5 real products, "5 products", in 4 columns** with centred, capped content.
- At phone-to-small-tablet width (~430–660 px physical), results showed in 2 columns.

This pass also caught and fixed two visual problems: over-tall result tiles, and misaligned image heights between one-line and two-line product names.

### Limitations — stated plainly

- **Responsive:** verified at the actual window widths above, not at each of the seven listed viewport sizes individually. The tablet 3-column breakpoint (≥600 logical px) wasn't captured as a separate screenshot.
- **Pagination:** the load-more path is implemented against the real `page`/`total_pages` fields, but the seeded catalog has 5 products, so a second page never occurs live. It is **UNVERIFIED** at runtime.
- **Mobile keyboard:** Android/iOS soft-keyboard behavior is **UNVERIFIED** because only the Windows build was run. On Windows, submitting drops focus from the field, which is the expected "search and dismiss" behavior.
- **Recent searches and logout:** recent searches are device-local and are **not** cleared on logout, so a second person using the same device would see them.
- **Product images:** seeded products have no `image_url`, so every result shows the placeholder basket icon.

STATUS: PHASE 3 SEARCH + SEARCH RESULTS COMPLETE AND VERIFIED


---

## Phase 4 — Product Details

Status labels used below: **IMPLEMENTED** (code exists), **TESTED** (covered by automated tests), **MANUALLY VERIFIED** (seen in the running app against the real backend), **UNVERIFIED** (not confirmed).

### What existed before

Graphify community 13 (ProductCard / `add_to_cart_button.dart` / product details) pointed at the relevant files.

- **Product details** were a modal bottom sheet, `UI/Widgets/Organisms/product_description_modal_opener.dart`, opened by `ProductCard`.
  - It rendered only the listing copy of the product and never fetched by id.
  - It had no loading, error or unavailable state.
  - It had its own hardcoded colours and was capped to 480 px on desktop.
- **Backend:** `GET /api/v1/catalog/products/:id` already exists and returns `data.product` with the same customer-safe fields as the list: no `purchase_cost` and no markup. Unknown or inactive ids return `404 PRODUCT_NOT_FOUND`. **No backend change was needed.**
- **Favourites:** there is no favourites code in the app and no favourites module in `backend/api/src/modules`.

### Reused, modified, created

| Item | Change |
|---|---|
| `ProductProvider` | **Extended** with `loadProductDetail(id)`, `productDetail(id)`, `isLoadingProductDetail(id)` and `productDetailFailure(id)` (`notFound` / `network`), using the same injectable `_request` over `ApiService`. |
| `AddToCartButton` | **Extended**: `expanded: true` gives a full-width, 52 px "Add to Cart" button. When unavailable it reads "Currently unavailable" and is disabled. Once the product is in the cart it becomes a full-width stepper with half-width tap targets. The quantity number now cross-fades on change everywhere the stepper appears. It still calls the same `CartProvider.add` / `decrement`. |
| `ProductCard` | Its private image widget became the public `ProductImage`, shared with details (same fit, fade-in and fallback). Tapping a card now pushes `/product` with the tapped `ProductModel`. |
| `route_generator.dart` | New `/product` route; accepts a `ProductModel` or a bare id string. |
| `Screens/product_details_screen.dart` | **Created**: the Product Details page. |
| `product_description_modal_opener.dart` | **Deleted**; it was the old details sheet, so only one product-details surface exists. |
| `AppSkeleton`, `AppStateView`, `BottomStickyContainer`, design tokens | Reused unchanged. |

No new provider, cart, API client, theme, product card or image package was added.

### Real data source (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

- Opening from a card renders the tapped listing copy immediately (no blank flash). The page then calls `GET /catalog/products/:id`, and the fresh copy replaces it, so price and availability are current.
- Opening with a bare id shows a skeleton until the backend responds.
- **Shown only if the backend has it:**
  - category name
  - product name
  - unit · pack size
  - selling price (Rs.)
  - description (under "About this product")
  - a "Product details" table: Unit, Pack and Category, each shown only when present
- **Not shown, because none of these exist in the backend:** MRP, discount, savings, ratings, reviews, stock counts, delivery promises, recommendations.
- The seeded catalogue has `description: null` for every product, so live pages show no description block and stay compact.
- **Favourites:** left out on purpose. No heart icon is shown, because nothing could persist it; a local-only favourite would look server-backed.

### Image handling (IMPLEMENTED, MANUALLY VERIFIED for the fallback only)

- Uses the shared `ProductImage`: `Image.network`, `BoxFit.contain`, 220 ms fade-in, and a basket-icon fallback on a missing or broken URL.
- Shown in a rounded, neutral panel that is square but capped: 48 % of the viewport height on phones, and on wide screens never taller than the viewport, so it always fits the first screen at 1280×720.
- Seeded products have no `image_url`, so only the fallback was seen live. **Loading a real remote image on this page is UNVERIFIED.**

### Quantity and cart (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

- **One interaction model everywhere:** "Add to Cart" → `− n +`, the same ADD → stepper model as the product cards.
  - There is no separate "choose quantity, then add" control, because that would need product-local cart state.
  - All changes go straight to `CartProvider`.
- **Quantity rules:**
  - − at 1 removes the line and the button returns to "Add to Cart".
  - The quantity can't go negative; the provider removes the line at ≤ 1.
- **Success feedback:**
  - a green "✓ n in cart" line under the price, driven by `CartProvider`
  - the global floating cart sliding in with the real count and subtotal
- The page stays on Product Details after adding; there's no forced navigation.
- **Phones:**
  - Price and CTA are pinned in `Scaffold.bottomNavigationBar`, inside the safe area.
  - The existing floating cart bar sits above it, and content has 96 px bottom clearance so neither bar covers anything.
  - There is still only one floating cart widget, and it keeps its role (go to cart), separate from the CTA's role (change quantity).
- **Wide screens:** the CTA is inline under the price, max 360 px wide. The floating cart is centred and capped at 560 px.

### Availability (IMPLEMENTED, TESTED; not live-verifiable)

- `is_available: false` shows a "Currently unavailable" pill, dims the image, and turns the CTA into a disabled "Currently unavailable". Tapping it adds nothing.
- A 404 from the detail endpoint shows "Product no longer available" with Go Back. The page **drops the stale listing copy**, so a removed product can't be added from here.
- Every seeded product is available, so the unavailable state was tested only with the captured real response with `is_available` flipped. It was **not** seen live.

### Loading and error (IMPLEMENTED, TESTED)

- **Loading:** skeleton blocks for image, category, title, unit, price and CTA, in the phone or two-column shape.
- **Network or server failure:** "Couldn't load this product" / "Check your connection and try again." / Try Again. No status code, SQL or exception text is shown; a test checks this with an `ECONNREFUSED`-style message.

### Responsive (IMPLEMENTED, TESTED; MANUALLY VERIFIED at three widths)

- **Below 720 logical px:** image, then info, then product details, with the pinned bottom CTA.
- **720 px and up:** two columns inside a centred 1120 px frame. The image is about 45 % wide and height-capped. The right column holds category, name, unit, price, CTA, cart feedback, description and details.
- **Widget tests:** 375×812, 390×844, 414×896, 768×1024, 1280×720, 1440×900 and 1920×1080. Each test adds to the cart and asserts no exceptions and the correct stacked or side-by-side arrangement.
- **Real Windows app (display scaling ≈ 1.45):**
  - ≈ 290 logical px (narrow phone)
  - ≈ 765 px (tablet, two columns)
  - ≈ 1240 px (desktop, two columns)
- **Fixed during this pass:**
  - The expanded stepper overflowed by 7.8 px at ≈ 290 px, so its tap targets now flex.
  - "n in cart" overflowed with wide fonts, so it now ellipsizes.
  - The label swap briefly overlapped the unit text, so the outgoing label now drops out at once.

### Animations (IMPLEMENTED, MANUALLY VERIFIED)

- **Image:** fade plus a 0.96 → 1 scale on first render.
- **Info block:** fade plus a 12 px rise, staggered 60 ms and 100 ms after the image.
- **Phone CTA bar:** rises into place.
- **Add to Cart → stepper:** 180 ms scale/fade (shared widget).
- **Quantity number:** 160 ms scale/fade (shared widget).
- **"n in cart":** fades and grows in.
- **Floating cart:** existing slide.
- Every animation plays once or on its own change; nothing re-animates the page on rebuild.

### Tests

- **New:** `test/product_details_screen_test.dart`, 21 tests.
  - **Fixtures:** verbatim captured responses for `/catalog/products/:id`, `/catalog/categories`, `?category_slug=dairy-eggs` and `?search=milk`. Overrides are applied to the captured detail JSON only where the seed can't produce a state: price change, description, `is_available: false`.
  - **What they cover:**
    - skeleton → real product
    - instant listing render followed by the id refresh winning
    - description omitted or shown
    - no invented commerce text or favourite icon
    - network error with Try Again (no raw error text)
    - 404 hiding a stale listing copy
    - unavailable label and disabled CTA
    - Add → + → − → − back to "Add to Cart" via `CartProvider`, with floating-cart count and subtotal
    - pre-existing cart quantity reflected
    - View Cart → `/cart`
    - desktop two-column layout, plus six more viewport sizes without overflow
    - Search → details → back keeping query, results and the shared cart state
    - Categories → category grid → details → back
    - `/product` with a bare id
- **Updated:** `test/search_screen_test.dart`, "tapping a result opens that real product". It used to assert the old sheet; it now asserts `/product` receives the exact tapped product (id, name, Rs. 540). Nothing was removed or loosened.
- **Suites:**
  - `flutter test`: **74/74 passing** (53 before, plus 21).
  - `flutter analyze`: the same 2 pre-existing `use_build_context_synchronously` infos.
- **`integration_test/live_customer_flow_test.dart`**, against the live backend. **Full pass, zero render-overflow warnings.**
  - **Home:** open Kotmale Fresh Milk 1L from Home; the details page loads by id and shows "1 L · Tetra Pack" and Rs. 540; back.
  - **Search:** search "milk", open the product, Add to Cart ("1 in cart", floating "1 item"), + ("2 items"), − ("1 item"); back to results with the card showing the stepper.
  - **Rest of the flow:** Home → cart → address CRUD → checkout → orders → cancel → logout.
  - This run happened before the final one-line tweak to the label-swap curve. `flutter test` and `flutter analyze` were re-run after it.

### Manual verification (real Windows app, real backend, keyboard input)

1. Product Details for Kotmale Fresh Milk 1L loaded by id: real name, "1 L · Tetra Pack", **Rs. 540** (matches `GET /catalog/products/:id`), category and details table, fallback image.
2. Add to Cart → stepper "1", "✓ 1 in cart", floating cart "1 item · Rs. 540".
3. + → "2 in cart", floating "2 items · Rs. 1080".
4. − → 1, then − → back to "Add to Cart"; the floating cart slid away.
5. Two-column layout at desktop and tablet widths; the inline CTA and "1 in cart" work there too.
6. Pelwatte Salted Butter 200g page showed **Rs. 805** and "200 g · Foil Wrap". After Add, View Cart opened the cart with Pelwatte ×1, subtotal Rs. 805, delivery Rs. 70, total Rs. 875.
7. **Opening from Home and from Search** (steps 1, 12–14 of the brief) was driven by the live integration test in the same real app, not by hand. Hand-driven captures opened the page directly, via a temporary initial route that has been removed.

### Limitations — stated plainly

- **Unavailable and 404 states:** TESTED only. The seed has no unavailable product, and I didn't alter live data to force one.
- **Real product images:** UNVERIFIED on this page, because no seeded product has an `image_url`.
- **Hand-driven navigation:** the Home → details and Search → details taps were automated (integration test), not hand-clicked. Mouse input to the automated window is unreliable here.
- **Phones:** Android/iOS safe-area and gesture-bar behaviour of the pinned CTA are UNVERIFIED; only Windows was run.
- **Screen sizes:** the seven sizes were covered by widget tests; the real app was checked at three widths, not all seven.
- **Price format:** prices show whole rupees (`toStringAsFixed(0)`), matching the rest of the app. A price with cents would be rounded in display; the backend's order totals stay authoritative.
- **Cart screen:** it still uses its older green stepper, which doesn't match the yellow one; that screen is a later phase and was not touched.

STATUS: PHASE 4 PRODUCT DETAILS COMPLETE AND VERIFIED


---

## Phase 5 — Cart + Empty Cart

Status labels: **IMPLEMENTED** (code exists), **TESTED** (automated tests), **MANUALLY VERIFIED** (seen in the running app against the real backend), **UNVERIFIED** (not confirmed).

### What existed before

- **`CartScreen`** was titled "Checkout" and mixed three things: the cart lines, a set of extra cards, and the checkout itself (delivery address bar + Cash on Delivery + **Place Order**) pinned at the bottom. **There was no separate checkout screen or route.**
- **`CartProductCard`** was a flat white row with a hand-rolled **green** quantity control (10 px icons, no semantics).
- **Extra cards on the cart:**
  - "Use Coupons" → a screen driven by `kDummyCoupons`, with a non-functional Apply. No coupons module in the backend.
  - "Ordering For Someone else" → a gift screen whose only button pops. No gifting module in the backend.
  - "Cancellation Policy" → text saying orders "cannot be cancelled once packed", which **contradicts the canonical rule** (PLACED and PACKED are both cancellable).
- **Empty cart** was a grey icon, "Your cart is waiting." and a **green** Browse Groceries button.
- **`CartProvider`** was already sound: `add`, `decrement` (removes at ≤ 1), `remove`, `subtotal`, `itemCount`. **Unchanged in this phase.**

### A decision worth flagging

The brief assumes Cart hands off to an existing checkout. In this codebase checkout *was* the bottom of the cart screen, so there was nothing to hand off to.

**What I did:** the cart is now only cart (items, summary, one CTA), and **Proceed to Checkout** opens a new `/checkout` route that hosts the existing, already-verified checkout widgets **unchanged** — `CartScreenAddressContainer` and `CartScreenPaymentContainer` (COD + Place Order, which posts the real order) — plus a read-only Order Summary and the cancellation policy. Its visual redesign is deliberately left to the Checkout phase.

### Reused, modified, created

| Item | Change |
|---|---|
| `CartProvider` | **Unchanged.** Still the only cart state. |
| `AddToCartButton` | **Reused** as the cart's quantity control (`compact: false`). Its medium size now has 40 px tall tap targets. |
| `ProductImage` | **Reused** for cart row thumbnails (fixed 72 px, 80 px on wide rows). |
| `CartProductCard` | **Rewritten**: card surface, shared image, 2-line name, unit, line total (plus "3 × Rs. 540" when quantity > 1), yellow stepper, trash button. Tapping the thumbnail opens Product Details. |
| `CartPriceDetailWidget` | **Rewritten** as "Order Summary" on the shared card/token styling; same data, plus an optional footer slot for the desktop CTA. |
| `CartScreen` | **Rewritten**: header, animated line list, summary, pinned CTA bar (phones) or side summary column (desktop). |
| `EmptyCartView` | **Created**, shared by Cart and Checkout. |
| `CheckoutScreen` + `/checkout` | **Created** as the host described above. |
| `CustomerShell.openShop()` | **Added** so Browse Groceries returns to the shell already in the stack instead of opening a second catalog. |
| `CancellationPolicyCard` | **Text corrected** to "You can cancel your order until it is out for delivery." |
| `CartTimeandTotalItemCard`, `ApplyCouponOnCartCard`, `OrderGiftCard` | **Deleted** — the cart's fake-feature entry points. The `/coupons` and `/cart/gift` screens themselves still exist but are no longer reachable from the cart. |

No new cart state, quantity control, product card, API client or theme was introduced.

### Quantity control (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

- The old green control is gone. The cart now uses the same `AddToCartButton` stepper as product cards and Product Details: Blynk Yellow `#FFE141`, dark text and icons.
- `+` and `−` call `CartProvider.add` / `decrement` directly; there is no cart-local quantity state.
- `−` at quantity 1 removes the line (`CartProvider` removes at ≤ 1), so a negative quantity isn't representable.
- The quantity digit cross-fades on change (shared widget); nothing else animates.
- A test asserts the stepper's fill is `primaryYellowColor` and that no green surface remains in the row.

### Totals and delivery fee (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

- Subtotal is `CartProvider.subtotal`; the row is labelled with the real item count.
- Delivery Fee is the existing `kDeliveryFeeEstimate` (Rs. 70) business rule. **No handling, convenience, platform or late-night fee** — a test asserts those strings never appear, along with MRP/OFF/Saved.
- Total = subtotal + Rs. 70, shown prominently in the summary and on the phone CTA bar.
- Both update on the same frame as a quantity change, because everything reads from `CartProvider`.
- The summary says "Cash on Delivery · final amount is confirmed when you place the order", which is accurate: the backend re-prices and returns the authoritative total.

### Remove item (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

- **One** removal affordance: a trash icon button per row, 40 × 40, labelled "Remove *product name*". Swipe was not added, since a trash button works identically on desktop and phone and only one mechanism was wanted.
- Removal (by trash or by `−` at 1) slides the row right, fades it and collapses its height over 260 ms while the rest close up, via `SliverAnimatedList`. The row shown during the animation is a frozen, non-interactive copy, so its controls can't be used mid-exit. A test asserts it is visible but inert mid-animation, and gone afterwards.

### Empty cart (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

- Basket icon on a soft yellow disc, "Your cart is empty", the delivery line, and a yellow **Browse Groceries** button, centred with a 360 px cap so it doesn't spread out on desktop.
- The app's onboarding illustration was deliberately **not** reused: it depicts a *full* trolley.
- **Browse Groceries** pops back to the Shop tab of the shell already in the stack (`CustomerShell.openShop`), and only starts a fresh shell if this stack has none. No new catalog route.
- The empty state replaces the list with a cross-fade when the last item goes, and the checkout CTA disappears with it.

### Layout and responsiveness (IMPLEMENTED, TESTED; MANUALLY VERIFIED at two widths)

- **Under 900 logical px:** one column capped at 720 px, with the CTA bar pinned in `Scaffold.bottomNavigationBar` (inside `SafeArea`), showing the total next to the button. It cannot cover the last row or the summary, which scroll above it.
- **900 px and up:** items on the left, a summary column (380 px) on the right with the CTA inside it, inside a 1160 px frame. No pinned bar in that layout.
- **Cart rows** reflow at 520 px: phones stack name/unit above price and stepper; wider rows put image, name, price, stepper and trash on one line.
- **Widget tests** at 375×812, 390×844, 414×896, 768×1024, 1280×720, 1440×900 and 1920×1080 add three real lines, assert no exceptions and the correct totals, then tap `+` and assert again.
- **Long names:** a test uses a 90-character product name at 375 px and asserts no overflow, with the price and stepper still present.
- **Manually verified** at roughly 385 logical px (phone) and 1240 logical px (desktop two-column).

### Floating cart (IMPLEMENTED)

The global floating cart bar is not rendered on Cart or Checkout, so the only action on the cart is Proceed to Checkout. It still appears on Home, Search and Product Details.

### Loading and error states

- **Loading:** the cart is client-side only (no fetch), so there is nothing to load and no skeleton is shown. `CheckoutScreen` inherits the existing address-loading behaviour unchanged.
- **Errors:** quantity and removal are local and cannot fail. Order placement keeps its existing error handling (friendly toast via `showAppToast`, no raw backend text). Nothing new was added, so this is **IMPLEMENTED as before, not re-verified in this phase**.

### Accessibility (IMPLEMENTED, TESTED)

- `−` / `+` carry "Remove one *name*" / "Add one more *name*"; tests drive them by those labels.
- The trash button has a tooltip and semantic label "Remove *name*"; the thumbnail is labelled "View *name*".
- "Your Cart", "Order Summary" and "Your cart is empty" are marked as headers.
- Tap targets: stepper 40 px tall, trash 40 × 40, CTA 52 px.
- The phone CTA bar reads as "Total Rs. 610" for screen readers instead of two loose fragments.
- **Contrast and screen-reader output on a real device are UNVERIFIED**; only the semantics tree was tested.

### Tests

- **New:** `test/cart_screen_test.dart`, 20 tests — real lines render; summary (subtotal, Rs. 70, total, no invented fees); `+`/`−` updating cart, line total and totals; `−` at 1 removing a line while others stay; trash removal; removal animation; yellow (not green) stepper; a long name at 375 px; empty state; empty after the last removal; Browse Groceries popping to the existing shop route; Proceed to Checkout reaching the real checkout widgets; checkout with an empty cart; desktop side-by-side layout; and six more viewport sizes.
- **Suites:** `flutter test` **94/94 passing** (74 before, plus 20). `flutter analyze`: the same 2 pre-existing infos.
- **`integration_test/live_customer_flow_test.dart`** (live backend) updated for the new step and passing in full, **zero render-overflow warnings**: login → Home → Product Details → search → add → **cart (real line, Order Summary, Rs. 540 / Rs. 70 / Rs. 610)** → **Proceed to Checkout** → address create/edit → Place Order (backend fee Rs. 70, COD, PLACED) → track → cancel → orders list → logout.
- No existing test was removed or weakened. Two Phase 3/4 assertions were adjusted only where the UI legitimately changed ("1 Item" → "1 item", cart → checkout step).

### Manual verification (real Windows app, real backend, keyboard input)

1. Added a real product from Product Details, opened the cart: **Kotmale Fresh Milk 1L, Rs. 540**, Subtotal Rs. 540, Delivery Fee Rs. 70, **Total Rs. 610**, yellow stepper and yellow CTA.
2. Raised the quantity to 3 from the product page: cart showed **Rs. 1620**, "3 × Rs. 540", Subtotal (3 items) Rs. 1620, **Total Rs. 1690** — live, with no stale figures.
3. Trash removed the line and the polished empty state appeared.
4. **Proceed to Checkout** opened the checkout with the unchanged address bar, Cash on Delivery and **Place Order**, and the same Rs. 1690 summary.
5. Desktop (~1240 logical px): items left, summary and CTA right, wide single-line rows.
6. The full login → … → Place Order path was exercised by the live integration run rather than by hand (see above).

### Limitations — stated plainly

- **Hand-driven checks used the keyboard**, not the mouse (mouse input to the automated window is unreliable here). One stray keypress landed on the trash button during a check, which is how removal got verified early.
- **Browse Groceries was not confirmed by hand** in the running app; a keypress hit the focused back button instead. Its behaviour is covered by a widget test that asserts it returns to the existing shop route.
- **Checkout bars at very narrow widths:** the pre-existing address and payment rows overflow under the wide test font below ~560 px, so the checkout widget tests run at 560 px. In the real app at ~385 logical px they render correctly. Those bars are untouched Phase-6 material.
- **Cart images:** no seeded product has an `image_url`, so only the placeholder icon has been seen in cart rows.
- **Multi-line long names** were verified with the test font; a real-device check is **UNVERIFIED**.
- **Accessibility**: semantics are tested, but no screen reader or contrast tool was run.
- **`/coupons` and `/cart/gift`** screens still exist in the router with their dummy content, now unreachable from the cart. Removing them entirely is out of this phase's scope.
- **Checkout look and feel** is intentionally unchanged, so it still shows the older green Place Order button and orange icons until the Checkout phase.

STATUS: PHASE 5 CART + EMPTY CART COMPLETE AND VERIFIED


---

## Home Promotional Carousel — Redesign

Status labels: **IMPLEMENTED**, **TESTED**, **MANUALLY VERIFIED** (running app, real backend), **UNVERIFIED**.

### What was there before

`HomeScreenCarousel` was a `PageView` of three hardcoded slides:

- Copy, colours and artwork were all constants in the file; nothing came from the catalog.
- Two slides used `Assets/Products/*.png` — template photography from the original Blinkit clone (a paneer tub, etc.) for products **this store does not sell** — inside white circular chips.
- The third used the onboarding basket photo full-bleed.
- Flat two-stop gradient, one CTA whose colour changed per slide (green on two of them), tiny grey dots.
- Continuous "float/breathe" tickers ran on the artwork whether or not the slide was visible.

### Approach

Same architecture — one `PageView`, the same file, the same design tokens, the existing `ProductProvider`, and the shared `ProductImage` from `card_product.dart`. What changed is the composition and where its content comes from.

**The stock product photography is gone.** Slides are composed from the **real catalog**: the campaign after the first follows the categories the backend returns (label, supporting sentence and CTA destination all real), and the product layers are real products from `ProductProvider`. Seeded products have no `image_url`, so the layers render the app's usual placeholder rather than invented photography, and the foreground layer names the real product it stands for.

### Composition (IMPLEMENTED, MANUALLY VERIFIED)

- **Card:** large radius (26), a three-stop diagonal tint→white wash, one soft shadow. No glassmorphism, no blobs.
- **Decor:** a `CustomPainter` per campaign — a large soft disc plus a thin ring (essentials), a curved sweep plus a ring (fresh), a rotated rounded rectangle plus a ring (daily) — all at 10–12% alpha, behind the products.
- **Content column:** uppercase campaign label → two-line headline (w900, tight leading, negative tracking) → supporting sentence → **yellow CTA**. The CTA uses `appPrimaryButtonStyle`, so it is Blynk Yellow on every slide; green appears only as a slide accent and in the active pagination pill.
- **Product layers:** three tiles at different sizes, each slightly rotated, the primary larger with a stronger shadow and a tinted border and the real product name beneath its image; secondaries sit behind at different sizes. Positions are fractions of the **free space**, so nothing can spill past the rounded edge at any width.
- **Three different arrangements** — `anchored`, `stacked`, `cascade` — one per campaign, so slides don't read as one banner retitled.

### Real data (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

| Slide | Label | Headline | CTA → | Supporting line |
|---|---|---|---|---|
| 1 | EVERYDAY ESSENTIALS | Everyday Essentials / At Your Doorstep | Explore → all products | "Everything on your list, from your Dharga Town store." (the real hub) |
| 2 | *first real category* (DAIRY & EGGS) | Fresh Picks / For Your Home | Shop Fresh → `dairy-eggs` | the category's own backend `description` |
| 3 | *second real category* (BISCUITS & SNACKS) | Daily Grocery Run / Made Simple | Browse → `biscuits-snacks` | the category's own backend `description` |

Slides 2 and 3 exist only because those categories exist: a category added server-side changes the carousel with no code change, and with no categories the carousel is just slide 1. **No discounts, percentages, savings, ratings, delivery times or stock claims** appear anywhere — a test asserts those strings are absent.

### Motion (IMPLEMENTED, TESTED; auto-advance MANUALLY VERIFIED)

- Auto-advance every 5 s, 520 ms `easeInOutCubic` transition, wrapping around.
- Swipe works and restarts the timer rather than fighting it.
- Content and product layers animate **independently**: label 0 ms, headline 70 ms, support 120 ms, CTA 170 ms; primary product 90 ms, secondaries 160/230 ms, each with its own slide direction and a 0.88→1 scale.
- The old always-on float tickers are gone; entrances are implicit animations that replay when a slide becomes active, so nothing animates continuously behind the customer's back.
- The timer skips ticks when Home is under a pushed route (`ModalRoute.isCurrent`).

### Pagination (IMPLEMENTED, TESTED, MANUALLY VERIFIED)

A connected pill track on a soft surface: the active pill is Blynk Green and 22 px wide, inactive pills are 7 px in the border grey, with a 280 ms transition. Tapping a pill jumps to that slide. The track carries a "Promotion n of m" semantic label.

### Responsive (IMPLEMENTED, TESTED; MANUALLY VERIFIED at four widths)

Seven width bands, each with its own height, margins, type scale, CTA size and column split — not one layout scaled:

| Band | Height | Headline | Notes |
|---|---|---|---|
| < 360 (small phone) | 190 | 15.5 | support hidden, headline may wrap to 3 lines, content column widened (8:5) |
| < 420 (phone) | 200 | 18 | support hidden, 7:5 |
| < 600 (large phone) | 212 | 21 | support shown |
| < 900 (small tablet) | 236 | 25 | — |
| < 1440 (tablet/desktop) | 268 | 30 | hero column widened (5:6) |
| ≥ 1440 (large desktop) | 300 | 34 | — |

**Manually verified** at ≈317, ≈386, ≈426 and ≈1275 logical px. The headline truncation found at ≈320 px (second line dropped) was fixed by the small-phone band above.

### Tests

- **New:** `test/home_carousel_test.dart`, 18 tests, driven by captured real category/product JSON:
  - first slide's campaign, headline and a real product name on the primary layer
  - later slides taking their label, description, headline and CTA from real categories
  - each campaign painting its own decor
  - no invented offers/timings/ratings
  - auto-advance through all three and wrap-around
  - swipe beating the timer, and the timer restarting after it
  - one indicator per slide and tap-to-jump
  - CTA routing to `/products` with `''` and with `dairy-eggs`
  - staying balanced with **no products loaded** (placeholder only, nothing invented)
  - nine viewport sizes (320×640 → 1920×1080), asserting no overflow and a working swipe at each
- **Suites:** `flutter test` **112/112 passing** (94 before, plus 18). `flutter analyze`: the same 2 pre-existing infos.
- **`integration_test/live_customer_flow_test.dart`** re-run against the live backend after the redesign: **full pass, zero render-overflow warnings**.

### Manual verification (real Windows app, real backend)

1. Home renders slide 1 with the real Dharga Town line, yellow Explore CTA and a layered composition whose foreground tile names a real product ("Farm Fresh Brown Eggs (10 Pack)").
2. Auto-advance to slide 2 (Dairy & Eggs, green tint, real description "Fresh milk, butter, cheese, and farm eggs", Shop Fresh) and on to slide 3 (Biscuits & Snacks, neutral tint, cascade composition, "Maliban Gold Marie 300g"), then wrapping back to slide 1.
3. Pagination pill tracks the active slide.
4. The slide-3 CTA opened the real Biscuits & Snacks product list.
5. Widths ≈317, ≈386, ≈426 and ≈1275 logical px: no collisions, no clipped headline, layers inside the card.

### Limitations — stated plainly

- **Product imagery:** no seeded product has an `image_url`, so every layer currently shows the placeholder basket. The composition is designed to stay balanced that way, but **how it looks with real product photography is UNVERIFIED**.
- **Swipe** is covered by widget tests at nine sizes; it was **not** hand-swiped in the running app (mouse input to the automated window is unreliable here).
- **Tablet band (600–900 px)** was verified by widget test only, not captured live.
- **Phones:** Android/iOS were not run; only the Windows build.
- Only the first two real categories become slides; a third category would need another campaign template.
- The onboarding artwork elsewhere in the app still carries an "in 10 Mins" claim. It predates this work and is **untouched** — worth revisiting, since it is a delivery promise.

STATUS: HOME PROMOTIONAL CAROUSEL REDESIGNED AND VERIFIED


---

## Add / Edit Address — Redesign

Status labels: **IMPLEMENTED**, **TESTED**, **MANUALLY VERIFIED** (running app), **UNVERIFIED**.

### What was there before

`AddEditAddressScreen` was ten identical `TextFormField`s in a `ListView`,
each a full-width white box with a Material outline and a `labelText`, one
after another. Above the coordinates sat a developer-facing note ("No map
picker yet - defaults to the Dharga Town hub…"), and the default-address
setting was a full-width grey `SwitchListTile` with a green thumb. The
pinned Cancel / Save bar already existed (added in an earlier phase).

### What changed (IMPLEMENTED, MANUALLY VERIFIED)

- **Header:** white `AppBar`, no elevation, a hairline only once the form
  scrolls under it.
- **Address-type selector:** `Home` / `Work` / `Other` pills at the top, Home
  selected by default, selected pill in Blynk Yellow. These write into the
  backend's existing free-text `label` — **no new API field**. "Other"
  reveals a custom name input, and an address whose label isn't a preset
  (e.g. "Integration Test Home") reopens under Other with its name filled in.
- **Grouped sections:** CONTACT / DELIVERY ADDRESS / LOCATION / DELIVERY
  NOTES. Each is one card with hairline dividers between its fields, so a
  section reads as a single block instead of loose white rectangles.
- **Fields:** borderless inside their card, ~56 px, floating labels, hint
  text lighter than entered text, and a yellow underline on focus. Icons
  only where they help scanning (person, phone, pin, city, note); fields
  without an icon keep the same text inset so the column stays aligned.
- **Location:** the developer note is replaced by "Delivery location /
  Your delivery location helps us confirm service availability.", with
  Latitude and Longitude side by side. **No map is implied or faked** — there
  is still no picker, and the Dharga Town defaults are unchanged.
- **Default address:** a proper setting row — title, explanatory line, switch
  on the right, Blynk Yellow when on.
- **Action bar:** Cancel (outlined) + **Save Address** (dominant yellow),
  pinned in `bottomNavigationBar`, inside the safe area, centred and capped
  at 560 px, never covering the form.
- **Responsive:** one column capped at 560 px, centred on tablet/desktop
  rather than stretched.

Backend behaviour, `AddressProvider`, the model and the API payload are
unchanged. Add and Edit are the same screen, so they share every component.

### Tests

`test/add_edit_address_screen_test.dart` — 25 tests: section structure; the
coordinates note with no map wording and the real hub defaults; the
default-address row and its yellow switch; Home/Work/Other mapping into
`label` including the required custom name; editing prefilling every real
field, preselecting the preset, and reopening a custom label under Other;
edit sending the existing id and payload; required-field blocking; optional
fields sent as `null`; the default toggle carried through; a failed save
keeping the form open; Cancel leaving without saving; five viewport sizes
with the action bar always on screen; and the form centred and capped at
560 px on desktop. (Validation-specific cases were added later — see
`docs/05-implementation/blynk-input-validation-audit.md`.)

`flutter analyze`: 2 pre-existing infos. Live E2E: full pass, including
address create and edit through this form.

### Manual verification (real Windows app)

Add Address at phone width: pills, grouped sections, floating labels, the
location block, the pinned yellow Save Address bar; field alignment fixed
after the first pass showed iconless fields sitting further left.

### Limitations

- **Tablet/desktop widths** are covered by widget tests (the form centres and
  caps at 560 px); only phone width was checked by hand.
- **Soft-keyboard scrolling** on Android/iOS is **UNVERIFIED** — only the
  Windows build was run, where there is no on-screen keyboard.
- The address list and checkout address bar were not restyled; they were
  out of scope for this task.

STATUS: ADD/EDIT ADDRESS UI REDESIGNED AND VERIFIED
