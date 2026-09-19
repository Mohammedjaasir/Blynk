# Blynk — Existing Application & Frontend Audit Report

> **Audited Repository:** `apps/customer/blinkit-clone-Flutter-ecommerce-`  
> **Target Backend API:** `http://localhost:4000/api/v1` (Stages 1–10 Complete & Verified)  
> **Date:** 2026-09-17  
> **Audit Status:** `STATUS: AUDIT COMPLETE — READY FOR FRONTEND IMPLEMENTATION`

---

## 1. Existing Application Structure

The repository contains an established, structured Flutter customer mobile application located in:
`apps/customer/blinkit-clone-Flutter-ecommerce-/`

### Architecture & Tech Stack
- **Framework:** Flutter 3.x (Dart SDK `>=3.0.5 <4.0.0`)
- **State Management:** `Provider` (`provider: ^6.0.5`)
- **Networking:** `Dio` (`dio: ^5.3.0`)
- **Secure Storage:** `flutter_secure_storage: ^8.0.0`
- **Environment Management:** `flutter_dotenv: ^5.1.0`
- **Design System:** `AppColors` (Primary Yellow `#FFE141`, Primary Green `#0C831F`, Slate Backgrounds), `Catamaran` typography, Atomic Widget architecture (`Atoms` & `Organisms`).

```
apps/customer/blinkit-clone-Flutter-ecommerce-/lib/
├── Infrastructure/
│   └── HttpMethods/
│       └── requesting_methods.dart      # Dio HTTP Client wrapper
├── Services/
│   ├── Exceptions/                      # Custom API & Network exceptions
│   └── Providers/
│       └── auth.provider.dart           # User Auth & JWT token state
├── UI/
│   └── Widgets/
│       ├── Atoms/                       # 17 Reusable atomic UI widgets
│       └── Organisms/                   # 18 Complex organism widgets
├── Screens/
│   ├── Auth/
│   │   ├── login_screen.dart            # Mobile login bottom sheet trigger
│   │   └── otp_verification_screen.dart # 6-digit OTP verification & countdown
│   ├── home_screen.dart                 # App bar, search, carousel, category cards
│   ├── products_screen.dart             # Category products grid & subcategories
│   ├── user_cart_screen.dart            # Cart items, address & payment containers
│   ├── user_address_screen.dart         # Address book listing & add address
│   ├── order_summary_screen.dart        # Itemized order breakdown & repeat CTA
│   ├── order_confirmation_screen.dart   # Lottie animation & order receipt
│   ├── user_orders_screen.dart          # Historical orders list with delivery ETA
│   ├── profile_screen.dart              # User account, addresses, orders, logout
│   ├── coupons_screeen.dart             # Promo & coupon selector
│   ├── cart_gift_screen.dart            # Gift options & recipient messaging
│   └── pdf_view_screen.dart             # In-app PDF invoice viewer
├── app_colors.dart                      # Color tokens
├── app_theme.dart                       # Material ThemeData definition
├── constants.dart                       # App-wide constants & mock templates
├── main.dart                            # Application entrypoint
└── route_generator.dart                 # Named routing table (14 routes)
```

---

## 2. Existing Customer App Feature Inventory

| Feature | Existing Status | Implementation Details | File(s) |
|---|---|---|---|
| **Welcome / Login** | **Existing** | UI complete with Lottie animations, phone input modal | `Screens/Auth/login_screen.dart`<br>`UI/Widgets/Organisms/login_screen_otp_sheet.dart` |
| **OTP Verification** | **Partially Implemented** | UI complete with 6-digit field & resend timer; currently pushes route without calling backend OTP verify | `Screens/Auth/otp_verification_screen.dart` |
| **Home Screen** | **Existing** | CustomScrollView with sticky search, banners, categories, sticky bottom cart bar | `Screens/home_screen.dart`<br>`UI/Widgets/Organisms/home_screen_*.dart` |
| **Category Browsing** | **Partially Implemented** | UI grid complete; currently rendering from static constants instead of `GET /categories` | `Screens/products_screen.dart`<br>`UI/Widgets/Organisms/category_with_products.dart` |
| **Product Catalog** | **Partially Implemented** | UI cards complete with Add to Cart / Qty increment; needs dynamic wiring to `GET /products` | `UI/Widgets/Atoms/card_product.dart`<br>`UI/Widgets/Organisms/products_screen_grid.dart` |
| **Cart Management** | **Partially Implemented** | Cart screen UI and item cards exist; needs state provider integration for cart persistence | `Screens/user_cart_screen.dart`<br>`UI/Widgets/Atoms/card_product_cart_screen.dart` |
| **Address Selection** | **Partially Implemented** | Address listing UI exists; needs connection to `GET /addresses` & `POST /addresses` with 4km check | `Screens/user_address_screen.dart`<br>`UI/Widgets/Atoms/card_address_screen.dart` |
| **Checkout & COD** | **Partially Implemented** | Price breakdown & COD selector exist; needs `POST /orders` payload submission | `Screens/user_cart_screen.dart`<br>`UI/Widgets/Organisms/cart_screen_payment_container.dart` |
| **Order Confirmation** | **Existing** | Lottie packing animation screen with auto-navigation | `Screens/order_confirmation_screen.dart` |
| **Order History** | **Partially Implemented** | List UI with delivery badges exists; needs `GET /orders` integration | `Screens/user_orders_screen.dart` |
| **Order Details** | **Partially Implemented** | Detailed breakdown exists; needs `GET /orders/:id` and cancellation button for `PLACED/PACKED` | `Screens/order_summary_screen.dart`<br>`UI/Widgets/Atoms/card_order_details.dart` |
| **User Profile** | **Existing** | Account info, address book shortcut, order history, logout dialog | `Screens/profile_screen.dart` |

---

## 3. Existing Rider & Admin App Status

- **Rider App:** Dedicated native Flutter screens for riders are not in `apps/customer/`. The backend provides full REST endpoints (`/api/v1/riders/*`) and the responsive web portal provides rider delivery flows (`http://localhost:5173`).
- **Admin & Store Operations:** Administrative dashboards, inventory sourcing, supplier CRUD, and operational metrics are provided via backend `/api/v1/admin/*` endpoints and the web management interface.

---

## 4. Backend API Contract Alignment

The backend running on `http://localhost:4000/api/v1` serves as the authoritative source of truth.

```
Flutter Customer App                       Blynk Backend API (Port 4000)
─────────────────────────────────────────────────────────────────────────────
LoginBottomSheet / OTPVerify   ───►   POST /api/v1/auth/otp/request
                               ───►   POST /api/v1/auth/otp/verify
HomeScreen / CategoryBuilder   ───►   GET  /api/v1/categories
ProductsScreenGrid             ───►   GET  /api/v1/products?category_id=...
UserAddressScreen              ───►   GET  /api/v1/addresses
                               ───►   POST /api/v1/addresses (4km Geofence)
CartScreen / PaymentContainer  ───►   POST /api/v1/orders (Authoritative Price, COD)
OrdersScreen                   ───►   GET  /api/v1/orders
OrderSummaryScreen             ───►   GET  /api/v1/orders/:id
                               ───►   POST /api/v1/orders/:id/cancel
ProfileScreen                  ───►   GET  /api/v1/me
```

---

## 5. Identified Gaps & Required Corrections

### 1. HTTP Client & Authentication Wiring (`requesting_methods.dart`, `auth.provider.dart`)
- **Gap:** `kdioBaseOptions.baseUrl` is empty `''`.
- **Correction:** Set base URL to `http://localhost:4000/api/v1` (or `http://10.0.2.2:4000/api/v1` for Android Emulator) via `flutter_dotenv`.
- **Gap:** Missing Dio `InterceptorsWrapper` to inject `Authorization: Bearer <token>` on authenticated requests.

### 2. Sri Lankan Localization & Currency (`constants.dart`, `login_screen_otp_sheet.dart`)
- **Gap:** Hardcoded Indian phone prefix `+91` in login widgets.
- **Correction:** Update phone prefix to `+94` with Sri Lankan mobile validation (`07X XXX XXXX` / `+947XXXXXXXX`).
- **Gap:** Currency symbol is set to `₹`.
- **Correction:** Update `appCurrencySymbol` to `LKR ` (or `Rs. `) to match backend price snapshots.

### 3. Dynamic Catalog Integration (`HomeScreen`, `ProductsScreen`)
- **Gap:** Categories and product grids currently read from static dummy arrays.
- **Correction:** Connect to `GET /categories` and `GET /products` using dynamic Provider models (`CatalogProvider`, `CartProvider`).

### 4. Authoritative Checkout & Geofenced Addresses (`CartScreen`, `UserAddressScreen`)
- **Gap:** Cart calculates mock totals without server-side validation.
- **Correction:** Client cart manages quantities and sends item IDs to `POST /orders` where the server computes authoritative subtotal, 70 LKR delivery fee, and grand total. Address creation captures coordinates for 4 km geofence validation.

### 5. Order State Machine & Cancellation (`OrderSummaryScreen`)
- **Gap:** Cancellation button is static or navigates to generic policy.
- **Correction:** Show active cancellation button when order status is `PLACED` or `PACKED`, calling `POST /orders/:id/cancel`. Hide/disable cancellation once status reaches `OUT_FOR_DELIVERY` or `DELIVERED`.

---

## 6. Customer Journey Status Matrix

| Step | Status | Evidence | Action Required |
|---|---|---|---|
| 1. Open App & Welcome | **PASS** | `LoginScreen` renders Lottie animation & brand logo | None |
| 2. Mobile Phone Entry | **PARTIAL** | Modal bottom sheet exists with `+91` | Change prefix to `+94` & wire `POST /auth/otp/request` |
| 3. OTP Verification | **PARTIAL** | UI countdown timer & inputs exist | Wire `POST /auth/otp/verify` & store JWT |
| 4. Home Screen Navigation | **PASS** | App bar, categories, carousel, floating nav | Wire categories dynamically to `GET /categories` |
| 5. Product Grid & Search | **PARTIAL** | Grid UI & search delegate exist | Bind `GET /products` and active category filters |
| 6. Add to Cart & Qty | **PARTIAL** | UI increment/decrement buttons exist | Wire to reactive `CartProvider` |
| 7. Address Selection | **PARTIAL** | Address cards exist | Wire `GET /addresses` & create with 4km check |
| 8. Checkout & COD | **PARTIAL** | Summary cards & COD button exist | Wire `POST /orders` with idempotency key |
| 9. Confirmation & Tracking | **PARTIAL** | Confirmation screen & order summary exist | Bind live status (`PLACED → PACKED → OUT_FOR_DELIVERY → DELIVERED`) |
| 10. Self-Service Cancellation | **PARTIAL** | Policy card exists | Connect `POST /orders/:id/cancel` for `PLACED/PACKED` |

---

## 7. Recommended Implementation Plan

1. **Step 1 — Network & Auth Foundation:**
   - Configure `requesting_methods.dart` with base URL, error interceptor, and JWT bearer token injector.
   - Update `auth.provider.dart` with `requestOtp()`, `verifyOtp()`, `logout()`, and token persistence.
2. **Step 2 — Catalog & Cart Providers:**
   - Create `CatalogProvider` for dynamic categories and products from `GET /categories` and `GET /products`.
   - Create `CartProvider` for managing client cart items and calculating estimated totals.
3. **Step 3 — Address & Order Providers:**
   - Create `AddressProvider` and `OrderProvider` to fetch saved addresses and submit checkouts to `POST /orders`.
4. **Step 4 — Screen Wiring & Localization:**
   - Update `login_screen_otp_sheet.dart` & `otp_verification_screen.dart` with `+94` and live OTP calls.
   - Update `home_screen.dart` and `products_screen.dart` to consume `CatalogProvider`.
   - Update `user_cart_screen.dart` and `order_summary_screen.dart` to consume `CartProvider` and `OrderProvider`.
   - Update `constants.dart` currency to `LKR`.

---

## 8. Files to Modify vs Preserve

### Files to Modify (Wiring & API Binding Only)
- `lib/constants.dart` (Currency to `LKR`, remove placeholder static data)
- `lib/Infrastructure/HttpMethods/requesting_methods.dart` (Base URL & auth header interceptors)
- `lib/Services/Providers/auth.provider.dart` (Live OTP & token management)
- `lib/UI/Widgets/Organisms/login_screen_otp_sheet.dart` (`+94` prefix & request OTP call)
- `lib/Screens/Auth/otp_verification_screen.dart` (Verify OTP call & token storage)
- `lib/Screens/home_screen.dart` & `lib/Screens/products_screen.dart` (Dynamic catalog integration)
- `lib/Screens/user_cart_screen.dart` (Dynamic cart & checkout submission)
- `lib/Screens/user_orders_screen.dart` & `lib/Screens/order_summary_screen.dart` (Live order history & tracking)

### Files to Strictly Preserve (Existing Visual Identity)
- `lib/app_colors.dart` & `lib/app_theme.dart` (Preserve existing brand colors and theme tokens)
- `lib/route_generator.dart` (Preserve existing named routes)
- `Assets/` (Preserve existing Lottie animations, product images, categories, and typography fonts)

---

STATUS: AUDIT COMPLETE — READY FOR FRONTEND IMPLEMENTATION
