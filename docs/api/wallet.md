# Blynk Wallet - API contract

Status: implemented on `feat/blynk-wallet` (migration 049). Owner decision 2026-10-15:
every approved refund goes to the customer's Blynk Wallet, whatever the payment method
(Terms §6.2, §10; Return policy §3-§4).

Rules the wallet keeps:

* Credits come only from refunds (automatic on cancel, item unavailable on a paid order,
  or staff "Refund to wallet") and Admin adjustments. Customers never top it up.
* The balance pays for future Blynk orders. It cannot be withdrawn as cash or moved to
  another account (there is no endpoint that does either).
* Expiry is a setting (`expiry_months`, default 0 = never). A credit added while it is
  above 0 expires that many months later; spending takes the soonest-expiring credits
  first.
* The balance is never negative (every write takes the customer's `users` row lock,
  like Blynk Points).
* Refunds are credited the moment the cancel / refund happens (policy: within 24 hours).

---

## 1. Money model

`orders.wallet_amount_used` is what the wallet paid for the order. It is a **payment**,
not a discount:

```
total_amount = subtotal_amount + delivery_fee - discount_amount - wallet_amount_used
```

so `total_amount` stays "what is still to pay": the cash the rider collects for COD,
or the amount sent to PayHere for an online order. The order's full value is
`total_amount + wallet_amount_used`. Reports' revenue counts both.

Checkout order: coupon / birthday gift / referral -> Blynk Points -> wallet. The wallet
pays at most `max_use_percent` % of what is due after points, including the delivery
fee, and never more than the balance.

* Wallet covers everything: the order is placed as **COD with `total_amount` 0**
  ("LKR 0 to collect - paid by wallet"), even when the customer chose "Pay online"
  (no PayHere step). Same path as a points-only zero total.
* Wallet covers part of an online order: PayHere is asked for `total_amount` only.

Blynk Points still earn on the items after discounts: the wallet is a payment, so the
`pointsForOrder` rule is unchanged (wallet money earns points like cash).

## 2. Ledger (`wallet_entries`, append-only)

| kind | sign | when |
|---|---|---|
| `ORDER_PAYMENT` | - | checkout used the wallet |
| `ORDER_PAYMENT_RETURNED` | + | the order that used it was cancelled, or an item became unavailable and the wallet paid more than is now due |
| `REFUND_ORDER_CANCELLED` | + | a cancelled order had been paid online (PayHere verified), including a payment that arrived after the order was cancelled |
| `REFUND_ITEM` | + | staff refund for a missing / damaged / wrong item, or automatic when an item becomes unavailable on an order already paid online |
| `REFUND_DELIVERY_FEE` | + | staff refund of the delivery fee (whole order wrong / not delivered because of us) |
| `ADJUSTMENT` | +/- | Admin only, with a reason, audited; never below 0 |
| `EXPIRED` | - | expiry sweep (only credits with an `expires_at`) |

Per order: **refundable = wallet paid + online paid (PayHere PAID) + cash collected
(COD delivered) - everything already credited back for that order**. Every refund for
an order (automatic or staff) is capped by it, so an order is never refunded twice.

## 3. Cancel paths (automatic, idempotent)

All cancels run through the lifecycle's `cancelOrder` under the order lock:
customer cancel, Ops/Admin cancel (including a FAILED / CUSTOMER_UNAVAILABLE order),
and PayHere payment expiry. On each:

* wallet still held by the order -> `ORDER_PAYMENT_RETURNED`
* online amount paid (net of item refunds already made) -> `REFUND_ORDER_CANCELLED`
* cash orders cancelled before delivery: only the wallet part comes back.

A PayHere payment that arrives after the order was cancelled is credited to the wallet
(`REFUND_ORDER_CANCELLED`) instead of being flagged for a portal refund.
Points used are returned by the existing points refund; nothing was earned (points are
earned on delivery).

---

## 4. Customer endpoints

### GET /me/wallet?page=1&limit=30

```json
{ "success": true, "data": {
  "enabled": true,
  "balance": 450.00,
  "expiry_months": 0,
  "expiry_note": "Your balance never expires.",
  "max_use_percent": 100,
  "entries": [
    { "id": "uuid", "kind": "REFUND_ORDER_CANCELLED", "amount": 450.00,
      "order_id": "uuid", "order_number": "BL-20261015-1234",
      "reason": "Order BL-20261015-1234 cancelled", "expires_at": null,
      "created_at": "2026-10-15T08:00:00.000Z" }
  ],
  "pagination": { "page": 1, "limit": 30, "total": 1, "total_pages": 1 }
} }
```

`reason` is always a customer-safe sentence. Admin adjustments show
"Adjusted by Blynk" (the staff reason stays internal, as with points).

### GET /orders/checkout-info (added)

```json
"wallet": { "enabled": true, "balance": 450.00, "max_use_percent": 100 }
```

### POST /orders (added)

`use_wallet: boolean` (optional, default false). Ignored while the wallet is switched
off or the balance is 0. The server decides the amount again under the customer's lock;
replays with the same idempotency key return the first order (no second debit).

### Order responses (POST /orders, GET /orders, GET /orders/:id, POST /orders/:id/cancel)

* `wallet_amount_used: number` on every order.
* `GET /orders/:id` and `POST /orders/:id/cancel` also carry

```json
"wallet": {
  "used": 300.00,
  "refunded_total": 300.00,
  "entries": [ { "id": "uuid", "kind": "ORDER_PAYMENT_RETURNED", "amount": 300.00,
                 "reason": "Order BL-... cancelled: wallet payment returned",
                 "created_at": "..." } ]
}
```

`entries` lists the credits back to the wallet for this order (refunds), newest first.

---

## 5. Staff endpoints (Admin + Operations)

| Method | Path | Roles |
|---|---|---|
| GET / PATCH | `/admin/settings/wallet` | ADMIN, OPERATIONS |
| GET | `/admin/customers/:id/wallet?page=&limit=` | ADMIN, OPERATIONS |
| POST | `/admin/customers/:id/wallet/adjust` | **ADMIN only** |
| GET | `/admin/orders/:id/wallet` | ADMIN, OPERATIONS |
| POST | `/admin/orders/:id/wallet-refund` | ADMIN, OPERATIONS |

### Settings

`{ "enabled": true, "expiry_months": 0, "max_use_percent": 100, "updated_at": null }`

PATCH any subset: `enabled` boolean; `expiry_months` whole number 0-120 (0 = never);
`max_use_percent` whole number 1-100. Audited (`WALLET_SETTINGS_UPDATED`).
`enabled: false` hides "Use wallet balance" at checkout; refunds are still credited
(money owed never disappears) and the app still shows a non-zero balance.

### GET /admin/customers/:id/wallet

```json
{ "customer_id": "uuid", "enabled": true, "balance": 450.00,
  "entries": [ { "id": "uuid", "kind": "REFUND_ITEM", "amount": 120.00,
    "order_id": "uuid", "order_number": "BL-...", "reason": "Damaged: Milk 1L",
    "created_by": "uuid|null", "created_by_name": "Ops Lead|null",
    "expires_at": null, "created_at": "..." } ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "total_pages": 1 } }
```

### POST /admin/customers/:id/wallet/adjust (ADMIN)

Body `{ "amount": -50.00, "reason": "Goodwill reversal" }`: non-zero, at most 2
decimals, |amount| <= 100000; reason 3-200 characters. Returns the GET shape.
Errors: 422 `WALLET_INSUFFICIENT` (`details.balance`) when it would go below 0;
403 `CANNOT_RECORD_FOR_SELF` for your own account; 404 `CUSTOMER_NOT_FOUND`.
Audited `WALLET_ADJUSTED`.

### GET /admin/orders/:id/wallet

```json
{ "order_id": "uuid", "order_number": "BL-...", "customer_id": "uuid",
  "order_status": "DELIVERED", "payment_method": "COD",
  "wallet_amount_used": 0, "delivery_fee": 150,
  "paid": { "wallet": 0, "online": 0, "cash": 1150, "total": 1150 },
  "refunded_total": 120, "refundable": 1030, "delivery_fee_refundable": 150,
  "points": { "redeemed": 0, "returnable": 0, "earned": 11 },
  "entries": [ ...same entry shape as the customer wallet (staff fields included)... ] }
```

### POST /admin/orders/:id/wallet-refund

Body:

```json
{ "amount": 120.00, "kind": "REFUND_ITEM", "reason": "Damaged: Milk 1L", "return_points": 0 }
```

* `kind`: `REFUND_ITEM` (missing / damaged / wrong item) or `REFUND_DELIVERY_FEE`.
* `amount` > 0, 2 decimals, <= `refundable`; for `REFUND_DELIVERY_FEE` also <=
  `delivery_fee_refundable` (the order's delivery fee minus fee refunds so far).
* `reason` 3-200 characters - **the customer sees it** in their wallet history.
* `return_points` (optional whole number, default 0): Blynk Points used on the refunded
  item to give back, <= `points.returnable`.
* Points earned on the refunded item are removed automatically (a `REFUND_ITEM` on an
  order that earned points takes back the same share of them; never below 0 points).

Returns `{ "refund": entry, "points_returned": 0, "points_removed": 1, "wallet": <GET shape> }`
(201). Errors: 422 `NOTHING_TO_REFUND`, 422 `REFUND_EXCEEDS_REFUNDABLE`
(`details.refundable`), 422 `REFUND_EXCEEDS_DELIVERY_FEE`, 422 `POINTS_RETURN_EXCEEDS`,
403 `CANNOT_RECORD_FOR_SELF` (your own order), 404 `ORDER_NOT_FOUND`, 400 validation.
Audited `WALLET_ORDER_REFUND`. Sends the push "LKR X added to your Blynk Wallet" when
app push is configured (no SMS).

### Order payloads for staff and riders

`GET /admin/orders`, `GET /admin/orders/:id` and the rider's delivery payloads carry
`wallet_amount_used`. `total_amount` is still the cash to collect; when it is 0 and
`wallet_amount_used` > 0 the apps show "LKR 0 to collect - paid by wallet".

## 6. Expiry

When `expiry_months` > 0, credits added get `expires_at = now + expiry_months`. The
worker's wallet sweep (hourly) and every balance read expire what is left of credits
past their date (soonest-expiring credits are spent first), writing `EXPIRED` rows.
Credits added while expiry was 0 never expire.
