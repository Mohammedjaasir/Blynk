import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/coupon_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/order_bill_card.dart';
import 'package:ecom/app_theme.dart';

/// Coupons at checkout (backend migration 018): the "Have a coupon code?"
/// field, the Discount line in the Order Summary, the code sent with the
/// order, and the Discount line on an order's bill. The server side (limits,
/// the lock, the error codes) is tested in backend/api/tests/coupons.test.ts.

const _realMilk =
    '{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}';
const _realButter =
    '{"id":"b0000001-0000-0000-0000-000000000002","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Pelwatte Salted Butter 200g","slug":"pelwatte-salted-butter-200g","description":null,"sku":"SKU-DAI-002","barcode":"4792024001028","unit":"200 g","pack_size":"Foil Wrap","image_url":null,"selling_price":805,"is_available":true}';

ProductModel _product(String json) => ProductModel.fromJson((jsonDecode(json) as Map).cast<String, dynamic>());

Map<String, dynamic> _preview({String code = 'WELCOME50', double discount = 50, String type = 'FIXED'}) => {
      'success': true,
      'data': {
        'coupon': {
          'code': code,
          'discount_type': type,
          'description': null,
          'subtotal': 540,
          'delivery_fee': 100,
          'discount_amount': discount,
          'total': 640 - discount,
        },
      },
    };

class _Call {
  _Call(this.method, this.url, this.body);
  final String method;
  final String url;
  final Object? body;
}

/// Replays the orders API: [handler] answers each request (or throws).
class _FakeApi {
  _FakeApi(this.handler);
  final dynamic Function(_Call call) handler;
  final calls = <_Call>[];

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    final c = _Call(method, url, body);
    calls.add(c);
    return handler(c);
  }

  List<_Call> to(String url) => calls.where((c) => c.url == url).toList();
}

void main() {
  group('coupon copy', () {
    test('parses a preview', () {
      final p = CouponPreview.tryParse(_preview()['data']['coupon'])!;
      expect(p.code, 'WELCOME50');
      expect(p.discountAmount, 50);
      expect(p.total, 590);
      expect(p.isFreeDelivery, isFalse);
      expect(CouponPreview.tryParse(null), isNull);
    });

    test('words every refusal plainly', () {
      String? words(String code, [Map<String, dynamic>? details]) =>
          couponRefusalMessage(ApiException(422, 'x', code: code, details: details));
      expect(words('COUPON_NOT_FOUND'), "That code doesn't exist. Check it and try again.");
      expect(words('COUPON_EXPIRED'), 'This code has expired.');
      expect(words('COUPON_NOT_STARTED'), "This code isn't active yet.");
      expect(words('COUPON_INACTIVE'), 'This code is no longer available.');
      expect(words('COUPON_FIRST_ORDER_ONLY'), 'This code is only for your first order.');
      expect(words('COUPON_LIMIT_REACHED', {'scope': 'CUSTOMER'}), "You've already used this code.");
      expect(words('COUPON_LIMIT_REACHED', {'scope': 'TOTAL'}), 'This code has been fully used.');
      expect(words('COUPON_MIN_SUBTOTAL', {'min_subtotal': 1000}), 'Add items worth LKR 1,000 or more to use this code.');
      expect(words('NETWORK_ERROR'), isNull);
    });
  });

  group('order bill', () {
    Map<String, dynamic> order({double discount = 0, String? code}) => {
          'id': 'o1',
          'order_number': 'BL-20260930-0042',
          'order_status': 'DELIVERED',
          'payment_method': 'COD',
          'payment_status': 'PAID',
          'subtotal_amount': '1080.00',
          'delivery_fee': 100,
          'discount_amount': discount,
          'coupon_code': code,
          'total_amount': 1180 - discount,
          'delivery_recipient_name': 'Ahmed',
          'delivery_recipient_phone': '+94771234567',
          'delivery_address_line1': '14 Mosque Road',
          'delivery_city': 'Dharga Town',
        };

    test('the model reads the discount and the code', () {
      final m = OrderModel.fromJson(order(discount: 108, code: 'SAVE10'));
      expect(m.discountAmount, 108);
      expect(m.couponCode, 'SAVE10');
      final none = OrderModel.fromJson(order()..remove('discount_amount')..remove('coupon_code'));
      expect(none.discountAmount, 0);
      expect(none.couponCode, isNull);
    });

    Future<void> pumpBill(WidgetTester tester, OrderModel m) => tester.pumpWidget(
          MaterialApp(theme: AppTheme.appTHeme, home: Scaffold(body: OrderBillCard(order: m))),
        );

    testWidgets('shows the Discount line with its code, and the total after it', (tester) async {
      await pumpBill(tester, OrderModel.fromJson(order(discount: 108, code: 'SAVE10')));
      expect(find.text('Discount (SAVE10)'), findsOneWidget);
      expect(find.text('−LKR 108'), findsOneWidget);
      expect(find.text('LKR 1,072'), findsOneWidget);
    });

    testWidgets('no Discount line without a coupon', (tester) async {
      await pumpBill(tester, OrderModel.fromJson(order()));
      expect(find.textContaining('Discount'), findsNothing);
      expect(find.text('LKR 1,180'), findsOneWidget);
    });
  });

  group('checkout', () {
    late CartProvider cart;
    late _FakeApi api;
    late OrderProvider orders;

    setUp(() {
      cart = CartProvider()..add(_product(_realMilk));
    });

    Future<void> pumpCheckout(WidgetTester tester, dynamic Function(_Call) handler,
        {bool couponsEnabled = true}) async {
      api = _FakeApi(handler);
      orders = OrderProvider(request: api.call);
      // Coupons are switched on/off in Admin / Operations (owner, 2026-10-08)
      // and reach the app as coupons_enabled on GET /store.
      final store = StoreInfoProvider(
        request: (_) async => {
          'success': true,
          'data': {'delivery_fee_lkr': 100, 'coupons_enabled': couponsEnabled},
        },
        readCache: () async => null,
        writeCache: (_) async {},
      );
      await tester.runAsync(store.load);
      tester.view.physicalSize = const Size(560, 1400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider(create: (_) => ProductProvider()),
            ChangeNotifierProvider(create: (_) => AddressProvider()),
            ChangeNotifierProvider.value(value: orders),
            ChangeNotifierProvider(create: (_) => AuthProvider()),
            ChangeNotifierProvider.value(value: store),
          ],
          child: MaterialApp(theme: AppTheme.appTHeme, home: const CheckoutScreen()),
        ),
      );
      await tester.pump();
    }

    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    Future<void> apply(WidgetTester tester, String code) async {
      await tester.enterText(find.descendant(of: find.byKey(const Key('coupon-field')), matching: find.byType(TextField)), code);
      await tester.tap(find.byKey(const Key('coupon-apply')));
      await settle(tester);
    }

    testWidgets('applying a code shows the saving and the Discount line; the total drops', (tester) async {
      await pumpCheckout(tester, (_) => _preview());
      expect(find.text('Have a coupon code?'), findsOneWidget);
      expect(find.text('LKR 640'), findsOneWidget);

      await apply(tester, 'welcome50');
      expect(api.to('/orders/validate-coupon'), hasLength(1));
      expect(api.calls.single.body, {
        'code': 'WELCOME50',
        'items': [
          {'product_id': 'b0000001-0000-0000-0000-000000000001', 'quantity': 1},
        ],
      });
      expect(find.text('WELCOME50 applied'), findsOneWidget);
      expect(find.text('You save LKR 50'), findsOneWidget);
      expect(find.byKey(const Key('summary-discount')), findsOneWidget);
      expect(find.text('Discount (WELCOME50)'), findsOneWidget);
      expect(find.text('−LKR 50'), findsOneWidget);
      expect(find.text('LKR 590'), findsOneWidget);
    });

    testWidgets('coupons switched off: no coupon field, nothing previewed', (tester) async {
      await pumpCheckout(tester, (_) => _preview(), couponsEnabled: false);
      await settle(tester);
      expect(find.text('Have a coupon code?'), findsNothing);
      expect(find.byKey(const Key('checkout-coupon')), findsNothing);
      expect(find.text('LKR 640'), findsOneWidget);
      expect(api.calls, isEmpty);
    });

    testWidgets('Remove takes the code off', (tester) async {
      await pumpCheckout(tester, (_) => _preview());
      await apply(tester, 'WELCOME50');
      await tester.tap(find.byKey(const Key('coupon-remove')));
      await settle(tester);
      expect(find.text('Have a coupon code?'), findsOneWidget);
      expect(find.byKey(const Key('summary-discount')), findsNothing);
      expect(find.text('LKR 640'), findsOneWidget);
    });

    testWidgets('a refusal is shown in plain words, with the minimum it needs', (tester) async {
      await pumpCheckout(
        tester,
        (_) => throw ApiException(422, 'Add items worth LKR 1000.00 or more to use this coupon.',
            code: 'COUPON_MIN_SUBTOTAL', details: {'min_subtotal': 1000, 'subtotal': 540}),
      );
      await apply(tester, 'BIGSHOP');
      expect(find.text('Add items worth LKR 1,000 or more to use this code.'), findsOneWidget);
      expect(find.byKey(const Key('summary-discount')), findsNothing);
    });

    testWidgets('an expired code says so', (tester) async {
      await pumpCheckout(tester, (_) => throw ApiException(422, 'expired', code: 'COUPON_EXPIRED'));
      await apply(tester, 'OLDCODE');
      expect(find.text('This code has expired.'), findsOneWidget);
    });

    testWidgets('a malformed code is caught before any request', (tester) async {
      await pumpCheckout(tester, (_) => _preview());
      await apply(tester, 'ab');
      expect(find.text('Codes are 4 to 20 letters or numbers.'), findsOneWidget);
      expect(api.calls, isEmpty);
    });

    testWidgets('changing the cart retires the preview; the code must be applied again', (tester) async {
      await pumpCheckout(tester, (_) => _preview());
      await apply(tester, 'WELCOME50');
      cart.add(_product(_realButter));
      await settle(tester);
      expect(find.byKey(const Key('summary-discount')), findsNothing);
      expect(find.text('Your cart changed. Apply WELCOME50 again.'), findsOneWidget);
      expect(orders.couponFor(cart), isNull);
    });
  });

  group('placing the order', () {
    Map<String, dynamic> placed() => {
          'success': true,
          'data': {
            'order': {
              'id': 'o1',
              'order_number': 'BL-20260930-0042',
              'order_status': 'PLACED',
              'subtotal_amount': 540,
              'delivery_fee': 100,
              'discount_amount': 50,
              'coupon_code': 'WELCOME50',
              'total_amount': 590,
            },
          },
        };

    test('sends the applied code, then forgets it', () async {
      final cart = CartProvider()..add(_product(_realMilk));
      final api = _FakeApi((c) => c.url == '/orders' ? placed() : _preview());
      final orders = OrderProvider(request: api.call);
      expect(await orders.applyCoupon('welcome50', cart), isTrue);
      final order = await orders.placeOrder(cart: cart, addressId: 'a1');
      expect((api.to('/orders').single.body as Map)['coupon_code'], 'WELCOME50');
      expect(order!.discountAmount, 50);
      expect(order.totalAmount, 590);
      expect(orders.appliedCouponCode, isNull);
    });

    test('no code is sent when none applies to this cart', () async {
      final cart = CartProvider()..add(_product(_realMilk));
      final api = _FakeApi((c) => c.url == '/orders' ? placed() : _preview());
      final orders = OrderProvider(request: api.call);
      await orders.applyCoupon('WELCOME50', cart);
      cart.add(_product(_realButter));
      await orders.placeOrder(cart: cart, addressId: 'a1');
      expect((api.to('/orders').single.body as Map).containsKey('coupon_code'), isFalse);
    });

    test('a code refused at placeOrder is dropped and explained', () async {
      final cart = CartProvider()..add(_product(_realMilk));
      final api = _FakeApi((c) => c.url == '/orders'
          ? throw ApiException(422, 'used', code: 'COUPON_LIMIT_REACHED', details: {'scope': 'TOTAL'})
          : _preview());
      final orders = OrderProvider(request: api.call);
      await orders.applyCoupon('WELCOME50', cart);
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(orders.couponFor(cart), isNull);
      expect(orders.couponError, 'This code has been fully used.');
      expect(orders.placeOrderFailure!.message, "That coupon can't be used again. Remove it and try again.");
      expect(cart.isEmpty, isFalse);
    });
  });
}
