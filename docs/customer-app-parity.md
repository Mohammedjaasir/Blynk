# Customer app parity: Flutter shop vs new app

Compared on 2026-10-14 on branch `feat/customer-app-parity`, after the c1, c2 and c3 merges and the integration pass. Updated the same day for the release branch `release/batch-2026-10-14` (d1, d3, d4 and the promo band merged).

- **Reference:** the Flutter shop, `apps/customer/blinkit-clone-Flutter-ecommerce-/lib` (the `Screens/` folder, `route_generator.dart`, and the widgets and services they use).
- **New app:** `apps/customer-app/src`.

Status means:
- **Done:** the same behaviour is there.
- **Partial:** it works, but differs or is incomplete, as noted.
- **Missing:** not built yet.

## Summary

There are **74 features** in total. Sorting is not counted, because neither app has it.

| Status | Count |
|---|---|
| Done | 68 |
| Partial | 6 |
| Missing | 0 |

### Release batch 2026-10-14 (`release/batch-2026-10-14`)

Closed every Missing row and two Partial ones:
- **Shell tabs** Shop / Orders / Help / Profile with an open-order badge (`app/(tabs)/`, `components/TabBar.tsx`).
- **Home:** promotions carousel (`components/PromoCarousel.tsx`, timing and motion as in `docs/promo-surfaces.md` and the Admin/Ops preview; taps follow `cta_target`: MAIN, CATEGORY, SUB_CATEGORY, PRODUCT, CATALOG), the Admin/Ops promo band (`components/PromoBand.tsx`), "Your usuals", named category groups, offline banner.
- **Catalog:** All categories (`app/categories.tsx`) and the category screen with a sub-category sidebar (`app/category/[slug].tsx`). Every entry point opens it: Home tiles and aisles, search chips, promo targets, deep links. The old `/store/<slug>` and `/opening` links redirect to it (the design mock keeps the old aisle flow).
- **Cart:** clear cart, savings header fix.
- **Config problem screen** for a release build without an API URL.
- Doctors hidden when Admin/Ops switch them off.

Added beyond the Flutter shop:
- **Product variants** (migration 045): size picker on product cards and the product page, "From LKR x" prices, sold out at stock 0, per-product delivery lead time ("Delivered from ...") with the lead-time card and slot rules in checkout; stock and size refusals update the cart.
- **PayHere online payment** (migration 047): cash / pay online choice in checkout, `/payment/pay`, verified `/payment/return` and `/payment/cancel`, awaiting-payment order states.
- **Address flow:** delivery-area map first (`GET /store` `store_location`), drag-pin, a nearby-area list when location is off, and the `/delivery-area` page. The Home location sheet opens this flow.
- **Policy links** (privacy, terms, refunds) in checkout, payment, login, sign-up and About us.

### Fixed in the integration pass (2026-10-14)

**Combo packs, end to end:**
- a "Combo packs" rail on Home
- ADD on the product page
- combo lines in the cart, saved with it
- `combos` sent in `POST /orders` and in the coupon preview
- combo error messages
- combos grouped with their items on the order screen

**Other fixes:**
- Live tracking on the order screen.
- Push permission is asked for after an order is placed and when "Notify me" is switched on.
- Every "Log in" button opens `/login` and then returns to where the customer was.
- Profile now has these rows: Blynk Points, Refer a friend, Channel doctors, My appointments, Share the app and About us.
- SMS & offers is shown to guests, who are sent to log in first.
- A new About us screen.
- A not-found screen.
- "Order again" on the order screen.

## Checklist

| Area | Screen / feature | Flutter | New app | Status | Notes |
|---|---|---|---|---|---|
| Start | Session gate / intro | session_gate.dart | app/index.tsx | Partial | The intro always goes on to Home as a guest. There is no login-first screen with "Skip" (possibly intended: owner to confirm). |
| Start | Login (phone) | Auth/login_screen.dart | app/login.tsx, plus the sheet in cart.tsx | Done | Every "Log in" entry uses `/login`, then comes back (`blynk/ui/signIn.ts`). |
| Start | OTP verify | Auth/otp_verification_screen.dart | app/otp.tsx | Done | |
| Start | Name capture (+ referral code) | Auth/name_capture_screen.dart | app/register.tsx | Done | |
| Start | Birthday prompt | Auth/birthday_prompt_screen.dart | app/birthday.tsx | Done | |
| Start | About you | about_you_screen.dart | app/profile.tsx | Partial | No "Anything else you love?" favourite-category chips. |
| Start | Config problem screen | config_problem_screen.dart | components/ConfigProblem.tsx | Done | Shown by `_layout.tsx` when a release build has no usable API URL. |
| Start | Not found | not_found_screen.dart | app/+not-found.tsx | Done | New. |
| Home | Shell tabs (Shop / Orders / Help / Profile), open-order badge | customer_shell.dart | app/(tabs)/_layout.tsx, components/TabBar.tsx | Done | |
| Home | Header, address, search | home_screen_app_bar.dart | app/(tabs)/home.tsx | Done | The location sheet opens the delivery-area address flow. |
| Home | Store-closed banner | store_closed_banner.dart | components/ClosedBanner.tsx | Done | |
| Home | Offline banner | connectivity_banner.dart | components/OfflineBanner.tsx | Done | Learns from every API call (`blynk/lib/connectivity.ts`). |
| Home | Birthday offer banner | birthday_offer_banner.dart | rewards/BirthdayOfferBanner.tsx | Done | Shown on Home and in checkout only. |
| Home | Promotions carousel (`GET /promotions`) | home_screen_carousel.dart | components/PromoCarousel.tsx | Done | Matches `docs/promo-surfaces.md` and the Admin/Ops preview; taps follow `cta_target`. The promo band (`components/PromoBand.tsx`) is also Admin/Ops-controlled. |
| Home | "Your usuals" | home_usuals_row.dart | rewards/UsualsRow.tsx | Done | |
| Home | Doctors entry | dental_home_entry.dart | doctors/DoctorsHomeEntry.tsx | Done | |
| Home | Category groups | home_category_groups.dart | catalog/HomeCategoryGroups.tsx | Done | Each Main is a section of category tiles with "See all". |
| Home | Product feed | home_product_feed.dart | (tabs)/home.tsx aisles | Partial | Different layout (tokri design). |
| Home | Combo packs rail | combo_rail.dart, combo_card.dart | blynk/combos/ComboViews.tsx | Done | New. Has ADD and a stepper, Sold out, a struck items total and "Save LKR x". |
| Home | Live catalogue refresh | catalog_live_updates.dart | lib/catalogLive.ts | Done | |
| Catalog | Categories screen | categories_screen.dart | app/categories.tsx | Done | |
| Catalog | Products listing (aisle) | products_screen.dart | app/category/[slug].tsx | Done | Sub-category sidebar, `?sub=` deep links, sizes / sold out / lead time on the cards. `/store/<slug>` and `/opening` redirect here. |
| Catalog | Search (recent, chips) | search_screen.dart | app/search.tsx | Done | |
| Catalog | Product details, Notify me, share | product_details_screen.dart | app/p/[id].tsx | Done | Notify me now also asks for push permission. |
| Catalog | Combo packs on the product page | none | app/p/[id].tsx | Done | ADD added (only the new app has this). |
| Cart | Lines and stepper | user_cart_screen.dart | app/cart.tsx, lib/cart.tsx | Done | |
| Cart | Combo cart lines | card_combo_cart.dart | cart.tsx ComboCartLine | Done | New. Kept with the saved cart and refreshed from `GET /combos`. |
| Cart | Coupon | checkout_coupon_field.dart | cart.tsx CouponCard | Done | The preview now includes combos. |
| Cart | Points use / earn | cart_rewards_lines.dart | checkout/CheckoutSections.tsx | Done | |
| Cart | Referral reward | cart_rewards_lines.dart | RewardsCard | Done | |
| Cart | Birthday offer | birthday_offer_banner.dart | CheckoutSections BirthdayBanner | Done | |
| Cart | Free delivery progress (basket / new customer) | card_cart_prices_detail.dart | cart.tsx, CartBar.tsx | Done | |
| Cart | Delivery slots / closed store | checkout_slot_picker.dart | SlotPickerCard | Done | |
| Cart | For someone else, needs help, rider note | checkout_recipient_section.dart | DeliveryDetailsCard | Done | |
| Cart | Address in checkout | cart_screen_address_container.dart | cart.tsx, app/addresses.tsx | Done | |
| Cart | Cancellation policy | card_cancellation_policy.dart | cart.tsx policy text | Done | |
| Cart | Clear cart | ClearCartSheet | cart.tsx | Done | Header button with a confirmation sheet. |
| Cart | Checkout and placing the order | checkout_screen.dart | cart.tsx | Done | Uses an idempotency key. Sends `combos`. Asks for push permission after success. |
| Cart | Order confirmation | order_confirmation_screen.dart | app/placed.tsx | Done | |
| Orders | Orders list | user_orders_screen.dart | app/(tabs)/orders.tsx | Done | "Log in" opens `/login`. |
| Orders | Order again | order_again_button.dart, reorder.dart | orders/reorder.ts, order/[id].tsx | Partial | On the order screen only, not on the list rows. Uses today's prices. A live combo is added back as a pack. Items that are no longer available are named. |
| Orders | Status, progress, timeline | order_summary_screen.dart | app/order/[id].tsx | Done | |
| Orders | Delivery code | DeliveryCodeCard | order/[id].tsx | Done | |
| Orders | Live tracking map + full map | order_tracking_map.dart | tracking/LiveTracking.tsx, app/track/[id].tsx | Done | Now mounted on the order screen. |
| Orders | Call rider | rider_contact_card.dart | order/[id].tsx | Done | |
| Orders | Cancel order | order_cancel_section.dart | order/[id].tsx | Done | |
| Orders | Combos on the order | order_summary_..._details_card.dart | order/[id].tsx | Done | Each combo is grouped with its items through `order_combo_id`. |
| Orders | Bill with discounts | order_bill_card.dart | order/[id].tsx | Done | |
| Account | Profile rows and order | profile_screen.dart | app/(tabs)/account.tsx | Done | About you, Points, Refer, Your orders, Address book, SMS & offers, Channel doctors, My appointments, Order updates, Help, Send feedback, Share the app, About us, Log out, Delete account. |
| Account | SMS preferences | sms_preferences_screen.dart | app/settings.tsx | Done | |
| Account | Help | help_screen.dart | app/(tabs)/help.tsx | Done | |
| Account | Feedback | feedback_screen.dart | app/feedback.tsx | Done | |
| Account | About us | app_about_screen.dart | app/about.tsx | Done | New. |
| Account | Delete account | delete_account_dialog | account.tsx | Done | |
| Account | Log out | logout_dialog | account.tsx | Done | |
| Account | Refer a friend | refer_friend_screen.dart | app/refer.tsx | Done | Linked from Profile while referrals are on. |
| Account | Points history | points_history_screen.dart | app/points.tsx | Done | Linked from Profile while points are on. |
| Account | Address book | user_address_screen.dart | app/addresses.tsx | Done | |
| Account | Live location picker | live_location_picker_screen.dart | address/LiveAddressScreen.tsx | Done | |
| Account | Share the app | profile_screen.dart | account.tsx | Done | |
| Doctors | Clinics | dental_clinics_screen.dart | doctors/index.tsx | Done | |
| Doctors | Clinic detail | dental_clinic_detail_screen.dart | doctors/clinic/[id].tsx | Done | |
| Doctors | Doctor profile | dental_doctor_profile_screen.dart | doctors/doctor/[id].tsx | Done | |
| Doctors | Slot picker | dental_slot_picker_screen.dart | doctors/book/[id].tsx | Done | |
| Doctors | Patient details | dental_patient_details_screen.dart | doctors/patient.tsx | Done | |
| Doctors | Review with hold countdown | dental_booking_review_screen.dart | doctors/review.tsx | Done | |
| Doctors | Confirmation | dental_booking_confirmation_screen.dart | doctors/confirmed.tsx | Done | |
| Doctors | My appointments | dental_my_appointments_screen.dart | doctors/appointments/index.tsx | Done | Also linked from Profile. |
| Doctors | Appointment detail (rate, cancel) | dental_appointment_detail_screen.dart | doctors/appointments/[id].tsx | Done | |
| Doctors | Sign-in gate | dental_sign_in_gate.dart | doctors/Gate.tsx | Done | |
| Platform | Push notifications | Services/push | blynk/push | Partial | Web (PWA) only; native builds have no Firebase config. A tap on an order notification opens the order, as in Flutter. |
| Platform | Share and deep links (`/p/<id>`, `?ref=`, `#/` routes) | share_links.dart | blynk/share | Done | Verified under `/app/` (see below). |
| Platform | Pending referral sync | pending_referral_sync.dart | rewards/api.ts | Done | |
| Platform | Analytics events (GA4 e-commerce via GTM) | Services/analytics | none in src/ | Partial | `public/index.html` loads GTM and consent, but the app pushes no events. |

## Remaining gaps

1. **Analytics events:** `page_view`, `view_item`, `add_to_cart` (including combos), `begin_checkout`, `purchase`, `login` and `sign_up`, pushed to `dataLayer`, mirroring `Services/analytics/analytics.dart`.
2. **Order again on order list rows:** the logic in `blynk/orders/reorder.ts` is ready to reuse.
3. **Session gate:** a login-first start with "Skip". The owner should decide whether this is wanted.
4. **Native push** (needs Firebase on native builds) and favourites in About you.

## Base path `/app/` (production web export)

- **Setting:** `app.json` has `experiments.baseUrl: "/app"`. With it, `npx expo export -p web` writes the script, font and asset URLs as `/app/...`.
- **Static files:** `public/` contains the manifest (scope `/app/`), the icons, the install helper, the phones-only gate and the worker that retires the old Flutter cache.
- **Production export:** the export command from 7e53325 succeeds. `apps/customer-site/Dockerfile` builds this app for blynk.lk/app/ again (release batch 2026-10-14).
- **Checked against a local mock API** (same config, with nginx's `try_files $uri $uri/ /app/index.html` emulated):
  - `/app/` plays the intro, then opens `/app/home`.
  - A shared link `/p/<id>` redirects (302) to `/app/#/p/<id>`, which opens Home and then the product.
  - `/app/?ref=CODE` keeps the code for sign-in.
  - Opening `/app/doctors/clinic/<id>`, `/app/order/<id>` and `/app/track/<id>` directly works.
  - An unknown path shows the not-found screen.
- **Push and live tracking:** a notification tap opens `WEB_APP_URL` (`https://blynk.lk/app/`), then the app routes to `/order/<id>` through the router, which handles the base path. The live-location stream and the other API calls use the absolute `EXPO_PUBLIC_API_BASE_URL`, so the base path does not affect them.
- **No code changes were needed for the base path.**
