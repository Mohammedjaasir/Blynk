import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/card_cart_prices_detail.dart';
import 'package:ecom/app_theme.dart';

/// Checkout switches (owner, 2026-10-08): coupons on/off from GET /store,
/// and this customer's new-customer free deliveries from
/// GET /orders/checkout-info. The server decides both again at placeOrder
/// (backend/api/tests/checkout-settings.test.ts).

Map<String, dynamic> _store({Object? coupons}) => {
      'success': true,
      'data': {
        'delivery_fee_lkr': 100,
        if (coupons != null) 'coupons_enabled': coupons,
        'new_customer_free_deliveries': {'enabled': true, 'count': 2},
      },
    };

Map<String, dynamic> _checkoutInfo({int remaining = 2, bool applies = true}) => {
      'success': true,
      'data': {
        'delivery_fee_lkr': applies ? 0 : 100,
        'standard_delivery_fee_lkr': 100,
        'coupons_enabled': false,
        'free_delivery': {
          'enabled': true,
          'count': 2,
          'used': 2 - remaining,
          'remaining': remaining,
          'applies': applies,
        },
      },
    };

StoreInfoProvider _provider(Future<dynamic> Function(String url) request) =>
    StoreInfoProvider(request: request, readCache: () async => null, writeCache: (_) async {});

const _milk =
    '{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}';

Future<void> _pumpSummary(WidgetTester tester, StoreInfoProvider store) async {
  final cart = CartProvider()
    ..add(ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>()));
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: cart),
        ChangeNotifierProvider.value(value: store),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        home: const Scaffold(body: SingleChildScrollView(child: CartPriceDetailWidget())),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('coupons_enabled', () {
    test('hidden until GET /store says true', () async {
      expect(_provider((_) async => _store()).couponsEnabled, isFalse);
      for (final (raw, want) in [(true, true), (false, false), ('true', false), (null, false)]) {
        final p = _provider((_) async => _store(coupons: raw));
        await p.load();
        expect(p.couponsEnabled, want, reason: '$raw');
      }
    });

    test('a failed GET /store keeps it hidden', () async {
      final p = _provider((_) async => throw ApiException(503, 'down'));
      await p.load();
      expect(p.couponsEnabled, isFalse);
    });
  });

  group('free delivery', () {
    test('reads GET /orders/checkout-info; the estimate fee drops to 0', () async {
      final urls = <String>[];
      final p = _provider((url) async {
        urls.add(url);
        return url == '/store' ? _store() : _checkoutInfo(remaining: 1);
      });
      await p.load();
      expect(p.checkoutDeliveryFee, 100);
      await p.loadCheckoutInfo(signedIn: true);
      expect(urls, ['/store', '/orders/checkout-info']);
      expect(p.freeDelivery, const FreeDeliveryOffer(count: 2, remaining: 1, applies: true));
      expect(p.checkoutDeliveryFee, 0);
      expect(p.deliveryFee, 100);
    });

    test('used up, signed out, or a failure: the full fee', () async {
      var answer = _checkoutInfo(remaining: 0, applies: false);
      final p = _provider((_) async => answer);
      await p.loadCheckoutInfo(signedIn: true);
      expect(p.freeDelivery!.applies, isFalse);
      expect(p.checkoutDeliveryFee, 100);

      answer = _checkoutInfo();
      await p.loadCheckoutInfo(signedIn: true);
      expect(p.checkoutDeliveryFee, 0);
      await p.loadCheckoutInfo(signedIn: false);
      expect(p.freeDelivery, isNull);
      expect(p.checkoutDeliveryFee, 100);

      final failing = _provider((_) async => throw ApiException(401, 'no'));
      await failing.loadCheckoutInfo(signedIn: true);
      expect(failing.freeDelivery, isNull);
      expect(failing.checkoutDeliveryFee, 100);
    });

    test('ignores a malformed offer', () {
      expect(FreeDeliveryOffer.tryParse(null), isNull);
      expect(FreeDeliveryOffer.tryParse({'count': '2', 'remaining': 1, 'applies': true}), isNull);
      expect(FreeDeliveryOffer.tryParse({'count': 2, 'remaining': -1, 'applies': true}), isNull);
      expect(FreeDeliveryOffer.tryParse({'count': 2, 'remaining': 0, 'applies': true})!.applies, isFalse);
    });

    testWidgets('the Order Summary shows FREE with the welcome note', (tester) async {
      final store = _provider((url) async => url == '/store' ? _store() : _checkoutInfo(remaining: 1));
      await tester.runAsync(() async {
        await store.load();
        await store.loadCheckoutInfo(signedIn: true);
      });
      await _pumpSummary(tester, store);
      expect(find.byKey(const Key('summary-free-delivery')), findsOneWidget);
      expect(find.text('FREE'), findsOneWidget);
      expect(find.text('Free delivery — welcome to Blynk. 1 of 2 free deliveries left.'), findsOneWidget);
      expect(find.text('LKR 100'), findsNothing);
      // Subtotal and total are both the milk alone.
      expect(find.text('LKR 540'), findsNWidgets(2));
    });

    testWidgets('no offer: the usual Delivery fee row', (tester) async {
      final store = _provider((_) async => _store());
      await tester.runAsync(store.load);
      await _pumpSummary(tester, store);
      expect(find.text('FREE'), findsNothing);
      expect(find.text('LKR 100'), findsOneWidget);
      expect(find.text('LKR 640'), findsOneWidget);
    });
  });
}
