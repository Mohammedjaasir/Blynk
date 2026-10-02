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
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/add_to_cart_button.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Atoms/product_hero.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_bar.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';
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
          // A guest: a sold-out product's "Notify me" button reads it.
          ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
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
      expect(find.text('Add to cart'), findsNothing);

      pending.complete(jsonDecode(_realMilkDetail));
      await settle(tester);

      expect(find.byType(AppSkeleton), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.text('1 L · Tetra Pack'), findsOneWidget);
      expect(find.text('Dairy & Eggs'), findsWidgets);
      expect(find.text('DAIRY & EGGS'), findsNothing, reason: 'no all-caps eyebrow');
      // W3: the price is stated ONCE, at hero size in the summary. The sticky
      // bar is the full-width "Add to cart" action and nothing else.
      expect(find.text('LKR 540'), findsOneWidget);
      expect(find.text('Add to cart'), findsOneWidget);
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
      expect(find.text('LKR 560'), findsOneWidget);
      expect(find.text('LKR 540'), findsNothing);
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

    // T2 report section 8G asked each screen task to add this line as its
    // screen landed: plan section 4.3 is "one yellow ACTION per screen", and
    // only a widget test can see what actually renders.
    testWidgets('exactly one yellow action renders, and it is flat',
        (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      final yellow = tester
          .widgetList<ElevatedButton>(find.byType(ElevatedButton))
          .where((b) =>
              b.style?.backgroundColor?.resolve(const <WidgetState>{}) ==
              BlynkCta.fill)
          .toList();
      expect(yellow, hasLength(1),
          reason: 'the sticky Add to cart, and nothing else on the page');

      // ...and nothing on the page is a gradient.
      expect(
        find.byWidgetPredicate((w) =>
            (w is DecoratedBox &&
                w.decoration is BoxDecoration &&
                (w.decoration as BoxDecoration).gradient != null) ||
            (w is Container &&
                w.decoration is BoxDecoration &&
                (w.decoration as BoxDecoration).gradient != null)),
        findsNothing,
      );
    });

    // A fill-height widget placed in Scaffold.bottomNavigationBar (ContentFrame,
    // BlynkButton.cta) takes the WHOLE screen and leaves the body zero-high -
    // and the page still builds without throwing, so every find.* silently
    // returns nothing and a suite can go green over a broken screen. Sizes are
    // the only check that catches it, so both are measured here.
    testWidgets('the sticky bar is a bar, and the body keeps the rest',
        (tester) async {
      const size = Size(400, 860);
      await pumpApp(
        tester,
        home: const ProductDetailsScreen(productId: _milkId),
        size: size,
      );
      await settle(tester);

      final bar = tester.getSize(
        find
            .ancestor(
              of: find.byType(AddToCartButton),
              matching: find.byType(DecoratedBox),
            )
            .first,
      );
      expect(bar.width, size.width);
      expect(bar.height, lessThan(140),
          reason: 'the sticky CTA bar must be bar-height, not screen-height');

      final body = tester.getSize(find.byType(ListView).first);
      expect(body.height, greaterThan(size.height / 2),
          reason: 'the scrolling body must keep the rest of the screen');
      expect(body.height + bar.height, lessThanOrEqualTo(size.height));

      // ...and the content really is laid out inside it.
      expect(tester.getSize(find.byType(ProductImageWell)).height,
          greaterThan(100));
    });

    testWidgets('the details section collapses and reopens', (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);
      expect(find.text('Tetra Pack'), findsOneWidget);

      await tester.tap(find.text('Product details'));
      await settle(tester);
      expect(find.text('Tetra Pack'), findsNothing,
          reason: 'collapsing really removes the content, it does not hide it');

      await tester.tap(find.text('Product details'));
      await settle(tester);
      expect(find.text('Tetra Pack'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('failure states', () {
    testWidgets('network failure: friendly error, Try again recovers',
        (tester) async {
      catalog.onDetail = (_) async =>
          throw ApiException(500, 'connect ECONNREFUSED 127.0.0.1:5432');
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      expect(find.text("Couldn't load this product"), findsOneWidget);
      expect(find.textContaining('ECONNREFUSED'), findsNothing);
      expect(find.textContaining('500'), findsNothing);
      expect(find.text('Add to cart'), findsNothing);

      catalog.onDetail = null;
      await tester.tap(find.text('Try again'));
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
      expect(find.text('Add to cart'), findsNothing);
    });

    testWidgets('unavailable product: labelled and cannot be added',
        (tester) async {
      catalog.onDetail = (_) async => _milkDetailWith({'is_available': false});
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      // Pill in the summary + the disabled CTA label.
      expect(find.text('Currently unavailable'), findsNWidgets(2));
      expect(find.text('Add to cart'), findsNothing);

      await tester.tap(find.text('Currently unavailable').last);
      await tester.pump();
      expect(cart.itemCount, 0);
    });
  });

  group('cart', () {
    testWidgets('Add to cart, +, - all go through the shared CartProvider',
        (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      await tester.tap(find.text('Add to cart'));
      await settle(tester);
      expect(cart.quantityOf(_milkId), 1);
      expect(cart.lines.single.product.name, 'Kotmale Fresh Milk 1L');
      expect(find.text('1 in cart'), findsOneWidget);
      // The screen's own bottom bar gains the View cart action; the count
      // and total live on the cart bar, which this screen does not show.
      expect(find.text('View cart'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(cart.quantityOf(_milkId), 2);
      expect(find.text('2 in cart'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'));
      await settle(tester);
      expect(cart.quantityOf(_milkId), 1);

      await tester.tap(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'));
      await settle(tester);
      // Never negative: the line is removed and the CTA returns.
      expect(cart.quantityOf(_milkId), 0);
      expect(cart.isEmpty, isTrue);
      expect(find.text('Add to cart'), findsOneWidget);
      expect(find.textContaining('in cart'), findsNothing);
      // Emptying the cart takes the View cart action away with it, so the
      // add control gets the whole bar back.
      expect(find.text('View cart'), findsNothing);
    });

    testWidgets('reflects a quantity already in the cart', (tester) async {
      cart
        ..add(_milkListing())
        ..add(_milkListing())
        ..add(_milkListing());
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      expect(find.text('Add to cart'), findsNothing);
      expect(find.text('3 in cart'), findsOneWidget);
    });

    testWidgets('View cart in the bottom bar opens the cart', (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);
      await tester.tap(find.text('Add to cart'));
      await settle(tester);

      await tester.tap(find.text('View cart'));
      await settle(tester);
      expect(find.text('route:/cart'), findsOneWidget);
    });

    testWidgets('one bottom bar, never a floating cart bar stacked on top',
        (tester) async {
      cart.add(_milkListing());
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      // The reported defect: this screen already owns a bottom bar, and the
      // global floating CartBar was being Stack-ed over the body on top of
      // it — so it covered the "Product details" section rather than sitting
      // above it. This screen must never render a CartBar.
      expect(find.byType(CartBar), findsNothing);
      expect(find.text('View cart'), findsOneWidget, reason: 'exactly one, in the bottom bar');
    });

    testWidgets('the bottom bar does not cover the content behind it',
        (tester) async {
      cart.add(_milkListing());
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      // `bottomNavigationBar` occupies layout instead of overlaying it, so
      // the scrollable body ends where the bar begins. Nothing in the body
      // may extend under it.
      final bar = tester.getRect(find.byType(AddToCartButton).last);
      final body = tester.getRect(find.byType(Scrollable).first);
      expect(body.bottom, lessThanOrEqualTo(bar.top));
    });
  });

  group('layout', () {
    testWidgets('the hero image is the other end of the card flight: same tag, image only', (tester) async {
      await pumpApp(tester, home: const ProductDetailsScreen(productId: _milkId));
      await settle(tester);

      final heroes = tester.widgetList<Hero>(find.byType(Hero)).toList();
      expect(heroes, hasLength(1), reason: 'exactly one flight lands here');
      expect(heroes.single.tag, ProductHero.tagFor(_milkId),
          reason: 'must equal the tag ProductCard gives the same product');
      expect(
        find.descendant(of: find.byType(Hero), matching: find.byType(ProductImageWell)),
        findsOneWidget,
      );
      expect(find.descendant(of: find.byType(Hero), matching: find.text('Kotmale Fresh Milk 1L')),
          findsNothing, reason: 'the name does not fly; only the image does');
    });

    testWidgets('desktop uses two columns with an inline CTA', (tester) async {
      await pumpApp(
        tester,
        home: const ProductDetailsScreen(productId: _milkId),
        size: const Size(1440, 900),
      );
      await settle(tester);

      final image = tester.getRect(find.byType(ProductImageWell));
      final title = tester.getRect(find.text('Kotmale Fresh Milk 1L'));
      expect(title.left, greaterThan(image.right),
          reason: 'info column sits beside the image');
      // Price shown once (no pinned phone bar on desktop).
      expect(find.text('LKR 540'), findsOneWidget);
      expect(find.text('Add to cart'), findsOneWidget);
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
        await tester.tap(find.text('Add to cart'));
        await settle(tester);

        expect(tester.takeException(), isNull);
        expect(find.text('1 in cart'), findsOneWidget);
        // Phones stack (image above title); wider screens sit side by side.
        final image = tester.getRect(find.byType(ProductImageWell));
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

      await tester.tap(find.text('Add to cart'));
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
