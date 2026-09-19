import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';

const _milkId = 'b0000001-0000-0000-0000-000000000001';

// Captured verbatim from the running backend.
// GET /api/v1/catalog/products/b0000001-0000-0000-0000-000000000001
const _realMilkDetail =
    '{"success":true,"data":{"product":{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}}}';
// GET /api/v1/catalog/categories
const _realCategories =
    '{"success":true,"data":{"categories":[{"id":"c0000001-0000-0000-0000-000000000001","name":"Dairy & Eggs","slug":"dairy-eggs","description":"Fresh milk, butter, cheese, and farm eggs","image_url":null,"display_order":1},{"id":"c0000001-0000-0000-0000-000000000002","name":"Biscuits & Snacks","slug":"biscuits-snacks","description":"Crackers, cookies, and Sri Lankan tea snacks","image_url":null,"display_order":2}]}}';
// GET /api/v1/catalog/products?category_slug=dairy-eggs&limit=100
const _realDairyProducts =
    '{"success":true,"data":{"products":[{"id":"b0000001-0000-0000-0000-000000000003","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Farm Fresh Brown Eggs (10 Pack)","slug":"farm-fresh-brown-eggs-10-pack","description":null,"sku":"SKU-EGG-003","barcode":"4792024001035","unit":"10 pcs","pack_size":"Pulp Tray","image_url":null,"selling_price":605,"is_available":true},{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true},{"id":"b0000001-0000-0000-0000-000000000002","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Pelwatte Salted Butter 200g","slug":"pelwatte-salted-butter-200g","description":null,"sku":"SKU-DAI-002","barcode":"4792024001028","unit":"200 g","pack_size":"Foil Wrap","image_url":null,"selling_price":805,"is_available":true}],"pagination":{"page":1,"limit":100,"total":3,"total_pages":1}}}';
// GET /api/v1/catalog/products?search=milk
const _realMilkSearch =
    '{"success":true,"data":{"products":[{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}],"pagination":{"page":1,"limit":40,"total":1,"total_pages":1}}}';
// GET /api/v1/catalog/products/00000000-0000-0000-0000-000000000000 -> 404
const _realNotFoundMessage = 'Product not found.';

/// The real detail payload with fields overridden - the seeded catalogue
/// has no unavailable product and no descriptions, so those states can only
/// be exercised by editing a captured response.
Map<String, dynamic> _milkDetailWith(Map<String, dynamic> overrides) {
  final json = jsonDecode(_realMilkDetail) as Map<String, dynamic>;
  (json['data']['product'] as Map<String, dynamic>).addAll(overrides);
  return json;
}

ProductModel _milkListing() => ProductModel.fromJson(
      (jsonDecode(_realMilkDetail)['data']['product'] as Map)
          .cast<String, dynamic>(),
    );

class _FakeCatalog {
  final List<String> detailCalls = [];
  Future<dynamic> Function(String id)? onDetail;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url.startsWith('/catalog/products/')) {
      final id = url.substring('/catalog/products/'.length);
      detailCalls.add(id);
      if (onDetail != null) return onDetail!(id);
      if (id == _milkId) return jsonDecode(_realMilkDetail);
      throw ApiException(404, _realNotFoundMessage, code: 'PRODUCT_NOT_FOUND');
    }
    if (url == '/catalog/categories') return jsonDecode(_realCategories);
    if (query.containsKey('search')) return jsonDecode(_realMilkSearch);
    if (query['category_slug'] == 'dairy-eggs') {
      return jsonDecode(_realDairyProducts);
    }
    return jsonDecode(_realDairyProducts);
  }
}

void main() {
  late _FakeCatalog catalog;
  late ProductProvider products;
  late CartProvider cart;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    catalog = _FakeCatalog();
    products = ProductProvider(request: catalog.call);
    cart = CartProvider();
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    required Widget home,
    Size size = const Size(400, 860),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: products),
          ChangeNotifierProvider.value(value: cart),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: home,
          onGenerateRoute: (settings) =>
              settings.name == '/product' || settings.name == '/products'
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

  // Bounded: the skeleton pulse repeats forever, so pumpAndSettle can't.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Finder cta() => find.byType(ProductDetailsScreen);

  group('loading real data', () {
    testWidgets('opened by id: skeleton, then the real product from the API',
        (tester) async {
      final pending = Completer<dynamic>();
      catalog.onDetail = (_) => pending.future;
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));

      expect(catalog.detailCalls, [_milkId]);
      expect(find.byType(AppSkeleton), findsWidgets);
      expect(find.text('Kotmale Fresh Milk 1L'), findsNothing);
      expect(find.text('Add to Cart'), findsNothing);

      pending.complete(jsonDecode(_realMilkDetail));
      await settle(tester);

      expect(find.byType(AppSkeleton), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.text('1 L · Tetra Pack'), findsOneWidget);
      expect(find.text('DAIRY & EGGS'), findsOneWidget);
      // Once in the summary, once in the pinned phone CTA bar.
      expect(find.text('Rs. 540'), findsNWidgets(2));
      expect(find.text('Add to Cart'), findsOneWidget);
    });

    testWidgets('opened from a card: renders instantly and refreshes by id',
        (tester) async {
      final pending = Completer<dynamic>();
      catalog.onDetail = (_) => pending.future;
      await pumpApp(
        tester,
        home: ProductDetailsScreen(
          productId: _milkId,
          initialProduct: _milkListing(),
        ),
      );

      expect(find.byType(AppSkeleton), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(catalog.detailCalls, [_milkId]);

      // The fresh backend copy wins (here: a changed selling price).
      pending.complete(_milkDetailWith({'selling_price': 560}));
      await settle(tester);
      expect(find.text('Rs. 560'), findsNWidgets(2));
      expect(find.text('Rs. 540'), findsNothing);
    });

    testWidgets('omits the description block when the backend has none',
        (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      expect(find.text('About this product'), findsNothing);
      expect(find.text('Product details'), findsOneWidget);
      expect(find.text('Tetra Pack'), findsOneWidget);
    });

    testWidgets('shows the real description when present', (tester) async {
      catalog.onDetail = (_) async =>
          _milkDetailWith({'description': 'Pasteurised full cream milk.'});
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      expect(find.text('About this product'), findsOneWidget);
      expect(find.text('Pasteurised full cream milk.'), findsOneWidget);
    });

    testWidgets('never shows invented commerce data', (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      for (final fake in ['MRP', 'OFF', 'Save', 'rating', 'review', 'left']) {
        expect(find.textContaining(RegExp(fake, caseSensitive: false)),
            findsNothing,
            reason: '"$fake" is not in the backend product');
      }
      expect(find.byIcon(Icons.favorite_border), findsNothing);
      expect(find.byIcon(Icons.star), findsNothing);
    });
  });

  group('failure states', () {
    testWidgets('network failure: friendly error, Try Again recovers',
        (tester) async {
      catalog.onDetail = (_) async =>
          throw ApiException(500, 'connect ECONNREFUSED 127.0.0.1:5432');
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      expect(find.text("Couldn't load this product"), findsOneWidget);
      expect(find.textContaining('ECONNREFUSED'), findsNothing);
      expect(find.textContaining('500'), findsNothing);
      expect(find.text('Add to Cart'), findsNothing);

      catalog.onDetail = null;
      await tester.tap(find.text('Try Again'));
      await settle(tester);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(catalog.detailCalls, hasLength(2));
    });

    testWidgets('404 hides the product even when opened from a stale card',
        (tester) async {
      catalog.onDetail = (_) async => throw ApiException(
          404, _realNotFoundMessage, code: 'PRODUCT_NOT_FOUND');
      await pumpApp(
        tester,
        home: ProductDetailsScreen(
          productId: _milkId,
          initialProduct: _milkListing(),
        ),
      );
      await settle(tester);

      expect(find.text('Product no longer available'), findsOneWidget);
      expect(find.text(_realNotFoundMessage), findsNothing);
      expect(find.text('Add to Cart'), findsNothing);
    });

    testWidgets('unavailable product: labelled and cannot be added',
        (tester) async {
      catalog.onDetail = (_) async => _milkDetailWith({'is_available': false});
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      // Pill in the summary + the disabled CTA label.
      expect(find.text('Currently unavailable'), findsNWidgets(2));
      expect(find.text('Add to Cart'), findsNothing);

      await tester.tap(find.text('Currently unavailable').last);
      await tester.pump();
      expect(cart.itemCount, 0);
    });
  });

  group('cart', () {
    testWidgets('Add to Cart, +, - all go through the shared CartProvider',
        (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      await tester.tap(find.text('Add to Cart'));
      await settle(tester);
      expect(cart.quantityOf(_milkId), 1);
      expect(cart.lines.single.product.name, 'Kotmale Fresh Milk 1L');
      expect(find.text('1 in cart'), findsOneWidget);
      // Global floating cart reflects it.
      expect(find.text('1 item'), findsOneWidget);
      expect(find.text('View Cart'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(cart.quantityOf(_milkId), 2);
      expect(find.text('2 in cart'), findsOneWidget);
      expect(find.text('2 items'), findsOneWidget);
      expect(find.text('Rs. 1080'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(cart.quantityOf(_milkId), 1);

      await tester.tap(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'));
      await settle(tester);
      // Never negative: the line is removed and the CTA returns.
      expect(cart.quantityOf(_milkId), 0);
      expect(cart.isEmpty, isTrue);
      expect(find.text('Add to Cart'), findsOneWidget);
      expect(find.textContaining('in cart'), findsNothing);
    });

    testWidgets('reflects a quantity already in the cart', (tester) async {
      cart
        ..add(_milkListing())
        ..add(_milkListing())
        ..add(_milkListing());
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      expect(find.text('Add to Cart'), findsNothing);
      expect(find.text('3 in cart'), findsOneWidget);
    });

    testWidgets('View Cart on the floating bar opens the cart', (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);
      await tester.tap(find.text('Add to Cart'));
      await settle(tester);

      await tester.tap(find.text('View Cart'));
      await settle(tester);
      expect(find.text('route:/cart'), findsOneWidget);
    });
  });

  group('layout', () {
    testWidgets('desktop uses two columns with an inline CTA', (tester) async {
      await pumpApp(
        tester,
        home: const ProductDetailsScreen(productId: _milkId),
        size: const Size(1440, 900),
      );
      await settle(tester);

      final image = tester.getRect(find.byType(ProductImage));
      final title = tester.getRect(find.text('Kotmale Fresh Milk 1L'));
      expect(title.left, greaterThan(image.right),
          reason: 'info column sits beside the image');
      // Price shown once (no pinned phone bar on desktop).
      expect(find.text('Rs. 540'), findsOneWidget);
      expect(find.text('Add to Cart'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final size in const [
      Size(375, 812),
      Size(390, 844),
      Size(414, 896),
      Size(768, 1024),
      Size(1280, 720),
      Size(1920, 1080),
    ]) {
      testWidgets('renders without overflow at ${size.width}x${size.height}',
          (tester) async {
        await pumpApp(
          tester,
          home: const ProductDetailsScreen(productId: _milkId),
          size: size,
        );
        await settle(tester);
        await tester.tap(find.text('Add to Cart'));
        await settle(tester);

        expect(tester.takeException(), isNull);
        expect(find.text('1 in cart'), findsOneWidget);
        // Phones stack (image above title); wider screens sit side by side.
        final image = tester.getRect(find.byType(ProductImage));
        final title = tester.getRect(find.text('Kotmale Fresh Milk 1L'));
        if (size.width < 720) {
          expect(title.top, greaterThan(image.bottom));
        } else {
          expect(title.left, greaterThan(image.right));
          expect(image.bottom, lessThanOrEqualTo(size.height),
              reason: 'image fits the first screen');
        }
      });
    }
  });

  group('navigation', () {
    testWidgets('Search -> Product Details -> back keeps the results',
        (tester) async {
      await pumpApp(tester, home: const SearchScreen());
      await tester.enterText(find.byType(TextField), 'milk');
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      expect(find.text('1 product'), findsOneWidget);

      await tester.tap(find.text('Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(find.byType(ProductDetailsScreen), findsOneWidget);
      expect(catalog.detailCalls, [_milkId]);

      await tester.tap(find.text('Add to Cart'));
      await settle(tester);

      await tester.pageBack();
      await settle(tester);
      expect(find.byType(ProductDetailsScreen), findsNothing);
      expect(find.text('1 product'), findsOneWidget);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'milk',
      );
      // Same cart: the search result's card now shows the stepper.
      expect(find.text('ADD'), findsNothing);
      expect(find.text('1 item'), findsOneWidget);
    });

    testWidgets('Categories -> category grid -> Product Details -> back',
        (tester) async {
      await pumpApp(tester, home: const CategoriesScreen());
      await settle(tester);

      await tester.tap(find.text('Dairy & Eggs'));
      await settle(tester);
      expect(find.text('Pelwatte Salted Butter 200g'), findsOneWidget);

      await tester.tap(find.text('Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(find.byType(ProductDetailsScreen), findsOneWidget);
      expect(find.text('1 L · Tetra Pack'), findsOneWidget);

      await tester.pageBack();
      await settle(tester);
      expect(find.byType(ProductDetailsScreen), findsNothing);
      expect(find.text('Pelwatte Salted Butter 200g'), findsOneWidget);
    });

    testWidgets('/product route accepts a bare id', (tester) async {
      await pumpApp(
        tester,
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () =>
                Navigator.of(context).pushNamed('/product', arguments: _milkId),
            child: const Text('open'),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await settle(tester);

      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(cta(), findsOneWidget);
    });
  });
}
