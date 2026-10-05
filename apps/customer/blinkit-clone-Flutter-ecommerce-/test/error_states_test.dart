import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Screens/user_address_screen.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_screen_payment_container.dart';
import 'package:ecom/UI/Widgets/Organisms/home_category_groups.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/main.dart' show rootScaffoldMessengerKey;

import 'fixtures/order_fixtures.dart';
import 'fixtures/session_fakes.dart';

/// Every list and detail screen that can fail must say so in customer words,
/// offer "Try again", and that button must ask the provider again.

const _scales = <double>[1.0, 2.0];

const _offline = 'NETWORK_ERROR';
final _serverCopy = AppErrors.server.message;

Map<String, dynamic> _product(String id, String name) => {
      'id': id,
      'category_id': 'c1',
      'category_name': 'Dairy & Eggs',
      'name': name,
      'slug': id,
      'sku': 'SKU-$id',
      'unit': '1 L',
      'selling_price': 540,
      'is_available': true,
    };

Map<String, dynamic> _productsResponse() => {
      'success': true,
      'data': {
        'products': [_product('b1', 'Kotmale Fresh Milk 1L')],
        'pagination': {'page': 1, 'limit': 100, 'total': 1, 'total_pages': 1},
      },
    };

Map<String, dynamic> _categoriesResponse() => {
      'success': true,
      'data': {
        'categories': [
          {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'description': null, 'image_url': null, 'display_order': 1},
        ],
      },
    };

Map<String, dynamic> _groupsResponse() => {
      'success': true,
      'data': {
        'groups': [
          {
            'id': 'g1',
            'name': 'Grocery & Kitchen',
            'sort_order': 0,
            'categories': [
              {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'description': null, 'image_url': null, 'display_order': 1},
            ],
          },
        ],
      },
    };

/// A scriptable catalog backend: [failProducts] / [failCategories] /
/// [failGroups] make those endpoints throw; every call is counted.
class _Catalog {
  ApiException? failProducts;
  ApiException? failCategories;
  ApiException? failGroups;
  Completer<void>? holdProducts;
  final Map<String, int> calls = {};

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    calls[url] = (calls[url] ?? 0) + 1;
    if (url == '/catalog/categories') {
      if (failCategories != null) throw failCategories!;
      return _categoriesResponse();
    }
    if (url == '/catalog/home-groups') {
      if (failGroups != null) throw failGroups!;
      return _groupsResponse();
    }
    if (url == '/promotions') return {'success': true, 'data': {'promotions': []}};
    if (url == '/catalog/products') {
      if (holdProducts != null) await holdProducts!.future;
      if (failProducts != null) throw failProducts!;
      return _productsResponse();
    }
    throw StateError('unexpected $url');
  }
}

Widget _app(
  WidgetTester tester, {
  required Widget home,
  required List<ChangeNotifierProvider> providers,
  double scale = 1.0,
  Size size = const Size(400, 860),
}) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  return MultiProvider(
    providers: providers,
    child: MaterialApp(
      theme: AppTheme.appTHeme,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: home,
    ),
  );
}

List<ChangeNotifierProvider> _shopProviders(ProductProvider products) => [
      ChangeNotifierProvider<ProductProvider>.value(value: products),
      ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
      ChangeNotifierProvider<AddressProvider>(create: (_) => AddressProvider(request: _neverAddresses)),
      ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
      ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
    ];

Future<dynamic> _neverAddresses({String? methodType, String? url, dynamic body}) async => {
      'data': {'addresses': []},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('Products screen', () {
    for (final scale in _scales) {
      testWidgets('a failed load shows the mapped copy and a retry that asks again (text scale $scale)', (tester) async {
        final catalog = _Catalog()..failProducts = ApiException(500, 'relation "products" does not exist');
        final products = ProductProvider(request: catalog.call);
        await tester.pumpWidget(_app(
          tester,
          home: const ProductsScreen(categorySlug: 'dairy-eggs'),
          providers: _shopProviders(products),
          scale: scale,
        ));
        await tester.pumpAndSettle();

        expect(find.text(_serverCopy), findsOneWidget);
        expect(find.textContaining('relation'), findsNothing);
        expect(find.text('Something went wrong loading products.'), findsNothing, reason: 'the old grey sentence is gone');
        expect(tester.takeException(), isNull);

        final retry = find.byKey(const Key('products-retry'));
        expect(retry, findsOneWidget);
        await tester.ensureVisible(retry);
        final before = catalog.calls['/catalog/products']!;
        catalog.failProducts = null;
        await tester.tap(retry);
        await tester.pumpAndSettle();

        expect(catalog.calls['/catalog/products'], before + 1);
        expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
        expect(find.byKey(const Key('products-retry')), findsNothing);
      });
    }

    testWidgets('no connection shows the offline state, not a server message', (tester) async {
      final catalog = _Catalog()..failProducts = ApiException(503, 'x', code: _offline);
      final products = ProductProvider(request: catalog.call);
      await tester.pumpWidget(_app(
        tester,
        home: const ProductsScreen(categorySlug: 'dairy-eggs'),
        providers: _shopProviders(products),
      ));
      await tester.pumpAndSettle();

      expect(find.text("You're offline"), findsOneWidget);
      expect(find.byKey(const Key('products-retry')), findsOneWidget);
    });

    testWidgets('loading shows skeleton cards, not a bare spinner', (tester) async {
      final catalog = _Catalog()..holdProducts = Completer<void>();
      final products = ProductProvider(request: catalog.call);
      await tester.pumpWidget(_app(
        tester,
        home: const ProductsScreen(categorySlug: 'dairy-eggs'),
        providers: _shopProviders(products),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.byType(ProductCardSkeleton), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      catalog.holdProducts!.complete();
      await tester.pumpAndSettle();
      expect(find.byType(ProductCardSkeleton), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    });

    testWidgets('a failure in the active category does not show over another category with data', (tester) async {
      final catalog = _Catalog();
      final products = ProductProvider(request: catalog.call);
      await products.loadProducts(categorySlug: 'dairy-eggs');
      catalog.failProducts = ApiException(500, 'x');
      await products.loadProducts(categorySlug: 'snacks');
      expect(products.productsFailureFor('snacks'), isNotNull);

      catalog.failProducts = null;
      await tester.pumpWidget(_app(
        tester,
        home: const ProductsScreen(categorySlug: 'dairy-eggs'),
        providers: _shopProviders(products),
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('products-retry')), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    });
  });

  group('Home', () {
    for (final scale in _scales) {
      testWidgets('the category groups show an error with "Try again" that reloads (text scale $scale)', (tester) async {
        final catalog = _Catalog()..failGroups = ApiException(500, 'boom');
        final products = ProductProvider(request: catalog.call);
        await tester.pumpWidget(_app(
          tester,
          home: const HomeScreen(),
          providers: _shopProviders(products),
          scale: scale,
        ));
        await tester.pumpAndSettle();

        final retry = find.byKey(HomeCategoryGroups.retryKey);
        // Home's composition is tall enough at 2.0x that the state really is
        // below the fold (past the sliver cache), so scroll it into view.
        await tester.scrollUntilVisible(retry, 200, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();

        expect(find.text(HomeCategoryGroups.failureTitle), findsOneWidget);
        expect(find.textContaining("Pull down to retry"), findsNothing, reason: 'the old grey sentence is gone');
        expect(tester.takeException(), isNull);
        expect(retry, findsOneWidget);
        expect(find.descendant(of: retry, matching: find.text('Try again')), findsOneWidget);

        final before = catalog.calls['/catalog/home-groups']!;
        catalog.failGroups = null;
        await tester.tap(retry);
        await tester.pumpAndSettle();

        expect(catalog.calls['/catalog/home-groups'], before + 1);
        expect(find.text(HomeCategoryGroups.failureTitle), findsNothing);
        expect(find.text('Dairy & Eggs'), findsWidgets);
      });
    }

    testWidgets('an empty answer (a successful empty list) shows no error and no section', (tester) async {
      final products = ProductProvider(request: (url, query) async {
        if (url == '/catalog/categories') return _categoriesResponse();
        if (url == '/catalog/home-groups') return {'data': {'groups': []}};
        if (url == '/promotions') return {'data': {'promotions': []}};
        throw StateError('unexpected $url');
      });
      await tester.pumpWidget(_app(tester, home: const HomeScreen(), providers: _shopProviders(products)));
      await tester.pumpAndSettle();

      expect(find.byKey(HomeCategoryGroups.retryKey), findsNothing);
      expect(find.text(HomeCategoryGroups.failureTitle), findsNothing);
    });
  });

  group('Categories and Search', () {
    testWidgets('categories: an error with Try again that reloads', (tester) async {
      final catalog = _Catalog()..failCategories = ApiException(500, 'boom');
      final products = ProductProvider(request: catalog.call);
      await tester.pumpWidget(_app(tester, home: const CategoriesScreen(), providers: _shopProviders(products)));
      await tester.pumpAndSettle();

      expect(find.text("We couldn't load categories"), findsOneWidget);
      expect(find.text(_serverCopy), findsOneWidget);
      catalog.failCategories = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Dairy & Eggs'), findsWidgets);
    });

    testWidgets('search: offline shows the offline state with a retry', (tester) async {
      var offline = true;
      final products = ProductProvider(request: (url, query) async {
        if (url == '/catalog/categories') return _categoriesResponse();
        if (offline) throw ApiException(503, 'x', code: _offline);
        return _productsResponse();
      });
      await tester.pumpWidget(_app(tester, home: const SearchScreen(), providers: _shopProviders(products)));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'milk');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();

      expect(find.text("You're offline"), findsOneWidget);
      offline = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    });
  });

  group('Orders list', () {
    Widget ordersApp(WidgetTester tester, OrderProvider orders, {double scale = 1.0}) => _app(
          tester,
          home: const OrdersScreen(),
          scale: scale,
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
            ChangeNotifierProvider<OrderProvider>.value(value: orders),
          ],
        );

    for (final scale in _scales) {
      testWidgets('a failed load shows mapped copy and orders-retry reloads (text scale $scale)', (tester) async {
        var fail = true;
        var calls = 0;
        final orders = OrderProvider(request: (method, url, {body, query}) async {
          calls++;
          if (fail) throw ApiException(500, 'select * from orders');
          return {
            'data': {
              'orders': [orderJson(detail: false)],
              'pagination': {'total_pages': 1},
            },
          };
        });
        await tester.pumpWidget(ordersApp(tester, orders, scale: scale));
        await tester.pumpAndSettle();

        expect(find.text("Couldn't load your orders."), findsOneWidget);
        expect(find.text(_serverCopy), findsOneWidget);
        expect(find.textContaining('select *'), findsNothing);
        expect(tester.takeException(), isNull);

        final retry = find.byKey(const Key('orders-retry'));
        expect(retry, findsOneWidget);
        await tester.ensureVisible(retry);
        final before = calls;
        fail = false;
        await tester.tap(retry);
        await tester.pumpAndSettle();

        expect(calls, before + 1);
        expect(find.byKey(const Key('orders-retry')), findsNothing);
        expect(find.text('BL-20260919-4821'), findsOneWidget);
      });
    }

    testWidgets('offline shows the offline state, still with orders-retry', (tester) async {
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        throw ApiException(503, 'x', code: _offline);
      });
      await tester.pumpWidget(ordersApp(tester, orders));
      await tester.pumpAndSettle();

      expect(find.text("You're offline"), findsOneWidget);
      expect(find.byKey(const Key('orders-retry')), findsOneWidget);
    });

    testWidgets('loading says what is loading', (tester) async {
      final handle = tester.ensureSemantics();
      final gate = Completer<void>();
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        await gate.future;
        return {'data': {'orders': [], 'pagination': {'total_pages': 1}}};
      });
      await tester.pumpWidget(ordersApp(tester, orders));
      await tester.pump();
      await tester.pump();
      // W9: the list now loads with skeleton rows instead of a centred
      // spinner labelled in visible text, so the announcement is asserted
      // where it actually has to arrive. This is the stronger form of the
      // same intent: `find.text` only proved a string was painted, this
      // proves an assistive technology receives it.
      expect(find.bySemanticsLabel('Loading your orders'), findsOneWidget);
      expect(find.byType(ListRowSkeleton), findsWidgets);
      gate.complete();
      await tester.pumpAndSettle();
      expect(find.text("You haven't placed any orders yet."), findsOneWidget);
      handle.dispose();
    });
  });

  group('Order detail', () {
    Widget detailApp(WidgetTester tester, OrderProvider orders, {double scale = 1.0}) => _app(
          tester,
          home: const OrderSummaryScreen(orderId: 'o1'),
          scale: scale,
          providers: [ChangeNotifierProvider<OrderProvider>.value(value: orders)],
        );

    for (final scale in _scales) {
      testWidgets('a failed load shows mapped copy and order-retry reloads (text scale $scale)', (tester) async {
        var fail = true;
        var calls = 0;
        final orders = OrderProvider(request: (method, url, {body, query}) async {
          calls++;
          if (fail) throw ApiException(500, 'stack trace at line 4');
          return {'data': {'order': orderJson(canCancel: false)}};
        });
        await tester.pumpWidget(detailApp(tester, orders, scale: scale));
        await tester.pumpAndSettle();

        expect(find.text("Couldn't load this order."), findsOneWidget);
        expect(find.text(_serverCopy), findsOneWidget);
        expect(find.textContaining('stack trace'), findsNothing);
        expect(tester.takeException(), isNull);

        final retry = find.byKey(const Key('order-retry'));
        await tester.ensureVisible(retry);
        final before = calls;
        fail = false;
        await tester.tap(retry);
        await tester.pumpAndSettle();
        expect(calls, before + 1);
        expect(find.text('BL-20260919-4821'), findsWidgets);
      });
    }

    testWidgets('a 404 is a final not-found with no retry', (tester) async {
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        throw ApiException(404, 'Order not found.', code: 'ORDER_NOT_FOUND');
      });
      await tester.pumpWidget(detailApp(tester, orders));
      await tester.pumpAndSettle();
      expect(find.text('This order could not be found.'), findsOneWidget);
      expect(find.byKey(const Key('order-retry')), findsNothing);
    });
  });

  group('Address list', () {
    Widget addressApp(WidgetTester tester, AddressProvider addresses, {double scale = 1.0}) => _app(
          tester,
          home: const UserAddressScreen(),
          scale: scale,
          providers: [ChangeNotifierProvider<AddressProvider>.value(value: addresses)],
        );

    for (final scale in _scales) {
      testWidgets('a failed load shows an error with Try again that reloads (text scale $scale)', (tester) async {
        var fail = true;
        var calls = 0;
        final addresses = AddressProvider(request: ({methodType, url, body}) async {
          calls++;
          if (fail) throw ApiException(500, 'pg: connection terminated');
          return {'data': {'addresses': []}};
        });
        await tester.pumpWidget(addressApp(tester, addresses, scale: scale));
        await tester.pumpAndSettle();

        expect(find.text("We couldn't load your addresses"), findsOneWidget);
        expect(find.text(_serverCopy), findsOneWidget);
        expect(find.textContaining('Pull to refresh'), findsNothing, reason: 'the old grey sentence is gone');
        expect(find.textContaining('pg:'), findsNothing);
        expect(tester.takeException(), isNull);

        final retry = find.byKey(const Key('addresses-retry'));
        expect(retry, findsOneWidget);
        await tester.ensureVisible(retry);
        final before = calls;
        fail = false;
        await tester.tap(retry);
        await tester.pumpAndSettle();
        expect(calls, before + 1);
        expect(find.text('No saved addresses yet.'), findsOneWidget);
      });
    }

    testWidgets('a guest (401) is asked to log in instead of being offered a retry that cannot work', (tester) async {
      final addresses = AddressProvider(request: ({methodType, url, body}) async {
        throw ApiException(401, 'Missing or empty Bearer token.', code: 'UNAUTHORIZED');
      });
      await tester.pumpWidget(addressApp(tester, addresses));
      await tester.pumpAndSettle();

      expect(find.text('Log in to continue.'), findsOneWidget);
      expect(find.text('Log in'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });
  });

  group('Place order failure toast', () {
    test('a timeout says we could not confirm, and points at Orders', () {
      expect(
        placeOrderFailureMessage(AppErrors.timeout),
        "We couldn't confirm your order. Check Orders before trying again.",
      );
    });

    test('other failures use the mapped copy', () {
      expect(placeOrderFailureMessage(AppErrors.offline), AppErrors.offline.message);
      expect(placeOrderFailureMessage(AppErrors.server), AppErrors.server.message);
      expect(
        placeOrderFailureMessage(AppErrors.from(ApiException(422, 'x', code: 'DELIVERY_OUTSIDE_RADIUS'))),
        "We don't deliver to this address yet. Choose another address.",
      );
    });

    Future<void> placeWith(WidgetTester tester, Object error) async {
      final addresses = AddressProvider(request: ({methodType, url, body}) async => {
            'data': {
              'addresses': [
                {
                  'id': 'a1',
                  'label': 'Home',
                  'recipient_name': 'Jane',
                  'recipient_phone': '+94771234567',
                  'address_line1': '12 Galle Road',
                  'city': 'Dharga Town',
                  'latitude': 6.43,
                  'longitude': 80.03,
                  'is_default': true,
                },
              ],
            },
          });
      await addresses.loadAddresses();
      final cart = CartProvider()..add(ProductModel.fromJson(_product('b1', 'Kotmale Fresh Milk 1L')));
      final orders = OrderProvider(request: (method, url, {body, query}) async => throw error);
      await tester.pumpWidget(_app(
        tester,
        // Wide: the test font (every glyph a square) is far wider than the real
        // one, and this bar's layout is not what is under test.
        size: const Size(900, 860),
        home: const Scaffold(body: Align(alignment: Alignment.bottomCenter, child: CartScreenPaymentContainer())),
        providers: [
          ChangeNotifierProvider<AddressProvider>.value(value: addresses),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<OrderProvider>.value(value: orders),
        ],
      ));
      await tester.tap(find.text('Place order'));
      await tester.pumpAndSettle();
    }

    testWidgets('a timed-out order shows the "check Orders" toast', (tester) async {
      await placeWith(tester, ApiException(408, 'x', code: 'TIMEOUT'));
      expect(find.text("We couldn't confirm your order. Check Orders before trying again."), findsOneWidget);
    });

    testWidgets('a server failure shows the mapped copy, not the backend text', (tester) async {
      await placeWith(tester, ApiException(500, 'insert or update on table violates foreign key'));
      expect(find.text(_serverCopy), findsOneWidget);
      expect(find.textContaining('foreign key'), findsNothing);
    });
  });

  test('AppStateView.error keeps working as the base of every state above', () {
    const view = AppStateView.error(title: 't', onRetry: null);
    expect(view.actionLabel, isNull);
  });
}
