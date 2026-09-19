# Blynk — Input Validation Audit (customer app)

Scope: every user-editable input currently present in the Flutter customer
app, audited against the real backend contracts in `backend/api/src`.

**Reported bug:** the Add Address form accepted `bbA Tester` as a recipient
phone number. The field only checked "not empty". Fixed, with regression
tests, and the same audit was applied to every other input.

---

## 1. What already existed

| Input | Validation before this audit |
|---|---|
| Login phone | `isValidSriLankanPhone` in `lib/constants.dart` — regex `^(?:0094\|94\|0)?(7[0-9]{8})$` |
| OTP | length check (`!= 6`) in the screen, no character check |
| Address: name, recipient, phone, line 1, city, lat, lng | "Required" (non-empty) only |
| Address: line 2, postal code, instructions | none |
| Search | `trim()` only, no length cap |
| Cart quantity | integer via `CartProvider`, no upper bound |
| Profile / Help | **no editable inputs exist** |
| Coupons screen | a coupon code field whose Apply does nothing, on dummy data; unreachable since the cart redesign |

There was no shared validation layer, so there was no single definition of
"valid phone" — and the address form had none at all.

## 2. The standard

One layer: **`lib/Services/Validation/app_validators.dart` (`AppValidators`)**.
`isValidSriLankanPhone` and `formatToE164` in `constants.dart` now delegate
to it, so the app has exactly one phone rule.

Flow for every field: **user input → `AppValidators` (validate) →
normalize → API**. The backend still validates independently; this layer is
there to catch mistakes early and keep junk off the wire, not to be the
security boundary.

## 3. Field rules

"Backend" cites the schema actually read. **Frontend-only** means the
backend has no equivalent rule; **tighter** means the frontend deliberately
rejects some values the backend would accept (never the reverse).

| Field | Required | Format | Min | Max | Normalization | Frontend | Backend |
|---|---|---|---|---:|---:|---|---|
| Address name (label) | Yes | letters, digits, space, `' - . , & /` | 2 | 30 | trim, collapse spaces | `AppValidators.addressName` | `address.schema.ts`: trim, 1–64 → **tighter** |
| Recipient name | Yes | letters, space, `' - .`; **no digits** | 2 | 80 | trim, collapse spaces | `recipientName` | trim, 2–128 → **tighter** |
| Recipient phone | Yes | Sri Lankan mobile, prefixes 70/71/72/74/75/76/77/78 | 9 digits | 9 digits | → E.164 `+94XXXXXXXXX` | `phone` / `normalizePhone` | `utils/phone.ts` `normalizeSriLankanPhone` → **exact match** |
| Address line 1 | Yes | letters, digits, space, `' - . , / # ( )` | 3 | 150 | trim, collapse spaces | `addressLine1` | trim, 3–500 → **tighter** |
| Address line 2 | No | same as line 1 | — | 150 | trim, collapse, `''` → `null` | `addressLine2` | trim, ≤500, nullable → **tighter** |
| City | Yes | letters, digits, space, `' - .`; must contain a letter | 2 | 64 | trim, collapse spaces | `city` | trim, 2–64 → **matches** |
| Postal code | No | exactly 5 digits (Sri Lanka) | 5 | 5 | trim, `''` → `null` | `postalCode` | trim, ≤16, nullable → **tighter** |
| Latitude | Yes | finite decimal, −90…90 | — | — | trim | `latitude` | `z.number().min(-90).max(90)` → **matches** |
| Longitude | Yes | finite decimal, −180…180 | — | — | trim | `longitude` | `z.number().min(-180).max(180)` → **matches** |
| Delivery instructions | No | letters, digits, space, common punctuation | — | 300 | trim, collapse, `''` → `null` | `deliveryInstructions` | trim, ≤1000, nullable → **tighter** |
| Default address toggle | — | boolean | — | — | — | UI state | `is_default` boolean |
| Login phone | Yes | same rule as recipient phone | 9 digits | 9 digits | → E.164 before the API call | `phone` (was a separate regex) | `auth.schema.ts` + `utils/phone.ts` → **exact match** |
| OTP | Yes | digits only | 6 | 6 | trim | `otp` | `verifyOtpSchema`: length 6, `^[0-9]{6}$` → **exact match** |
| Search query | No | free text (digits and punctuation allowed) | 1 | 100 | trim, collapse, truncate at 100 | `normalizeSearch` | `catalog.schema.ts`: trim, ≤100 → **matches** |
| Cart quantity | — | integer | 1 | 100 | — | `CartProvider` (capped) | `order.schema.ts`: int, 1–100 per item → **matches** |

### Input formatters (typing-time, not a substitute for validation)

- Phone fields: digits, space, `+`, `-`, `()` only — this is what stops
  `bbA Tester` ever entering the field. Pasted `+94 77 123 4567` still works.
- OTP: digits only, max 6.
- Postal code: digits only, max 5.
- Latitude/longitude: digits, `-`, `.` (a "decimal" keyboard still offers
  letters on desktop).
- Text fields carry deliberate `maxLength`s; counters are hidden.

## 4. Changes made

- **Created** `AppValidators` (rules, normalization, phone E.164, quantity).
- **Add/Edit Address:** every field validated and normalized; whitespace
  collapsed; optional fields sent as `null`; phone normalized to E.164
  before the payload is built; formatters added.
- **Login sheet:** now uses the shared `phone` validator and formatter;
  the duplicate message wording is gone.
- **OTP screen:** 6-digit numeric contract enforced (validator + digits-only
  formatter) instead of a bare length check.
- **Search:** query normalized (trim, collapse, 100-char cap) at both the
  debounce and submit paths; the field is capped too.
- **Cart:** per-line quantity capped at 100 to match `order.schema.ts`.
- **`constants.dart`:** phone helpers delegate to `AppValidators`.
- **Add/Edit Address form:** `autovalidateMode.onUserInteraction`, so a
  corrected field clears its error immediately instead of at the next Save.

## 5. Discrepancies found

1. **Phone prefixes (real bug, fixed).** The old Flutter regex accepted any
   `7X` number, including `073`/`079`, which `normalizeSriLankanPhone`
   rejects. The app could accept a number the API would refuse at OTP
   request. Flutter now matches the backend's prefix list exactly.
2. **Address form had no validation at all** beyond "not empty" — the
   reported bug. Fixed.
3. **Distinct cart items (open backend gap, not fixed here).**
   `order.schema.ts` caps an order at **50 distinct items**; the app does
   not stop a customer adding a 51st product, so the failure would only
   appear at Place Order. Only 5 products are seeded, so it can't be hit
   today. Flagged rather than silently changed, since it needs a UX
   decision.
4. **Postal code format is a frontend-only rule.** The backend accepts any
   string ≤16 characters. Five digits is the Sri Lankan format; if the
   business ever needs other formats, this rule is the one to relax.
5. **Coupon code field** (`coupons_screeen.dart`) is unvalidated, but its
   Apply button does nothing and the screen runs on `kDummyCoupons`. It has
   no backend module and is no longer reachable from the cart. Left alone;
   it should be removed with the rest of that dummy feature.
6. **No profile, email or contact-message inputs exist** in the customer
   app today, so there is nothing to validate there. `users` on the backend
   does expose `updateProfileSchema` (full name 2–128, email ≤255) — if a
   profile edit screen is added, its rules should come from
   `AppValidators` and match that schema.

## 6. What stays backend-authoritative

Frontend validation never replaces the backend for: product availability
and prices, delivery fee, serviceability/geofence, order totals, order
creation and cancellation rules. Checkout still submits to the API and uses
what the API returns.

## 7. Verification

- **`test/app_validators_test.dart`** — 23 tests: valid input, empty,
  whitespace-only, too short, too long, invalid characters, boundary values,
  normalization and optional/null handling for every field, plus the
  reported bug both ways:
  - `phone("bbA Tester")` → **fails**
  - `recipientName("bbA Tester")` → **passes** (same string, different field)
  - every accepted phone spelling normalizes to `+94771234567`
  - prefixes 70/71/72/74/75/76/77/78 accepted; 73/79 rejected
- **`test/add_edit_address_screen_test.dart`** — 25 tests, including
  screen-level regressions: `bbA Tester` in the phone field blocks the save
  and nothing reaches the provider; a real number saves as `+94771234567`
  with names/addresses whitespace-normalized; letters can't be typed into
  the phone field at all; out-of-range latitude and a 3-digit postal code
  are rejected.
- **`test/cart_provider_test.dart`** — quantities stay whole, never go
  negative, and cap at 100.
- **`test/phone_validation_test.dart`** — the pre-existing suite still
  passes against the tightened rule.
- **`flutter test`**: 162/162 passing. **`flutter analyze`**: 2 pre-existing
  infos, unchanged.
- **Live E2E** (`integration_test/live_customer_flow_test.dart`) against the
  real backend: full pass — real OTP login, catalog, search, product,
  cart, **address create with a real Sri Lankan number, edit**, checkout,
  order, cancel, logout.

### Manual check of the reported flow (real Windows app)

1. Typing `bbA Tester077 123 4567` into Recipient phone leaves `077 123 4567`
   in the field - the letters never get in (input formatter).
2. An invalid number (`077 123 4567077`) shows
   **"Enter a valid Sri Lankan mobile number"** under the field and the save
   is blocked; nothing is sent.
3. Correcting it to `0771234567` clears the error as you type
   (`autovalidateMode.onUserInteraction`, added during this check).
4. The same string `bbA Tester` is accepted in Recipient name, as it should
   be.
5. **Saving the address and the checkout that follows** were verified by the
   live E2E run (real OTP login → address create with a real Sri Lankan
   number → edit → checkout → order → cancel → logout), not by hand: the
   hand-driven session was not logged in.

STATUS: GLOBAL INPUT VALIDATION AUDITED, IMPLEMENTED AND VERIFIED
