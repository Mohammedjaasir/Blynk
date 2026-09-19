import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Screens/user_cart_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product_cart_screen.dart';
import 'package:ecom/app_colors.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';

// Captured verbatim from the running backend
// (GET /api/v1/catalog/products?category_slug=dairy-eggs).
const _realMilk =
    '{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}';
const _realButter =
    '{"id":"b0000001-0000-0000-0000-000000000002","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Pelwatte Salted Butter 200g","slug":"pelwatte-salted-butter-200g","description":null,"sku":"SKU-DAI-002","barcode":"4792024001028","unit":"200 g","pack_size":"Foil Wrap","image_url":null,"selling_price":805,"is_available":true}';

ProductModel _product(String json, {String? name}) {
  final map = (jsonDecode(json) as Map).cast<String, dynamic>();
  if (name != null) map['name'] = name;
  return ProductModel.fromJson(map);
}

void main() {
  late CartProvider cart;

  setUp(() => cart = CartProvider());

  Future<void> pumpCart(
    WidgetTester tester, {
    Size size = const Size(400, 860),
    Widget home = const CartScreen(),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: cart),
          ChangeNotifierProvider(create: (_) => ProductProvider()),
          ChangeNotifierProvider(create: (_) => AddressProvider()),
          ChangeNotifierProvider(create: (_) => OrderProvider()),
          ChangeNotifierProvider(create: (_) => AuthProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: home,
          onGenerateRoute: (settings) =>
              settings.name == '/checkout' || settings.name == '/home'
                  ? AppRouter.generateRoute(settings)
                  : MaterialPageRoute(
                      settings: settings,
                      builder: (_) =>
                          Scaffold(body: Text('route:${settings.name}')),
                    ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  // Bounded: removal/insert animations plus any repeating pulse.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Finder minus(String name) => find.bySemanticsLabel('Remove one $name');
  Finder plus(String name) => find.bySemanticsLabel('Add one more $name');

  group('cart with real items', () {
    testWidgets('renders the real cart lines, not hardcoded products',
        (tester) async {
      cart
        ..add(_product(_realMilk))
        ..add(_product(_realButter));
      await pumpCart(tester);

      expect(find.text('Your Cart'), findsOneWidget);
      expect(find.text('2 items'), findsOneWidget);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.text('1 L'), findsOneWidget);
      expect(find.text('Rs. 540'), findsOneWidget);
      expect(find.text('Pelwatte Salted Butter 200g'), findsOneWidget);
      expect(find.text('Rs. 805'), findsOneWidget);
      expect(find.byType(CartProductCard), findsNWidgets(2));
      // Images come from the shared component.
      expect(find.byType(ProductImage), findsNWidgets(2));
    });

    testWidgets('summary shows subtotal, the Rs. 70 fee and the total',
        (tester) async {
      cart.add(_product(_realMilk));
      await pumpCart(tester);

      expect(find.text('Order Summary'), findsOneWidget);
      expect(find.text('Subtotal (1 item)'), findsOneWidget);
      expect(find.text('Delivery Fee'), findsOneWidget);
      expect(find.text('Rs. 70'), findsOneWidget);
      // 540 + 70, in the summary and on the pinned bar.
      expect(find.text('Rs. 610'), findsNWidgets(2));
      // No invented fees.
      for (final fake in ['Handling', 'Convenience', 'Platform', 'Late Night',
        'Saved', 'MRP', 'OFF']) {
        expect(find.textContaining(fake), findsNothing);
      }
    });

    testWidgets('+ and - update the shared cart, subtotal and total live',
        (tester) async {
      cart.add(_product(_realMilk));
      await pumpCart(tester);

      await tester.tap(plus('Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(cart.quantityOf('b0000001-0000-0000-0000-000000000001'), 2);
      expect(find.text('2 × Rs. 540'), findsOneWidget);
      // Line total and the summary's subtotal.
      expect(find.text('Rs. 1080'), findsNWidgets(2));
      expect(find.text('Subtotal (2 items)'), findsOneWidget);
      expect(find.text('Rs. 1150'), findsNWidgets(2)); // 1080 + 70

      await tester.tap(minus('Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(cart.quantityOf('b0000001-0000-0000-0000-000000000001'), 1);
      expect(find.text('Subtotal (1 item)'), findsOneWidget);
      expect(find.text('Rs. 610'), findsNWidgets(2));
    });

    testWidgets('- at one removes the line and never goes negative',
        (tester) async {
      cart
        ..add(_product(_realMilk))
        ..add(_product(_realButter));
      await pumpCart(tester);

      await tester.tap(minus('Kotmale Fresh Milk 1L'));
      await settle(tester);

      expect(cart.quantityOf('b0000001-0000-0000-0000-000000000001'), 0);
      expect(cart.itemCount, 1);
      expect(find.text('Kotmale Fresh Milk 1L'), findsNothing);
      // The other line stays and the summary follows.
      expect(find.text('Pelwatte Salted Butter 200g'), findsOneWidget);
      expect(find.text('Subtotal (1 item)'), findsOneWidget);
      expect(find.text('Rs. 875'), findsNWidgets(2)); // 805 + 70
    });

    testWidgets('the trash button removes a line', (tester) async {
      cart
        ..add(_product(_realMilk))
        ..add(_product(_realButter));
      await pumpCart(tester);

      await tester.tap(find.byTooltip('Remove Pelwatte Salted Butter 200g'));
      await settle(tester);

      expect(cart.quantityOf('b0000001-0000-0000-0000-000000000002'), 0);
      expect(find.text('Pelwatte Salted Butter 200g'), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    });

    testWidgets('removal animates out before the row disappears',
        (tester) async {
      cart
        ..add(_product(_realMilk))
        ..add(_product(_realButter));
      await pumpCart(tester);

      await tester.tap(find.byTooltip('Remove Kotmale Fresh Milk 1L'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 80));
      // Mid-animation the frozen copy is still on screen but inert.
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(minus('Kotmale Fresh Milk 1L'), findsNothing);

      await settle(tester);
      expect(find.text('Kotmale Fresh Milk 1L'), findsNothing);
    });

    testWidgets('quantity control is yellow, not the old green',
        (tester) async {
      cart.add(_product(_realMilk));
      await pumpCart(tester);

      Finder filled(Color color) => find.descendant(
            of: find.byType(CartProductCard),
            matching: find.byWidgetPredicate(
              (w) =>
                  w is Container &&
                  w.decoration is BoxDecoration &&
                  (w.decoration as BoxDecoration).color == color,
            ),
          );

      expect(filled(AppColors.primaryYellowColor), findsOneWidget);
      expect(filled(AppColors.primaryGreenColor), findsNothing);
    });

    testWidgets('a very long product name wraps without overflow',
        (tester) async {
      cart.add(_product(
        _realMilk,
        name: 'Kotmale Full Cream Fresh Pasteurised Dairy Milk Tetra Pack '
            '1 Litre Family Size Value Pack',
      ));
      await pumpCart(tester, size: const Size(375, 812));
      await settle(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Rs. 540'), findsWidgets);
      expect(plus('Kotmale Full Cream Fresh Pasteurised Dairy Milk Tetra Pack '
          '1 Litre Family Size Value Pack'), findsOneWidget);
      expect(find.text('Proceed to Checkout'), findsOneWidget);
    });
  });

  group('empty cart', () {
    testWidgets('shows the empty state and no checkout CTA', (tester) async {
      await pumpCart(tester);

      expect(find.text('Your cart is empty'), findsOneWidget);
      expect(
        find.textContaining("we'll deliver them to your doorstep"),
        findsOneWidget,
      );
      expect(find.text('Browse Groceries'), findsOneWidget);
      expect(find.text('Proceed to Checkout'), findsNothing);
      expect(find.text('Order Summary'), findsNothing);
    });

    testWidgets('appears after the last item is removed', (tester) async {
      cart.add(_product(_realMilk));
      await pumpCart(tester);
      expect(find.text('Your cart is empty'), findsNothing);

      await tester.tap(find.byTooltip('Remove Kotmale Fresh Milk 1L'));
      await settle(tester);

      expect(find.text('Your cart is empty'), findsOneWidget);
      expect(find.text('Proceed to Checkout'), findsNothing);
    });

    testWidgets('Browse Groceries goes back to the shop already in the stack',
        (tester) async {
      // A stub stands in for the shell here: mounting CustomerShell pulls in
      // the Profile/Help tabs, whose remote icon images can't load in tests.
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider(create: (_) => ProductProvider()),
            ChangeNotifierProvider(create: (_) => AddressProvider()),
            ChangeNotifierProvider(create: (_) => OrderProvider()),
            ChangeNotifierProvider(create: (_) => AuthProvider()),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            initialRoute: '/home',
            onGenerateRoute: (settings) => settings.name == '/cart'
                ? AppRouter.generateRoute(settings)
                : MaterialPageRoute(
                    settings: settings,
                    builder: (_) => const Scaffold(body: Text('shop-shell')),
                  ),
          ),
        ),
      );
      await tester.pump();

      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      navigator.pushNamed('/cart');
      await tester.pump();
      await settle(tester);
      expect(find.byType(CartScreen), findsOneWidget);

      await tester.tap(find.text('Browse Groceries'));
      await tester.pump();
      await settle(tester);

      // Popped back to the shop that was already there - no extra route.
      expect(find.byType(CartScreen), findsNothing);
      // One shop route, not a second copy pushed on top.
      expect(find.text('shop-shell'), findsOneWidget);
    });
  });

  group('checkout handoff', () {
    testWidgets('Proceed to Checkout opens the existing checkout',
        (tester) async {
      cart.add(_product(_realMilk));
      // Wider than a phone: the pre-existing checkout bars are laid out for
      // the real font and overflow under the test font at 400 px.
      await pumpCart(tester, size: const Size(560, 900));

      await tester.tap(find.text('Proceed to Checkout'));
      await tester.pump();
      await settle(tester);

      expect(find.byType(CheckoutScreen), findsOneWidget);
      // The verified checkout pieces are still the ones doing the work.
      expect(find.text('Place Order'), findsOneWidget);
      expect(find.text('Cash on Delivery'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(CheckoutScreen),
          matching: find.text('Rs. 610'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('checkout with an empty cart shows the empty state',
        (tester) async {
      await pumpCart(
        tester,
        home: const CheckoutScreen(),
        size: const Size(560, 900),
      );

      expect(find.text('Your cart is empty'), findsOneWidget);
      expect(find.text('Place Order'), findsNothing);
    });
  });

  group('layout', () {
    testWidgets('desktop puts the summary beside the items', (tester) async {
      cart.add(_product(_realMilk));
      await pumpCart(tester, size: const Size(1440, 900));
      await settle(tester);

      final row = tester.getRect(find.byType(CartProductCard));
      final summary = tester.getRect(find.text('Order Summary'));
      expect(summary.left, greaterThan(row.right));
      // The CTA lives in the summary column, not a pinned bar.
      expect(find.text('Proceed to Checkout'), findsOneWidget);
      expect(find.text('TOTAL'), findsNothing);
    });

    for (final size in const [
      Size(375, 812),
      Size(390, 844),
      Size(414, 896),
      Size(768, 1024),
      Size(1280, 720),
      Size(1920, 1080),
    ]) {
      testWidgets('no overflow at ${size.width}x${size.height}',
          (tester) async {
        cart
          ..add(_product(_realMilk))
          ..add(_product(_realButter))
          ..add(_product(_realButter));
        await pumpCart(tester, size: size);
        await settle(tester);

        expect(tester.takeException(), isNull);
        expect(find.text('Proceed to Checkout'), findsOneWidget);
        // 540 + 1610 + 70
        expect(find.textContaining('Rs. 2220'), findsWidgets);

        await tester.tap(plus('Kotmale Fresh Milk 1L'));
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(cart.itemCount, 4);
      });
    }
  });
}
