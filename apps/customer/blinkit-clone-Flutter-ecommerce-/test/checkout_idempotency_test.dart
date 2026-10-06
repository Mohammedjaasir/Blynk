import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';

import 'fixtures/order_fixtures.dart';

/// Duplicate orders (2026-10-06): every place-order sends an idempotency
/// key, the same one for every retry of the same checkout, so a retry after
/// a timeout gets back the order the server already made instead of a
/// second one. The backend side (replaying the order for a known key) is
/// order.service.ts createOrder.

const _milk = ProductModel(
  id: 'b0000001-0000-0000-0000-000000000001',
  categoryId: 'c1',
  categoryName: 'Dairy & Eggs',
  name: 'Kotmale Fresh Milk 1L',
  slug: 'kotmale-fresh-milk-1l',
  sku: 'SKU-DAI-001',
  unit: '1 L',
  sellingPrice: 540,
  isAvailable: true,
);

const _eggs = ProductModel(
  id: 'b0000001-0000-0000-0000-000000000003',
  categoryId: 'c1',
  categoryName: 'Dairy & Eggs',
  name: 'Farm Fresh Brown Eggs (10 Pack)',
  slug: 'farm-fresh-brown-eggs-10-pack',
  sku: 'SKU-EGG-003',
  unit: '10 pcs',
  sellingPrice: 605,
  isAvailable: true,
);

Map<String, dynamic> _placed() => {
      'success': true,
      'data': {'order': orderJson(id: 'o1')},
    };

Map<String, dynamic> _preview() => {
      'success': true,
      'data': {
        'coupon': {
          'code': 'WELCOME50',
          'discount_type': 'FIXED',
          'description': null,
          'subtotal': 540,
          'delivery_fee': 100,
          'discount_amount': 50,
          'total': 590,
        },
      },
    };

/// Answers POST /orders with whatever [next] returns (or throws).
class _Api {
  _Api(this.next);
  Object Function() next;
  final bodies = <Map>[];

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    if (url == '/orders/validate-coupon') return _preview();
    bodies.add(body as Map);
    final v = next();
    if (v is Exception) throw v;
    return v;
  }

  List<Object?> get keys => bodies.map((b) => b['idempotency_key']).toList();
}

void main() {
  late int generated;
  String keys() => 'key-${++generated}';

  setUp(() => generated = 0);

  test('the real key generator makes distinct keys within the backend limit', () {
    final a = newCheckoutIdempotencyKey();
    final b = newCheckoutIdempotencyKey();
    expect(a, isNot(b));
    expect(a.length, lessThanOrEqualTo(128));
    expect(a, matches(RegExp(r'^cust_[0-9a-f]{32}$')));
  });

  test('a place-order sends an idempotency key', () async {
    final api = _Api(_placed);
    final orders = OrderProvider(request: api.call, idempotencyKeyGenerator: keys);
    final cart = CartProvider()..add(_milk);

    await orders.placeOrder(cart: cart, addressId: 'a1');

    expect(api.keys, ['key-1']);
  });

  test('a retry after a timeout sends the same key, and then gets the order', () async {
    final api = _Api(() => ApiException(408, 'That took too long. Try again.', code: 'TIMEOUT'));
    final orders = OrderProvider(request: api.call, idempotencyKeyGenerator: keys);
    final cart = CartProvider()..add(_milk);

    await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
    expect(cart.isEmpty, isFalse);
    api.next = () => ApiException(503, 'offline', code: 'NETWORK_ERROR');
    await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
    api.next = _placed;
    final order = await orders.placeOrder(cart: cart, addressId: 'a1');

    expect(order, isNotNull);
    expect(api.keys, ['key-1', 'key-1', 'key-1']);
    expect(generated, 1);
  });

  test('after a successful order the next checkout gets a new key', () async {
    final api = _Api(_placed);
    final orders = OrderProvider(request: api.call, idempotencyKeyGenerator: keys);
    final cart = CartProvider()..add(_milk);

    await orders.placeOrder(cart: cart, addressId: 'a1');
    expect(orders.pendingCheckoutKey, isNull);
    cart.add(_milk);
    await orders.placeOrder(cart: cart, addressId: 'a1');

    expect(api.keys, ['key-1', 'key-2']);
  });

  group('a changed checkout gets a new key', () {
    late _Api api;
    late OrderProvider orders;
    late CartProvider cart;

    setUp(() async {
      api = _Api(() => ApiException(408, 'slow', code: 'TIMEOUT'));
      orders = OrderProvider(request: api.call, idempotencyKeyGenerator: keys);
      cart = CartProvider()..add(_milk);
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
    });

    test('another item', () async {
      cart.add(_eggs);
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(api.keys, ['key-1', 'key-2']);
    });

    test('another quantity', () async {
      cart.add(_milk);
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(api.keys, ['key-1', 'key-2']);
    });

    test('another address', () async {
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a2'), throwsA(isA<ApiException>()));
      expect(api.keys, ['key-1', 'key-2']);
    });

    test('a coupon applied', () async {
      expect(await orders.applyCoupon('WELCOME50', cart), isTrue);
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(api.keys, ['key-1', 'key-2']);
      expect(api.bodies.last['coupon_code'], 'WELCOME50');
    });

    test('going back to the same checkout is a new attempt too', () async {
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a2'), throwsA(isA<ApiException>()));
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(api.keys, ['key-1', 'key-2', 'key-3']);
    });
  });

  test('a second tap while an order is being placed sends nothing', () async {
    final pending = Completer<Object>();
    final calls = <Object?>[];
    final orders = OrderProvider(
      request: (method, url, {body, query}) {
        calls.add(body);
        return pending.future;
      },
      idempotencyKeyGenerator: keys,
    );
    final cart = CartProvider()..add(_milk);

    final first = orders.placeOrder(cart: cart, addressId: 'a1');
    expect(orders.isPlacingOrder, isTrue);
    expect(await orders.placeOrder(cart: cart, addressId: 'a1'), isNull);
    expect(calls, hasLength(1));

    pending.complete(_placed());
    expect(await first, isNotNull);
    expect(orders.isPlacingOrder, isFalse);
  });

  test('logging out forgets the pending key', () async {
    final api = _Api(() => ApiException(408, 'slow', code: 'TIMEOUT'));
    final orders = OrderProvider(request: api.call, idempotencyKeyGenerator: keys);
    final cart = CartProvider()..add(_milk);
    await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
    expect(orders.pendingCheckoutKey, 'key-1');

    orders.reset();

    expect(orders.pendingCheckoutKey, isNull);
  });
}
