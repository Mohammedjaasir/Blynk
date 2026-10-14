# PayHere online payments - API contract

Status: backend implemented on `feat/pay` (migration 047). Written 2026-10-14 for the
customer checkout phase (customer app / PWA), Admin and Operations.

Cash on delivery (COD) stays the default. Online payment is offered only while
staff have switched PayHere on and it is fully configured.

PayHere references (owner pointed to https://support.payhere.lk/): Checkout API
(HTML form POST), Payment Notification (`notify_url`, `md5sig`). The documentation
site blocks automated fetches; the formulas below are PayHere's published ones and
are pinned by `backend/api/tests/payhere-signature.test.ts`.

---

## 1. Flow

```
Customer app                       Blynk API                                   PayHere
------------                       ---------                                   -------
GET /store  or /orders/checkout-info
  online_payment.enabled = true  <-
POST /orders {..., payment_method:"ONLINE"}
                                   order AWAITING_PAYMENT, payment PENDING,
                                   payment_expires_at = now + window
                                 <- 201 {order}
POST /payments/payhere/checkout {order_id}
                                   checks owner, state, not expired,
                                   builds fields + hash (secret stays here)
                                 <- 200 {action_url, fields, expires_at}
auto-submit an HTML <form method=POST action=action_url> with `fields`  ------>  hosted payment page
                                                                                  customer pays
                                   POST /payments/payhere/notify  <------------- server-to-server
                                   (x-www-form-urlencoded, md5sig)
                                   verify merchant_id + md5sig, amount, currency
                                   status 2  -> order PLACED, payment PAID
                                   status 0  -> recorded, still pending
                                   status -1/-2 -> attempt FAILED, order stays
                                               AWAITING_PAYMENT (customer may retry
                                               until it expires)
                                   status -3 -> chargeback recorded (REFUNDED +
                                               refund_required flag for staff)
browser redirected to return_url / cancel_url  <------------------------------- 
GET /orders/:id  (poll every 2-3 s for up to ~60 s; response is data.order)
  order_status PLACED + payment_status PAID  -> "Paid, we're packing"
  still AWAITING_PAYMENT                      -> "Waiting for PayHere" / retry
  CANCELLED                                   -> expired / cancelled

worker: every 60 s cancels AWAITING_PAYMENT orders past payment_expires_at
        (coupon, birthday gift, referral reward and points released; no stock was taken)
```

The return_url is **never** trusted: only a verified notification marks an order paid.
Store staff never see an unpaid online order in the packing queue (only `PLACED`
orders are packable).

## 2. New/changed values

* `orders.order_status` gains **`AWAITING_PAYMENT`** (before `PLACED`). Customer apps
  should show it as "Waiting for payment". `can_cancel` is true in this state.
* `orders.payment_method`: `COD` (default) | `ONLINE`.
* `orders.payment_status`: `PENDING` | `PAID` | `FAILED` (last online attempt failed;
  the order may still be paid until it expires) | `REFUNDED` (chargeback).
* `orders.payment_expires_at`: ISO time, only for online orders.
* `order.payment` (detail): adds `gateway` (`PAYHERE`), `gateway_payment_id`,
  `gateway_status_code`, `gateway_method` (e.g. `VISA`), `gateway_status_message`,
  `refund_required` (true when money arrived for an order that was already
  cancelled/expired, the amount did not match, or a chargeback happened),
  `failed_at`. Customers do not get `gateway_response`.

## 3. Customer endpoints

### Is online payment offered?
`GET /api/v1/store` and `GET /api/v1/orders/checkout-info` include:

```json
"online_payment": { "enabled": true, "provider": "PAYHERE", "methods_note": "Visa, Mastercard, eZ Cash", "payment_window_minutes": 20 }
```
`enabled` is true only when switched on AND merchant id + secret are saved AND the
server has its encryption key. When false, hide "Pay online".

### Place an online order
`POST /api/v1/orders` - the existing body plus
`"payment_method": "ONLINE"` (omit or `"COD"` for cash on delivery).

Errors: `422 ONLINE_PAYMENT_UNAVAILABLE` (switched off / not configured),
`422 NOTHING_TO_PAY_ONLINE` (total is 0 after discounts/points - place it as COD).

Response: the usual order with `order_status: "AWAITING_PAYMENT"`,
`payment_method: "ONLINE"`, `payment_status: "PENDING"`, `payment_expires_at`.
Idempotency works as before (same key -> same order).

### Get the PayHere form
`POST /api/v1/payments/payhere/checkout` (customer access token; only the order's owner)

```json
{ "order_id": "<order uuid>" }
```

200:
```json
{
  "success": true,
  "data": {
    "action_url": "https://sandbox.payhere.lk/pay/checkout",
    "method": "POST",
    "mode": "sandbox",
    "expires_at": "2026-10-14T10:20:00.000Z",
    "fields": {
      "merchant_id": "1211149",
      "return_url": "https://blynk.lk/app/payment/return?order=<uuid>",
      "cancel_url": "https://blynk.lk/app/payment/cancel?order=<uuid>",
      "notify_url": "https://api.blynk.lk/api/v1/payments/payhere/notify",
      "order_id": "BL-20261014-1234",
      "items": "Blynk order BL-20261014-1234",
      "currency": "LKR",
      "amount": "1250.00",
      "first_name": "Nimal",
      "last_name": "Perera",
      "email": "",
      "phone": "+94771234567",
      "address": "No. 1, Test Lane",
      "city": "Dharga Town",
      "country": "Sri Lanka",
      "custom_1": "<order uuid>",
      "hash": "UPPERCASE MD5"
    }
  }
}
```
Post **all** fields unchanged as `application/x-www-form-urlencoded` to
`action_url` (a hidden auto-submitting form in a WebView / browser tab). Do not change
`merchant_id`, `order_id`, `amount`, `currency` (they are in the hash). PayHere asks
for an email: if `email` is empty, the client may ask the customer and fill it in
(email/name/phone/address are not part of the hash).

Errors: `404 ORDER_NOT_FOUND` (not yours), `409 ORDER_NOT_AWAITING_PAYMENT`,
`409 ORDER_ALREADY_PAID`, `409 PAYMENT_EXPIRED` (the order is cancelled now),
`422 NOT_ONLINE_ORDER`, `422 ONLINE_PAYMENT_UNAVAILABLE`.

Calling it again for the same order is allowed (retry after a failed card); it
resets `payment_status` from `FAILED` to `PENDING`.

### After PayHere
The browser lands on `return_url`/`cancel_url` (the customer web app route
`/app/payment/return?order=<uuid>` / `/app/payment/cancel?order=<uuid>`; the native
app can intercept these URLs in its WebView). Then poll `GET /api/v1/orders/:id`.
The customer can cancel with `POST /api/v1/orders/:id/cancel` while
`AWAITING_PAYMENT`.

## 4. PayHere -> Blynk

`POST /api/v1/payments/payhere/notify` - public, called by PayHere only,
`application/x-www-form-urlencoded`: `merchant_id, order_id, payment_id,
payhere_amount, payhere_currency, status_code, md5sig, method, status_message, ...`.

* Signature: `md5sig == UPPER(MD5(merchant_id + order_id + payhere_amount +
  payhere_currency + status_code + UPPER(MD5(merchant_secret))))` (constant-time
  compare) and `merchant_id` must be ours. Invalid -> `400`, nothing changes.
* `order_id` is the Blynk order number; the order must be an ONLINE order.
* status 2 requires `payhere_currency == LKR` and `payhere_amount == total_amount`
  (2 dp); otherwise the payment is recorded with `refund_required` and the order is
  NOT released.
* Idempotent: a repeated notification changes nothing (logged as DUPLICATE).
* Every notification is logged in `payment_notifications` (no card data, no secret).
* Replies `200 OK` once processed.

Checkout hash (sent to PayHere): `UPPER(MD5(merchant_id + order_id + amount(2dp, no
thousands separator) + currency + UPPER(MD5(merchant_secret))))`.

Status codes: `2` success, `0` pending, `-1` cancelled, `-2` failed, `-3` chargedback.

## 5. Staff endpoints (Admin + Operations)

`GET /api/v1/admin/settings/payment-gateway` (ADMIN, OPERATIONS)

```json
{
  "provider": "PAYHERE",
  "enabled": false,
  "mode": "sandbox",
  "merchant_id": "1211149",
  "merchant_secret_set": true,
  "merchant_secret_masked": "••••••••",
  "merchant_secret_updated_at": "2026-10-14T08:00:00.000Z",
  "allowed_methods": "Visa, Mastercard, eZ Cash",
  "payment_window_minutes": 20,
  "encryption_key_configured": true,
  "ready": true,
  "checkout_url": "https://sandbox.payhere.lk/pay/checkout",
  "notify_url": "https://api.blynk.lk/api/v1/payments/payhere/notify",
  "return_url": "https://blynk.lk/app/payment/return",
  "cancel_url": "https://blynk.lk/app/payment/cancel",
  "can_edit_credentials": true,
  "updated_at": "2026-10-14T08:00:00.000Z"
}
```
The secret itself is never returned (not even encrypted).

`PATCH /api/v1/admin/settings/payment-gateway` (ADMIN, OPERATIONS), any subset of:
`enabled` (bool), `allowed_methods` (text <= 200, or null), `payment_window_minutes`
(5-180) - **Admin and Operations**; `mode` (`sandbox`|`live`), `merchant_id`
(digits, <= 32), `merchant_secret` (8-128 chars) - **Admin only** (Operations gets
`403 CREDENTIALS_ADMIN_ONLY`). Returns the GET shape. Errors:
`422 PAYMENT_SECRET_KEY_MISSING` (server has no PAYMENT_SECRET_KEY, the secret is
refused), `422 PAYHERE_NOT_CONFIGURED` (enabling without merchant id/secret/key).
Audited as `PAYMENT_GATEWAY_UPDATED`; the secret appears only as `"changed"`.

`POST /api/v1/admin/settings/payment-gateway/test-hash` (ADMIN, OPERATIONS), body
optional `{ "order_id": "TEST-0001", "amount": 1000 }` -> `{ merchant_id, order_id,
amount: "1000.00", currency: "LKR", hash, mode }`. Uses the stored secret, calls
nothing outside Blynk; proves the secret decrypts. `422 PAYHERE_NOT_CONFIGURED`
when nothing is saved.

Orders (`GET /api/v1/admin/orders`, `/admin/orders/:id`) already return
`payment_method`, `payment_status`, and now `payment_expires_at`; the detail's
`payment` carries the gateway fields above. Labels used by the staff apps:
COD+PENDING "Cash on delivery", COD+PAID "Cash collected", ONLINE+PAID "Paid online",
ONLINE+PENDING "Payment pending", ONLINE+FAILED "Payment failed",
REFUNDED "Refunded / chargeback", `refund_required` "Refund needed".

## 6. Delivery of a paid order

The rider (and Operations) finish a paid online order through the same
`POST /api/v1/rider/deliveries/:id/collect-cod` with the customer's delivery code:
for an ONLINE order with `payment_status: PAID` no cash is collected
(`cod_collected_amount: 0`, no "cash received" SMS); the `amount` sent is ignored.
An ONLINE order that is not paid is refused (`409 NOT_COD_ORDER`). Admin "Mark
delivered" works the same way. The Rider and Operations delivery screens show
"Paid online — do not collect cash" when `payment_method == "ONLINE"` and
`payment_status == "PAID"`; the handover step becomes "Confirm delivery code".
Rider pay: a paid online order brings in no cash, so the rider's earning for it is
not kept out of cash and shows as owed to the rider in the pay ledger (owner has not
decided otherwise; current behaviour kept).

## 7. Environment (names only)

* `PAYMENT_SECRET_KEY` - required to save the merchant secret (>= 32 chars; used to
  encrypt it at rest with AES-256-GCM). Changing it makes the stored secret
  unreadable -> re-enter the secret.
* `PAYHERE_NOTIFY_URL` (optional) - default `PUBLIC_BASE_URL + API_PREFIX +
  /payments/payhere/notify`.
* `PAYHERE_RETURN_URL`, `PAYHERE_CANCEL_URL` (optional) - default
  `WEB_APP_URL + payment/return` / `payment/cancel` (`?order=<uuid>` is appended).
