import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/app_theme.dart';

/// A loading screen must run ONE skeleton ticker, however many placeholder
/// blocks it shows (the audit counted about 80 on a loading Home).

class _NoAddresses extends AddressProvider {
  @override
  List<AddressModel> get addresses => const [];

  @override
  Future<void> loadAddresses() async {}
}

/// Every catalog call waits on a completer the test controls.
class _Gate {
  final categories = Completer<dynamic>();
  final groups = Completer<dynamic>();
  final products = Completer<dynamic>();
  final search = Completer<dynamic>();
  final detail = Completer<dynamic>();

  Future<dynamic> call(String url, Map<String, dynamic> query) {
    if (url == '/catalog/categories') return categories.future;
    if (url == '/catalog/home-groups') return groups.future;
    if (url == '/promotions') {
      return Future.value({
        'success': true,
        'data': {'promotions': <dynamic>[]},
      });
    }
    if (url.startsWith('/catalog/products/')) return detail.future;
    if (query.containsKey('search')) return search.future;
    return products.future;
  }
}

Map<String, dynamic> _categories() => {
      'success': true,
      'data': {
        'categories': [
          for (final i in [1, 2])
            {'id': 'c$i', 'name': 'Category $i', 'slug': 'cat-$i', 'description': null, 'image_url': null, 'display_order': i},
        ],
      },
    };

Map<String, dynamic> _groups() => {
      'success': true,
      'data': {
        'groups': [
          {
            'id': 'g1',
            'name': 'Grocery & Kitchen',
            'sort_order': 0,
            'categories': [
              for (final i in [1, 2])
                {'id': 'c$i', 'name': 'Category $i', 'slug': 'cat-$i', 'description': null, 'image_url': null, 'display_order': i},
            ],
          },
        ],
      },
    };

Map<String, dynamic> _products() => {
      'success': true,
      'data': {
        'products': [
          {
            'id': 'p1',
            'category_id': 'c1',
            'category_name': 'Category 1',
            'name': 'Kotmale Fresh Milk 1L',
            'slug': 'milk',
            'description': null,
            'sku': 'SKU-1',
            'barcode': null,
            'unit': '1 L',
            'pack_size': null,
            'image_url': null,
            'selling_price': 540,
            'is_available': true,
          },
        ],
        'pagination': {'page': 1, 'limit': 100, 'total': 1, 'total_pages': 1},
      },
    };

Future<void> _pump(
  WidgetTester tester,
  _Gate gate,
  Widget home, {
  bool disableAnimations = false,
  Size size = const Size(400, 900),
}) async {
  FlutterSecureStorage.setMockInitialValues({});
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ProductProvider(request: gate.call)),
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider<AddressProvider>(create: (_) => _NoAddresses()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => OrderProvider()),
      ],
      child: MaterialApp(
        theme: AppTheme.theme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: disableAnimations),
          child: child!,
        ),
        home: home,
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

int _tickers(WidgetTester tester) => tester.binding.transientCallbackCount;

void main() {
  group('SkeletonScope.active', () {
    Widget scope(WidgetTester tester, {required bool active}) => MaterialApp(
          home: SkeletonScope(active: active, child: const AppSkeleton(width: 40, height: 12)),
        );

    testWidgets('inactive parks the pulse (no ticker, fully opaque); switching on and off toggles it', (tester) async {
      await tester.pumpWidget(scope(tester, active: false));
      await tester.pump(const Duration(milliseconds: 200));
      expect(_tickers(tester), 0);
      expect(tester.widget<FadeTransition>(find.byType(FadeTransition).last).opacity.value, 1.0);

      await tester.pumpWidget(scope(tester, active: true));
      await tester.pump(const Duration(milliseconds: 100));
      expect(_tickers(tester), 1);

      await tester.pumpWidget(scope(tester, active: false));
      await tester.pump(const Duration(milliseconds: 100));
      expect(_tickers(tester), 0);
    });
  });

  group('Home', () {
    testWidgets('category group tiles: one ticker while they load, none once loaded', (tester) async {
      final gate = _Gate();
      await _pump(tester, gate, const HomeScreen());
      // Home's entrance (motion M3) is a one-shot ticker that is over in
      // 810 ms. Let it finish before taking the baseline, otherwise it is
      // counted as "everything else that ticks" and the final assertion
      // sees one fewer than it expects once it has stopped.
      await tester.pump(const Duration(milliseconds: 900));
      final idle = _tickers(tester) - 1; // everything else on Home that ticks

      // Groups loading: two rows of rounded tile skeletons, one shared pulse.
      expect(find.byType(CategoryTileSkeleton).evaluate().length, greaterThan(2));
      expect(_tickers(tester), idle + 1, reason: 'every visible tile skeleton must share one pulse');

      // The flat category list (the search hint) arriving changes nothing.
      gate.categories.complete(_categories());
      await tester.pump();
      await tester.pump();
      expect(find.byType(CategoryTileSkeleton), findsWidgets);

      // Everything loaded: the pulse is parked, so the screen can settle.
      gate.groups.complete(_groups());
      await tester.pump();
      await tester.pump();
      await tester.pumpAndSettle();
      expect(find.byType(CategoryTileSkeleton), findsNothing);
      expect(find.text('Category 1'), findsOneWidget);
      expect(_tickers(tester), idle);
    });

    testWidgets('reduced motion: a loading Home runs no skeleton ticker at all', (tester) async {
      final gate = _Gate();
      await _pump(tester, gate, const HomeScreen(), disableAnimations: true);
      final idle = _tickers(tester);
      for (var i = 0; i < 4; i++) {
        await tester.pump();
      }
      expect(find.byType(CategoryTileSkeleton).evaluate().length, greaterThan(2));
      expect(_tickers(tester), idle);
    });

    testWidgets('the scope stays mounted while loading toggles, so the scroll position survives', (tester) async {
      final gate = _Gate();
      await _pump(tester, gate, const HomeScreen());
      final scope = find.byType(SkeletonScope);
      expect(scope, findsOneWidget);
      final before = tester.state(scope);
      gate.categories.complete(_categories());
      await tester.pump();
      await tester.pump();
      gate.groups.complete(_groups());
      await tester.pump();
      await tester.pump();
      expect(tester.state(find.byType(SkeletonScope)), same(before));
    });
  });

  group('Search', () {
    testWidgets('a grid of product skeletons runs one extra ticker, not one each', (tester) async {
      final gate = _Gate();
      await _pump(tester, gate, const SearchScreen());
      final before = _tickers(tester);

      await tester.enterText(find.byType(TextField), 'milk');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump();

      expect(find.byType(ProductCardSkeleton).evaluate().length, greaterThan(2));
      expect(_tickers(tester), before + 1);

      gate.search.complete(_products());
      await tester.pump();
      await tester.pump();
      await tester.pumpAndSettle();
      expect(find.byType(ProductCardSkeleton), findsNothing);
      // The skeleton pulse is parked (the text cursor may or may not blink).
      expect(_tickers(tester), lessThanOrEqualTo(before));
    });
  });

  group('Categories and product details', () {
    testWidgets('twelve category tiles share one ticker', (tester) async {
      final gate = _Gate();
      await _pump(tester, gate, const CategoriesScreen());
      expect(find.byType(CategoryTileSkeleton), findsWidgets);
      expect(_tickers(tester), 1);
    });

    testWidgets('the product-details skeleton runs one ticker for all its blocks', (tester) async {
      final gate = _Gate();
      await _pump(tester, gate, const ProductDetailsScreen(productId: 'p1'));
      expect(find.byType(AppSkeleton).evaluate().length, greaterThan(4));
      expect(_tickers(tester), 1);
    });
  });
}
