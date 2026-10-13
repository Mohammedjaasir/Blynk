# Customer app redesign: what must stay

> **What this is.** The checklist for redesigning the Blynk customer app (the shop at blynk.lk/app). The redesign may change how every screen *looks*. It must keep everything the app *does*, every link to the Admin, Ops, Rider and Inventory apps, and the Blynk colours. It was built by reading the current code on 13 Oct 2026.
>
> **Start from `origin/main`** (commit `4d78df2`, 12 Oct). The branch currently checked out, `feat/customer-grid-and-accumulated-work`, is 14 commits behind main. It is missing order for someone else, SMS language choice, free delivery above a basket amount, and picking a delivery address without changing the default. Items marked **[main]** below exist only on main.

---

## 1. The rule: the backend stays exactly as it is

Every connection to Admin, Ops, Rider and Inventory goes through the **same backend API**. The customer app never talks to the other apps directly. If the redesigned app makes the same API calls with the same fields, every connection keeps working with **zero backend changes**:
- staff edits appear in the shop;
- orders appear in Ops;
- addresses reach the rider;
- live tracking flows back to the customer.

So the redesign keeps:
- the same endpoints and request fields;
- the same response fields it reads;
- the error codes it handles specially;
- the sign-in token flow.

These are all listed in sections 5 and 6.

---

## 2. Colours and design values to keep

These come from the code (`lib/design/primitives.dart`, `tokens.dart`, `typography.dart`). The design idea is **"Ink, paper, one signal"**: a quiet white page with dark text, where yellow is used only for the one thing you tap to move forward.

| Token | Hex | Use |
|---|---|---|
| signal (Blynk yellow) | `#FFE141` | The main action on each screen (Add, View cart, Proceed, Place order). Always with dark text, never as text colour |
| signalPressed | `#E5C700` | Pressed yellow |
| signalWash / signalWashPressed | `#FFFADD` / `#FFF6C6` | Selected category, soft yellow fills |
| ink | `#1A1D2E` | Text, icons, the dark cart bar |
| ink2 / ink3 | `#6B7280` / `#4B5563` | Secondary text |
| paper | `#FFFFFF` | Page |
| paperMuted | `#BFC0C5` | Muted text on dark |
| well | `#F6F8FB` | Image wells, input fills |
| line / lineStrong | `#E5E9F0` / `#7B8494` | Dividers / control borders |
| positive (Blynk green) | `#0C831F` | True states (Live, Delivered, Applied), offer prices |
| positiveInk / positiveTint | `#0A741B` / `#E8F5EA` | Green text / green badge fill |
| problem / problemTint | `#B42318` / `#FDECEA` | Errors |
| notice / noticeTint | `#8A5A00` / `#FFF6BF` | Closed, birthday, category-offer and scheduled banners |
| strike | `#6E757B` | Struck-through old price |
| scrim | `#000000` at 50% | Behind sheets |

- **Spacing:** a 4-point scale (4, 8, 12, 16, 24, 32, 48).
- **Corner radius:** 8, 12, 20; chip 16; pill 10; fully round.
- **Shadows:** soft (6% black), raised (10%), overlay (16%).
- **Font:** **Poppins** (Catamaran is bundled for future Tamil).
- **Type sizes:** display 28/800, title 20/800, heading 16/700, body 14/500, label 14/700, caption 12/600. Nothing below 12 px.
- **Motion:** 60 / 120 / 200 / 280 / 320 ms; entrances 450 ms with a 90 ms step. Respect reduced motion everywhere.
- **Tap targets:** at least 48 dp.
- **Voice:**
  - sentence case;
  - no exclamation marks, except "Happy birthday!" and celebration moments;
  - errors say what to do next;
  - marketing copy never states the delivery fee amount.
- **Marketing imagery:** no religious imagery of any kind, and only local Sri Lankan people.

---

## 3. What to borrow from the Toing reference (Swiggy's budget app), in Blynk colours

The reference video (`WhatsApp Video 2026-10-12 at 11.41.57 PM.mp4`) shows this flow. Take the *flow and feel*, not Toing's purple and green.

| Toing pattern | Blynk version (existing feature it maps to) |
|---|---|
| Browse freely, sign in only at checkout ("Almost There — Proceed with Phone Number") | Blynk already lets guests browse and fill the cart. Make checkout the natural sign-in point: one sheet with the phone number, then the code, then straight back into checkout |
| SMS code read automatically | Web: `autocomplete="one-time-code"` (iPhone) plus the WebOTP API (Android Chrome). WebOTP needs a small backend change: the SMS must end with `@blynk.lk #123456` |
| "Location permission is off — GRANT" bar on home | Blynk's address block in the header. Add a soft prompt for guests and customers with no address |
| Deal rails ("Meals under ₹99"), price-drop tags | Blynk's Offers rail, Combo packs rail, category rails, and category % offer banners |
| "Yay! You've unlocked Free Delivery" in the cart bar | Blynk free deliveries (2 per customer) and **[main]** free delivery above a basket amount. The cart bar can show "Free delivery unlocked" or "Add LKR X for free delivery" |
| "Hurray! Free delivery unlocked!" pop-up | A one-time celebration when the basket crosses the free-delivery amount, or a free delivery applies (respect reduced motion) |
| Savings list with green "Applied" ticks, "₹110 saved on the total" | Blynk's order summary lines: free delivery, coupon, birthday gift, referral reward, points, combo savings. Show each as an "Applied" row and total the saving. Saving amounts on offers still follow the "Save LKR" switch |
| Map pin with "Move the pin to change location" and "Confirm & proceed" | Blynk's "Pin your location" picker (already a fixed centre pin with "Confirm location") |
| Add delivery instructions, "Where would you like us to deliver?" | Blynk's address form plus **[main]** note for the rider, order for someone else and "Needs help at the door" |

Toing features that **don't apply** to Blynk:
- online payment offers (Blynk is cash on delivery only);
- restaurant ratings;
- the "vs other apps" price comparison (no such data);
- cutlery and cooking requests.

---

## 4. Every screen and what it must still do

**Shell**
- Four tabs: **Shop · Orders · Help · Profile**. Each tab keeps its state.
- The Orders tab shows a dot while an order is in progress.
- A floating dark **cart bar** shows item count, items total and "View cart"; it's hidden when the cart is empty.
- Android back goes to Shop; on Shop it's "press back again to exit".
- **Phones only.** Computers see "use your phone" unless the address ends `?desktop=1`.

**Launch and sign-in**
- Splash. On first launch, 2 onboarding slides with **Skip**; the second uses the live hours.
- Sign-in sheet: +94 phone, "Continue" / "Skip for now", and the terms line.
- Code screen: 6 digits, resend after 30 s, "Skip & explore store".
- Mapped errors: wrong code, expired, too many tries, locked, deactivated.
- New account: **name** (2–60 characters), an **optional referral code** (only while referrals are on), then an **optional birthday**.
- After sign-in, return to the remembered screen (used by the doctors gate; expires after 30 minutes).
- A rejected session clears the cart, orders, addresses and location, goes to login, and says "You've been logged out…".

**Shop (home)**, top to bottom:
1. **Header:** logo, cart with count, profile; the address line "Dharga Town · {hours}" and the selected address (guest: "Log in to set your delivery address").
2. **Search** bar with a rotating hint.
3. **Banners:** offline; **store closed** (live message: closed now / today / holiday / reason, plus when it reopens).
4. **Tagline:** "Your Daily Essentials, Simplified".
5. **Birthday banner** while the gift applies.
6. **Promotions carousel:** staff banners with solid, gradient, image or full-artwork backgrounds. A banner can open a category, a product or all products. Auto-advances every 3 s and pauses on touch. Hidden when there are none.
7. **Your usuals:** the last order's products, with "Add all" (reports any unavailable items).
8. **Channel doctors** entry.
9. **Category groups:** titled rows of category tiles in the staff's arranged order. Falls back to "Shop by category".
10. **Product feed:** Combo packs rail → Offers rail → one rail per category (3 or more products, "See all") → All products grid.

Pull to refresh reloads the catalogue and usuals.

**Product card**
- Image, name, unit, price.
- Offer price **green first, old price struck through**, with **"Save LKR X" only when the switch is on**.
- ADD (yellow) becomes a − n + stepper (max 100).
- Unavailable: washed out, "N/A".

**Combo card / sheet**
- Item list, pack price against the struck items total, "What's inside", "Offer ends", "Sold out".

**Category page**
- Left sidebar ("All", then sub-categories created by staff with "+ Add sidebar item") and a product grid.
- A **category % offer** banner ("10% off everything here", plus "until …").

**Search**
- 350 ms debounce; category chips; recent searches (8, with Clear); "Browse categories"; empty and error states.

**Product page**
- Back, **Share** (blynk.lk/p/<id>), image, category, name, unit and pack, price and offer, "Offer ends", Available / Currently unavailable.
- **Notify me when it's back** (guests sign in first; asks push permission).
- About and Details sections; sticky Add / stepper and View cart.
- "Product no longer available" when the product is gone.

**Cart**
- Lines with steppers and remove; combo lines; Clear cart (with confirmation).
- Birthday and closed banners, rewards lines.
- **Order summary:**
  - Subtotal, plus combo savings.
  - **Delivery fee:**
    - FREE with "r of c free deliveries left";
    - or the fee, with "~2.4 km" when the fee goes by distance;
    - **[main]** "Add LKR X more for free delivery" progress, or "Free delivery on orders of LKR X or more".
  - Total, and "Cash on delivery · final amount is confirmed when you place the order".
- Proceed to checkout. The cart is saved on the device and works offline.

**Checkout**, in order:
1. Birthday banner.
2. **Delivery address**, with Change or Add. **[main]** Picking an address here doesn't change the default.
3. **Delivery time:** only when slots are on. "As soon as possible" or slots by day; "Full"; the closed-store note.
4. **[main] Delivery details:**
   - "For someone else" with receiver name and mobile;
   - "Needs help at the door";
   - "Note for the rider" (up to 300 characters).
5. Items, read-only.
6. **Coupon box:** only when coupons are on. Apply / Remove, with these results: saves X / free delivery / your birthday gift or referral saves more / "your cart changed, apply again".
7. **Rewards:** referral reward; points balance with a **Use points** switch (off by default) and an estimate; "You'll earn about N points".
8. **Summary** with Birthday gift, Discount (CODE), Referral reward and Blynk Points lines.
9. "You can cancel your order until it is out for delivery."
10. **Place order** (cash on delivery). It's disabled with an empty cart, or when the store is closed and no slot is picked.
    - **Without an address:** opens the address book.
    - **After success:** ask for push permission, then the confirmation screen.

**Order placed**
- Number, amount, points or referral used, address, scheduled window, then "View order" / "Back to home".

**Orders tab**
- Guest: "Log in to see your orders".
- List with paging. Each row shows the status badge, item names, count, "Cash on delivery", time, scheduled window, total, and **Order again** on finished orders.

**Order page**
- Refreshes every 20 s while the order is active.
- Status header with reason, and a 4-step tracker.
- **Delivery code:** "comes when the rider picks up", then the 4-digit code with "Show this to your rider".
- **Live tracking map**, only while out for delivery and picked up:
  - rider bike icon that turns with travel;
  - road route and "Arriving in ~N min";
  - "Live" / "Last seen N min ago" / "Live location unavailable";
  - rider first name and **Call rider**; full-screen map.
  - "{Name} has arrived" at the door.
- "What happened" timeline, items, **Order again**, the bill (every discount line), delivery details (name, phone, additional phone, address, instructions).
- **Cancel order** only while allowed (with confirmation).

**Help**
- FAQs: area (4 km), live weekly hours plus up to 3 holidays, fee shown in the cart, cash on delivery, cancelling, something missing.
- **Call us** (copies the number if calling fails), **WhatsApp us**, Send feedback, store hours.

**Profile**
- Name and phone.
- Items: About you, **Blynk Points** tile, **Refer a friend** (each only while its programme is on), Your orders, Address book, **SMS & offers**, My appointments, Send feedback, Share the app, About us (version), Log out, **Delete account**.
  - Delete account says "Finish or cancel your open orders first" when needed; **[main]** it also cancels upcoming doctor bookings.

**Addresses**
- List with Default, Set default, Edit and Delete; **[main]** a pick mode labelled "Delivering here".
- **Form:**
  - Name, prefilled (2–80 characters).
  - Phone (Sri Lankan).
  - Another phone (optional, different).
  - Address (3–150 characters).
  - **Location is required.**
- **Pin your location:**
  - A privacy explainer, then a map with a fixed centre pin and "Confirm location".
  - Handles permission off, blocked, location off and timeout.
  - Falls back to device location if the map fails.
- **Zone check:** the 4 km limit is checked by the server ("We don't deliver there yet").

**About you**
- Name, date of birth (birthday gift copy), favourite categories (chips), "Anything else you love?" (200 characters). Only changed fields are saved.

**SMS & offers**
- "Offers by SMS" switch.
- **[main]** SMS language: සිංහල / தமிழ் / English.

**Feedback**
- 1–5 stars (optional), topic App / Delivery / Products / Other, message (2000 characters). Limit 5 per hour.

**Refer a friend**
- Code, Share (link with ?ref=), Copy, friends joined, rewards earned, waiting credits, "{Name} invited you", and "Have a friend's code?".

**Blynk Points**
- Balance, how it works (from the server's numbers), history (earned, used, returned, expired, adjusted), and when points expire.

**Doctors ("Channel doctors")**
- **Sign-in gate:** guests sign in first while "Doctors need sign-in" is on.
- **Flow:**
  1. Clinics, with search.
  2. Clinic: hours, map, doctors with fees.
  3. Doctor profile: fee "payable at the clinic".
  4. Day strip and times.
  5. 5-minute hold.
  6. Patient details.
  7. Review with countdown.
  8. Confirm.
- **My appointments:** Upcoming / Past. Detail page with status, map, **rate your visit**, and cancel with a reason.

**Other**
- Not-found page, "build isn't configured" page, offline handling everywhere.

---

## 5. How the customer app connects to the staff apps

### 5.1 Things staff change that the customer sees

How quickly changes appear:
- **Catalogue items** (products, categories, groups, promotions, combos): about **1 second**, through the live catalogue stream, with a 30-second refresh as backup.
- **Store settings:** within 30 seconds, and when the app reopens or the cart opens.

| What the customer sees | Changed in | Customer reads it from |
|---|---|---|
| Products, photos, prices, offer prices (new price or LKR off, end date), Active/Available | Ops / Admin → Products | `/catalog/products`, `/catalog/products/:id` |
| Categories, sub-categories (sidebar), category % offers, Arrange order | Ops / Admin → Categories | `/catalog/categories` |
| Home category groups | Ops / Admin → Category groups | `/catalog/home-groups` |
| Promotions carousel | Ops / Admin → Promotions | `/promotions` |
| Combo packs | Ops / Admin → Combo packs | `/combos` |
| Back-in-stock alerts | Inventory / Ops stock restock (tracked products) | push `{type:'product'}` |
| Delivery fee (flat, or per-km tiers by road distance; the tiers are never shown) | Ops More / Admin Settings | `/store`, `/orders/checkout-info` |
| Free deliveries (2 each), **[main]** basket free delivery | Ops / Admin checkout settings | `/orders/checkout-info` |
| Coupons switch and codes | Ops / Admin → Coupons | `/store`, `/orders/validate-coupon` |
| "Save LKR" switch | Ops / Admin checkout settings | `/store` `show_offer_savings` |
| Birthday offer | Ops / Admin → Birthday offer | `/orders/checkout-info`, `/me` |
| Refer a friend, Blynk Points | Ops / Admin | `/me/referral`, `/me/points`, `/orders/checkout-info` |
| Hours, close now, holidays, delivery slots | Ops Opening hours / Admin Settings | `/store`, `/orders/slots` |
| Doctors, clinics, availability, sign-in switch | Ops Doctors / Admin Doctors | `/dental/*`, `/store` |
| **[main]** order for someone else switch, SMS language mode | Ops / Admin | `/orders/checkout-info`, `/me` |

### 5.2 Things customers do that reach the staff apps

| Customer action | Where it shows up |
|---|---|
| Place order | Ops and Admin "To pack" lane (slot orders grouped), Inventory sourcing queue, dashboards and order map |
| Address, location pin, extra phone, instructions | Copied onto the order. Rider app (navigation, call), Ops order detail and packing slip, Admin order panel |
| **[main]** For someone else, receiver, "needs help", note for the rider | Rider app, Ops and Admin order screens. SMS go to the receiver |
| Cancel | Leaves the lanes, stock restored, rewards returned. Customer gets an SMS and a push |
| Birthday, favourite categories | Ops / Admin birthdays list (so the shop can add a treat) |
| Feedback | Admin → Feedback |
| Doctor booking, cancellation, rating | Ops Doctors → Appointments and Ratings |
| Referral code | Ops / Admin referrals list |
| Delete account | Customer is anonymised; past orders are kept for records |

### 5.3 The order round trip

| Step | Done by | Customer sees | Message to customer |
|---|---|---|---|
| Placed | Customer | Order placed | — |
| Item unavailable | Ops / Admin / Inventory | Item unavailable, new total | SMS |
| Packed | Inventory / Ops / Admin | Packed | Push |
| Rider assigned | Ops / Admin | (rider assigned) | — |
| Out for delivery (rider picks up) | Rider / staff | **Delivery code**, live map, Call rider | Push, plus SMS with the code and the amount to keep ready |
| Arrived | Rider | "{Name} has arrived" | — |
| Delivered (rider enters the code and collects cash) | Rider / staff | Delivered | Push |
| Failed / couldn't reach you | Rider / staff | Delivery failed / We couldn't reach you | Push |
| Cancelled by staff | Ops / Admin | Cancelled, with reason | Push and SMS |

**Live location:**
- The rider's phone sends a point at most every 9 seconds while moving.
- The customer gets it through `GET /orders/:id/location/stream`, which needs the sign-in token. On the web it's read with `fetch()` because EventSource can't send headers.
- The route and ETA come from `GET /orders/:id/route`, every 25 seconds.

---

## 6. Data contracts the new app must keep

- **Response shape:**
  - Success: `{success:true, data:{…}}`.
  - Errors: `{success:false, error:{code, message, details}}`.
  - Lists: `data.orders` / `data.products` plus `pagination`.
- **Sign-in:**
  1. `POST /auth/otp/request {phone}`, then `POST /auth/otp/verify {phone, otp}`. This returns `access_token`, `refresh_token` and `user`.
  2. Send `Authorization: Bearer …` on every request.
  3. On a 401, call `POST /auth/refresh {refresh_token}` once (the token rotates), then retry the request.
  4. A 401 or 403 from the refresh call ends the session.
  5. `POST /auth/logout` and `GET /auth/me` complete the flow.
- **Placing an order:** `POST /orders`
  ```
  { idempotency_key: "cust_<32 hex>",     // same key for the same cart|address|coupon|slot|points|details, so retries are safe
    address_id, items:[{product_id, quantity}], combos?:[{combo_id, quantity}],
    coupon_code?, delivery_slot_start?, use_points?: true,
    for_someone_else?, recipient?:{name, phone}, delivery_note?, needs_help? }   // last four: [main]
  ```
  The server re-prices everything. Payment is always cash on delivery.
- **Other endpoints used:**
  - **Store and catalogue:**
    - `/store`
    - `/catalog/events` (SSE)
    - `/catalog/products`, `/catalog/categories`, `/catalog/home-groups`
    - `/promotions`
    - `/combos`
    - `/products?on_offer=true`
    - `POST`/`DELETE /catalog/products/:id/notify-me`
  - **Profile and rewards:**
    - `/me`: `PATCH` with `full_name`, `date_of_birth`, `favourite_category_ids`, `favourites_note`, `sms_offers`, `sms_language`; `DELETE` deletes the account
    - `/me/addresses`, including `/default`
    - `/me/devices` (push)
    - `/me/usuals`
    - `/me/referral`, `/me/referral/apply`
    - `/me/points`
    - `/feedback`
  - **Orders:**
    - `/orders/checkout-info?address_id=` (and `&subtotal=` on [main])
    - `/orders/slots`
    - `/orders/validate-coupon`
    - `/orders`, `/orders/:id`, `/orders/:id/cancel`
    - `/orders/:id/location/stream`, `/orders/:id/route`
  - **Doctors:** `/dental/clinics…`, `/dental/doctors…`, `/dental/appointments…`
- **Error codes with special handling:**
  - Ordering: `STORE_CLOSED` (show the server's sentence, refresh store status), `SLOT_UNAVAILABLE` / `SLOT_FULL` (drop the slot, reload slots), `DELIVERY_OUTSIDE_RADIUS`, `PRODUCT_UNAVAILABLE`, `COMBO_*` (reload combos), `COUPON_*`.
  - Account: `ACTIVE_ORDERS_EXIST`.
  - Doctors: `SIGN_IN_REQUIRED`.
  - Rewards: `REFERRAL_*`.
  - Sign-in: `INVALID_OTP`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS_EXCEEDED`, `LOGIN_LOCKED`.
  - Rate limits: `TOO_MANY_REQUESTS`, `FEEDBACK_RATE_LIMITED`.
  - **[main]** `FOR_SOMEONE_ELSE_DISABLED`.
  - The full wording is in `lib/Services/app_errors.dart`.
- **Push:** register with `POST /me/devices {token, platform:'web'}` and unregister on sign-out. Tapping a notification opens a screen based on its type:
  - `order` → order page
  - `product` → product page
  - `appointment` → appointment detail
- **Device storage:** keep the same meanings as the current keys:
  - session tokens;
  - cart (`{v:1, lines, combos}`);
  - recent searches;
  - the login-skipped flag;
  - a pending referral code;
  - the last delivery fee.
- **Links:**
  - `blynk.lk/p/<id>` opens a product.
  - `/app/?ref=CODE` saves a referral code and applies it after sign-in.
- **Analytics (Google Tag Manager, web only, no personal data, hashed customer id):**
  - `page_view`, `login`, `sign_up`;
  - `view_item_list`, `view_item`;
  - `add_to_cart`, `remove_from_cart`, `view_cart`;
  - `begin_checkout`, `add_shipping_info`, `purchase`;
  - `search`, `select_promotion`, `share`;
  - `pwa_installed`.

---

## 7. "Smooth for PWA users": what it takes

**Today's shop is Flutter built for the web.**

| | Size (compressed) |
|---|---|
| App code | 1.2 MB |
| Drawing engine (canvaskit) | 2.9 MB |
| **Download before the first screen** | **about 4.1 MB** |

Flutter also draws the whole app onto a canvas instead of normal web pages. In a phone browser that means:
- **a slow first open on mobile data;**
- scrolling and text input that feel less native, especially on iPhone;
- no native text selection;
- weaker browser features (autofill, find, translate);
- the address-bar and keyboard quirks of canvas apps.

**Two ways to get a smooth PWA:**

| | A. Redesign inside Flutter, then speed it up | B. Rebuild the shop as a light web app (React + Vite, like Ops/Rider/Admin) |
|---|---|---|
| First download | Still ~2.5–4 MB even with the newer WebAssembly renderer and splitting | About 150–300 KB, so the first screen appears in about 1–2 s on 4G |
| Feel | Canvas-drawn | Native scrolling, inputs, SMS-code autofill, smoother on iPhone |
| Backend | No change | No change (same API) |
| Work | Smaller: restyle the existing screens | Larger: rebuild about 35 screens against this checklist; the Flutter tests don't carry over |
| Risk | Low, but the "smooth" goal is only partly met | Medium; the checklist above is the safety net |

**Recommendation: B.** Rebuild the shop as a light web app, keeping this checklist, the same API and the same colours. It's the only way to really fix the first-open speed and the feel on iPhone. The Flutter app can keep running at blynk.lk/app until the new one passes the checklist, then the address is switched over. This also matches the earlier plan decision (D1, 21 Sep): "iOS PWA is React + Vite".

**PWA essentials either way:**
- **Install:** the app installs to the Home Screen with the yellow theme, and has a working offline page and an offline cart.
- **Updates and back button:** the new version reaches installed apps immediately, and the Android back button stays inside the app.
- **Live data and push:** the catalogue stream and order tracking pause in the background and resume on return. Web push works on iOS 16.4+ once the app is installed.
