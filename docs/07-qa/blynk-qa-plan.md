# Blynk QA Plan

Pre-launch test plan for every Blynk app: the customer app (APK and web at blynk.lk/app/), Operations, Admin, Inventory and Rider.

- **Code:** `main` at `b7a8e29`. Items marked *Fixed* below are in this code; testers see them only after the backend, websites and APKs are redeployed and rebuilt.
- **Prepared:** 6 Oct 2026
- **Site:** https://blynk.lk · **Shop:** https://blynk.lk/app/

## How to use this sheet

1. Do **Setup** first, then the **End-to-end flows** (they cross several apps), then each app's own cases.
2. In the **Status** column write **Pass**, **Fail** or **Blocked**. For Fail or Blocked, add a note: what you saw, the phone or browser, and the time.
3. **P1** must pass before launch. **P2** should pass; a failure can be judged case by case.

| Status | Meaning |
|---|---|
| Pass | Everything under "Expected" happened |
| Fail | Something differs; write what you saw |
| Blocked | Could not run it (setup missing, earlier failure); say why |

## Known issues from the code check

Every app was checked against the backend on 6 Oct: all of them call the right endpoints with the right fields and permissions. These are behaviour problems.

| Severity | App | Issue | What testers will see |
|---|---|---|---|
| Fixed (needs redeploy) | Operations | Inventory → Stock list asked for 200 rows; the server allows 100 | Stock screen showed "Could not load stock". Now loads every product, 100 at a time. |
| Fixed (needs redeploy) | Operations | Ledger product filter used the same 200-row request | The product dropdown was always empty. Now filled. |
| Fixed (needs redeploy) | Admin | Coupon on/off switch sent the coupon type without its value | Switching a fixed or percentage coupon failed with "Request validation failed". Now works. |
| Fixed (needs redeploy) | Admin, Ops, Inventory, Rider | Sign-out did not end the session on the server | After signing out, the login stayed valid for up to 30 days. Now revoked on sign-out. |
| Fixed (needs redeploy) | Rider | Sign-out did not stop location sharing | "Sharing your location" stayed on after sign-out. Now stops. |
| High | Customer | No duplicate protection on Place order | If Place order times out and the customer taps it again, two orders can be created. |
| High | Inventory | Sourcing part of a line closes the whole line | Sourcing 1 of 3 marks the item done; the customer is still charged for 3. |
| High | Customer web | Live updates do not stream in the web app | No live rider marker at blynk.lk/app/; status still refreshes every 20 s. The APK is fine. |
| High | Rider, Ops | APKs must be rebuilt before testing | The installed Rider APK (2 Oct) lacks "Navigate in Google Maps" and the second phone number. |
| High | Operations | APK build can point at localhost | A plain build uses .env.local (localhost). Build with VITE_API_BASE_URL set to the live API. |
| Medium | Customer | Addresses outside 4 km can be saved | The customer only learns at Place order: "We don’t deliver there yet". |
| Medium | Customer | Editing an address drops address line 2 | Older addresses lose their second line when edited. |
| Medium | Customer | Cart is not saved | Closing the app or refreshing the web app empties the cart. |
| Medium | Rider | Opening the app with no signal signs the rider out | Rider must sign in again after opening offline. |
| Medium | Operations | A network blip during token refresh signs the operator out | Operator is sent back to sign-in on a weak connection. |
| Medium | Admin, Ops | Lists stop at 100 or 200 rows with no warning | Live orders, products, stock lookups and counts quietly stop at the limit. |
| Medium | Admin, Ops | Removing an image deletes the file before saving | Cancel after Remove leaves a broken image. |
| Medium | Admin | Markup of 1000% and very large costs give a server error | Error instead of a form message. |
| Medium | Admin | ARTWORK promotions cannot be edited | Saving one fails; preview cannot draw it. |
| Medium | Admin | Admin cannot mark items unavailable; Mark delivered is always an override | Use Ops/Inventory for unavailable items. History shows "override" even with the code. |
| Medium | Admin, Ops | Images over 2 MB give a server error | Error instead of "too large". |
| Medium | Operations | Dental blocked dates show the day before | A blocked 25 Dec shows as 24 Dec. |
| Medium | Rider, Ops | Location sending ignores some refusals | If the phone clock is ahead or accuracy is 0, points are refused but the app says "network" and keeps retrying. |
| Low | Admin, Ops | Promotion up/down arrows do nothing when two have the same order | Reorder appears to succeed but nothing moves. |
| Low | Landing | Says "Pay by cash or card" | Only cash on delivery exists today. |
| Low | All staff apps | Signing in by SMS with an unknown number creates a customer account | A stray customer appears in Admin → Customers. |
| Low | Customer | No account deletion in the app | Needed before Google Play. |
| Low | Inventory | Packing staff cannot pack orders or receive stock | Only Operations/Admin can. Confirm this is intended. |
| Low | SMS offers | "Opted out" count is store-wide; estimate includes invalid numbers | Estimate can be slightly higher than what is sent. |

## Setup before testing

Do these once. Mark each Pass when done so testers know the environment is ready.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| S-01 | P1 | Backend settings in Coolify | 1. Backend app → Environment Variables.<br>2. CORS_ORIGINS includes https://blynk.lk, the Admin and Inventory site addresses, and https://localhost (Android builds of Ops, Admin, Inventory).<br>3. SMS_PROVIDER=sbs, SMS_API_KEY, SMS_API_SECRET (secret), SMS_SENDER_ID = the approved sender.<br>4. SMS_OFFER_LANGUAGES=en. FIREBASE_SERVICE_ACCOUNT_JSON set for push.<br>5. Redeploy backend (and worker if separate). | Deploy log shows migrations up to 027 applied; /health is OK; log says push enabled. | | |
| S-02 | P1 | Delivery centre on the Clock Tower | 1. Database terminal: psql -U postgres -d postgres.<br>2. Run the two UPDATE lines for 6.441313, 80.011437.<br>3. SELECT code, latitude, longitude FROM dark_stores; | DHARGA-01 shows 6.441313 | 80.011437. | | |
| S-03 | P1 | Websites redeployed | 1. Landing site: build args API_BASE_URL (ends in /api/v1) and SHARE_BASE_URL=https://blynk.lk; Domains = https://blynk.lk; redeploy.<br>2. Redeploy Admin and Inventory sites. | blynk.lk shows "Install Blynk"; blynk.lk/app/ loads the shop; Admin and Inventory open their sign-in. | | |
| S-04 | P1 | APKs rebuilt and installed | 1. Customer APK: API_BASE_URL, SHARE_BASE_URL=https://blynk.lk, APP_LINK_HOST=blynk.lk, google-services.json present.<br>2. Operations and Rider APKs: set VITE_API_BASE_URL to the live API in the shell before building (Ops .env.local points at localhost).<br>3. Raise versionCode; install on test phones. | Each app opens and signs in against the live API. Rider delivery screen shows "Navigate in Google Maps". | | |
| S-05 | P1 | Test accounts and phones | 1. Admin creates: 1 Operations, 1 Inventory, 2 Riders (with vehicle).<br>2. Have 3 customer phones on different networks: Dialog, SLT-Mobitel, Hutch or Airtel.<br>3. Note the Admin account phone (needed for "Send test to my phone"). | Every account signs in to its own app. | | |
| S-06 | P2 | Test catalog data | 1. A category with 2 sub-categories; a category group on Home.<br>2. 5+ products: some tracked with stock, some untracked; one tracked with 0 stock.<br>3. One coupon each: FIXED, PERCENT, FREE_DELIVERY.<br>4. One active promotion. | Customer Home shows the group, promotion and products. | | |

## End-to-end flows (across apps)

These check that the apps talk to each other. Run them with real devices side by side.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| E2E-01 | P1 | Order from placing to delivered | 1. Customer (inside 4 km, between 8 AM and 9 PM) adds 2 products, one tracked; checks out with cash on delivery.<br>2. Ops → Orders: the order appears under To pack within about 20 s.<br>3. Inventory → Sourcing queue: source each item with a cost and supplier.<br>4. Ops: Pack the order, Assign rider A.<br>5. Rider A: order appears in the queue within 30 s; tap Picked up, allow location.<br>6. Customer (APK): order shows On the way with the rider moving on the map and a 4-digit delivery code.<br>7. Rider: I’ve arrived, enter the customer’s code, collect the cash. | Customer sees Delivered; Ops/Admin show Delivered; Inventory ledger shows the stock reduced; Admin → Sales (today) includes it; Cash shows the amount collected for rider A; customer gets push and SMS updates. | | |
| E2E-02 | P1 | An item is unavailable | 1. Customer places an order with 3 products.<br>2. Inventory → Sourcing: mark one item unavailable.<br>3. Ops: pack the rest and complete delivery. | Order shows "item unavailable", total drops by that item (coupon recalculated); customer is told by SMS/push; rider collects the new total. | | |
| E2E-03 | P1 | Customer cancels before packing | 1. Customer places an order with a coupon.<br>2. Customer cancels it from order details. | Order leaves the Ops board; tracked stock is restored; the coupon can be used again; customer gets a cancellation message. | | |
| E2E-04 | P1 | Store cancels a packed order | 1. Ops packs an order, then cancels it with a reason. | Customer sees Cancelled with the reason; rider (if assigned) sees "Cancelled — don’t pick up". | | |
| E2E-05 | P1 | Delivery fails and is restaged | 1. Rider picks up, then taps Can’t deliver with a reason.<br>2. Ops: order is in Needs attention; Restage with a note; assign rider again; deliver. | Order returns to Packed, then completes. Rider’s My day shows one failed and one delivered. | | |
| E2E-06 | P1 | Wrong delivery code lockout and override | 1. Rider enters a wrong code 5 times.<br>2. Ops: Mark delivered with a written override note. | Rider sees tries left, then a 15-minute lock. Ops override delivers the order and history says override. | | |
| E2E-07 | P2 | Two orders on one trip | 1. Two customers place orders; Ops assigns both to rider B.<br>2. Assign a third far-away order to rider B. | Rider sees "Your trip · 2 stops" in road order. The far order asks Ops to confirm adding it anyway. | | |
| E2E-08 | P2 | Operations staff delivers | 1. Ops → More → Deliver myself: set vehicle.<br>2. Assign an order to that Ops account; deliver it from the Ops app. | Same flow as a rider; customer map updates while the Ops phone screen is locked. | | |
| E2E-09 | P1 | Catalog change reaches customers | 1. Ops changes a product’s price and hides another product.<br>2. Watch the customer APK and the web app. | APK updates within seconds; web within 30 s. Hidden product disappears; checkout charges the new price. | | |
| E2E-10 | P1 | Delivery fee change | 1. Admin → Settings: change the delivery fee.<br>2. Customer checks out a new order.<br>3. Open an older order. | New order uses the new fee; older order keeps its fee. Landing page and Help never show a fee amount. | | |
| E2E-11 | P1 | Coupon from Admin to checkout | 1. Admin creates a FIXED coupon; switches it off and on.<br>2. Customer applies it at checkout; places the order.<br>3. Customer tries it again past its per-customer limit. | Switch works (fixed bug). Discount shows on the bill; second use is refused with a clear message; Admin shows usage 1. | | |
| E2E-12 | P2 | Back-in-stock alert | 1. Tracked product at 0 stock: customer taps Notify me (APK).<br>2. Admin/Inventory restocks it. | Customer receives a push that the product is back. | | |
| E2E-13 | P1 | SMS offer and opt-out | 1. Customer 1 turns Profile → SMS & offers → Offers by SMS off.<br>2. Admin → SMS offers: Send test to my phone; then send to All customers.<br>3. Ops → More → SMS offers: check history. | Test SMS arrives on the Admin phone with the stop line. Customer 1 gets nothing; others get the English offer. History shows the send with counts. | | |
| E2E-14 | P1 | Staff accounts and access | 1. Admin creates Ops, Inventory and Rider accounts.<br>2. Each signs in to its own app, then tries the other apps.<br>3. Admin disables one account; Admin resets another’s password. | Each account works only in its own app; others show a "wrong app" message. Disabled account is signed out within 15 minutes; old password stops working. | | |
| E2E-15 | P1 | Sign-out ends the session | 1. Sign out of Admin, Ops, Inventory and Rider.<br>2. Use the browser Back button / reopen the app. | Every app shows sign-in; nothing from the old session loads. | | |
| E2E-16 | P2 | Dental booking | 1. Ops sets up a clinic, doctor and weekly availability.<br>2. Customer books a slot, then cancels another booking.<br>3. Ops → Dental → Appointments. | Booking appears in Ops; cancelled one shows cancelled; customer gets confirmation messages. | | |

## Customer app (APK)

Android phone with the new customer APK.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| C-01 | P2 | First launch and Skip | 1. Fresh install; open; tap Skip.<br>2. Close and reopen. | Shop opens; the login screen is not shown again. | | |
| C-02 | P1 | OTP login on each network | 1. Log in with a Dialog number, then SLT-Mobitel, then Hutch/Airtel. | Code arrives within 30 s from the approved sender name on every network. | | |
| C-03 | P1 | Wrong, expired and repeated codes | 1. Enter a wrong code; wait for expiry; then too many tries. | Clear messages each time; no crash. | | |
| C-04 | P2 | Home | 1. Check promotions, category groups, categories; pull to refresh. | All sections load; links open the right category or product. | | |
| C-05 | P2 | Categories and sub-categories | 1. Open a category that has sub-categories. | Sidebar lists its sub-categories; products load for each. | | |
| C-06 | P2 | Search | 1. Search a product name, a SKU, nonsense text. | Results, then a clear "no results" state. | | |
| C-07 | P2 | Product page and share link | 1. Open a product; Share. | Shared text includes https://blynk.lk/p/<id>. | | |
| C-08 | P2 | Opening a share link | 1. Open the link on a phone with the app installed, then on one without. | Opens in the app; otherwise opens the product in the web shop. | | |
| C-09 | P1 | Address with current location | 1. Add an address; tap Use my current location. | Location is required to save; pin is close to your real position. | | |
| C-10 | P1 | Outside 4 km | 1. Save an address more than 4 km from the Clock Tower; try to order. | Order refused: "We don’t deliver there yet" (saving the address is allowed: known issue). | | |
| C-11 | P1 | Ordering hours | 1. Open the cart before 8 AM or after 9 PM.<br>2. Leave the cart open across 8:00 AM. | Note "We’re closed now. Orders open at 8 AM"; Place order greyed out; turns on by itself at 8:00. | | |
| C-12 | P2 | Phone clock wrong | 1. Set the phone clock to midday while it is really night; try to order. | Server refuses: "We’re closed right now. We take orders 8 AM – 9 PM." | | |
| C-13 | P1 | Coupons at checkout | 1. Apply a valid, an invalid, an expired and a below-minimum coupon. | Valid one discounts the bill; others show a clear reason. | | |
| C-14 | P1 | Place order | 1. Place an order. | Confirmation shows the server’s total and cash on delivery. | | |
| C-15 | P1 | Slow network on Place order | 1. Turn on a very slow connection; tap Place order once and wait. | Message "Check Orders before trying again". Check Orders: exactly one order (known risk of duplicates if tapped again). | | |
| C-16 | P2 | Order history and Order again | 1. Open Orders; open one; Order again. | Details and bill are correct; items are added to the cart. | | |
| C-17 | P1 | Live tracking and delivery code | 1. During E2E-01, watch the order screen. | Map shows the rider moving; 4-digit code visible only while on the way. | | |
| C-18 | P1 | Push notifications | 1. Go through packed, on the way, delivered and cancelled. | A push for each; tapping opens the order. | | |
| C-19 | P1 | SMS & offers switch | 1. Profile → SMS & offers → turn Offers by SMS off; reopen the app. | Setting is kept; no language choice is shown (English only for now). | | |
| C-20 | P2 | Feedback | 1. Send feedback 6 times within an hour. | First 5 accepted; 6th refused with a wait message. | | |
| C-21 | P2 | Help | 1. Open Help. | Says orders and delivery 8 AM – 9 PM, 4 km area; never quotes a fee amount. | | |
| C-22 | P2 | Offline | 1. Airplane mode; open the app; browse. | Offline banner; no crash; recovers when back online. | | |
| C-23 | P2 | Large text | 1. Phone font size to largest; browse cart and checkout. | Nothing cut off or overlapping. | | |
| C-24 | P2 | Logout | 1. Log out, log back in. | Clean sign-in; orders and addresses still there. | | |

## Landing site and web app

Android Chrome, iPhone Safari and a desktop browser.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| W-01 | P1 | Install on Android | 1. blynk.lk in Chrome → Install Blynk. | Chrome install prompt or the steps; Blynk icon on the home screen opens the shop. | | |
| W-02 | P1 | Install on iPhone | 1. blynk.lk in Safari → Install Blynk. | Steps: Share → Add to Home Screen; icon opens the shop full screen. | | |
| W-03 | P1 | Shop in the browser | 1. Shop in your browser → log in with OTP → place an order. | Works end to end (if login or products fail, CORS is wrong: see S-01). | | |
| W-04 | P1 | Maps in the web app | 1. Add an address with the map picker. | Streets of Dharga Town draw; pin can be moved. | | |
| W-05 | P2 | Order tracking on the web | 1. Track an order that is on the way. | Status updates (no live rider marker: known issue). | | |
| W-06 | P2 | Landing content | 1. Read the page top to bottom. | Hours 8–9, "Order every day", no fee amount, no APK link. ("Cash or card" wording: known issue.) | | |
| W-07 | P2 | Share link redirect | 1. Open https://blynk.lk/p/<product id> in a browser. | Opens that product in the web shop. | | |

## Operations app

Operations account on the new Ops APK (and once in a browser).

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| O-01 | P1 | Sign-in | 1. Email + password; then SMS code; then a Rider account. | Ops and Admin get in; Rider is refused with a clear message. | | |
| O-02 | P2 | Home counts | 1. Compare Home numbers with the Orders board. | Counts match. | | |
| O-03 | P1 | Orders board | 1. Place orders; watch lanes. | Orders move between To pack, Ready for a rider, On the road; board refreshes every 20 s. | | |
| O-04 | P1 | Pack, assign, hand over | 1. Pack an order; assign a rider; hand to rider. | Each step allowed only in the right state; rider suggestions show load and distance. | | |
| O-05 | P1 | Mark delivered with code | 1. On an order on the way, Mark delivered with the customer’s code. | Delivered; history shows the code was used. | | |
| O-06 | P1 | Failed, unavailable, restage, cancel | 1. Mark failed (note), Customer unavailable (note), Restage, Cancel (reason). | Each needs its note; customer sees the cancel reason. | | |
| O-07 | P2 | Packing slip | 1. Open a packing slip in a browser and in the APK. | Browser prints; APK shows "print from a browser". | | |
| O-08 | P1 | Inventory stock list (fixed) | 1. Catalog → Inventory → Stock with more than 100 products. | List loads and shows every product. | | |
| O-09 | P1 | Ledger product filter (fixed) | 1. Inventory → Ledger → product dropdown. | Dropdown lists products; filtering works. | | |
| O-10 | P1 | Stock adjust | 1. Restock, write off, audit on a tracked product. | On-hand changes; ledger shows each entry with reason. | | |
| O-11 | P1 | Products | 1. Create, edit (with image), hide, delete; try a duplicate SKU. | Changes show in the customer app; duplicate SKU refused clearly. | | |
| O-12 | P2 | Product import | 1. Import an .xlsx: dry run, then import. | Preview lists created/updated/errors; only valid rows import. | | |
| O-13 | P2 | Categories and groups | 1. Create a sub-category; reorder Home groups; delete a category with products (move them). | Customer Home follows the new order; products moved. | | |
| O-14 | P2 | Promotions | 1. Create, edit, hide, reorder. | Customer carousel updates (reorder may not move: known issue). | | |
| O-15 | P1 | Cash | 1. Record a hand-in for a rider; check reconciliation. | Collected vs handed in correct; Delete not offered to Operations. | | |
| O-16 | P1 | Deliver myself: background location | 1. During a delivery, lock the screen 10 minutes. | Customer map keeps updating; notification shows sharing. | | |
| O-17 | P1 | Staff accounts | 1. Create an Inventory and a Rider account; try to create an Admin. | Ops can create Inventory and Rider only. | | |
| O-18 | P1 | Delivery fee | 1. More → Delivery fee: change it. | New orders use it. | | |
| O-19 | P1 | SMS offers | 1. More → SMS offers: write an English offer, estimate, test send, send; try after 9 PM. | One English box; counts and SMS parts shown; after 9 PM refused "8 AM to 9 PM only". | | |
| O-20 | P2 | Dental admin | 1. Clinics, doctors, availability, block 25 Dec. | All save (blocked date may show 24 Dec: known issue). | | |
| O-21 | P1 | Sign-out | 1. Sign out during a self-delivery. | Location sharing stops; sign-in screen shown. | | |

## Admin website

Admin account in a desktop browser.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| A-01 | P1 | Sign-in and lockout | 1. 5 wrong passwords; then a non-admin account. | Locked for 15 minutes with a clear message; non-admin refused. | | |
| A-02 | P2 | Dashboard | 1. Open Dashboard. | Counts of products, categories, promotions load. | | |
| A-03 | P1 | Orders | 1. Open the board and an order; Pack, assign, cancel. | Same rules as Ops; bill and history correct. | | |
| A-04 | P1 | Product form validation | 1. Markup 999, then 1000; cost blank. | 999 saves; 1000 gives an error (known issue); blank cost saves as 0. | | |
| A-05 | P2 | Product import | 1. Import a file with a duplicate SKU and a missing category. | Those rows are listed as errors; others import. | | |
| A-06 | P2 | Categories with Sinhala/Tamil names | 1. Create two categories with Sinhala names. | Second may be refused as "taken" (known issue). | | |
| A-07 | P2 | Category groups | 1. Create, rename, reorder, delete. | Customer Home follows. | | |
| A-08 | P2 | Promotions and images | 1. Create with an image over 2 MB; remove an image then Cancel. | Large image gives an error (known); removed image may break (known). | | |
| A-09 | P1 | Coupons (fixed switch) | 1. Create FIXED, PERCENT, FREE_DELIVERY; switch each off and on; delete a used one. | Switch works for all three; used coupon cannot be deleted. | | |
| A-10 | P1 | Customers | 1. Search by phone; open one; download Excel. | Shows SMS language and Offers On/Off; Excel has both columns and phones keep the +. | | |
| A-11 | P1 | Staff accounts | 1. Create each role; Can deliver; disable; reset password; try editing yourself. | Rules enforced with clear messages. | | |
| A-12 | P1 | Settings: delivery fee | 1. Set 0, 150, 1001. | 0 and 150 save; 1001 refused. | | |
| A-13 | P2 | Sales report | 1. Today, yesterday, 7 and 30 days. | Figures match delivered orders; times in Sri Lanka time. | | |
| A-14 | P1 | Cash | 1. Record a hand-in; delete it. | Balance updates; delete works for Admin. | | |
| A-15 | P2 | Feedback | 1. Filter New; mark read. | Customer feedback appears; marking read updates the count. | | |
| A-16 | P1 | SMS offers | 1. Audience "Never ordered"; test to my phone; send; double-click Send. | One English box; one offer created per confirm; history updates. | | |
| A-17 | P2 | Session expiry | 1. Leave Admin idle 20 minutes, then click around. | Keeps working (silent refresh) or returns to sign-in, never a broken page. | | |

## Inventory website

Inventory (packing staff) account, and once as Admin.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| I-01 | P1 | Sign-in | 1. Inventory account; then an Operations account. | Inventory gets in; Ops told to use the Operations app. | | |
| I-02 | P2 | Overview | 1. Open Overview. | Needs stock, counts, queue summary, latest ledger. | | |
| I-03 | P1 | Stock list | 1. Search, views (Tracked, Low & out), include inactive, paging. | Correct rows; untracked show "Sourced on order". | | |
| I-04 | P1 | Read-only for packing staff | 1. Open a product’s stock panel as Inventory, then as Admin. | Inventory cannot adjust; Admin can. | | |
| I-05 | P2 | Running low and ledger | 1. Open Running low; ledger with filters and a bad date range. | Lists correct; bad range shows an error. | | |
| I-06 | P1 | Source items | 1. Sourcing queue: source each item with cost and supplier. | Item marked sourced; tracked stock reduced. | | |
| I-07 | P1 | Partial quantity | 1. Order of 3; source quantity 1. | Known issue: the whole line is marked done. Record what happens. | | |
| I-08 | P1 | Mark unavailable | 1. Mark an item unavailable. | Order total recalculated (including coupon); customer informed. | | |
| I-09 | P2 | Two people at once | 1. Two browsers source the same item. | Second sees "already sourced" and the queue refreshes. | | |
| I-10 | P2 | Suppliers | 1. Add, edit, deactivate; duplicate code. | Duplicate refused; deactivated supplier gone from the sourcing list. | | |
| I-11 | P1 | Sign-out | 1. Sign out. | Sign-in shown. | | |

## Rider app

Rider account on the new Rider APK, Android 13 or newer.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| R-01 | P1 | Right version | 1. Open a delivery. | "Navigate in Google Maps" button and Additional phone (if given) are shown. | | |
| R-02 | P1 | Sign-in | 1. Email + password; then an Ops account. | Rider gets in; Ops refused. | | |
| R-03 | P1 | Queue | 1. With orders assigned: Now, Next, Done today. | Correct order; refreshes every 30 s. | | |
| R-04 | P1 | Delivery screen | 1. Map, address, note, Call buttons. | Customer pin and route shown; Call opens the dialler. | | |
| R-05 | P1 | Navigate in Google Maps | 1. Tap Navigate in Google Maps. | Google Maps app opens with directions to the customer’s pin. | | |
| R-06 | P1 | Picked up and location | 1. Tap Picked up; allow location (and notifications). | Notification "Sharing your location"; customer map shows the rider. | | |
| R-07 | P1 | Background 30 minutes | 1. Lock the screen 30 minutes while on the way. | Customer map still updates. | | |
| R-08 | P1 | Arrived and collect | 1. I’ve arrived; enter the code; collect. | Sharing stops; "Delivered, LKR X collected". | | |
| R-09 | P1 | Wrong code lock | 1. 5 wrong codes. | Tries left, then a 15-minute countdown. | | |
| R-10 | P1 | Can’t deliver | 1. Report with a reason. | Order failed; reason shown. | | |
| R-11 | P2 | Trip | 1. 2+ deliveries assigned. | Stops in road order with total cash. | | |
| R-12 | P2 | My day | 1. Open My day. | Today and this week totals correct. | | |
| R-13 | P1 | Sign-out stops sharing (fixed) | 1. Sign out while sharing. | Notification disappears; sharing stops. | | |
| R-14 | P2 | Open with no signal | 1. Airplane mode; open the app. | Known issue: rider is signed out. Record what happens. | | |

## Summary

- Total cases: **116** (74 P1)
- Fill in: Pass ___ · Fail ___ · Blocked ___ · Not run ___
