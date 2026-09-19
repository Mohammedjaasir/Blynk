# Customer Order Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Customer app's Orders list and Order detail show the order lifecycle the backend already records (status, history, schedule, payment, delivery handover, cancellation), and ask the backend whether an order can be cancelled.

**Architecture:** The backend already exposes everything except cancellation eligibility. One derived boolean, `can_cancel`, is added to the existing customer order responses (no endpoint, no migration). Everything else is Flutter: `OrderModel` parses the fields it currently drops, `OrderProvider` reports errors instead of swallowing them, and the two screens are rebuilt from small widgets that render backend state only.

**Tech Stack:** Flutter (provider, dio), Express + Kysely + Zod + Vitest (one backend change), PostgreSQL (unchanged).

**Spec:** the phase brief "Next Phase — Customer Order Experience" (2026-09-19); `docs/04-business/business-rules.md` §3, §5; `docs/01-product/blynk_prd.md` §3; dispatch plan `docs/superpowers/plans/2026-09-19-blynk-dispatch-order-operations.md` (D2, D11, §O).

## Global Constraints

- Do **not** add: GPS/live location, maps, ETA, push notifications, rider personal information, fake delivery progress, fake timestamps, new order states.
- The UI shows backend state. Status comes from `order_status`; the timeline comes from `history[]`. Nothing is inferred from the clock or from `packed_at`/`dispatched_at` columns (they go stale after a re-stage).
- Cancellation rules do not change: customer cancel is valid from `PLACED` and `PACKED` only (`CATALOGUE.CUSTOMER_CANCEL`), checked under the order lock.
- No new endpoints. No migration. No change to admin, rider or inventory contracts.
- Visual language: Blynk Yellow `AppColors.primaryYellowColor` (#FFE141) for primary actions, Blynk Green `AppColors.primaryGreenColor` (#0C831F) only for delivered/paid, Catamaran, tokens from `lib/app_design.dart` (`AppSpacing`, `AppRadius`, `AppTextColors`, `AppSurfaces`). Dense, readable, 44px+ touch targets, 4.5:1 text contrast, no colour-only meaning.
- No new Flutter dependencies (no `intl`): dates are formatted by a small local helper.
- Tests use payloads shaped exactly like the real responses (§B below).
- Design skill: `ui-ux-pro-max` stands in for "Taste" (not installed), as in the three previous phases; its UX rules are kept, its palettes and fonts are rejected.
- Commit only when the user asks; work on a branch, not `main`.

---

## A. Graphify

`graphify query` (12 tokens from the graph vocabulary) located the entry points: `OrdersScreen`, `OrderSummaryScreen`, `OrderDetailsCard`, `CancellationPolicyCard`, `OrderStatus`, `OrderStatusHistoryTable`, `DeliveryAssignmentStatus`, `calculateScheduledDeliveryTime()`. The graph is from 2026-09-15 and has no nodes for `orders/lifecycle/*`, so the contract below was read from source. Task 9 refreshes the graph.

## B. What the backend exposes today (read from source, not assumed)

Routes (`backend/api/src/modules/orders/index.ts`), all `requireAuth`, all scoped to the caller's `customer_id`:

| Route | Returns |
|---|---|
| `GET /orders?page&limit&status` | `{ orders[], pagination{page,limit,total,total_pages} }`; each order has `items[]`; **no** `history`, `delivery`, `payment` |
| `GET /orders/:id` | `{ order }` with `items[]`, `payment`, `history[]`, `delivery` |
| `POST /orders/:id/cancel` `{reason?}` | `{ order }` (same shape as detail) |
| `POST /orders` | `{ order, is_idempotent_replay }` (`items`, `payment`; no history/delivery) |

Customer-visible fields after `sanitizeCustomerOrder` (`order.service.ts:39-75`):

| Need | Field(s) | Exposed? |
|---|---|---|
| What was ordered | `items[].product_name_snapshot, unit_snapshot, quantity, unit_selling_price, subtotal, item_status` (`PENDING/SOURCED/PACKED/UNAVAILABLE/SUBSTITUTED`) | Yes. Cost fields stripped. |
| Totals | `subtotal_amount, delivery_fee, total_amount` (numbers, 2 dp). `RESOLVE_ITEM` removes `UNAVAILABLE` items from the totals and the payment amount. | Yes |
| Payment / COD | `payment_method` (`COD`), `payment_status` (`PENDING/PAID/FAILED/REFUNDED`) on the order; detail adds `payment{amount, paid_at}` | Yes |
| Status | `order_status`: `PLACED, ITEM_UNAVAILABLE, PACKED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, FAILED, CUSTOMER_UNAVAILABLE` | Yes |
| History | detail only: `history[] = {id, order_id, old_status, new_status, created_at}`, oldest first; one row per status change including the re-stage (`FAILED → PACKED`). Notes and actor stripped (D11). | Yes |
| Cancellation details | `cancellation_reason` (customer-visible by design, D10), `cancelled_at` | Yes |
| **Cancellation eligibility** | — | **No. The only gap (§D).** |
| Scheduled orders | `scheduled_for` (`null` = immediate; otherwise 08:00 Asia/Colombo today/tomorrow, set at placement outside 08:00–21:00) | Yes |
| Failed orders | `order_status = FAILED` / `CUSTOMER_UNAVAILABLE`. The rider's failure reason is staff-only and is not exposed. The failed `deliveries` row is filtered out, so `delivery` is `null` until a replacement is assigned. | Yes (status only, by design) |
| Delivery (safe) | detail only: `delivery = {assignment_status, assigned_at, picked_up_at, delivered_at}` or `null`. No rider name, phone, vehicle, cash ledger or notes. | Yes |
| Address | `delivery_recipient_name/phone, delivery_address_line1/2, delivery_city, delivery_instructions`, `customer_notes` | Yes |

Two behaviours the UI must respect:
1. A cancelled order that had a waiting rider keeps `delivery.assignment_status = 'ASSIGNED'` (left for the Rider app's "Cancelled — don't pick up"). The delivery block is therefore shown only when `order_status` is `PACKED`, `OUT_FOR_DELIVERY` or `DELIVERED`.
2. A re-staged order is `PACKED` again and is customer-cancellable again (business rules §5 "Abandoning a failed order"). With `can_cancel` the app follows this without knowing the rule.

**Cancellation safety against concurrent rider/admin actions — verified, no change needed.** `CUSTOMER_CANCEL` takes `SELECT … FOR UPDATE` on the order, checks the state under the lock, and `setOrderStatus` is a compare-and-set. Existing race tests (5 repetitions each): `rider-delivery.test.ts:480` cancel ∥ pickup (loser gets `400 ORDER_ALREADY_OUT_FOR_DELIVERY` or `409`), `order-lifecycle.test.ts:540` pack ∥ cancel, `:592` assign ∥ cancel, `:605` admin cancel ∥ pickup. Refusal codes the app must handle: `ORDER_ALREADY_OUT_FOR_DELIVERY` (400), `ORDER_ALREADY_CANCELLED` (400), `ORDER_CANNOT_BE_CANCELLED` (400), `ORDER_NOT_FOUND` (404), `VALIDATION_ERROR` (400).

## C. Current Customer Orders UI — audit

| # | Problem | Where | Severity |
|---|---|---|---|
| 1 | History, schedule, delivery handover, `cancelled_at`, delivery instructions are returned by the API and dropped by `OrderModel.fromJson`. The customer cannot see what happened to the order. | `lib/Models/order_model.dart:118` | High |
| 2 | Cancellation visibility is a hardcoded client list (`isOrderCancellable`). | `order_model.dart:40` | High |
| 3 | A refused or failed cancel shows nothing on the detail screen; the error is written to `_ordersError`, which then replaces the whole Orders list with an error. | `order.provider.dart:127`, `card_order_details.dart:44` | High |
| 4 | `getOrderById` swallows every error: a timeout reads "This order could not be found." No retry. | `order.provider.dart:58`, `order_summary_screen.dart:52` | High |
| 5 | List error state says "Pull to refresh" but is not scrollable, so it cannot be pulled. No retry button. | `user_orders_screen.dart:41` | High |
| 6 | Detail has no refresh at all; a customer watching an order sees stale state until they leave and return. | `order_summary_screen.dart` | High |
| 7 | "Repeat Order" is a green primary button that only opens the cart; it repeats nothing. | `repeat_order_cta.dart:27` | High (fake feature) |
| 8 | Status is a small coloured word low on the detail screen, under a generic "Order details" heading. Payment shows the raw string `COD`. "Order Placed" shows a raw ISO timestamp `2026-09-19T10:00:00.000Z`. | `card_order_details.dart:76-97` | Medium |
| 9 | Scheduled orders are indistinguishable from immediate ones, in the list, the detail and the confirmation screen. | all three | Medium |
| 10 | Amounts use `toStringAsFixed(0)`: `Rs. 1214.50` is shown as `Rs.1215`, which is not what the rider collects. | list, detail, item card | Medium |
| 11 | `item_status` is parsed and never shown; an `UNAVAILABLE` item looks charged although the backend removed it from the total. | `card_product_order_summary.dart` | Medium |
| 12 | Labels: "Failed" (failed what?), "Customer unavailable" (third person, to the customer), "Unknown". Every non-delivered order gets a truck icon, including cancelled ones. Status colour is the only difference between red states. | `order_status_labels.dart`, `user_orders_screen.dart:110` | Medium |
| 13 | Only the first 20 orders load; `pagination` is ignored. | `order.provider.dart:31` | Low |
| 14 | Confirmation screen says "Track Your Order" (there is no tracking) on a green button; brand primary is yellow. | `order_confirmation_screen.dart:67` | Low |
| 15 | `CancellationPolicyCard` exists but is unused by the orders screens; 10px grey text. | `card_cancellation_policy.dart` | Low |
| 16 | Template look: stacked white rounded cards, grey label/value pairs, default `AlertDialog`, `Colors.orangeAccent`/`redAccent`. | detail | Visual |

## D. Backend gap — the only one

| | |
|---|---|
| **Missing field** | `can_cancel: boolean` on every customer order object (list, detail, create, cancel responses). |
| **Why the app needs it** | The brief requires the UI to ask the backend whether cancellation is allowed. Today the app copies the rule (`PLACED`, `PACKED`); if the catalogue changes, the app offers a button the backend refuses, or hides one it would accept. |
| **Can it be derived safely?** | Yes, server-side: `CATALOGUE.CUSTOMER_CANCEL.from.includes(order.order_status)` — the same array the cancel action checks under the lock. Ownership is implicit (the sanitizer only runs on the caller's own orders). It is advisory: `POST /orders/:id/cancel` stays the authority, so a stale `true` is refused with the existing codes. |
| **API impact** | One additive boolean in `sanitizeCustomerOrder`. Admin/rider responses untouched. |
| **Database impact** | None. |

Rejected: a new `GET /orders/:id/cancellation` endpoint (an extra round trip for one boolean); always showing the button and letting the POST refuse (offers an action that cannot work on delivered orders).

## E. Decisions — APPROVED 2026-09-19 (C1–C6 as recommended)

**C4 precision from the user:** assigned/arrived wording is shown **only** when `delivery.assignment_status` explicitly returned by the backend says so (`ASSIGNED`/`ACCEPTED` → assigned, `ARRIVED_AT_CUSTOMER` → arrived). Never inferred from timestamps, `order_status` or the absence of a delivery. No rider identity, phone, location, ETA, maps or other new delivery information. `can_cancel` is a response field only; `POST /orders/:id/cancel` stays the authority. Repeat Order is removed, not replaced. No polling.

### Decision table

| # | Question | Recommendation |
|---|---|---|
| C1 | Add `can_cancel` as in §D? | **Yes.** If the field is absent the app hides the button (fail closed). |
| C2 | "Repeat Order" button (fake today). | **Remove it.** No documented requirement; a real re-order needs availability and price checks, which is its own feature. |
| C3 | Customer wording (no new states, words only): `PLACED` "Order placed", `ITEM_UNAVAILABLE` "Item unavailable", `PACKED` "Packed", `OUT_FOR_DELIVERY` "Out for delivery", `DELIVERED` "Delivered", `CANCELLED` "Cancelled", `FAILED` "Delivery failed", `CUSTOMER_UNAVAILABLE` "We couldn't reach you", unparseable "Status unavailable". | **Approve.** |
| C4 | Show `delivery.assignment_status` as one sentence under the status: `ASSIGNED/ACCEPTED` → "A rider has been assigned.", `ARRIVED_AT_CUSTOMER` → "Your rider has arrived." It is already-approved customer data (`sanitizeCustomerDelivery`), real state, no identity, no location. | **Yes.** |
| C5 | Amounts: show cents when present (`Rs. 1,214.50`, `Rs. 1,955`). | **Yes** — it is the cash the rider collects. |
| C6 | Staleness: pull-to-refresh on both screens, refetch when the app returns to the foreground, refetch after any cancel attempt. No timer polling. | **Yes.** |

Observation, no action proposed: PRD line 81 describes `ITEM_UNAVAILABLE` as "customer opted to cancel", but the approved catalogue does not let a customer cancel from `ITEM_UNAVAILABLE`. The rules are preserved as approved; with `can_cancel` the app follows whatever the backend decides.

## F. Design (ui-ux-pro-max rules; Blynk tokens)

**Orders list row** (one surface per order, 1px `AppSurfaces.border`, radius `AppRadius.card`, no shadow):
```
┌───────────────────────────────────────────────┐
│ ● Out for delivery                 Rs. 1,955  │  status dot+label (w700) · total (w800)
│ Kotmale Fresh Milk 1L, Butter 200g +1 more    │  what they ordered (1 line, ellipsis)
│ 3 items · Cash on delivery        19 Sep, 3:42 PM │  secondary, 12px
│ ⏱ Scheduled · from 8:00 AM, 20 Sep            │  only if scheduled_for != null and status is PLACED/ITEM_UNAVAILABLE/PACKED
└───────────────────────────────────────────────┘
```
Status tone (icon + word, never colour alone): active = `AppTextColors.primary` on a yellow-tint chip; delivered = green with check; cancelled = `AppTextColors.secondary` with a struck circle; failed/couldn't reach/item unavailable = `Color(0xffB42318)` with an alert icon.

**Order detail**, top to bottom in one scroll (`RefreshIndicator`):
1. **Status header**: status label at 24/w800, one sentence (C3/C4 copy), and for scheduled pre-dispatch orders "Scheduled — delivery from 8:00 AM, Sun 20 Sep". Cancelled: "Reason: …" from `cancellation_reason`.
2. **Timeline** ("What happened"): every `history[]` row, oldest first, label + local time. A `PACKED` row whose `old_status` is `FAILED`/`CUSTOMER_UNAVAILABLE` reads "Packed again for redelivery". The last row is emphasised. No future/greyed steps (that would be fake progress).
3. **Items**: name, `unit × qty`, line subtotal; `UNAVAILABLE` → struck through + "Unavailable — not charged"; `SUBSTITUTED` → "Replaced by the store".
4. **Bill**: subtotal, delivery fee, total; then one payment line: `PENDING` + active → "Cash on delivery — pay Rs. X to the rider"; `PAID` → "Paid in cash" (green); `CANCELLED` → "Nothing to pay"; `FAILED`/`CUSTOMER_UNAVAILABLE` + `PENDING` → "Not paid".
5. **Delivery to**: recipient, phone, address, instructions, customer notes.
6. **Cancel** (only if `canCancel`): full-width outlined destructive button + the policy line "You can cancel until your order is out for delivery." Confirmation is a bottom sheet (radius `AppRadius.sheet`): primary yellow "Keep order", text-destructive "Cancel order". While the request runs the button shows a spinner and is disabled.

Primary yellow action on this screen: none while an order is active (nothing the customer must do); "Keep order" in the sheet; "Try again" on error states. No green primary buttons.

**Confirmation screen:** yellow "View order"; if `scheduledFor != null`, the line "Scheduled — delivery from 8:00 AM, Sun 20 Sep".

**Error copy:** list/detail load failure → "Couldn't load your orders." / "Couldn't load this order." + the `ApiException.message` + yellow "Try again". 404/400 → "This order could not be found." (no retry). Cancel refusals: `ORDER_ALREADY_OUT_FOR_DELIVERY` → "Your order is already on its way, so it can't be cancelled."; `ORDER_ALREADY_CANCELLED` → "This order is already cancelled."; `ORDER_CANNOT_BE_CANCELLED` → "This order can't be cancelled now."; timeout/network → "We couldn't confirm the cancellation. Checking your order…". After every failed cancel the order is refetched so the screen shows the truth.

## G. Files

| File | Responsibility |
|---|---|
| Modify `backend/api/src/modules/orders/order.service.ts` | `customerCanCancel`, `can_cancel` in `sanitizeCustomerOrder` |
| Modify `backend/api/tests/customer-orders.test.ts` | contract tests for `can_cancel` |
| Modify `lib/Models/order_model.dart` | parse `can_cancel`, `scheduled_for`, timestamps, `history`, `delivery`; `tryParse`; remove `isOrderCancellable` |
| Create `lib/Models/order_format.dart` | `formatLkr`, `formatOrderTime`, `formatScheduled` |
| Modify `lib/Models/order_status_labels.dart` | C3 labels, tone, icon, sentence, timeline label, payment line |
| Modify `lib/Services/Providers/order.provider.dart` | injectable request, `fetchOrder` (throws), `cancelOrder` → `CancelOutcome`, pagination |
| Create `lib/UI/Widgets/Atoms/order_status_chip.dart` | dot/icon + label |
| Create `lib/UI/Widgets/Organisms/order_status_header.dart` | detail section 1 |
| Create `lib/UI/Widgets/Organisms/order_timeline.dart` | detail section 2 |
| Create `lib/UI/Widgets/Organisms/order_bill_card.dart` | detail section 4 (replaces `_OrderTotalsCard`) |
| Create `lib/UI/Widgets/Organisms/order_cancel_section.dart` | detail section 6 (button, sheet, refusal) |
| Modify `lib/UI/Widgets/Atoms/card_product_order_summary.dart`, `Organisms/order_summary_screen_product_details_card.dart` | item status, amounts |
| Modify `lib/UI/Widgets/Atoms/card_order_details.dart` | becomes "Delivery to" only (status, cancel move out) |
| Modify `lib/Screens/user_orders_screen.dart`, `order_summary_screen.dart`, `order_confirmation_screen.dart` | new rows, states, refresh, resume |
| Delete `lib/UI/Widgets/Atoms/repeat_order_cta.dart`, `card_cancellation_policy.dart` (C2; policy line moves into the cancel section) | |
| Create `test/fixtures/order_fixtures.dart` | real-shaped payloads for every state |
| Modify/Create `test/order_model_test.dart`, `test/order_provider_test.dart`, `test/orders_screen_test.dart`, `test/order_detail_screen_test.dart` | §H |
| Create `integration_test/order_lifecycle_flow_test.dart` | live E2E |

All Flutter paths are under `apps/customer/blinkit-clone-Flutter-ecommerce-/`.

## H. Test matrix (brief → test)

| Brief | Test |
|---|---|
| order list with multiple items | `orders_screen_test`: "names the items and counts quantities" |
| order detail | `order_detail_screen_test`: "shows items, bill, address" |
| each supported status | model test maps 8 + unknown; list test labels 8; detail test header + sentence for 8 |
| scheduled order | list chip, detail line, confirmation line; not shown once `OUT_FOR_DELIVERY` |
| cancelled order | reason + `cancelled` timeline row + "Nothing to pay"; stale `delivery.ASSIGNED` not rendered |
| failed order | "Delivery failed", "Not paid", no cancel, `delivery: null` tolerated |
| failed → re-stage → delivered | timeline shows 7 rows in order incl. "Packed again for redelivery"; header "Delivered"; "Paid in cash" |
| cancellation visibility | shown iff `can_cancel == true`; hidden when field absent; `PACKED` + `can_cancel:false` hides it (proves no client list) |
| cancellation refusal | provider returns `CancelOutcome.refused` with code; screen shows the message, refetches, button disappears |
| malformed/missing order | `tryParse` null for no id / non-map; list skips bad rows; bad item/history entries skipped; detail 404 → not found |
| stale order state | cancel on stale `PLACED` → 400 `ORDER_ALREADY_OUT_FOR_DELIVERY` → refetched order rendered; resume triggers refetch |
| backend errors/timeouts | provider maps 500/`TIMEOUT`; list + detail show retry; retry succeeds; cancel timeout refetches |
| backend | `can_cancel` true on placed (create, list, detail), false after cancel; unit check of all 8 statuses against the catalogue |

---

## N. Tasks

### Task 1: Backend `can_cancel`

**Files:** Modify `backend/api/src/modules/orders/order.service.ts`; Test `backend/api/tests/customer-orders.test.ts`

**Interfaces:** Produces `can_cancel: boolean` on every `sanitizeCustomerOrder` result; `export function customerCanCancel(status: OrderStatus): boolean`.

- [ ] **Step 1: Failing tests** — append inside `describe('Customer orders contract')`:

```ts
  it('tells the customer app whether the order can be cancelled (can_cancel)', async () => {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    created.push(placed.body.data.order.id);
    const id = placed.body.data.order.id as string;
    expect(placed.body.data.order.can_cancel).toBe(true);

    const list = await request(app).get('/api/v1/orders?limit=50').set('Authorization', `Bearer ${tokenCustomer}`);
    expect(list.body.data.orders.find((o: { id: string }) => o.id === id).can_cancel).toBe(true);
    const detail = await request(app).get(`/api/v1/orders/${id}`).set('Authorization', `Bearer ${tokenCustomer}`);
    expect(detail.body.data.order.can_cancel).toBe(true);

    const cancelled = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${tokenCustomer}`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.can_cancel).toBe(false);

    const again = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${tokenCustomer}`).send({});
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ORDER_ALREADY_CANCELLED');
  });

  it('can_cancel is the lifecycle catalogue\'s rule for every status', () => {
    const ALL = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE'] as const;
    for (const s of ALL) expect(customerCanCancel(s)).toBe(CATALOGUE.CUSTOMER_CANCEL.from.includes(s));
    expect(ALL.filter(customerCanCancel)).toEqual(['PLACED', 'PACKED']);
  });
```
and add the imports:
```ts
import { customerCanCancel } from '../src/modules/orders/order.service.js';
import { CATALOGUE } from '../src/modules/orders/lifecycle/catalogue.js';
```

- [ ] **Step 2:** `cd backend/api && npx vitest run tests/customer-orders.test.ts` → FAIL (`customerCanCancel` is not exported; `can_cancel` undefined).

- [ ] **Step 3: Implement** in `order.service.ts` — change the catalogue import to `import { adminStatusAction, CATALOGUE } from './lifecycle/catalogue.js';`, add above `sanitizeCustomerOrder`:

```ts
/**
 * Whether the customer may cancel right now: the CUSTOMER_CANCEL rule itself,
 * so the app never keeps its own list. Advisory - the cancel action re-checks
 * under the order lock.
 */
export function customerCanCancel(status: OrderStatus): boolean {
  return CATALOGUE.CUSTOMER_CANCEL.from.includes(status);
}
```
and in `sanitizeCustomerOrder`'s returned object, after `...safeOrder,`:
```ts
    can_cancel: customerCanCancel(order.order_status),
```

- [ ] **Step 4:** `npx vitest run tests/customer-orders.test.ts tests/orders.test.ts tests/order-lifecycle.test.ts` → PASS. `npm run typecheck` → clean.
- [ ] **Step 5:** Commit (when the user asks): `feat(orders): expose can_cancel on customer order responses`.

### Task 2: Fixtures + `OrderModel`

**Files:** Create `test/fixtures/order_fixtures.dart`; Modify `lib/Models/order_model.dart`, `test/order_model_test.dart`

**Interfaces — Produces:**
```dart
class OrderStatusEvent { final OrderStatus? oldStatus; final OrderStatus newStatus; final DateTime? at; }
class OrderDeliveryInfo { final String assignmentStatus; final DateTime? assignedAt, pickedUpAt, deliveredAt; }
// OrderModel gains:
final String rawStatus; final bool canCancel; final DateTime? scheduledFor, placedAt, cancelledAt;
final String? deliveryInstructions; final List<OrderStatusEvent> history; final OrderDeliveryInfo? delivery;
bool get isScheduled;          // scheduledFor != null
bool get showsScheduleNotice;  // isScheduled && status in {placed, itemUnavailable, packed}
bool get showsDelivery;        // delivery != null && status in {packed, outForDelivery, delivered}
static OrderModel? tryParse(Object? json);
```
`isOrderCancellable` and `isCancellable` are deleted.

- [ ] **Step 1: Fixtures.** `orderJson({...})` returns a map shaped like `GET /orders/:id`:

```dart
Map<String, dynamic> orderJson({
  String id = 'c0000001-0000-0000-0000-000000000001',
  String number = 'BL-20260919-4821',
  String status = 'PLACED',
  bool? canCancel,
  String paymentStatus = 'PENDING',
  String? scheduledFor,
  String? cancellationReason,
  List<Map<String, dynamic>>? items,
  List<List<String?>>? history, // [old, new, iso]
  Map<String, dynamic>? delivery,
  bool detail = true,
  num subtotal = 1885.0, num fee = 70.0, num total = 1955.0,
}) => {
      'id': id, 'order_number': number, 'order_status': status,
      if (canCancel != null) 'can_cancel': canCancel,
      'payment_method': 'COD', 'payment_status': paymentStatus,
      'subtotal_amount': subtotal, 'delivery_fee': fee, 'total_amount': total,
      'scheduled_for': scheduledFor,
      'delivery_recipient_name': 'Jane Silva', 'delivery_recipient_phone': '+94771234567',
      'delivery_address_line1': '12 Galle Road', 'delivery_address_line2': null,
      'delivery_city': 'Dharga Town', 'delivery_instructions': 'Blue gate',
      'cancellation_reason': cancellationReason,
      'cancelled_at': status == 'CANCELLED' ? '2026-09-19T10:20:00.000Z' : null,
      'customer_notes': null,
      'placed_at': '2026-09-19T10:00:00.000Z', 'created_at': '2026-09-19T10:00:00.000Z',
      'items': items ?? [itemJson('i1', 'Kotmale Fresh Milk 1L', 2, 540), itemJson('i2', 'Butter 200g', 1, 805)],
      if (detail) 'payment': {'amount': total, 'payment_status': paymentStatus, 'paid_at': null},
      if (detail) 'history': [
        for (final h in history ?? [[null, 'PLACED', '2026-09-19T10:00:00.000Z']])
          {'id': 'h${h[2]}', 'order_id': id, 'old_status': h[0], 'new_status': h[1], 'created_at': h[2]},
      ],
      if (detail) 'delivery': delivery,
    };

Map<String, dynamic> itemJson(String id, String name, int qty, num price, {String status = 'PENDING'}) => {
      'id': id, 'order_id': 'o', 'product_id': 'p-$id', 'product_name_snapshot': name,
      'sku_snapshot': 'SKU-$id', 'unit_snapshot': '1 pc', 'unit_selling_price': price,
      'quantity': qty, 'subtotal': price * qty, 'item_status': status, 'created_at': '2026-09-19T10:00:00.000Z',
    };

/// FAILED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED, as the backend records it.
Map<String, dynamic> restagedDeliveredJson() => orderJson(
      status: 'DELIVERED', canCancel: false, paymentStatus: 'PAID',
      history: [
        [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
        ['PLACED', 'PACKED', '2026-09-19T10:10:00.000Z'],
        ['PACKED', 'OUT_FOR_DELIVERY', '2026-09-19T10:20:00.000Z'],
        ['OUT_FOR_DELIVERY', 'FAILED', '2026-09-19T10:40:00.000Z'],
        ['FAILED', 'PACKED', '2026-09-19T11:00:00.000Z'],
        ['PACKED', 'OUT_FOR_DELIVERY', '2026-09-19T11:10:00.000Z'],
        ['OUT_FOR_DELIVERY', 'DELIVERED', '2026-09-19T11:30:00.000Z'],
      ],
      delivery: {'assignment_status': 'DELIVERED', 'assigned_at': '2026-09-19T11:05:00.000Z',
        'picked_up_at': '2026-09-19T11:10:00.000Z', 'delivered_at': '2026-09-19T11:30:00.000Z'},
    );
```

- [ ] **Step 2: Failing model tests** (replace the `isOrderCancellable` test; keep the status-mapping and cost-field tests):

```dart
test('canCancel is the backend flag, never derived from status', () {
  expect(OrderModel.fromJson(orderJson(status: 'PLACED', canCancel: true)).canCancel, isTrue);
  expect(OrderModel.fromJson(orderJson(status: 'PACKED', canCancel: false)).canCancel, isFalse);
  expect(OrderModel.fromJson(orderJson(status: 'PLACED')).canCancel, isFalse, reason: 'absent = fail closed');
});
test('parses schedule, history and delivery', () {
  final o = OrderModel.fromJson(restagedDeliveredJson());
  expect(o.history.map((h) => h.newStatus), [OrderStatus.placed, OrderStatus.packed, OrderStatus.outForDelivery,
    OrderStatus.failed, OrderStatus.packed, OrderStatus.outForDelivery, OrderStatus.delivered]);
  expect(o.history[4].oldStatus, OrderStatus.failed);
  expect(o.history.first.at, DateTime.utc(2026, 9, 19, 10));
  expect(o.delivery!.assignmentStatus, 'DELIVERED');
  expect(o.showsDelivery, isTrue);
  final s = OrderModel.fromJson(orderJson(scheduledFor: '2026-09-20T02:30:00.000Z'));
  expect(s.isScheduled, isTrue); expect(s.showsScheduleNotice, isTrue);
  expect(OrderModel.fromJson(orderJson(status: 'DELIVERED', scheduledFor: '2026-09-20T02:30:00.000Z')).showsScheduleNotice, isFalse);
});
test('a cancelled order never shows its leftover ASSIGNED delivery', () {
  final o = OrderModel.fromJson(orderJson(status: 'CANCELLED', delivery: {'assignment_status': 'ASSIGNED', 'assigned_at': '2026-09-19T10:15:00.000Z', 'picked_up_at': null, 'delivered_at': null}));
  expect(o.showsDelivery, isFalse);
});
test('malformed payloads', () {
  expect(OrderModel.tryParse(null), isNull);
  expect(OrderModel.tryParse('x'), isNull);
  expect(OrderModel.tryParse({'order_number': 'N'}), isNull, reason: 'no id');
  final o = OrderModel.tryParse({...orderJson(), 'items': [itemJson('i1', 'Milk', 1, 540), 'junk', null], 'history': ['junk', {'new_status': 'PACKED', 'created_at': 'not-a-date'}]})!;
  expect(o.items, hasLength(1));
  expect(o.history, hasLength(1)); expect(o.history.single.at, isNull);
  expect(OrderModel.tryParse({...orderJson(), 'order_status': 'TELEPORTED'})!.status, OrderStatus.unknown);
});
```

- [ ] **Step 3:** `flutter test test/order_model_test.dart` → FAIL (getters undefined).
- [ ] **Step 4: Implement** in `order_model.dart`:

```dart
DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse(v.toString());

class OrderStatusEvent {
  const OrderStatusEvent({required this.oldStatus, required this.newStatus, required this.at});
  final OrderStatus? oldStatus;
  final OrderStatus newStatus;
  final DateTime? at;
  static OrderStatusEvent? tryParse(Object? json) {
    if (json is! Map || json['new_status'] == null) return null;
    return OrderStatusEvent(
      oldStatus: json['old_status'] == null ? null : orderStatusFromString(json['old_status'].toString()),
      newStatus: orderStatusFromString(json['new_status'].toString()),
      at: _date(json['created_at']),
    );
  }
}

class OrderDeliveryInfo {
  const OrderDeliveryInfo({required this.assignmentStatus, this.assignedAt, this.pickedUpAt, this.deliveredAt});
  final String assignmentStatus;
  final DateTime? assignedAt, pickedUpAt, deliveredAt;
  static OrderDeliveryInfo? tryParse(Object? json) {
    if (json is! Map || json['assignment_status'] == null) return null;
    return OrderDeliveryInfo(
      assignmentStatus: json['assignment_status'].toString(),
      assignedAt: _date(json['assigned_at']), pickedUpAt: _date(json['picked_up_at']), deliveredAt: _date(json['delivered_at']),
    );
  }
}
```
`OrderItemModel.tryParse(Object?)` returns `null` for non-maps or a missing `id`. In `OrderModel`: add the fields; `fromJson` sets `rawStatus`, `canCancel: json['can_cancel'] == true`, `scheduledFor: _date(json['scheduled_for'])`, `placedAt: _date(json['placed_at'] ?? json['created_at'])`, `cancelledAt`, `deliveryInstructions`, `items: rawItems.map(OrderItemModel.tryParse).whereType<OrderItemModel>().toList()`, `history` likewise, `delivery: OrderDeliveryInfo.tryParse(json['delivery'])`; and

```dart
static const _preDispatch = {OrderStatus.placed, OrderStatus.itemUnavailable, OrderStatus.packed};
static const _withDelivery = {OrderStatus.packed, OrderStatus.outForDelivery, OrderStatus.delivered};
bool get isScheduled => scheduledFor != null;
bool get showsScheduleNotice => isScheduled && _preDispatch.contains(status);
bool get showsDelivery => delivery != null && _withDelivery.contains(status);

static OrderModel? tryParse(Object? json) {
  if (json is! Map) return null;
  final map = json.cast<String, dynamic>();
  if ((map['id'] ?? '').toString().isEmpty) return null;
  return OrderModel.fromJson(map);
}
```
Remove `createdAt` (replaced by `placedAt`), `isOrderCancellable`, `isCancellable`; fix the two call sites in Task 6/7 (until then keep the project compiling by updating `card_order_details.dart` to `order.canCancel` and dropping the raw date block).

- [ ] **Step 5:** `flutter test test/order_model_test.dart` → PASS; `flutter analyze` → no new issues. Commit: `feat(customer): order model parses lifecycle data and can_cancel`.

### Task 3: Formatting + status presentation

**Files:** Create `lib/Models/order_format.dart`, `test/order_format_test.dart`; Modify `lib/Models/order_status_labels.dart`

**Interfaces — Produces:**
```dart
String formatLkr(double amount);                 // 'Rs. 1,955' / 'Rs. 1,214.50'
String formatOrderTime(DateTime utcOrLocal);     // '19 Sep, 3:42 PM' (device local time)
String formatScheduled(DateTime at);             // 'from 8:00 AM, Sun 20 Sep'
enum OrderTone { active, success, neutral, problem }
String orderStatusLabel(OrderStatus s); OrderTone orderStatusTone(OrderStatus s); IconData orderStatusIcon(OrderStatus s);
Color orderToneColor(OrderTone t);
String orderStatusSentence(OrderModel o);        // C3/C4 copy
String timelineLabel(OrderStatusEvent e);        // incl. 'Packed again for redelivery'
String paymentLine(OrderModel o);
```

- [ ] **Step 1: Failing tests** (`test/order_format_test.dart`):
```dart
test('money shows cents only when there are any', () {
  expect(formatLkr(1955), 'Rs. 1,955'); expect(formatLkr(1214.5), 'Rs. 1,214.50'); expect(formatLkr(70), 'Rs. 70');
});
test('times are local and human', () {
  expect(formatOrderTime(DateTime(2026, 9, 19, 15, 42)), '19 Sep, 3:42 PM');
  expect(formatOrderTime(DateTime(2026, 9, 19, 0, 5)), '19 Sep, 12:05 AM');
  expect(formatScheduled(DateTime(2026, 9, 20, 8)), 'from 8:00 AM, Sun 20 Sep');
});
test('labels, sentences, payment', () {
  expect(orderStatusLabel(OrderStatus.failed), 'Delivery failed');
  expect(orderStatusLabel(OrderStatus.customerUnavailable), "We couldn't reach you");
  final arrived = OrderModel.fromJson(orderJson(status: 'OUT_FOR_DELIVERY', delivery: {'assignment_status': 'ARRIVED_AT_CUSTOMER'}));
  expect(orderStatusSentence(arrived), 'Your rider has arrived.');
  expect(paymentLine(OrderModel.fromJson(orderJson())), 'Cash on delivery — pay Rs. 1,955 to the rider');
  expect(paymentLine(OrderModel.fromJson(restagedDeliveredJson())), 'Paid in cash');
  expect(paymentLine(OrderModel.fromJson(orderJson(status: 'CANCELLED'))), 'Nothing to pay');
  expect(paymentLine(OrderModel.fromJson(orderJson(status: 'FAILED'))), 'Not paid');
  final h = OrderModel.fromJson(restagedDeliveredJson()).history;
  expect(timelineLabel(h[4]), 'Packed again for redelivery'); expect(timelineLabel(h[1]), 'Packed');
});
```
- [ ] **Step 2:** run → FAIL. **Step 3: Implement.** `formatLkr`: `final whole = amount == amount.roundToDouble(); final s = amount.toStringAsFixed(whole ? 0 : 2);` then insert thousands commas into the integer part with `replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',')`; prefix `'Rs. '`. `formatOrderTime`: `final t = d.toLocal();` month from a const 12-name list, 12-hour clock, zero-padded minutes. `formatScheduled`: weekday from a const 7-name list (`DateTime.weekday - 1`). Sentences:

| Status | Sentence |
|---|---|
| placed | scheduled → "We'll start preparing it when deliveries open."; else "We've received your order." |
| itemUnavailable | "Something couldn't be sourced. Your total has been updated." |
| packed | `showsDelivery` and `delivery.assignmentStatus` is exactly `ASSIGNED` or `ACCEPTED` → "A rider has been assigned."; else "Your order is packed." (nothing is said about riders when the backend returned no such status) |
| outForDelivery | `showsDelivery` and `delivery.assignmentStatus` is exactly `ARRIVED_AT_CUSTOMER` → "Your rider has arrived."; else "Your order is on its way." |
| delivered | "Delivered. Thank you!" |
| cancelled | "This order was cancelled." |
| failed | "We couldn't complete this delivery." |
| customerUnavailable | "The rider couldn't reach you at the address." |
| unknown | "Pull down to refresh." |

Tones: delivered → success; cancelled → neutral; failed, customerUnavailable, itemUnavailable → problem; unknown → neutral; rest → active. Colours: active `AppTextColors.primary`, success `AppColors.primaryGreenColor`, neutral `AppTextColors.secondary`, problem `Color(0xffB42318)`. Icons: placed `receipt_long_outlined`, itemUnavailable `error_outline`, packed `inventory_2_outlined`, outForDelivery `local_shipping_outlined`, delivered `check_circle`, cancelled `cancel_outlined`, failed/customerUnavailable `error_outline`, unknown `help_outline`. `orderStatusColor` is removed (call sites move to tone in Tasks 6–7).
- [ ] **Step 4:** tests PASS, analyze clean. Commit: `feat(customer): order wording, money and time formatting`.

### Task 4: `OrderProvider` — real errors, cancel outcome, pagination

**Files:** Modify `lib/Services/Providers/order.provider.dart`; Create `test/order_provider_test.dart`

**Interfaces — Produces:**
```dart
typedef OrderRequest = Future<dynamic> Function(String method, String url, {Object? body, Map<String, dynamic>? query});
OrderProvider({OrderRequest? request});
Future<void> loadOrders();                 // page 1, replaces list
Future<void> loadMoreOrders();             // next page, appends; no-op when !hasMoreOrders or busy
bool get hasMoreOrders; bool get isLoadingMore;
Future<OrderModel> fetchOrder(String id);  // throws ApiException (404 → code ORDER_NOT_FOUND)
Future<CancelOutcome> cancelOrder(String id, {String? reason});
class CancelOutcome { final OrderModel? order; final ApiException? error; bool get ok => order != null;
  bool get isRefusal => error != null && error!.statusCode >= 400 && error!.statusCode < 500 && error!.statusCode != 408; }
```
`getOrderById` is removed. `cancelOrder` never touches `_ordersError`.

- [ ] **Step 1: Failing tests** with a fake request in the style of `test/home_carousel_test.dart`:
```dart
class _FakeOrdersApi {
  final calls = <String>[];
  final Map<String, Object Function()> routes = {};
  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url${query == null ? '' : '?page=${query['page']}'}';
    calls.add(key);
    final r = routes[key];
    if (r == null) throw ApiException(404, 'Order not found.', code: 'ORDER_NOT_FOUND');
    final v = r(); if (v is ApiException) throw v; return v;
  }
}
Map<String, dynamic> listEnvelope(List<Object?> orders, {int page = 1, int totalPages = 1}) =>
    {'success': true, 'data': {'orders': orders, 'pagination': {'page': page, 'limit': 20, 'total': orders.length, 'total_pages': totalPages}}};
Map<String, dynamic> orderEnvelope(Map<String, dynamic> o) => {'success': true, 'data': {'order': o}};
```
Tests: (a) list parses orders and **skips** a `'junk'` row; (b) `loadMoreOrders` requests `page=2`, appends, `hasMoreOrders` false after the last page; (c) list 500 → `ordersError` set, list kept empty; then a succeeding retry clears it; (d) `fetchOrder` returns the model; throws `ApiException` 404 on a missing order and `code == 'TIMEOUT'` on a timeout; an envelope without `order` throws `ApiException(500)`; (e) cancel success → `ok`, list entry replaced, `canCancel == false`; (f) cancel 400 `ORDER_ALREADY_OUT_FOR_DELIVERY` → `isRefusal`, `ordersError` stays null; (g) cancel timeout → `!ok && !isRefusal`.
- [ ] **Step 2:** FAIL. **Step 3: Implement**: default `_request` wraps `ApiService.requestMethods(methodType:, url:, body:, queryParameters:)`; `loadOrders` sends `query: {'page': '1', 'limit': '20'}` and stores `total_pages`; every catch converts with `e is ApiException ? e : ApiService.handleError(e)`. **Step 4:** PASS, analyze clean. Commit: `feat(customer): order provider reports errors and cancel outcomes`.

### Task 5: Status chip, header, timeline, bill (pure widgets)

**Files:** Create the four widget files in §G; Create `test/order_widgets_test.dart`

**Interfaces — Produces:** `OrderStatusChip({required OrderStatus status})`, `OrderStatusHeader({required OrderModel order})`, `OrderTimeline({required List<OrderStatusEvent> history})`, `OrderBillCard({required OrderModel order})`. Keys: `Key('order-status-header')`, `Key('order-schedule-notice')`, `Key('order-timeline')`, `Key('timeline-row-$index')`, `Key('order-payment-line')`.

- [ ] **Step 1: Failing tests:** header shows label + sentence for all 8 statuses (loop over `{status: [label, sentence]}`); schedule notice present for `PLACED` + `scheduled_for`, absent for `OUT_FOR_DELIVERY`; cancelled shows "Reason: Supplier closed today"; timeline of `restagedDeliveredJson()` has 7 rows in order, row 4 text "Packed again for redelivery", each with its formatted time, and **no** row for a status that is not in `history` (e.g. a `PLACED`-only order shows exactly 1 row — no greyed future steps); timeline with empty history renders nothing (`SizedBox.shrink`); bill shows `Rs. 1,885`, `Rs. 70`, `Rs. 1,955` and the payment line per Task 3.
- [ ] **Step 2:** FAIL. **Step 3: Implement** per §F. Timeline row: 10px dot (last row filled `AppTextColors.primary`, others `AppSurfaces.border`), 1px connector, label `w700 14`, time `AppTextColors.secondary 12`; an event with `at == null` shows the label only (never a made-up time). Header: label `fontSize 24, w800`, tone colour + icon, sentence `14`, schedule notice in a `AppSurfaces.tile` pill with `Icons.schedule`. **Step 4:** PASS. Commit: `feat(customer): order status header, timeline and bill`.

### Task 6: Orders list screen

**Files:** Modify `lib/Screens/user_orders_screen.dart`, `test/orders_screen_test.dart`

- [ ] **Step 1: Failing tests** (extend the existing file; `_FixedOrders` gains overridable `ordersError`, `hasMoreOrders`, and counts `loadOrders` calls): names items ("Kotmale Fresh Milk 1L, Butter 200g") and "3 items"; three-item order shows "+1 more"; total `Rs. 1,955`; all 8 labels (C3); scheduled chip only for a pre-dispatch scheduled order; error state shows "Couldn't load your orders." and a "Try again" button that calls `loadOrders`; error and empty states are inside a scrollable so pull-to-refresh works (`tester.fling` → `loadOrders` called); scrolling to the end calls `loadMoreOrders` when `hasMoreOrders`; row tap still pushes `/order` with the id.
- [ ] **Step 2:** FAIL. **Step 3: Implement** the row in §F with `InkWell` (ripple, 44px+), `OrderStatusChip`, `Semantics(label: '$number, $statusLabel, $total')`; states wrapped in `RefreshIndicator` + `ListView` (`AlwaysScrollableScrollPhysics`); `NotificationListener<ScrollNotification>` triggers `loadMoreOrders` within 200px of the end; footer spinner while `isLoadingMore`. **Step 4:** PASS. Commit: `feat(customer): orders list shows items, schedule and real states`.

### Task 7: Order detail screen + cancellation

**Files:** Modify `lib/Screens/order_summary_screen.dart`, `card_order_details.dart`, `card_product_order_summary.dart`, `order_summary_screen_product_details_card.dart`; Create `order_cancel_section.dart`, `test/order_detail_screen_test.dart`; Delete `repeat_order_cta.dart`, `card_cancellation_policy.dart`

**Interfaces — Consumes:** `OrderProvider.fetchOrder`, `cancelOrder`, `CancelOutcome`; Task 5 widgets. **Produces:** `OrderCancelSection({required OrderModel order, required Future<void> Function() onChanged})`; keys `Key('cancel-order-button')`, `Key('confirm-cancel')`, `Key('keep-order')`, `Key('order-retry')`.

- [ ] **Step 1: Failing tests** (real `OrderProvider(request: fake.call)` from Task 4):
  1. detail renders header, 2 items, bill, "Delivery to", instructions;
  2. cancel button visible iff `can_cancel: true`; hidden for `PACKED` + `can_cancel:false`; hidden when the field is absent;
  3. cancel → sheet → confirm → `POST /orders/:id/cancel` called once → screen shows "Cancelled", reason, a `Cancelled` timeline row, no cancel button;
  4. "Keep order" closes the sheet, no request;
  5. **stale state / refusal:** screen shows `PLACED` + `can_cancel:true`; the fake now returns 400 `ORDER_ALREADY_OUT_FOR_DELIVERY` for cancel and an `OUT_FOR_DELIVERY` order for GET → message "Your order is already on its way, so it can't be cancelled.", header "Out for delivery", button gone;
  6. cancel timeout → "We couldn't confirm the cancellation. Checking your order…" and one refetch;
  7. double-tap confirm sends one request (button disabled while busy);
  8. 404 → "This order could not be found.", no retry button; 500/timeout → "Couldn't load this order." + `order-retry`; retry then succeeds;
  9. failed order: "Delivery failed", "Not paid", no cancel, `delivery: null` OK; re-staged delivered order: 7 timeline rows, "Paid in cash";
  10. `UNAVAILABLE` item shows "Unavailable — not charged"; `SUBSTITUTED` shows "Replaced by the store";
  11. `didChangeAppLifecycleState(resumed)` refetches (`tester.binding.handleAppLifecycleStateChanged`);
  12. no "Repeat Order" anywhere.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** Screen state: `_order`, `_error` (`ApiException?`), `_loading`; `_load()` try/catch around `fetchOrder`; `WidgetsBindingObserver` for resume; body is `RefreshIndicator(onRefresh: _load)` over a `ListView` of §F sections 1–6. `OrderCancelSection` holds `_busy`; on confirm: `final r = await provider.cancelOrder(order.id); if (!r.ok) show message (SnackBar, `cancelRefusalMessage(r.error!)`); await onChanged();` where `onChanged` is the screen's `_load` (on success the refetch also brings the new history row). `cancelRefusalMessage` maps the codes in §F and falls back to `error.message`. **Step 4:** all Flutter tests PASS; `flutter analyze` clean. Commit: `feat(customer): order detail with history, schedule and backend-driven cancel`.

### Task 8: Confirmation screen

**Files:** Modify `lib/Screens/order_confirmation_screen.dart`; Create `test/order_confirmation_screen_test.dart`
- [ ] Tests: button reads "View order" and pushes `/order`; scheduled order shows "Scheduled — delivery from 8:00 AM, Sun 20 Sep"; immediate order does not; total shown with `formatLkr` and "Cash on delivery". Implement: yellow primary (`AppColors.primaryYellowColor`, `AppTextColors.onYellow`), text only. Commit: `feat(customer): confirmation shows schedule and amount to pay`.

### Task 9: Full verification

- [ ] `cd apps/customer/blinkit-clone-Flutter-ecommerce- && flutter test` → all pass (report counts).
- [ ] `flutter analyze` → no issues introduced (report the baseline if pre-existing).
- [ ] `cd backend/api && npm run typecheck && npm test && npm run test:hygiene` → pass (backend tests were touched).
- [ ] Admin/Rider/Inventory typechecks: `npm run typecheck` (or `tsc --noEmit`) in `apps/admin`, `apps/rider`, `apps/inventory` — unchanged code, confirms nothing consumed the removed symbols.
- [ ] Production build: `flutter build apk --release` (and `flutter build web --release` if the web target is enabled); `cd backend/api && npm run build`.
- [ ] Refresh the graph: `graphify update .` so `orders/lifecycle` and the new widgets are indexed.

### Task 10: Live E2E (`integration_test/order_lifecycle_flow_test.dart`)

Harness: the pattern in `integration_test/admin_to_customer_flow_test.dart` (real OTP sign-in via `dev_otp`, Dio ops clients for admin, packing staff and rider). Endpoints (from `tests/order-lifecycle.test.ts:85-97`): source `POST /admin/orders/:id/items/:itemId/source {actual_unit_cost}`, status `PATCH /admin/orders/:id/status {status, notes?}`, assign `POST /admin/orders/:id/assign-rider {rider_id}`, rider step `PATCH /riders/deliveries/:id/status {status}`, cash `POST /riders/deliveries/:id/collect-cod {amount}`. After every backend step the app pulls to refresh and the test asserts the header, the newest timeline row and cancel visibility; a DB/API read confirms the same status.

- [ ] **Flow A (happy path):** customer places an order in the app → "Order placed", cancel visible → staff source + `PACKED` → "Packed", cancel still visible → admin assigns → "A rider has been assigned." → rider `PICKED_UP` → "Out for delivery", cancel gone → `ARRIVED_AT_CUSTOMER` → "Your rider has arrived." → collect COD → "Delivered", "Paid in cash", timeline Placed/Packed/Out for delivery/Delivered; list row shows Delivered.
- [ ] **Flow B (cancellation):** place → cancel in the app → "Cancelled", "Nothing to pay"; stock restored check via `GET /admin/inventory` unchanged from baseline. **Refusal:** place, pack, assign, open detail (button visible), rider picks up behind the app's back, tap cancel → refusal message, screen becomes "Out for delivery".
- [ ] **Flow C (failed-delivery recovery):** … rider `FAILED` (reason) → app "Delivery failed", "Not paid", no cancel, no reason text leaked → admin `PACKED` with notes (re-stage) → app "Packed", timeline "Packed again for redelivery" → assign replacement → pickup → arrive → collect → "Delivered"; timeline has 7 rows in order.
- [ ] Baseline restored (orders, deliveries, notifications, stock) with the guarded cleanup used in the dispatch phase; screenshots at each stage (360×800 and 412×915).

### Task 11: Generic-AI-design audit + visual refinement

- [ ] Run exactly "Audit this app for generic AI design patterns" against the Task 10 screenshots (list, each detail state, cancel sheet, errors, confirmation). Check: stacked identical cards, label/value grey pairs, weak type hierarchy, unclear primary action, colour-only meaning, default Material dialogs/snackbars, decoration without purpose, thumb reach, whitespace.
- [ ] Fix findings in the visual layer only (no provider/model/API changes); rerun `flutter test`, `flutter analyze` and Task 10 unchanged.

### Task 12: Documentation

- [ ] `docs/05-implementation/blynk-customer-orders-report.md` (requirements, §B contract table, §C audit, §D gap, decisions, tests with counts, E2E results, design audit, limitations: no polling, failure reason not shown by design). `implementation-status.md` gains a section. `docs/02-architecture/blynk_backend_api_architecture.md` customer order response gains `can_cancel`.

## Self-review

- **Spec coverage:** audit list (§B/§C each item); lifecycle paths incl. re-stage (Tasks 2, 5, 7, 10 C); backend-state-only (Global Constraints, timeline rule, `showsDelivery`); UX six questions (what: list names + items; how much: bill + payment line; status: header; scheduled: notice; cancel: `can_cancel`; history: timeline); backend gap documented in the brief's four-point format (§D); cancellation preserved + concurrency verified (§B); all 12 planned test themes (§H); verification list incl. hygiene (Task 9), live E2E of all three flows (Task 10), design audit (Task 11).
- **Forbidden items:** none introduced. `ARRIVED_AT_CUSTOMER` is existing approved customer data, put to the user as C4 rather than assumed.
- **Type consistency:** `canCancel`, `fetchOrder`, `CancelOutcome.ok/isRefusal`, `OrderStatusEvent.at`, `showsScheduleNotice`, `showsDelivery`, `formatLkr` are used with the same names in Tasks 2–8.
- **Known softness:** Tasks 5–8 specify widgets by structure, keys, copy and assertions rather than full widget source; C2–C5 change copy, so final strings are fixed once the decisions in §E are approved.
