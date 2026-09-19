// Live, end-to-end verification of the customer shopping flow against the
// REAL running backend (http://localhost:4000 by default - see .env /
// getApiBaseUrl()). Nothing here is mocked: OTP request/verify, catalog
// load, address CRUD, checkout and order retrieval all make real HTTP
// calls to the real API, exactly as the shipped app would.
//
// pumpAndSettle() is deliberately avoided throughout: the onboarding
// screen's second slide is a repeat:true Lottie animation and the OTP
// screen runs a 30s Timer.periodic countdown, both of which schedule
// frames continuously and make pumpAndSettle() hang or time out. Bounded
// pump loops (see `_settle`) are used instead, matching the existing
// pattern in test/widget_test.dart.
//
// Run with a real backend already up:
//   flutter test integration_test/live_customer_flow_test.dart -d windows
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/main.dart' as app;
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/add_edit_address_screen.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';

Future<void> _settle(
  WidgetTester tester, {
  int maxPumps = 60,
  Duration step = const Duration(milliseconds: 250),
}) async {
  for (var i = 0; i < maxPumps; i++) {
    await tester.pump(step);
  }
}

// Scrolls the finder into view first: at this desktop test window's
// compact height, content below the fold in a ListView/CustomScrollView
// isn't just off-screen, it isn't built yet (slivers only materialize
// widgets near the viewport) - ensureVisible() needs the element to
// already exist, so a not-yet-built target needs dragUntilVisible()
// instead, which scrolls incrementally until it actually appears.
// Pass [within] (a finder for the screen that owns the target) whenever the
// target may be below the fold. Without it this falls back to the last
// Scrollable in the tree, which is ambiguous now that CustomerShell keeps
// all four tab scrollables mounted at once - scrolling the wrong list means
// the target never appears and the tap silently hits nothing.
Future<void> _tap(WidgetTester tester, Finder finder, {Finder? within}) async {
  if (finder.evaluate().isEmpty) {
    final scrollable = within != null
        ? find.descendant(of: within, matching: find.byType(Scrollable)).first
        : find.byType(Scrollable).last;
    if (scrollable.evaluate().isNotEmpty) {
      await tester.dragUntilVisible(
        finder,
        scrollable,
        const Offset(0, -150),
        maxIteration: 30,
      );
    }
  } else {
    await tester.ensureVisible(finder);
  }
  await tester.pump();
  await tester.tap(finder, warnIfMissed: false);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'live flow: OTP login -> catalog -> cart -> address CRUD -> checkout -> orders -> cancel -> logout',
    (tester) async {
      // Unique-ish per run so repeated runs don't collide on stale state,
      // while staying a validly-formatted Sri Lankan test number.
      final runSuffix = (DateTime.now().millisecondsSinceEpoch % 100000)
          .toString()
          .padLeft(5, '0');
      final testPhone = '71${runSuffix.padLeft(7, '0')}'.substring(0, 9);

      app.main();
      await _settle(tester);

      // ================= 1. Onboarding -> auth sheet =================
      expect(find.text('Next'), findsOneWidget,
          reason: 'onboarding first slide should show a Next button');
      await _tap(tester, find.text('Next'));
      await _settle(tester, maxPumps: 10);

      expect(find.text('Get Started'), findsOneWidget,
          reason: 'onboarding second (last) slide should show Get Started');
      await _tap(tester, find.text('Get Started'));
      await _settle(tester, maxPumps: 10);

      expect(find.text('Log in or Sign up'), findsOneWidget);

      // ================= 2. Real OTP request =================
      final phoneField = find.byType(TextFormField).first;
      expect(phoneField, findsOneWidget);
      await tester.enterText(phoneField, testPhone);
      await tester.pump();

      expect(find.text('Continue'), findsOneWidget);
      await _tap(tester, find.text('Continue'));
      await _settle(tester); // real POST /auth/otp/request

      expect(find.text('OTP verification'), findsOneWidget,
          reason:
              'requestOtp() must have succeeded against the real backend to navigate here');

      final rootContext = tester.element(find.byType(MaterialApp));
      final authProvider =
          Provider.of<AuthProvider>(rootContext, listen: false);

      // The backend only returns dev_otp in dev/test environments (see
      // auth.service.ts) - a real, server-generated code, not a
      // client-side bypass.
      expect(authProvider.lastDevOtp, isNotNull,
          reason: 'backend should have returned a real dev_otp for this dev/test call');
      expect(authProvider.lastDevOtp, hasLength(6));
      expect(find.textContaining('Dev Code:'), findsOneWidget,
          reason: 'dev OTP must be clearly labeled as a dev aid in the UI, not silent');

      // ================= 3. Real OTP verify =================
      expect(find.text('Verify & Continue'), findsOneWidget);
      await _tap(tester, find.text('Verify & Continue'));
      await _settle(tester); // real POST /auth/otp/verify

      expect(find.text('OTP verification'), findsNothing,
          reason: 'successful verify should navigate away to /home');
      expect(authProvider.isAuthenticated, isTrue);
      expect(authProvider.accessToken, isNotNull);
      expect(authProvider.currentUser, isNotNull,
          reason: 'GET /auth/me (or the verify response) should have populated the user');

      // ================= 4. Real catalog data on Home =================
      await _settle(tester, maxPumps: 20);
      expect(find.text('Categories'), findsOneWidget);
      // The four-tab customer shell wraps Home.
      expect(find.text('Shop'), findsOneWidget);
      expect(find.text('Orders'), findsWidgets);

      // The promo hero sits above the rails, so on this window the first
      // product row can start below the fold - scroll it into existence
      // before asserting on it.
      final homeScroll = find
          .byWidgetPredicate((w) =>
              w is Scrollable && w.axisDirection == AxisDirection.down)
          .first;
      // dragUntilVisible needs a single-match finder; several product cards
      // render 'ADD', so scroll by hand until the first one exists.
      for (var i = 0; i < 12 && find.text('ADD').evaluate().isEmpty; i++) {
        await tester.drag(homeScroll, const Offset(0, -220));
        await _settle(tester, maxPumps: 2);
      }
      expect(find.text('ADD'), findsWidgets,
          reason: 'at least one real seeded product should render an ADD button');

      // ============ 5a. Home -> real Product Details -> back ============
      final cartProvider =
          Provider.of<CartProvider>(rootContext, listen: false);
      await _tap(tester, find.text('Kotmale Fresh Milk 1L').first);
      await _settle(tester, maxPumps: 10); // real GET /catalog/products/:id
      final detailsScreen = find.byType(ProductDetailsScreen);
      expect(detailsScreen, findsOneWidget);
      expect(
        find.descendant(of: detailsScreen, matching: find.text('1 L · Tetra Pack')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: detailsScreen, matching: find.text('Rs. 540')),
        findsWidgets,
        reason: 'price must match the backend selling_price',
      );
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await _settle(tester, maxPumps: 6);
      expect(detailsScreen, findsNothing);
      // Opening the product scrolled Home; bring the search bar back.
      await tester.drag(homeScroll, const Offset(0, 3000));
      await _settle(tester, maxPumps: 4);

      // ================= 5b. Real search -> real cart =================
      await _tap(tester, find.text('Search groceries & essentials'));
      await _settle(tester, maxPumps: 10);
      final searchScreen = find.byType(SearchScreen);
      expect(searchScreen, findsOneWidget);
      final searchField = find.byType(TextField);

      // No matches: friendly empty state, no backend error text.
      await tester.enterText(searchField, 'zzqx');
      await _settle(tester, maxPumps: 12); // debounce + real GET
      expect(find.text('Sorry!'), findsOneWidget);

      // Real matches for a real query, with the backend's own total.
      await tester.enterText(searchField, 'milk');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await _settle(tester, maxPumps: 12);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.text('1 product'), findsOneWidget);

      // Clearing returns to the initial state, which now shows the
      // submitted search as a recent one; tapping it re-runs it.
      await _tap(tester, find.byTooltip('Clear search'));
      await _settle(tester, maxPumps: 4);
      expect(find.text('RECENT SEARCHES'), findsOneWidget);
      await _tap(tester, find.text('milk'));
      await _settle(tester, maxPumps: 12);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);

      // Search -> Product Details: add, +, - through the shared cart.
      await _tap(tester, find.text('Kotmale Fresh Milk 1L'));
      await _settle(tester, maxPumps: 10);
      expect(detailsScreen, findsOneWidget);
      await _tap(tester, find.text('Add to Cart'));
      await _settle(tester, maxPumps: 4);
      expect(cartProvider.quantityOf(cartProvider.lines.single.product.id), 1);
      expect(cartProvider.lines.single.product.name, 'Kotmale Fresh Milk 1L');
      expect(find.text('1 in cart'), findsOneWidget);
      expect(find.text('1 item'), findsOneWidget,
          reason: 'the floating cart bar must reflect real CartProvider state');

      await _tap(tester,
          find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L').last);
      await _settle(tester, maxPumps: 4);
      expect(cartProvider.itemCount, 2);
      expect(find.text('2 items'), findsOneWidget);

      await _tap(tester,
          find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L').last);
      await _settle(tester, maxPumps: 4);
      expect(cartProvider.itemCount, 1);
      expect(find.text('1 item'), findsOneWidget);

      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await _settle(tester, maxPumps: 6);
      expect(detailsScreen, findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget,
          reason: 'closing the product keeps the search results');
      // The search result card shows the same cart quantity.
      expect(
        find.descendant(of: searchScreen, matching: find.text('ADD')),
        findsNothing,
      );
      expect(find.text('1 item'), findsOneWidget);

      // Back to Home: the same cart state is visible there.
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await _settle(tester, maxPumps: 6);
      expect(find.byType(SearchScreen), findsNothing);
      expect(find.text('1 item'), findsOneWidget);

      await _tap(tester, find.text('View Cart'));
      await _settle(tester, maxPumps: 15);
      expect(find.text('Your Cart'), findsOneWidget);
      expect(find.text('1 item'), findsWidgets);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.text('Order Summary'), findsOneWidget);
      // Real line price + the Rs. 70 delivery fee business rule.
      expect(find.text('Rs. 540'), findsWidgets);
      expect(find.text('Rs. 70'), findsOneWidget);
      expect(find.text('Rs. 610'), findsWidgets);

      // Cart hands off to the existing checkout (address + COD + Place Order).
      await _tap(tester, find.text('Proceed to Checkout'));
      await _settle(tester, maxPumps: 10);
      expect(find.byType(CheckoutScreen), findsOneWidget);
      expect(find.text('Place Order'), findsOneWidget);

      // ================= 6. Real address CRUD =================
      final addressProvider =
          Provider.of<AddressProvider>(rootContext, listen: false);
      await _settle(tester, maxPumps: 10); // let CartScreenAddressContainer's loadAddresses() land

      // Create. Scoped to the GestureDetector the address bar actually uses
      // (product cards use a plain InkWell for their own "Add" button, and
      // Home stays mounted underneath this pushed route). Tapping it opens
      // the address LIST screen (/user/address), not the form directly.
      final cartAddressAction = find.ancestor(
        of: find.text('Add'),
        matching: find.byType(GestureDetector),
      );
      expect(cartAddressAction, findsOneWidget,
          reason: 'no default address yet -> cart address bar should offer Add');
      await _tap(tester, cartAddressAction);
      await _settle(tester, maxPumps: 15); // real GET /me/addresses
      expect(find.text('My Addresses'), findsOneWidget);

      await _tap(tester, find.text('Add new address'));
      await _settle(tester, maxPumps: 10);
      expect(find.text('Add Address'), findsOneWidget);

      // The address name is a Home / Work / Other picker writing into the
      // backend's free-text label; "Other" reveals the custom name field.
      await _tap(tester, find.text('Other'));
      await _settle(tester, maxPumps: 4);

      final formFields = find.byType(TextFormField);
      // Order follows the redesigned sections: name, contact, address.
      await tester.enterText(formFields.at(0), 'Integration Test Home');
      await tester.enterText(formFields.at(1), 'QA Tester');
      await tester.enterText(formFields.at(2), '+94$testPhone');
      await tester.enterText(formFields.at(3), 'No. 12, Test Lane');
      await tester.enterText(formFields.at(5), 'Dharga Town');
      await tester.pump();

      // Explicitly make this the default so checkout has one to use, and
      // so the create call is verified with is_default: true honoured.
      await _tap(tester, find.byType(Switch),
          within: find.byType(AddEditAddressScreen));
      await tester.pump();

      await _tap(tester, find.text('Save Address'),
          within: find.byType(AddEditAddressScreen));
      await _settle(tester); // real POST /me/addresses

      expect(find.text('Add Address'), findsNothing,
          reason: 'successful create should pop back to the address list screen');
      expect(addressProvider.errorMessage, isNull);
      expect(addressProvider.defaultAddress, isNotNull);
      expect(addressProvider.defaultAddress!.label, 'Integration Test Home');

      // Edit - already back on the address list screen after the create's pop.
      final rootNavigator =
          tester.state<NavigatorState>(find.byType(Navigator).first);

      expect(find.text('Integration Test Home'), findsOneWidget);
      expect(find.text('· Default'), findsOneWidget,
          reason: 'the address just created with is_default:true should show as default');

      await _tap(tester, find.text('Edit'));
      await _settle(tester, maxPumps: 10);
      expect(find.text('Edit Address'), findsOneWidget);
      final editLabelField = find.byType(TextFormField).first;
      await tester.enterText(editLabelField, 'Integration Test Home (Edited)');
      await _tap(tester, find.text('Save Address'),
          within: find.byType(AddEditAddressScreen));
      await _settle(tester); // real PATCH /me/addresses/:id

      // find.text() also matches an EditableText's contents, so asserting
      // the label alone could pass against the still-open form's own field.
      // The provider is the unambiguous check that the PATCH actually landed.
      expect(find.text('Edit Address'), findsNothing,
          reason: 'a successful save should pop the edit form');
      expect(addressProvider.defaultAddress?.label,
          'Integration Test Home (Edited)',
          reason: 'the edit must be reflected in real backend-backed state');

      // Back to checkout
      rootNavigator.pop();
      await _settle(tester, maxPumps: 10);
      expect(find.byType(CheckoutScreen), findsOneWidget);
      expect(find.textContaining('Integration Test Home (Edited)'), findsOneWidget,
          reason: 'CartScreenAddressContainer should show the edited default address');

      // ================= 7. Real checkout =================
      expect(find.text('Place Order'), findsOneWidget);
      await _tap(tester, find.text('Place Order'));
      await _settle(tester); // real POST /orders

      final orderProvider =
          Provider.of<OrderProvider>(rootContext, listen: false);
      expect(orderProvider.placeOrderError, isNull,
          reason: 'checkout should have succeeded against the real backend');
      final placed = orderProvider.lastPlacedOrder;
      expect(placed, isNotNull);
      expect(placed!.deliveryFee, 70.0,
          reason: 'backend-authoritative delivery fee must be Rs. 70 per the Phase 1 business rule');
      expect(placed.totalAmount,
          closeTo(placed.subtotalAmount + placed.deliveryFee, 0.01));
      expect(placed.paymentMethod.toUpperCase(), contains('COD'));
      expect(placed.status, OrderStatus.placed);

      expect(find.byKey(const Key('view-order')), findsOneWidget);

      // ================= 8. Real order retrieval + lifecycle UI =================
      await _tap(tester, find.byKey(const Key('view-order')));
      await _settle(tester); // real GET /orders/:id

      // The AppBar title carries the order number.
      expect(find.text(placed.orderNumber), findsWidgets);
      expect(find.text('Bill'), findsOneWidget);
      // The button is shown only because the backend's can_cancel said so.
      expect(find.byKey(const Key('cancel-order-button')), findsOneWidget,
          reason: 'a freshly PLACED order must be cancellable per the canonical lifecycle');

      // ================= 9. Real cancellation =================
      await _tap(tester, find.byKey(const Key('cancel-order-button')));
      await _settle(tester, maxPumps: 10);
      await _tap(tester, find.byKey(const Key('confirm-cancel'))); // bottom sheet confirm
      await _settle(tester); // real POST /orders/:id/cancel + re-fetch

      expect(find.byKey(const Key('cancel-order-button')), findsNothing,
          reason:
              'after a real cancellation the screen must re-fetch and stop offering Cancel');

      // ================= 10. Orders list shows the real order =================
      rootNavigator.pushNamed('/orders');
      await _settle(tester); // real GET /orders
      expect(find.textContaining(placed.orderNumber), findsOneWidget);
      expect(find.textContaining('Cancelled'), findsOneWidget,
          reason: 'orders list should reflect the real, backend-confirmed cancelled status');
      rootNavigator.pop();
      await _settle(tester, maxPumps: 10);

      // ================= 11. Real logout =================
      await authProvider.logout(); // real POST /auth/logout + local clear
      expect(authProvider.isAuthenticated, isFalse);
      expect(authProvider.accessToken, isNull);
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
