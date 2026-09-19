import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/app_theme.dart';

/// The customer app must ask the backend again at the moments a customer
/// would expect current data: pulling Home down, coming back to the Shop
/// tab, and bringing the app back to the foreground. Before the fix none
/// of these fetched anything, so Admin edits never showed up.

class _Backend {
  double price = 540;
  final Map<String, int> calls = {};

  int productCalls() => calls['/catalog/products'] ?? 0;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    calls[url] = (calls[url] ?? 0) + 1;
    if (url == '/catalog/categories') {
      return {
        'success': true,
        'data': {
          'categories': [
            {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'description': null, 'image_url': null, 'display_order': 1},
          ],
        },
      };
    }
    if (url == '/promotions') {
      return {'success': true, 'data': {'promotions': []}};
    }
    if (url == '/catalog/products') {
      return {
        'success': true,
        'data': {
          'products': [
            {
              'id': 'b1', 'category_id': 'c1', 'category_name': 'Dairy & Eggs',
              'name': 'Kotmale Fresh Milk 1L', 'slug': 'kotmale-fresh-milk-1l',
              'description': null, 'sku': 'SKU-DAI-001', 'barcode': null,
              'unit': '1 L', 'pack_size': null, 'image_url': null,
              'selling_price': price, 'is_available': true,
            },
          ],
          'pagination': {'page': 1, 'limit': 100, 'total': 1, 'total_pages': 1},
        },
      };
    }
    throw StateError('unexpected $url');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  late _Backend backend;
  late ProductProvider products;
  late DateTime now;

  setUp(() {
    backend = _Backend();
    now = DateTime(2026, 9, 18, 16);
    products = ProductProvider(request: backend.call, clock: () => now);
  });

  Widget withProviders(Widget child) => MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: products),
          ChangeNotifierProvider(create: (_) => CartProvider()),
          ChangeNotifierProvider(create: (_) => AddressProvider()),
          ChangeNotifierProvider(create: (_) => AuthProvider()),
        ],
        child: MaterialApp(theme: AppTheme.appTHeme, home: child),
      );

  testWidgets('pulling Home down fetches the current catalog', (tester) async {
    tester.view.physicalSize = const Size(430, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(withProviders(const HomeScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('540'), findsWidgets);

    backend.price = 750; // Admin saves a new price
    await tester.fling(find.byType(CustomScrollView), const Offset(0, 400), 1200);
    await tester.pumpAndSettle();

    expect(find.textContaining('750'), findsWidgets);
    expect(find.textContaining('540'), findsNothing);
  });

  group('CustomerShell', () {
    Future<void> pumpShell(WidgetTester tester) async {
      await products.loadProducts(categorySlug: 'dairy-eggs');
      await tester.pumpWidget(withProviders(
        const CustomerShell(tabs: [
          Text('shop tab'),
          Text('orders tab'),
          Text('help tab'),
          Text('profile tab'),
        ]),
      ));
      await tester.pump();
    }

    testWidgets('does not refetch just by being built', (tester) async {
      await pumpShell(tester);
      expect(backend.productCalls(), 1);
    });

    testWidgets('refreshes when the app returns to the foreground', (tester) async {
      await pumpShell(tester);
      backend.price = 750;

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(backend.productCalls(), 2);
      expect(products.productsFor('dairy-eggs').single.sellingPrice, 750);
    });

    testWidgets('refreshes when the customer comes back to the Shop tab', (tester) async {
      await pumpShell(tester);
      backend.price = 750;

      await tester.tap(find.text('Orders'));
      await tester.pump();
      expect(backend.productCalls(), 1, reason: 'leaving Shop fetches nothing');

      await tester.tap(find.text('Shop'));
      await tester.pump();

      expect(backend.productCalls(), 2);
      expect(products.productsFor('dairy-eggs').single.sellingPrice, 750);
    });
  });
}
