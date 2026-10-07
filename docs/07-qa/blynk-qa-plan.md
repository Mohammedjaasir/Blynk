# Blynk QA Plan

Pre-launch test plan for every Blynk app: the customer app (APK and web at blynk.lk/app/), Operations, Admin, Inventory and Rider.

- **Code:** `main` with the 6 Oct fixes. Testers see the fixes only after the backend and websites are redeployed and the new APKs are installed (Setup S-01 to S-04).
- **Prepared:** 6 Oct 2026, sign-in rules updated 7 Oct · **Site:** https://blynk.lk · **Shop:** https://blynk.lk/app/

## How to use this sheet

1. Do **Setup** first, then the **End-to-end flows** (they cross several apps), then each app's own cases.
2. In the **Status** column write **Pass**, **Fail** or **Blocked**. For Fail or Blocked, add a note: what you saw, the phone or browser, and the time.
3. **P1** must pass before launch. **P2** should pass; a failure can be judged case by case.

| Status | Meaning |
|---|---|
| Pass | Everything under "Expected" happened |
| Fail | Something differs; write what you saw |
| Blocked | Could not run it (setup missing, earlier failure); say why |

## Still open

| Severity | App | Issue | What testers will see |
|---|---|---|---|
| High | All APKs | Old installs miss every fix above | Install the new APKs from 6 Oct (see S-04): uninstall the old app first. |

## Changed on 7 Oct: sign-in rules

| App | Sign-in now |
|---|---|
| Admin website | Email + password only. Admin accounts have no phone number. |
| Inventory website | Email + password only. Inventory accounts have no phone number. |
| Operations app | Email + password, or phone + SMS code (unchanged). |
| Rider app | Phone + SMS code only. New riders apply in the app; Admin or Ops approves under **Rider requests**. Staff can no longer create Rider accounts. |

## Fixed on 6 Oct (check these specially)

Found by checking every app against the backend. All apps call the right endpoints with the right fields and permissions; these were behaviour problems.

| App | Was | Now |
|---|---|---|
| Operations | Inventory → Stock list and Ledger product filter asked for more rows than the server allows | Both load fully now. |
| Admin | Coupon on/off switch failed for fixed and percentage coupons | Switch works for every type. |
| Admin, Ops, Inventory, Rider | Sign-out did not end the session on the server | Session is revoked on sign-out. |
| Customer | Duplicate orders when Place order was retried | A retry reuses the same order reference; the server returns the first order. |
| Inventory | Sourcing part of a line closed the whole line | No quantity box: source the full quantity or mark the item unavailable. |
| Customer web | Live rider map and live catalog did not stream in the web app | Both stream at blynk.lk/app/. |
| Customer | Addresses outside 4 km could be saved | Refused when saving with "We don’t deliver to this address yet". |
| Customer | Editing an address dropped line 2 | Line 2 is kept. |
| Customer | Cart was lost on restart or web reload | Cart is kept until the order is placed or the customer logs out. |
| Customer | No account deletion | Profile → Delete account (orders kept for the store’s records). |
| Rider, Ops, Admin | Weak connection or opening offline signed staff out | Session kept; a "Try again" notice instead. |
| Rider, Ops | Location sending ignored refusals; accuracy 0 and fast phone clocks were rejected | Server accepts them; app stops with the real reason on a refusal. |
| Rider | Sharing stopped for other trip stops after one arrival; buttons could hang on "Saving…" | Sharing moves to the next stop; requests time out after 15 s. |
| Ops, Rider, Inventory | APK/website build could point at localhost | Production build fails without a proper https API address. |
| All staff apps | SMS sign-in with an unknown number created a customer account | Shows "No Blynk account uses this number" instead. |
| Admin, Ops | Remove image deleted the file before saving; images over 2 MB gave a server error | File removed only after saving; clear 2 MB message. |
| Admin | ARTWORK promotions could not be edited; markup 1000% gave a server error | Both fixed; limits shown next to the fields. |
| Admin | No Mark unavailable; Mark delivered always recorded as override | Mark unavailable added; Mark delivered takes the customer’s code. |
| Admin, Ops | Promotion reorder sometimes did nothing; lists capped silently | Reorder always moves; lists say "Showing X of N" or load everything. |
| Admin | Sinhala/Tamil category or product names clashed | Each gets its own web address automatically. |
| Operations | Dental blocked dates showed the day before | Correct date shown. |
| Landing | Said "Pay by cash or card" | Says cash on delivery. |
| Inventory | Packing staff could not pack or receive stock (owner decision: allow) | Packing staff can restock, write off, audit and Mark packed. |
| SMS offers | Estimate and opted-out count could differ from what is sent | Counts match the chosen audience; test sends limited to 8 AM–9 PM and 5 per hour. |
| Rider, Ops | Android 13+ was not asked for notification permission | Asked right after location, before sharing starts; sharing still works if refused, with a note. |
| Admin, Ops | Board said "Substitution needs a cost" even when a cost existed | Shown only when a substitution really has no cost; Pack allowed otherwise. |
| Admin, Ops | Cash: disabled riders could not be picked for a hand-in | All riders listed; disabled ones marked (inactive). |
| Admin, Ops, Inventory | Live order boards loaded only the first 100 orders | Boards load every page (up to 2,000 orders). |
| Customer | Address line 2 could not be cleared | Editing the address text replaces both lines with what was typed. |

## Setup before testing

Do these once. Mark each Pass when done so testers know the environment is ready.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| S-01 | P1 | Backend settings in Coolify | 1. Backend app → Environment Variables.<br>2. CORS_ORIGINS keeps https://blynk-admin.valgrowlabs.com and https://blynk-inventory.valgrowlabs.com, has https://blynk.lk, and adds https://ops.blynk.lk (the Operations APK).<br>3. SMS_PROVIDER=sbs, SMS_API_KEY, SMS_API_SECRET (secret), SMS_SENDER_ID = the approved sender.<br>4. SMS_OFFER_LANGUAGES=en. FIREBASE_SERVICE_ACCOUNT_JSON set for push.<br>5. Redeploy backend (and worker if separate). | Deploy log shows migrations up to 027 applied; /health is OK; log says push enabled. | | |
| S-02 | P1 | Delivery centre on the Clock Tower | 1. Database terminal: psql -U postgres -d postgres.<br>2. Run the two UPDATE lines for 6.441313, 80.011437.<br>3. SELECT code, latitude, longitude FROM dark_stores; | DHARGA-01 shows 6.441313 | 80.011437. | | |
| S-03 | P1 | Websites redeployed | 1. Landing site: build args API_BASE_URL (ends in /api/v1) and SHARE_BASE_URL=https://blynk.lk; Domains = https://blynk.lk; redeploy.<br>2. Redeploy Admin and Inventory sites. | blynk.lk shows "Install Blynk"; blynk.lk/app/ loads the shop; Admin and Inventory open their sign-in. | | |
| S-04 | P1 | APKs rebuilt and installed | 1. Built 6 Oct against the live API: Customer apps/customer/blinkit-clone-Flutter-ecommerce-/build/app/outputs/flutter-apk/app-release.apk; Operations apps/operations/android/app/build/outputs/apk/debug/app-debug.apk; Rider apps/rider/android/app/build/outputs/apk/debug/app-debug.apk. Uninstall old apps, then install these (or rebuild as below).<br>2. Customer APK: API_BASE_URL, SHARE_BASE_URL=https://blynk.lk, APP_LINK_HOST=blynk.lk, google-services.json present.<br>3. Operations and Rider APKs: set VITE_API_BASE_URL to the live https API before building (the build now refuses localhost or a missing address).<br>4. Raise versionCode; uninstall old builds; install on test phones. | Each app opens and signs in against the live API ("We couldn’t reach Blynk" on login means a test build pointing at a PC). Rider delivery screen shows "Navigate in Google Maps". | | |
| S-05 | P1 | Test accounts and phones | 1. Admin creates: 1 Operations, 1 Inventory.<br>1b. 2 riders apply in the Rider app; Admin approves them under Rider requests (E2E-18).<br>2. Have 3 customer phones on different networks: Dialog, SLT-Mobitel, Hutch or Airtel.<br>3. For SMS offer tests, type a phone in "Send test to" (Admin has no phone now). | Every account signs in to its own app. | | |
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
| E2E-14 | P1 | Staff accounts and access | 1. Admin creates Ops and Inventory accounts; one rider is approved (E2E-18).<br>2. Each signs in to its own app, then tries the other apps.<br>3. Admin disables one account; Admin resets another’s password. | Each account works only in its own app; others show a "wrong app" message. Disabled account is signed out within 15 minutes; old password stops working. | | |
| E2E-17 | P2 | Unknown number on a staff app | 1. On Ops, Inventory, Rider and Admin, sign in by SMS with a number that has no account. | "No Blynk account uses this number"; no new customer appears in Admin → Customers. | | |
| E2E-18 | P1 | Rider applies and is approved | 1. New phone: Rider app → Apply to deliver → name, vehicle, plate → SMS code.<br>2. Try to sign in.<br>3. Admin → Rider requests (badge shows 1) → Approve.<br>4. Sign in on the Rider app again.<br>5. A second applicant: Ops → More → Rider requests → Reject with a reason. | Step 2: "waiting for approval" screen. Step 3: rider gets an SMS. Step 4: queue opens. Step 5: that rider sees "not approved" with the reason. | | |
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
| C-10 | P1 | Outside 4 km | 1. Try to save an address more than 4 km from the Clock Tower. | Not saved: "We don’t deliver to this address yet". | | |
| C-11 | P1 | Ordering hours | 1. Open the cart before 8 AM or after 9 PM.<br>2. Leave the cart open across 8:00 AM. | Note "We’re closed now. Orders open at 8 AM"; Place order greyed out; turns on by itself at 8:00. | | |
| C-12 | P2 | Phone clock wrong | 1. Set the phone clock to midday while it is really night; try to order. | Server refuses: "We’re closed right now. We take orders 8 AM – 9 PM." | | |
| C-13 | P1 | Coupons at checkout | 1. Apply a valid, an invalid, an expired and a below-minimum coupon. | Valid one discounts the bill; others show a clear reason. | | |
| C-14 | P1 | Place order | 1. Place an order. | Confirmation shows the server’s total and cash on delivery. | | |
| C-15 | P1 | No duplicate orders | 1. Very slow connection; tap Place order; when it times out tap Place order again.<br>2. Double-tap Place order on a normal connection. | Orders shows exactly one order each time. | | |
| C-16 | P2 | Order history and Order again | 1. Open Orders; open one; Order again. | Details and bill are correct; items are added to the cart. | | |
| C-17 | P1 | Live tracking and delivery code | 1. During E2E-01, watch the order screen. | Map shows the rider moving; 4-digit code visible only while on the way. | | |
| C-18 | P1 | Push notifications | 1. Go through packed, on the way, delivered and cancelled. | A push for each; tapping opens the order. | | |
| C-19 | P1 | SMS & offers switch | 1. Profile → SMS & offers → turn Offers by SMS off; reopen the app. | Setting is kept; no language choice is shown (English only for now). | | |
| C-20 | P2 | Feedback | 1. Send feedback 6 times within an hour. | First 5 accepted; 6th refused with a wait message. | | |
| C-21 | P2 | Help | 1. Open Help. | Says orders and delivery 8 AM – 9 PM, 4 km area; never quotes a fee amount. | | |
| C-22 | P2 | Offline | 1. Airplane mode; open the app; browse. | Offline banner; no crash; recovers when back online. | | |
| C-23 | P2 | Large text | 1. Phone font size to largest; browse cart and checkout. | Nothing cut off or overlapping. | | |
| C-24 | P2 | Logout | 1. Log out, log back in. | Clean sign-in; orders and addresses still there; cart is empty after logout. | | |
| C-25 | P1 | Cart kept | 1. Add items; close the app fully; reopen.<br>2. Same in the web app with a page reload. | Cart still has the items and quantities. | | |
| C-26 | P1 | Delete account | 1. With an open order: Profile → Delete account.<br>2. After the order is delivered: Delete account again.<br>3. Log in again with the same number. | First attempt refused: finish or cancel open orders. Second deletes and returns to login. The number can sign up as a new account. | | |
| C-27 | P2 | Edit an address with two lines | 1. Edit an older address with a second line; change only the name; save.<br>2. Edit it again and change the address text. | First save keeps the second line; second save stores exactly the new text. | | |

## Landing site and web app

Android Chrome, iPhone Safari and a desktop browser.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| W-01 | P1 | Install on Android | 1. blynk.lk in Chrome → Install Blynk. | Chrome install prompt or the steps; Blynk icon on the home screen opens the shop. | | |
| W-02 | P1 | Install on iPhone | 1. blynk.lk in Safari → Install Blynk. | Steps: Share → Add to Home Screen; icon opens the shop full screen. | | |
| W-03 | P1 | Shop in the browser | 1. Shop in your browser → log in with OTP → place an order. | Works end to end (if login or products fail, CORS is wrong: see S-01). | | |
| W-04 | P1 | Maps in the web app | 1. Add an address with the map picker. | Streets of Dharga Town draw; pin can be moved. | | |
| W-05 | P1 | Live tracking on the web | 1. Track an order that is on the way at blynk.lk/app/. | Rider marker moves on the map, as in the APK. | | |
| W-06 | P2 | Landing content | 1. Read the page top to bottom. | Hours 8–9, "Order every day", no fee amount, no APK link, payment shown as cash on delivery. | | |
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
| O-14 | P2 | Promotions | 1. Create, edit, hide, reorder; remove an image then Cancel. | Customer carousel updates; reorder always moves; the image is still there after Cancel. | | |
| O-15 | P1 | Cash | 1. Record a hand-in for a rider, including a disabled rider; check reconciliation. | Collected vs handed in correct; disabled riders marked (inactive); Delete not offered to Operations. | | |
| O-16 | P1 | Deliver myself: background location | 1. During a delivery, lock the screen 10 minutes. | Customer map keeps updating; notification shows sharing. | | |
| O-17 | P1 | Staff accounts | 1. Open Create account. | Ops can create Inventory only; the page says new riders apply in the Rider app. | | |
| O-24 | P1 | Rider requests | 1. More → Rider requests: Waiting, Approved, Rejected.<br>2. Approve one; reject one (reason required). | Count shows on More; approved rider can sign in; rejected shows reason and who reviewed. | | |
| O-18 | P1 | Delivery fee | 1. More → Delivery fee: change it. | New orders use it. | | |
| O-19 | P1 | SMS offers | 1. More → SMS offers: write an English offer, estimate, test send, send; try after 9 PM. | One English box; counts and SMS parts shown; after 9 PM refused "8 AM to 9 PM only". | | |
| O-20 | P2 | Dental admin | 1. Clinics, doctors, availability, block 25 Dec. | All save; the blocked date shows 25 Dec. | | |
| O-22 | P1 | Weak connection | 1. Use the app on very weak signal for 20 minutes during a self-delivery. | Stays signed in; location keeps sharing or says why it stopped. | | |
| O-23 | P2 | Far trip confirmation | 1. Assign a far-away order to a rider who already has one. | "Add to trip anyway" appears and works. | | |
| O-21 | P1 | Sign-out | 1. Sign out during a self-delivery. | Location sharing stops; sign-in screen shown. | | |

## Admin website

Admin account in a desktop browser.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| A-01 | P1 | Sign-in and lockout | 1. Check there is no SMS option.<br>2. 5 wrong passwords; then a non-admin account. | Email + password only; locked for 15 minutes with a clear message; non-admin refused. | | |
| A-19 | P1 | Rider requests | 1. Sidebar → Rider requests (badge = waiting count).<br>2. Approve one; reject one with a reason.<br>3. Staff accounts → Create account. | Lists update; Rider is not offered when creating an account. | | |
| A-02 | P2 | Dashboard | 1. Open Dashboard. | Counts of products, categories, promotions load. | | |
| A-03 | P1 | Orders | 1. Open the board and an order; Pack, assign, cancel. | Same rules as Ops; bill and history correct. | | |
| A-04 | P1 | Product form validation | 1. Markup 999.99, then 1000; a huge cost. | 999.99 saves; 1000 and the huge cost show a message next to the field. | | |
| A-05 | P2 | Product import | 1. Import a file with a duplicate SKU and a missing category. | Those rows are listed as errors; others import. | | |
| A-06 | P2 | Sinhala/Tamil names | 1. Create two categories and two products with Sinhala or Tamil names. | All save. | | |
| A-07 | P2 | Category groups | 1. Create, rename, reorder, delete. | Customer Home follows. | | |
| A-08 | P2 | Promotions and images | 1. Upload an image over 2 MB; remove an image then Cancel; edit an ARTWORK promotion. | Clear 2 MB message; image still there after Cancel; ARTWORK saves. | | |
| A-18 | P1 | Mark unavailable and deliver with code | 1. On a placed order, Mark unavailable on one item.<br>2. On an order on the way, Mark delivered with the customer’s code. | Total recalculated; history shows the code was used (not an override). | | |
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
| I-01 | P1 | Sign-in | 1. Check there is no SMS option.<br>2. Inventory account; then an Operations account. | Email + password only; Inventory gets in; Ops told to use the Operations app. | | |
| I-02 | P2 | Overview | 1. Open Overview. | Needs stock, counts, queue summary, latest ledger. | | |
| I-03 | P1 | Stock list | 1. Search, views (Tracked, Low & out), include inactive, paging. | Correct rows; untracked show "Sourced on order". | | |
| I-04 | P1 | Read-only for packing staff | 1. Open a product’s stock panel as Inventory, then as Admin. | Inventory cannot adjust; Admin can. | | |
| I-05 | P2 | Running low and ledger | 1. Open Running low; ledger with filters and a bad date range. | Lists correct; bad range shows an error. | | |
| I-06 | P1 | Source items | 1. Sourcing queue: source each item with cost and supplier. | Item marked sourced; tracked stock reduced. | | |
| I-07 | P1 | Full quantity only | 1. Source an item with quantity 3.<br>2. A tracked item with only 1 in stock. | Dialog shows "Sourcing all 3" with no quantity box; with short stock it offers Mark unavailable. | | |
| I-08 | P1 | Mark unavailable | 1. Mark an item unavailable. | Order total recalculated (including coupon); customer informed. | | |
| I-09 | P2 | Two people at once | 1. Two browsers source the same item. | Second sees "already sourced" and the queue refreshes. | | |
| I-10 | P2 | Suppliers | 1. Add, edit, deactivate; duplicate code. | Duplicate refused; deactivated supplier gone from the sourcing list. | | |
| I-11 | P1 | Sign-out | 1. Sign out. | Sign-in shown. | | |
| I-12 | P1 | Packing staff: restock and pack | 1. As packing staff: restock a product, write off one, audit.<br>2. Source all items of an order; Mark packed. | Stock changes recorded; the order leaves the queue and shows Packed in Ops; tracking mode and suppliers stay read-only. | | |

## Rider app

Rider account on the new Rider APK, Android 13 or newer.

| ID | Pri | Test | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| R-01 | P1 | Right version | 1. Open a delivery. | "Navigate in Google Maps" button and Additional phone (if given) are shown. | | |
| R-02 | P1 | Sign-in | 1. Phone + SMS code as an approved rider; then an Ops number. | Rider gets in; Ops refused. No email option. | | |
| R-16 | P1 | Apply to deliver | 1. Welcome → Get started → fill the form (Bicycle needs no plate) → SMS code. | "Application sent"; it appears in Admin and Ops Rider requests. | | |
| R-17 | P1 | Waiting and rejected | 1. Sign in while waiting; then after a rejection. | Waiting screen; then "not approved" with the reason. | | |
| R-03 | P1 | Queue | 1. With orders assigned: Now, Next, Done today. | Correct order; refreshes every 30 s. | | |
| R-04 | P1 | Delivery screen | 1. Map, address, note, Call buttons. | Customer pin and route shown; Call opens the dialler. | | |
| R-05 | P1 | Navigate in Google Maps | 1. Tap Navigate in Google Maps. | Google Maps app opens with directions to the customer’s pin. | | |
| R-06 | P1 | Picked up and location | 1. Fresh install on Android 13+; tap Picked up.<br>2. Allow location, then allow notifications.<br>3. Repeat after clearing data, tapping Don’t allow for notifications. | Location then notification prompts; "Sharing your location" notification; customer map shows the rider. If notifications are refused, sharing still works and the app says to turn them on. | | |
| R-07 | P1 | Background 30 minutes | 1. Lock the screen 30 minutes while on the way. | Customer map still updates. | | |
| R-08 | P1 | Arrived and collect | 1. I’ve arrived; enter the code; collect. | Sharing stops; "Delivered, LKR X collected". | | |
| R-09 | P1 | Wrong code lock | 1. 5 wrong codes. | Tries left, then a 15-minute countdown. | | |
| R-10 | P1 | Can’t deliver | 1. Report with a reason. | Order failed; reason shown. | | |
| R-11 | P2 | Trip | 1. 2+ deliveries assigned. | Stops in road order with total cash. | | |
| R-12 | P2 | My day | 1. Open My day. | Today and this week totals correct. | | |
| R-13 | P1 | Sign-out stops sharing (fixed) | 1. Sign out while sharing. | Notification disappears; sharing stops. | | |
| R-14 | P1 | Open with no signal | 1. Airplane mode; open the app; then turn signal on. | Stays signed in with an offline notice; works again when online. | | |
| R-15 | P1 | Trip: sharing moves on | 1. Trip with 2 stops on the road; mark the first arrived. | Customer 2 still sees the rider moving; app says sharing for your next stop. | | |

## Summary

- Total cases: **130** (87 P1)
- Fill in: Pass ___ · Fail ___ · Blocked ___ · Not run ___
