import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/card_cart_prices_detail.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/session_fakes.dart';

/// The delivery fee by distance (owner, 2026-10-10): Ops/Admin can price
/// delivery per km. GET /store then sends no fee (`delivery_fee_lkr` null,
/// `delivery_fee_by_distance` true) and GET /orders/checkout-info?address_id=
/// answers the fee for the selected address. The app never sees the tiers.

Map<String, dynamic> _store({bool byDistance = true}) => {
      'success': true,
      'data': {
        'delivery_fee_lkr': byDistance ? null : 100,
        'delivery_fee_mode': byDistance ? 'DISTANCE_TIERS' : 'FLAT',
        'delivery_fee_by_distance': byDistance,
      },
    };

Map<String, dynamic> _checkoutInfo({
  Object? fee = 210,
  Object? km = 2.43,
  String mode = 'DISTANCE_TIERS',
  String? addressId = 'a1',
  bool freeApplies = false,
  bool estimated = false,
}) =>
    {
      'success': true,
      'data': {
        'delivery_fee_lkr': freeApplies ? 0 : fee,
        'standard_delivery_fee_lkr': fee,
        'delivery_fee_mode': mode,
        'delivery_distance_km': km,
        'delivery_distance_estimated': estimated,
        'delivery_fee_address_id': addressId,
        'coupons_enabled': false,
        'free_delivery': {
          'enabled': true,
          'count': 2,
          'remaining': freeApplies ? 1 : 0,
          'applies': freeApplies,
        },
      },
    };

StoreInfoProvider _provider(Future<dynamic> Function(String url) request, {String? cached}) =>
    StoreInfoProvider(request: request, readCache: () async => cached, writeCache: (_) async {});

Map<String, dynamic> _address(String id, {bool isDefault = false}) => {
      'id': id,
      'label': 'Home',
      'recipient_name': 'Nimal',
      'recipient_phone': '0771234567',
      'address_line1': '12 Main Street',
      'city': 'Colombo',
      'latitude': 7.0,
      'longitude': 80.0,
      'is_default': isDefault,
    };

const _milk =
    '{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}';

void main() {
  group('StoreInfoProvider: fee for the selected address', () {
    test('checkout-info carries ?address_id= only when an address is selected', () {
      expect(StoreInfoProvider.checkoutInfoUrl(null), '/orders/checkout-info');
      expect(StoreInfoProvider.checkoutInfoUrl(''), '/orders/checkout-info');
      expect(StoreInfoProvider.checkoutInfoUrl('a1'), '/orders/checkout-info?address_id=a1');
    });

    test('GET /store by distance: no fee, the cached fee stays the fallback', () async {
      final p = _provider((_) async => _store(), cached: '150');
      await p.load();
      expect(p.deliveryFeeByDistance, isTrue);
      expect(p.deliveryFee, 150);
      expect(p.checkoutDeliveryFee, 150);
      expect(p.deliveryDistanceLabel, isNull);
    });

    test('the server fee for the address wins over the store fee, with ~km', () async {
      final urls = <String>[];
      final p = _provider((url) async {
        urls.add(url);
        return url == '/store' ? _store() : _checkoutInfo();
      });
      await p.load();
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(urls, ['/store', '/orders/checkout-info?address_id=a1']);
      expect(p.checkoutDeliveryFee, 210);
      expect(p.deliveryFee, 100, reason: 'the store fallback is untouched');
      expect(p.deliveryFeeAddressId, 'a1');
      expect(p.deliveryDistanceLabel, '~2.4 km');
      expect(p.checkoutFee!.standardFee, 210);
    });

    test('a flat fee shows no distance; an estimated km still reads ~', () async {
      var answer = _checkoutInfo(fee: 100, km: null, mode: 'FLAT');
      final p = _provider((_) async => answer);
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(p.checkoutDeliveryFee, 100);
      expect(p.deliveryFeeByDistance, isFalse);
      expect(p.deliveryDistanceLabel, isNull);

      answer = _checkoutInfo(km: 3, estimated: true);
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(p.checkoutFee!.distanceEstimated, isTrue);
      expect(p.deliveryDistanceLabel, '~3 km');
    });

    test('a free delivery still makes the estimate 0', () async {
      final p = _provider((_) async => _checkoutInfo(freeApplies: true));
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(p.freeDelivery!.applies, isTrue);
      expect(p.checkoutDeliveryFee, 0);
    });

    test('a far address may cost more than the store-fee bound; garbage is ignored', () async {
      var answer = _checkoutInfo(fee: 1250);
      final p = _provider((_) async => answer);
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(p.checkoutDeliveryFee, 1250);
      for (final bad in <Object?>[null, -5, 'lots', double.nan]) {
        answer = _checkoutInfo(fee: bad);
        await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
        expect(p.checkoutFee, isNull, reason: '$bad');
        expect(p.checkoutDeliveryFee, 100, reason: '$bad');
      }
    });

    test('a failure or a sign-out forgets the address fee', () async {
      var fail = false;
      final p = _provider((_) async => fail ? throw ApiException(404, 'gone', code: 'ADDRESS_NOT_FOUND') : _checkoutInfo());
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(p.checkoutDeliveryFee, 210);
      fail = true;
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a9');
      expect(p.checkoutFee, isNull);
      expect(p.checkoutDeliveryFee, 100);

      fail = false;
      await p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      await p.loadCheckoutInfo(signedIn: false);
      expect(p.checkoutFee, isNull);
      expect(p.deliveryDistanceLabel, isNull);
    });

    test('same address joins; another address is never served the old answer', () async {
      final pending = <String, Completer<dynamic>>{};
      final urls = <String>[];
      final p = _provider((url) {
        urls.add(url);
        return (pending[url] = Completer<dynamic>()).future;
      });
      final first = p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      expect(identical(p.loadCheckoutInfo(signedIn: true, addressId: 'a1'), first), isTrue);
      final second = p.loadCheckoutInfo(signedIn: true, addressId: 'a2');
      expect(identical(second, first), isFalse);
      expect(urls, [
        '/orders/checkout-info?address_id=a1',
        '/orders/checkout-info?address_id=a2',
      ]);
      // A call for a2 while a2 runs joins it, not a1's.
      expect(identical(p.loadCheckoutInfo(signedIn: true, addressId: 'a2'), second), isTrue);

      pending['/orders/checkout-info?address_id=a2']!.complete(_checkoutInfo(fee: 260, km: 5.1, addressId: 'a2'));
      await second;
      pending['/orders/checkout-info?address_id=a1']!.complete(_checkoutInfo());
      await first;
      expect(p.checkoutDeliveryFee, 260);
      expect(p.deliveryFeeAddressId, 'a2');
      expect(p.deliveryDistanceLabel, '~5.1 km');
    });

    test('an answer that lands after a sign-out is dropped', () async {
      final answer = Completer<dynamic>();
      final p = _provider((_) => answer.future);
      final running = p.loadCheckoutInfo(signedIn: true, addressId: 'a1');
      await p.loadCheckoutInfo(signedIn: false);
      answer.complete(_checkoutInfo(freeApplies: true));
      await running;
      expect(p.checkoutFee, isNull);
      expect(p.freeDelivery, isNull);
    });

    test('~km rounds to one decimal, whole km without one', () {
      expect(CheckoutDeliveryFee.formatApproxKm(2.43), '~2.4 km');
      expect(CheckoutDeliveryFee.formatApproxKm(2.96), '~3 km');
      expect(CheckoutDeliveryFee.formatApproxKm(3), '~3 km');
      expect(CheckoutDeliveryFee.formatApproxKm(0.02), '~0.1 km');
      expect(CheckoutDeliveryFee.tryParse({'delivery_fee_lkr': '210.50', 'delivery_distance_km': '1.25'})!.fee, 210.5);
    });
  });

  group('validate-coupon', () {
    Map<String, dynamic> preview() => {
          'success': true,
          'data': {
            'coupon': {'code': 'WELCOME50', 'discount_amount': 50, 'subtotal': 540, 'delivery_fee': 210, 'total': 700},
          },
        };

    test('sends address_id when an address is known, nothing otherwise', () async {
      final bodies = <Map>[];
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        bodies.add(body as Map);
        return preview();
      });
      final cart = CartProvider()..add(ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>()));
      expect(await orders.applyCoupon('WELCOME50', cart, addressId: 'a1'), isTrue);
      expect(await orders.applyCoupon('WELCOME50', cart), isTrue);
      expect(bodies[0]['address_id'], 'a1');
      expect(bodies[1].containsKey('address_id'), isFalse);
    });
  });

  group('Order Summary', () {
    Future<(AddressProvider, List<String>)> pump(WidgetTester tester, {bool freeApplies = false}) async {
      final urls = <String>[];
      final store = _provider((url) async {
        urls.add(url);
        if (url == '/store') return _store();
        if (url.endsWith('address_id=a2')) return _checkoutInfo(fee: 260, km: 5.1, addressId: 'a2');
        return _checkoutInfo(freeApplies: freeApplies);
      });
      final addresses = AddressProvider(request: ({methodType, url, body}) async {
        if (methodType == 'GET') {
          return {
            'success': true,
            'data': {
              'addresses': [_address('a1', isDefault: true), _address('a2')],
            },
          };
        }
        return {'success': true, 'data': <String, dynamic>{}};
      });
      await addresses.loadAddresses();
      final cart = CartProvider()..add(ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>()));
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider.value(value: store),
            ChangeNotifierProvider.value(value: addresses),
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: const Scaffold(body: SingleChildScrollView(child: CartPriceDetailWidget())),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      return (addresses, urls);
    }

    testWidgets('shows the fee for the selected address with ~km, and follows a change', (tester) async {
      final (addresses, urls) = await pump(tester);
      expect(urls, ['/orders/checkout-info?address_id=a1']);
      expect(find.text('Delivery fee'), findsOneWidget);
      expect(find.text('LKR 210'), findsOneWidget);
      expect(find.text('~2.4 km'), findsOneWidget);
      expect(find.byKey(const Key('summary-delivery-distance')), findsOneWidget);
      expect(find.text('LKR 750'), findsOneWidget);

      await tester.runAsync(() => addresses.setDefaultAddress('a2'));
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(urls.last, '/orders/checkout-info?address_id=a2');
      expect(find.text('LKR 260'), findsOneWidget);
      expect(find.text('~5.1 km'), findsOneWidget);
      expect(find.text('LKR 210'), findsNothing);
      expect(find.text('LKR 800'), findsOneWidget);
    });

    testWidgets('a free delivery still reads FREE, without a distance', (tester) async {
      await pump(tester, freeApplies: true);
      expect(find.text('FREE'), findsOneWidget);
      expect(find.byKey(const Key('summary-delivery-distance')), findsNothing);
      expect(find.text('LKR 540'), findsNWidgets(2));
    });
  });
}
