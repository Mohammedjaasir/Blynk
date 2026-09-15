# Graph Report - .  (2026-09-15)

## Corpus Check
- 256 files · ~236,827 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 771 nodes · 990 edges · 63 communities (57 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Flutter Windows Platform Runner
- Database Schema & Tables
- Database Schema & Tables
- Flutter iOS Platform Bridge
- Database Schema & Tables
- Customer Cart & Catalog Widgets
- Customer Auth & Session Management
- TypeScript Compiler Configuration
- Database Schema & Tables
- Database Schema & Tables
- Flutter Linux Platform Shell
- Backend Express Server & Config
- Backend Express Server & Config
- Database Schema & Tables
- Customer Cart & Catalog Widgets
- Customer Design System & UI Styling
- Customer Cart & Catalog Widgets
- Customer Cart & Catalog Widgets
- Component: pricing/index.ts
- Customer Auth & Session Management
- Flutter iOS Platform Bridge
- Customer Auth & Session Management
- Component: custom_sliver_delegate.dart
- Customer Cart & Catalog Widgets
- Customer Auth & Session Management
- Flutter Windows Platform Runner
- Database Schema & Tables
- Customer Auth & Session Management
- Customer Design System & UI Styling
- Database Schema & Tables
- Database Schema & Tables
- Customer Cart & Catalog Widgets
- Customer Cart & Catalog Widgets
- Customer Order Summary & Checkout UI
- Component: api_exception.dart
- Component: Cancellation Before OUT_FOR_DE
- Component: coupons_screeen.dart
- Customer Auth & Session Management
- Database Schema & Tables
- Customer Address & Location Flow
- Component: home_screen_search_bar.dart
- Database Schema & Tables
- Component: pdf_view_screen.dart
- Component: home_screen_floating_button.da
- Customer Cart & Catalog Widgets
- Customer Cart & Catalog Widgets
- Customer Cart & Catalog Widgets
- Component: cupertino_logout_dialog.dart
- Component: home_screen_category_builder.d
- Component: home_screen_floating_action_bu
- Database Schema & Tables
- Database Schema & Tables
- Component: MainActivity.kt
- Component: repeat_order_cta.dart
- Database Schema & Tables
- Database Schema & Tables
- Database Schema & Tables
- Component: String?

## God Nodes (most connected - your core abstractions)
1. `Win32Window` - 22 edges
2. `compilerOptions` - 18 edges
3. `MessageHandler` - 12 edges
4. `FlutterWindow` - 10 edges
5. `Create` - 10 edges
6. `WndProc` - 10 edges
7. `scripts` - 10 edges
8. `MessageHandler` - 9 edges
9. `createApp()` - 8 edges
10. `OnCreate` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Node.js/TypeScript Modular Monolith` --ARCHITECTS--> `Blynk Backend API Service`  [EXTRACTED]
  docs/03-decisions/adr-002-modular-monolith.md → backend/api/README.md
- `Blynk Backend API Service` --CONNECTS_TO--> `PostgreSQL 15+ Unified Database`  [EXTRACTED]
  backend/api/README.md → docs/03-decisions/adr-003-postgresql.md
- `Blynk REST API Architecture Specification` --IMPLEMENTED_BY--> `Blynk Backend API Service`  [EXTRACTED]
  docs/02-architecture/blynk_backend_api_architecture.md → backend/api/README.md
- `Stage 1 Backend Foundation Status` --RECORDS_STAGE_1--> `Blynk Backend API Service`  [EXTRACTED]
  docs/05-implementation/implementation-status.md → backend/api/README.md
- `wWinMain()` --calls--> `CreateAndAttachConsole()`  [INFERRED]
  apps/customer/blinkit-clone-Flutter-ecommerce-/windows/runner/main.cpp → apps/customer/blinkit-clone-Flutter-ecommerce-/windows/runner/utils.cpp

## Import Cycles
- None detected.

## Communities (63 total, 6 thin omitted)

### Community 0 - "Flutter Windows Platform Runner"
Cohesion: 0.06
Nodes (53): RegisterPlugins(), DartProject, HWND, LPARAM, LRESULT, UINT, WPARAM, FlutterWindow (+45 more)

### Community 1 - "Database Schema & Tables"
Cohesion: 0.06
Nodes (32): createApp(), Env, envSchema, checkDatabaseConnection(), db, pool, __dirname, ensureMigrationTable() (+24 more)

### Community 2 - "Database Schema & Tables"
Cohesion: 0.06
Nodes (33): AuditLogsTable, CategoriesTable, CustomerAddressesTable, DarkStoresTable, Database, DeliveriesTable, DeliveryAssignmentStatus, InventoryAdjustmentsTable (+25 more)

### Community 3 - "Flutter iOS Platform Bridge"
Cohesion: 0.07
Nodes (24): Any, AppDelegate, Bool, RunnerTests, RegisterGeneratedPlugins(), AppDelegate, Bool, MainFlutterWindow (+16 more)

### Community 4 - "Database Schema & Tables"
Cohesion: 0.07
Nodes (24): build, buildIconWithLabel, ProfileScreen, build, OrdersScreen, buildActions, buildLeading, buildResults (+16 more)

### Community 5 - "Customer Cart & Catalog Widgets"
Cohesion: 0.08
Nodes (22): AppTheme, build, OrderSummaryScreen, build, UserAddressScreen, build, CartScreen, package:ecom/app_colors.dart (+14 more)

### Community 6 - "Customer Auth & Session Management"
Cohesion: 0.08
Nodes (25): author, description, engines, node, keywords, license, main, name (+17 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.08
Nodes (25): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitAny (+17 more)

### Community 8 - "Database Schema & Tables"
Cohesion: 0.08
Nodes (21): build, main, MainApp, build, HomeScreen, build, categoryName, ProductsScreen (+13 more)

### Community 9 - "Database Schema & Tables"
Cohesion: 0.08
Nodes (23): AnimationDirection, AppRouter, builder, generateRoute, ScalePageRoute, Offset, package:ecom/Screens/app_about_screen.dart, package:ecom/Screens/Auth/login_screen.dart (+15 more)

### Community 10 - "Flutter Linux Platform Shell"
Cohesion: 0.11
Nodes (18): fl_register_plugins(), main(), my_application_activate(), my_application_class_init(), my_application_dispose(), my_application_init(), my_application_local_command_line(), my_application_new() (+10 more)

### Community 11 - "Backend Express Server & Config"
Cohesion: 0.09
Nodes (23): devDependencies, pino-pretty, supertest, tsx, @types/cors, @types/express, @types/luxon, @types/node (+15 more)

### Community 12 - "Backend Express Server & Config"
Cohesion: 0.10
Nodes (21): dependencies, cors, dotenv, express, helmet, kysely, luxon, pg (+13 more)

### Community 13 - "Database Schema & Tables"
Cohesion: 0.11
Nodes (14): add_to_cart_button.dart, build, index, build, index, ProductCardForList, ProductCard, productDetails (+6 more)

### Community 14 - "Customer Cart & Catalog Widgets"
Cohesion: 0.11
Nodes (12): ../../../app_colors.dart, AddNewAddressCard, build, AddressCard, build, build, CartProductCard, index (+4 more)

### Community 15 - "Customer Design System & UI Styling"
Cohesion: 0.12
Nodes (14): AppColors, greyWhiteColor, primaryGreenColor, primaryYellowColor, redAccentColor, scaffoldBackgroundColor, customTextField, isPhoneNumberField (+6 more)

### Community 16 - "Customer Cart & Catalog Widgets"
Cohesion: 0.12
Nodes (11): build, build, OrderGiftCard, buildIndividualPriceCard, chargeslissst, context, customTextButton, main (+3 more)

### Community 17 - "Customer Cart & Catalog Widgets"
Cohesion: 0.13
Nodes (12): asynAction, AsyncAction, ApiService, _dio, kdioBaseOptions, requestMethods, buildAddToCartButton, ../HttpMethods/requesting_methods.dart (+4 more)

### Community 18 - "Component: pricing/index.ts"
Cohesion: 0.19
Nodes (10): CalculatedPriceResult, calculateSellingPrice(), PriceCalculationParams, pricingRouter, calculateHaversineKm(), isWithinDeliveryRadius(), normalizeSriLankanPhone(), calculateScheduledDeliveryTime() (+2 more)

### Community 19 - "Customer Auth & Session Management"
Cohesion: 0.14
Nodes (13): build, createState, data, dispose, initState, _otpController, _restartTimer, _secondsRemaining (+5 more)

### Community 20 - "Flutter iOS Platform Bridge"
Cohesion: 0.18
Nodes (12): Blynk Backend API Service, Blynk System Architecture Specification, Blynk REST API Architecture Specification, Blynk Canonical Database Specification, Blynk Product Requirements Document, Blynk Confirmed Business Rules, Client-Side Cart with Authoritative Checkout, Customer Mobile Application (Flutter) (+4 more)

### Community 21 - "Customer Auth & Session Management"
Cohesion: 0.18
Nodes (11): AuthProvider, _authToken, getAuthToken, logout, of, _secureStorage, ChangeNotifier, FlutterSecureStorage (+3 more)

### Community 22 - "Component: custom_sliver_delegate.dart"
Cohesion: 0.17
Nodes (11): build, child, maxExtent, maxHeight, minExtent, minHeight, shouldRebuild, SliverAppBarDelegate (+3 more)

### Community 23 - "Customer Cart & Catalog Widgets"
Cohesion: 0.17
Nodes (9): CancellationPolicyCard, build, OrderDetailsCard, ApplyCouponOnCartCard, build, build, HomeScreenCarousel, Route /coupons (+1 more)

### Community 24 - "Customer Auth & Session Management"
Cohesion: 0.18
Nodes (11): _authorizeWithPhoneNumber, build, createState, dispose, initState, LoginwithMobileWidget, _LoginwithMobileWidgetState, _textEditingController (+3 more)

### Community 25 - "Flutter Windows Platform Runner"
Cohesion: 0.24
Nodes (9): wWinMain(), string, wchar_t, CreateAndAttachConsole(), GetCommandLineArguments(), Utf8FromUtf16(), _In_, _In_opt_ (+1 more)

### Community 26 - "Database Schema & Tables"
Cohesion: 0.18
Nodes (11): Cash on Delivery (COD) Phase 1, 8 AM - 9 PM Delivery Operating Window, Phase 1 On-Demand Sourcing Model, 24/7 Customer Ordering Window, 1-2 Rider Fleet & Manual Assignment, deliveries Table, order_items Table, order_status_history Table (+3 more)

### Community 27 - "Customer Auth & Session Management"
Cohesion: 0.24
Nodes (10): LoginScreen, _LoginScreenState, OTPVerificationScreen, _OTPVerificationScreenState, build, createState, ErrorScreem, _ErrorScreemState (+2 more)

### Community 28 - "Customer Design System & UI Styling"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, prefer_related_applications, short_name (+2 more)

### Community 29 - "Database Schema & Tables"
Cohesion: 0.22
Nodes (8): appCurrencySybmbol, introParagraph, kCategoriesTitles, kDummyCoupons, kDummyProducts, kSvgIcons, RequestingMethods, List

### Community 30 - "Database Schema & Tables"
Cohesion: 0.25
Nodes (8): Dharga Town Dark Store (DHARGA-01), Dharga Town Phase 1 Launch, 4 km Delivery Service Radius, Phase 2 Tracked Warehouse Inventory, categories Table, dark_stores Table, inventory Table, products Table

### Community 31 - "Customer Cart & Catalog Widgets"
Cohesion: 0.25
Nodes (6): AppAboutScreen, build, build, index, OrderSummaryProductCard, ../../../constants.dart

### Community 32 - "Customer Cart & Catalog Widgets"
Cohesion: 0.29
Nodes (7): build, CartGiftScreen, _CartGiftScreenState, createState, OrderAsGiftStepCard, subtitle, title

### Community 33 - "Customer Order Summary & Checkout UI"
Cohesion: 0.33
Nodes (6): build, createState, initState, OrderConfirmationScreen, _OrderConfirmationScreenState, package:lottie/lottie.dart

### Community 34 - "Component: api_exception.dart"
Cohesion: 0.29
Nodes (6): ApiException, message, stackTrace, statusCode, Exception, StackTrace?

### Community 35 - "Component: Cancellation Before OUT_FOR_DE"
Cohesion: 0.33
Nodes (6): Cancellation Before OUT_FOR_DELIVERY, Order Lifecycle State Machine, Order State: DELIVERED, Order State: OUT_FOR_DELIVERY, Order State: PACKED, Order State: PLACED

### Community 36 - "Component: coupons_screeen.dart"
Cohesion: 0.40
Nodes (5): build, CouponsSelectionScreen, _CouponsSelectionScreenState, createState, package:ecom/UI/Widgets/Atoms/custom_text_field.dart

### Community 37 - "Customer Auth & Session Management"
Cohesion: 0.40
Nodes (4): build, createState, package:ecom/UI/Widgets/Atoms/custom_button.dart, package:ecom/UI/Widgets/Organisms/login_screen_otp_sheet.dart

### Community 38 - "Database Schema & Tables"
Cohesion: 0.40
Nodes (4): build, CatgorywithProducts, title, ../Atoms/card_product_list.dart

### Community 39 - "Customer Address & Location Flow"
Cohesion: 0.40
Nodes (4): build, _buildAddress, HomeScreenAppBar, Route /profile

### Community 40 - "Component: home_screen_search_bar.dart"
Cohesion: 0.40
Nodes (4): build, _buildSearchField, HomeScreenSearchBar, ../../custom_sliver_delegate.dart

### Community 41 - "Database Schema & Tables"
Cohesion: 0.40
Nodes (4): build, OrderSummaryProductsDetails, ../Atoms/card_product_order_summary.dart, Route /order/invoice

### Community 42 - "Component: pdf_view_screen.dart"
Cohesion: 0.50
Nodes (3): build, ViewOrderInvoiceScreen, package:flutter_cached_pdfview/flutter_cached_pdfview.dart

### Community 43 - "Component: home_screen_floating_button.da"
Cohesion: 0.50
Nodes (3): build, HomeScreenFloatingNavigationBar, ../Organisms/home_screen_floating_action_button_widget.dart

### Community 44 - "Customer Cart & Catalog Widgets"
Cohesion: 0.50
Nodes (3): BottomStickyContainer, build, Route /cart

### Community 45 - "Customer Cart & Catalog Widgets"
Cohesion: 0.50
Nodes (3): build, CartPriceDetailWidget, ../Atoms/card_individual_price.dart

### Community 46 - "Customer Cart & Catalog Widgets"
Cohesion: 0.50
Nodes (3): build, CartScreenPaymentContainer, Route /order/confirm

### Community 47 - "Component: cupertino_logout_dialog.dart"
Cohesion: 0.50
Nodes (3): build, CupertinoLogoutDialog, package:flutter/cupertino.dart

### Community 48 - "Component: home_screen_category_builder.d"
Cohesion: 0.50
Nodes (3): build, HomeScreenCateogoryWidget, ../Atoms/category_widget.dart

### Community 49 - "Component: home_screen_floating_action_bu"
Cohesion: 0.50
Nodes (3): build, FloatingActionButtonWidget, home_screen_category_builder.dart

### Community 50 - "Database Schema & Tables"
Cohesion: 0.50
Nodes (3): builder, buildSubCategory, subCategory

### Community 51 - "Database Schema & Tables"
Cohesion: 0.67
Nodes (3): Flat 70 LKR Delivery Fee, 20% Default Markup Policy, system_configurations Table

## Knowledge Gaps
- **280 isolated node(s):** `AsyncAction`, `asynAction`, `ApiService`, `kdioBaseOptions`, `_dio` (+275 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FlutterWindow` connect `Flutter Windows Platform Runner` to `Flutter iOS Platform Bridge`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `AsyncAction`, `asynAction`, `ApiService` to the rest of the system?**
  _280 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Flutter Windows Platform Runner` be split into smaller, more focused modules?**
  _Cohesion score 0.0597567424643046 - nodes in this community are weakly interconnected._
- **Should `Database Schema & Tables` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Database Schema & Tables` be split into smaller, more focused modules?**
  _Cohesion score 0.05873015873015873 - nodes in this community are weakly interconnected._
- **Should `Flutter iOS Platform Bridge` be split into smaller, more focused modules?**
  _Cohesion score 0.06722689075630252 - nodes in this community are weakly interconnected._
- **Should `Database Schema & Tables` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._