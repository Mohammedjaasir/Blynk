# Blynk Customer Order Experience — Implementation Report

**Plan:** `docs/superpowers/plans/2026-09-19-blynk-customer-order-experience.md`
**Spec:** phase brief "Next Phase — Customer Order Experience" (2026-09-19); `docs/04-business/business-rules.md` §3, §5; `docs/01-product/blynk_prd.md` §3.

## 1. Scope

The Customer app's Orders list and Order detail now show the order lifecycle the backend already supported (status, history, schedule, payment, delivery handover) and ask the backend whether cancellation is allowed, instead of relying on a client-side status list. No new order states, no GPS/maps/ETA/push notifications, no rider identity or location, no fake progress or timestamps were introduced. The fake "Repeat Order" action was removed, not replaced.

## 2. Backend audit and the one change

The backend already exposed everything the phase needed except cancellation eligibility (full audit in the plan §B). The single change:

- `sanitizeCustomerOrder` (`backend/api/src/modules/orders/order.service.ts`) gained `can_cancel: boolean`, derived from `customerCanCancel(status)`, which is a pure passthrough to `CATALOGUE.CUSTOMER_CANCEL.from` — the same array `POST /orders/:id/cancel` itself checks under the order lock. No new endpoint, no migration, no change to the cancellation rule, the lifecycle engine, or the admin/rider/inventory contracts. `POST /orders/:id/cancel` remains the sole authority; `can_cancel` is advisory and a stale `true` is refused with the existing error codes.
- Test: `backend/api/tests/customer-orders.test.ts` — `can_cancel` true→false across a full create→list→detail→cancel→re-cancel-refused round trip, plus a unit check tying it to the catalogue for every order status.
- Cancellation's safety against concurrent rider/admin actions was audited, not changed: it was already verified by existing race tests (customer cancel vs. rider pickup, vs. packing, vs. rider assignment; admin cancel vs. pickup), 5 repetitions each.

## 3. Flutter changes

| Area | What changed |
|---|---|
| `lib/Models/order_model.dart` | Parses `can_cancel`, `scheduled_for`, `placed_at`, `cancelled_at`, `delivery_instructions`, `history[]`, `delivery` — previously dropped. `canCancel` reads `can_cancel` only (absent ⇒ false, fail closed); the old client-side `isOrderCancellable` status list is gone. |
| `lib/Models/order_format.dart`, `order_status_labels.dart` | Money/time formatting, per-status label/tone/icon/sentence, timeline row wording, payment-line wording — all derived from backend fields only. |
| `lib/Services/Providers/order.provider.dart` | `fetchOrder` (throws real errors instead of returning null), `cancelOrder` → `CancelOutcome` (never corrupts the orders-list error state), pagination (`loadMoreOrders`/`hasMoreOrders`), a generation counter guarding against a refresh racing an in-flight load-more or an in-flight detail fetch. |
| `lib/UI/Widgets/Organisms/order_status_header.dart`, `order_timeline.dart`, `order_bill_card.dart`, `order_cancel_section.dart`, `lib/UI/Widgets/Atoms/order_status_chip.dart` | New pure widgets for the detail screen's status header, timeline, bill and cancellation flow. |
| `lib/Screens/user_orders_screen.dart` | List row shows status, total, items, payment, schedule; real error/empty/loading states with pull-to-refresh in every state; pagination. |
| `lib/Screens/order_summary_screen.dart` | Rebuilt: status header → timeline → items → bill → delivery address → cancel section (only when `canCancel`); resume-triggered refetch; a visible notice (not a silent failure) when a refresh fails with content already on screen. |
| `lib/Screens/order_confirmation_screen.dart` | "View order" (was "Track Your Order" — there was no tracking), Blynk Yellow; shows the amount to pay and, only when the backend returned `scheduled_for`, the delivery window. |
| Removed | `lib/UI/Widgets/Atoms/repeat_order_cta.dart` (fake feature, not replaced). `card_cancellation_policy.dart` stays — it is also used by Checkout. |

**Rider-status wording (user's explicit instruction):** "A rider has been assigned." and "Your rider has arrived." are shown only when `delivery.assignment_status` is exactly `ASSIGNED`/`ACCEPTED` or `ARRIVED_AT_CUSTOMER` as returned by the backend — never inferred from order status, timestamps, or absence of data. No rider identity, phone, location, ETA, or map is rendered anywhere.

## 4. Tests

- Flutter: 289 tests passing (unit: model/format/provider; widget: the four new organisms/atoms, orders list, order detail, confirmation), covering every supported status, scheduled orders, cancellation visibility and refusal, the failed→re-staged→delivered path, malformed/missing orders, stale state, and backend errors/timeouts. `flutter analyze`: clean.
- Backend: 707 tests passing (29 files), `npm run typecheck` clean, `npm run test:hygiene` — every row of every table identical after the run.
- Live E2E (`integration_test/order_lifecycle_flow_test.dart`, real OTP sign-ins, real HTTP against the running backend, nothing mocked): normal delivery (7 steps, placed and watched entirely through the UI), cancellation by the customer, a refused cancellation on stale state, and failed-delivery recovery (rider fail → admin re-stage → replacement rider → delivered), each cross-checked against `GET /orders/:id`. Forbidden-content scan (rider name/phone, ETA, "km", coordinates, map widgets) run repeatedly across every flow — clean throughout. Passed twice in a row; the dev database was restored to baseline after each run (row counts for orders/items/history/payments/deliveries/notifications/addresses/users/sourcing/inventory-adjustments/OTP/audit logs, plus every inventory quantity).
- Production build: backend build clean; Flutter Windows release build succeeded. The Android release build is blocked by a pre-existing Gradle 7.5 / Java 21 mismatch in the project's Android toolchain, unrelated to this phase's changes.

## 5. Design pass

A generic-AI-design audit was run against 21 real-font screenshots (360×800 and 412×915) of every order state. Ten findings were fixed in the visual layer only — no string, `Key`, semantics label, or logic changed:
Catamaran on button/snackbar text (it was silently falling back to the platform font); the bill's Total made unmistakable (22px/w800 with a rule, matching the cart's own bill); the status timeline given per-status colour and a visible rail (it was previously indistinguishable dots at 1.22:1 contrast, so a failed delivery looked identical to a successful one); page-background text/icon contrast raised to WCAG AA; card differentiation (the bill gets the app's shared elevated-card treatment, the delivery address recedes); the scheduled-delivery pill given a visible fill; the order list's row reworked so status+total lead instead of the reference code, closed orders recede, and Blynk Yellow stopped doing double duty as a status colour; empty/error states optically centred; the confirmation screen's amount and schedule made the dominant facts; the cancellation sheet given a drag handle and more separation between "keep" and "cancel". Full list, before/after screenshots, and the two controller adjustments to the audit (approved shadow on the Bill card; skipped an optional title-hiding suggestion) are in `task-11-audit.md` / `task-11-fixes-report.md` under the phase's working directory.

## 6. Known limitations

- Android release build is blocked by a pre-existing toolchain mismatch (Gradle 7.5 / Java 21), not by this phase.
- `refresh_tokens` in the dev database gained rows from the E2E harness's own long-lived store-side sessions (kept deliberately so the seeded ops accounts stay signed in); not part of the strict baseline set and considered advisory.
- A pre-existing integration test (`live_customer_flow_test.dart`) asserted the confirmation button's old text; updated to use `Key('view-order')` since the rename was an approved part of this phase.
- The live E2E harness's artifacts live outside the repo, per the existing convention.

STATUS: CUSTOMER ORDER EXPERIENCE COMPLETE AND VERIFIED
