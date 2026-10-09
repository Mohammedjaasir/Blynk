import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/UI/Widgets/Atoms/offer_tag.dart';
import 'package:ecom/UI/Widgets/Organisms/home_product_feed.dart';
import 'package:ecom/UI/Widgets/Organisms/product_rail.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

/// Product offers (owner, 2026-10-09): a product can be on offer at a reduced
/// price (Rice LKR 250 -> LKR 220), with an optional end date. The customer
/// sees the offer price, the regular price struck through and an "Offer"
/// tag; the cart estimates at the offer price; Home gets an "Offers" rail
/// from GET /products?on_offer=true. The server charges the offer price
/// itself (backend/api/tests/product-offers.test.ts).

Map<String, dynamic> _json(
  String id, {
  String name = 'Samba Rice 1kg',
  Object? price = 250,
  Object? offer,
  Object? endsAt,
  String categoryId = 'c1',
  bool includeOfferKeys = true,
}) =>
    {
      'id': id,
      'category_id': categoryId,
      'category_name': 'Rice & Grains',
      'name': name,
      'slug': id,
      'description': null,
      'sku': 'SKU-$id',
      'barcode': null,
      'unit': '1 kg',
      'pack_size': null,
      'image_url': null,
      'selling_price': price,
      if (includeOfferKeys) 'offer_price': offer,
      if (includeOfferKeys) 'offer_ends_at': endsAt,
      'is_available': true,
    };

ProductModel _product(String id, {Object? offer, Object? endsAt, Object? price = 250, String? name}) =>
    ProductModel.fromJson(_json(id, offer: offer, endsAt: endsAt, price: price, name: name ?? 'Product $id'));

String _future() => DateTime.now().add(const Duration(days: 3)).toUtc().toIso8601String();
String _past() => DateTime.now().subtract(const Duration(hours: 1)).toUtc().toIso8601String();

Widget _host(WidgetTester tester, Widget child, {CartProvider? cart, ProductProvider? products}) {
  tester.view.physicalSize = const Size(420, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<CartProvider>.value(value: cart ?? CartProvider()),
      if (products != null) ChangeNotifierProvider<ProductProvider>.value(value: products),
    ],
    child: MaterialApp(theme: AppTheme.theme, home: Scaffold(body: child)),
  );
}

Widget _card(ProductModel product, {double width = 160}) => Builder(
      builder: (context) => Align(
        alignment: Alignment.topLeft,
        child: SizedBox(
          width: width,
          height: ProductCard.heightFor(context, width),
          child: ProductCard(product: product, hero: false),
        ),
      ),
    );

Map<String, dynamic> _page(List<Map<String, dynamic>> products) => {
      'success': true,
      'data': {
        'products': products,
        'pagination': {'page': 1, 'limit': 100, 'total': products.length, 'total_pages': 1},
      },
    };

void main() {
  group('ProductModel offer fields', () {
    test('an active offer with an end date: offer price charged, 12% off', () {
      final rice = _product('r', offer: 220, endsAt: '2099-01-31T18:30:00.000Z');
      expect(rice.sellingPrice, 250);
      expect(rice.offerPrice, 220);
      expect(rice.offerEndsAt, DateTime.utc(2099, 1, 31, 18, 30));
      expect(rice.isOnOffer, isTrue);
      expect(rice.effectivePrice, 220);
      expect(rice.offerPercentOff, 12);
    });

    test('an active offer with no end date never lapses on the device', () {
      final rice = _product('r', offer: '220.50', endsAt: null);
      expect(rice.offerPrice, 220.5);
      expect(rice.offerEndsAt, isNull);
      expect(rice.isOnOffer, isTrue);
      expect(rice.effectivePrice, 220.5);
    });

    test('an offer whose end date has passed on the device clock: the regular price', () {
      final rice = _product('r', offer: 220, endsAt: _past());
      expect(rice.isOnOffer, isFalse);
      expect(rice.effectivePrice, 250);
      expect(rice.offerPercentOff, 0);
      final at = DateTime.utc(2026, 10, 9, 12);
      final ending = _product('e', offer: 220, endsAt: '2026-10-09T12:00:00.000Z');
      expect(ending.isOnOfferAt(at.subtract(const Duration(seconds: 1))), isTrue);
      expect(ending.isOnOfferAt(at), isFalse, reason: 'ends at that instant');
    });

    test('missing, null, garbage or not-a-reduction: no offer, nothing breaks', () {
      final older = ProductModel.fromJson(_json('o', includeOfferKeys: false));
      expect(older.offerPrice, isNull);
      expect(older.offerEndsAt, isNull);
      expect(older.isOnOffer, isFalse);
      expect(older.effectivePrice, 250);
      for (final raw in [null, 'cheap', 0, -5, double.nan, <String, dynamic>{}]) {
        final p = _product('g', offer: raw);
        expect(p.offerPrice, isNull, reason: '$raw');
        expect(p.effectivePrice, 250, reason: '$raw');
      }
      expect(_product('n', offer: 220, endsAt: 'soon').offerEndsAt, isNull);
      expect(_product('n', offer: 220, endsAt: 42).offerEndsAt, isNull);
      // An "offer" at or above the regular price is not shown as one.
      expect(_product('s', offer: 250).isOnOffer, isFalse);
      expect(_product('s', offer: 300).effectivePrice, 250);
    });

    test('toJson round-trips the offer (the saved cart relies on it)', () {
      final ends = _future();
      final rice = _product('r', offer: 220, endsAt: ends);
      final back = ProductModel.fromJson(rice.toJson());
      expect(back.offerPrice, 220);
      expect(back.offerEndsAt, DateTime.parse(ends));
      expect(back.effectivePrice, 220);
      final plain = ProductModel.fromJson(_product('p').toJson());
      expect(plain.offerPrice, isNull);
      expect(plain.offerEndsAt, isNull);
    });

    test('the tag reads "Offer −12%", or just "Offer" under half a percent', () {
      expect(OfferTag.labelFor(_product('r', offer: 220)), 'Offer −12%');
      expect(OfferTag.labelFor(_product('r', offer: 249.5)), 'Offer');
    });
  });

  group('ProductCard', () {
    testWidgets('on offer: new price in green first, old price struck after, Save tag, no Offer tag', (tester) async {
      await tester.pumpWidget(_host(tester, _card(_product('r', offer: 220, endsAt: _future()))));
      final struck = find.byType(StruckPrice);
      expect(struck, findsOneWidget);
      final struckText = tester.widget<Text>(find.descendant(of: struck, matching: find.byType(Text)));
      expect(struckText.data, 'LKR 250');
      expect(struckText.style?.decoration, TextDecoration.lineThrough);
      expect(struckText.style?.decorationColor, BlynkColors.sale);
      // The new price: Blynk green, plain "LKR 220", first on the line.
      final sale = find.byType(SalePrice);
      expect(sale, findsOneWidget);
      expect(find.text('LKR 220'), findsOneWidget);
      expect(tester.widget<Text>(find.text('LKR 220')).style?.color, BlynkColors.sale);
      expect(tester.getTopLeft(sale).dx, lessThan(tester.getTopLeft(struck).dx));
      expect(find.text('Save LKR 30'), findsOneWidget);
      expect(find.byType(OfferTag), findsNothing);
      expect(find.textContaining('Offer'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('no offer, or an ended one: just the regular price, same card height', (tester) async {
      for (final p in [_product('p'), _product('e', offer: 220, endsAt: _past())]) {
        await tester.pumpWidget(_host(tester, _card(p)));
        expect(find.text('LKR 250'), findsOneWidget);
        expect(find.byType(StruckPrice), findsNothing);
        expect(find.byType(SalePrice), findsNothing);
        expect(find.textContaining('Save'), findsNothing);
        expect(find.textContaining('%'), findsNothing);
      }
    });

    testWidgets('a narrow card at 2x text does not overflow on offer', (tester) async {
      tester.view.physicalSize = const Size(360, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final product = _product('r', price: 12500, offer: 11999.5);
      await tester.pumpWidget(ChangeNotifierProvider<CartProvider>.value(
        value: CartProvider(),
        child: MaterialApp(
          theme: AppTheme.theme,
          builder: (context, app) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)),
            child: app!,
          ),
          home: Scaffold(body: _card(product, width: 120)),
        ),
      ));
      expect(tester.takeException(), isNull);
      expect(find.byType(SalePrice), findsOneWidget);
    });
  });

  group('cart at the offer price', () {
    test('line totals and the subtotal use the offer price', () {
      final cart = CartProvider()
        ..add(_product('r', offer: 220, endsAt: _future()))
        ..add(_product('r', offer: 220, endsAt: _future()))
        ..add(_product('m', price: 540));
      final rice = cart.lines.firstWhere((l) => l.product.id == 'r');
      expect(rice.lineTotal, 440);
      expect(cart.subtotal, 980);
    });

    test('a saved cart keeps the offer; one restored after it ended re-prices to regular', () {
      final active = decodeSavedCart(encodeSavedCart([
        CartLine(product: _product('r', offer: 220, endsAt: _future()), quantity: 2),
      ]))!;
      expect(active.single.lineTotal, 440);
      final ended = decodeSavedCart(encodeSavedCart([
        CartLine(product: _product('r', offer: 220, endsAt: _past()), quantity: 2),
      ]))!;
      expect(ended.single.lineTotal, 500);
    });

    test('adding the fresh product replaces the snapshot, so the newest price wins', () {
      final cart = CartProvider()..add(_product('r'));
      expect(cart.subtotal, 250);
      cart.add(_product('r', offer: 220));
      expect(cart.subtotal, 440);
    });
  });

  group('Offers rail on Home', () {
    final catalog = [
      for (var i = 0; i < 3; i++) _json('p$i', name: 'Product p$i'),
    ];

    Future<ProductProvider> pumpFeed(
      WidgetTester tester,
      Future<dynamic> Function(Map<String, dynamic> query) offers,
    ) async {
      final queries = <Map<String, dynamic>>[];
      final provider = ProductProvider(request: (url, query) async {
        if (url == '/catalog/products') return _page(catalog);
        if (url == '/catalog/categories') {
          return {'success': true, 'data': {'categories': []}};
        }
        if (url == '/products') {
          queries.add(query);
          return offers(query);
        }
        throw StateError('unexpected $url');
      });
      await tester.pumpWidget(_host(
        tester,
        const CustomScrollView(slivers: [HomeProductFeed()]),
        products: provider,
      ));
      await tester.pumpAndSettle();
      if (queries.isNotEmpty) {
        expect(queries.first['on_offer'], 'true');
      }
      return provider;
    }

    testWidgets('shown, first, when GET /products?on_offer=true returns offers', (tester) async {
      final provider = await pumpFeed(
        tester,
        (_) async => _page([_json('o1', name: 'Samba Rice 1kg', offer: 220, endsAt: _future())]),
      );
      expect(provider.offerProducts.map((p) => p.id), ['o1']);
      expect(find.byKey(const ValueKey('home-offers')), findsOneWidget);
      expect(find.text(HomeProductFeed.offersTitle), findsOneWidget);
      expect(find.byKey(const ValueKey('home-offers-rail')), findsOneWidget);
      expect(
        find.descendant(of: find.byType(ProductRail), matching: find.text('Samba Rice 1kg')),
        findsOneWidget,
      );
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('home-offers'))).dy,
        lessThan(tester.getTopLeft(find.byKey(const ValueKey('home-all-products'))).dy),
      );
    });

    testWidgets('hidden when there are no offers', (tester) async {
      await pumpFeed(tester, (_) async => _page(const []));
      expect(find.byKey(const ValueKey('home-offers')), findsNothing);
      expect(find.text(HomeProductFeed.offersTitle), findsNothing);
      expect(find.byKey(const ValueKey('home-all-products')), findsOneWidget);
    });

    testWidgets('hidden when the request fails', (tester) async {
      await pumpFeed(tester, (_) async => throw StateError('offline'));
      expect(find.byKey(const ValueKey('home-offers')), findsNothing);
      expect(find.byKey(const ValueKey('home-all-products')), findsOneWidget);
    });

    testWidgets('hidden when an older backend ignores on_offer and returns everything', (tester) async {
      await pumpFeed(tester, (_) async => _page(catalog));
      expect(find.byKey(const ValueKey('home-offers')), findsNothing);
    });
  });
}
