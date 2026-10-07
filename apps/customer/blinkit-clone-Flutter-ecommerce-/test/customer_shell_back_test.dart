import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/adaptive_scaffold.dart';
import 'package:ecom/UI/Widgets/Organisms/bottom_cart_container.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_bar.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';

ProductModel _product(String id, double price) => ProductModel(
      id: id,
      categoryId: 'c',
      categoryName: 'Dairy',
      name: 'Item $id',
      slug: 'item-$id',
      sku: 'SKU-$id',
      unit: '1 pc',
      sellingPrice: price,
      isAvailable: true,
    );

Future<dynamic> _emptyCatalog(String url, Map<String, dynamic> query) async {
  if (url == '/catalog/categories') return {'success': true, 'data': {'categories': []}};
  if (url == '/promotions') return {'success': true, 'data': {'promotions': []}};
  return {
    'success': true,
    'data': {
      'products': [],
      'pagination': {'page': 1, 'limit': 100, 'total': 0, 'total_pages': 1},
    },
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  late CartProvider cart;
  late OrderProvider orders;
  late int orderFetches;
  late List<String> platformCalls;

  setUp(() {
    cart = CartProvider();
    orderFetches = 0;
    platformCalls = [];
    orders = OrderProvider(request: (method, url, {body, query}) async {
      orderFetches++;
      return {'success': true, 'data': {'orders': [], 'pagination': {'total_pages': 1}}};
    });
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        platformCalls.add(call.method);
        return null;
      },
    );
    addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
  });

  // What an un-intercepted back press on the first route ends up as.
  bool exited() => platformCalls.contains('SystemNavigator.pop');

  Widget app({List<Widget>? tabs, int initialTab = 0, EdgeInsets padding = EdgeInsets.zero}) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ProductProvider(request: _emptyCatalog)),
        ChangeNotifierProvider.value(value: cart),
        ChangeNotifierProvider(create: (_) => AddressProvider()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider.value(value: orders),
      ],
      child: MaterialApp(
        theme: AppTheme.theme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(padding: padding, viewPadding: padding),
          child: child!,
        ),
        onGenerateRoute: (settings) {
          if (settings.name == '/cart') {
            return MaterialPageRoute(
              settings: settings,
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => CustomerShell.openShop(context),
                    child: const Text('cart page - open shop'),
                  ),
                ),
              ),
            );
          }
          return MaterialPageRoute(
            settings: const RouteSettings(name: '/home'),
            builder: (_) => CustomerShell(initialTab: initialTab, tabs: tabs),
          );
        },
      ),
    );
  }

  const stubTabs = <Widget>[
    Center(child: Text('shop tab')),
    Center(child: Text('orders tab')),
    Center(child: Text('help tab')),
    Center(child: Text('profile tab')),
  ];

  Future<void> pumpShell(
    WidgetTester tester, {
    List<Widget>? tabs = stubTabs,
    double width = 400,
    int initialTab = 0,
    EdgeInsets padding = EdgeInsets.zero,
  }) async {
    tester.view.physicalSize = Size(width, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(app(tabs: tabs, initialTab: initialTab, padding: padding));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  Future<void> systemBack(WidgetTester tester) async {
    await tester.binding.handlePopRoute();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  int selectedIndex(WidgetTester tester) =>
      tester.widget<AdaptiveScaffold>(find.byType(AdaptiveScaffold)).selectedIndex;

  group('back handling', () {
    testWidgets('back on Orders, Help and Profile returns to Shop without leaving the app', (tester) async {
      await pumpShell(tester);
      for (final label in ['Orders', 'Help', 'Profile']) {
        await tester.tap(find.text(label));
        await tester.pump();
        expect(selectedIndex(tester), isNot(0), reason: label);

        await systemBack(tester);
        expect(selectedIndex(tester), 0, reason: 'back from $label');
        expect(exited(), isFalse, reason: label);
      }
    });

    testWidgets('back on Shop asks first, then a second press in time leaves the app', (tester) async {
      await pumpShell(tester);
      expect(selectedIndex(tester), 0);
      await systemBack(tester);
      expect(exited(), isFalse);
      expect(find.text(CustomerShell.exitHint), findsOneWidget);
      await systemBack(tester);
      expect(exited(), isTrue);
    });

    testWidgets('a second press after the window only asks again', (tester) async {
      await pumpShell(tester);
      await systemBack(tester);
      await tester.pump(CustomerShell.exitWindow + const Duration(milliseconds: 100));
      await systemBack(tester);
      expect(exited(), isFalse);
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('a tab that is not Shop is left with one back press, then Shop exits', (tester) async {
      await pumpShell(tester, initialTab: 3);
      expect(selectedIndex(tester), 3);
      await systemBack(tester);
      expect(selectedIndex(tester), 0);
      expect(exited(), isFalse);
      await systemBack(tester);
      expect(exited(), isFalse, reason: 'Shop asks first');
      await systemBack(tester);
      expect(exited(), isTrue);
    });

    testWidgets('canPop is computed from the selected tab, so predictive back stays correct', (tester) async {
      await pumpShell(tester);
      PopScope scope() => tester.widget<PopScope>(find
          .descendant(
            of: find.byType(CustomerShell),
            matching: find.byWidgetPredicate((w) => w is PopScope),
          )
          .first);

      // Shop pops only once armed by a first press (press back again to exit).
      expect(scope().canPop, isFalse);
      await tester.tap(find.text('Help'));
      await tester.pump();
      expect(scope().canPop, isFalse);
      await tester.tap(find.text('Shop'));
      await tester.pump();
      expect(scope().canPop, isFalse);
      await systemBack(tester);
      expect(scope().canPop, isTrue);
      await tester.pump(CustomerShell.exitWindow + const Duration(milliseconds: 100));
      expect(scope().canPop, isFalse);
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('a pushed route above the shell pops normally and keeps the tab', (tester) async {
      await pumpShell(tester);
      await tester.tap(find.text('Help'));
      await tester.pump();

      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      navigator.pushNamed('/cart');
      await tester.pumpAndSettle();
      expect(find.text('cart page - open shop'), findsOneWidget);

      await systemBack(tester);
      await tester.pumpAndSettle();
      expect(find.text('cart page - open shop'), findsNothing);
      expect(selectedIndex(tester), 2, reason: 'the shell was not asked to go to Shop');
      expect(exited(), isFalse);
    });

    testWidgets('CustomerShell.openShop still returns to the Shop tab under the pushed route', (tester) async {
      await pumpShell(tester);
      await tester.tap(find.text('Profile'));
      await tester.pump();

      tester.state<NavigatorState>(find.byType(Navigator)).pushNamed('/cart');
      await tester.pumpAndSettle();
      await tester.tap(find.text('cart page - open shop'));
      await tester.pumpAndSettle();

      expect(find.text('cart page - open shop'), findsNothing);
      expect(selectedIndex(tester), 0);
    });

    testWidgets('back also works with the rail layout', (tester) async {
      await pumpShell(tester, width: 800);
      await tester.tap(find.text('Orders'));
      await tester.pump();
      await systemBack(tester);
      expect(selectedIndex(tester), 0);
    });
  });

  group('the one cart bar', () {
    const tabsWithHome = <Widget>[
      HomeScreen(),
      Center(child: Text('orders tab')),
      Center(child: Text('help tab')),
      Center(child: Text('profile tab')),
    ];

    testWidgets('exactly one bar with the shell and a real Home tab, and Home draws none', (tester) async {
      cart.add(_product('a', 540));
      await pumpShell(tester, tabs: tabsWithHome);
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.byType(CartBar), findsOneWidget);
      expect(find.text('View cart'), findsOneWidget);
      expect(find.text('1 item'), findsOneWidget);
      expect(find.byType(BottomStickyContainer), findsNothing);
      expect(find.descendant(of: find.byType(HomeScreen), matching: find.byType(CartBar)), findsNothing);
    });

    for (final width in [400.0, 800.0, 1200.0]) {
      testWidgets('one bar on every tab at $width dp, sitting above the nav', (tester) async {
        cart
          ..add(_product('a', 540))
          ..add(_product('a', 540));
        await pumpShell(tester, tabs: tabsWithHome, width: width);
        await tester.pump(const Duration(milliseconds: 500));

        for (final label in ['Shop', 'Orders', 'Help', 'Profile']) {
          await tester.tap(find.text(label));
          await tester.pump();
          expect(find.byType(CartBar), findsOneWidget, reason: label);
          expect(find.text('2 items'), findsOneWidget, reason: label);
          expect(find.text('View cart'), findsOneWidget, reason: label);
        }

        final bar = tester.getRect(find.byType(CartBar));
        if (width < 600) {
          final nav = tester.getRect(find.byKey(const ValueKey('adaptive-bottom-bar')));
          expect(bar.bottom, nav.top);
        } else {
          expect(bar.bottom, 800);
          expect(bar.left, greaterThan(80));
        }
      });
    }

    testWidgets('an empty cart shows no bar and the body keeps the full height', (tester) async {
      await pumpShell(tester);
      expect(find.byType(CartBar), findsOneWidget, reason: 'the slot exists');
      expect(find.text('View cart'), findsNothing);
      expect(tester.getSize(find.byType(CartBar)).height, 0);
    });

    testWidgets('the Shop tab carries no cart-count badge any more', (tester) async {
      cart.add(_product('a', 540));
      await pumpShell(tester);
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsNothing);
      // The old badge was a green pill holding the count.
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('adaptive-bottom-bar')),
          matching: find.text('1'),
        ),
        findsNothing,
      );
    });
  });

  group('Orders badge', () {
    Future<void> loadOrders(List<Map<String, dynamic>> list) async {
      orders = OrderProvider(request: (method, url, {body, query}) async {
        orderFetches++;
        return {'success': true, 'data': {'orders': list, 'pagination': {'total_pages': 1}}};
      });
      await orders.loadOrders();
      orderFetches = 0;
    }

    testWidgets('no dot when nothing is loaded, and the shell never fetches orders itself', (tester) async {
      await pumpShell(tester);
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsNothing);
      expect(orderFetches, 0);
    });

    testWidgets('a dot, and a spoken description, for a non-terminal order in memory', (tester) async {
      final handle = tester.ensureSemantics();
      await loadOrders([orderJson(status: 'OUT_FOR_DELIVERY', detail: false)]);
      await pumpShell(tester);
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsOneWidget);
      expect(find.bySemanticsLabel('Orders, order in progress'), findsOneWidget);
      expect(orderFetches, 0, reason: 'derived from memory, no extra fetch');
      handle.dispose();
    });

    for (final status in ['PLACED', 'PACKED', 'ITEM_UNAVAILABLE', 'CUSTOMER_UNAVAILABLE']) {
      testWidgets('$status counts as an open order', (tester) async {
        await loadOrders([orderJson(status: status, detail: false)]);
        await pumpShell(tester);
        expect(find.byKey(const ValueKey('nav-badge-dot')), findsOneWidget);
      });
    }

    for (final status in ['DELIVERED', 'CANCELLED', 'FAILED']) {
      testWidgets('$status is finished: no dot', (tester) async {
        await loadOrders([orderJson(status: status, detail: false)]);
        await pumpShell(tester);
        expect(find.byKey(const ValueKey('nav-badge-dot')), findsNothing);
      });
    }

    testWidgets('the dot appears when an open order arrives and goes when it finishes', (tester) async {
      await pumpShell(tester);
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsNothing);

      var status = 'PLACED';
      orders = OrderProvider(request: (method, url, {body, query}) async {
        return {
          'success': true,
          'data': {
            'orders': [orderJson(status: status, detail: false)],
            'pagination': {'total_pages': 1},
          },
        };
      });
      // Same provider instance the shell already listens to.
      await tester.pumpWidget(app(tabs: stubTabs));
      await orders.loadOrders();
      await tester.pump();
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsOneWidget);

      status = 'DELIVERED';
      await orders.loadOrders();
      await tester.pump();
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsNothing);
    });
  });

  group('system insets (gesture bar, cutout)', () {
    // A tall list whose last row must stay reachable above the cart bar and
    // the bottom inset.
    final listTabs = <Widget>[
      ListView(
        children: [
          for (var i = 0; i < 40; i++) SizedBox(height: 60, child: Text('row $i')),
        ],
      ),
      const Center(child: Text('orders tab')),
      const Center(child: Text('help tab')),
      const Center(child: Text('profile tab')),
    ];
    const inset = EdgeInsets.only(bottom: 24, right: 24);

    for (final width in [800.0, 1200.0]) {
      testWidgets('at $width dp the cart bar and the last row sit above the bottom inset', (tester) async {
        cart.add(_product('a', 540));
        await pumpShell(tester, tabs: listTabs, width: width, padding: inset);
        await tester.pump(const Duration(milliseconds: 500));

        final bar = tester.getRect(find.byType(CartBar));
        expect(bar.bottom, lessThanOrEqualTo(800 - 24));
        expect(bar.right, lessThanOrEqualTo(width - 24));

        await tester.drag(find.byType(ListView), const Offset(0, -5000));
        await tester.pumpAndSettle();
        final last = tester.getRect(find.text('row 39'));
        expect(last.bottom, lessThanOrEqualTo(bar.top), reason: 'not under the cart bar');
        expect(last.bottom, lessThanOrEqualTo(800 - 24));
      });

      testWidgets('at $width dp with an empty cart the last row still clears the inset', (tester) async {
        await pumpShell(tester, tabs: listTabs, width: width, padding: inset);
        await tester.drag(find.byType(ListView), const Offset(0, -5000));
        await tester.pumpAndSettle();
        expect(tester.getRect(find.text('row 39')).bottom, lessThanOrEqualTo(800 - 24));
      });
    }

    testWidgets('compact still puts the bar above the inset exactly once', (tester) async {
      cart.add(_product('a', 540));
      await pumpShell(tester, tabs: listTabs, padding: inset);
      await tester.pump(const Duration(milliseconds: 500));
      final nav = tester.getRect(find.byKey(const ValueKey('adaptive-bottom-bar')));
      expect(nav.bottom, 800 - 24);
      expect(nav.height, 64);
      expect(tester.getRect(find.byType(CartBar)).bottom, nav.top);
    });
  });
}
