import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/LocalStorage/cart_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Validation/app_validators.dart';

import 'fixtures/order_fixtures.dart';

/// The cart is remembered across app restarts and web reloads (2026-10-06):
/// written on every change, read back at launch, cleared by a successful
/// order or a logout, and safe against anything odd in storage.

const _milk = ProductModel(
  id: 'b0000001-0000-0000-0000-000000000001',
  categoryId: 'c1',
  categoryName: 'Dairy & Eggs',
  name: 'Kotmale Fresh Milk 1L',
  slug: 'kotmale-fresh-milk-1l',
  sku: 'SKU-DAI-001',
  unit: '1 L',
  packSize: 'Tetra Pack',
  imageUrl: 'https://cdn.example/milk.jpg',
  imageFocalX: 30,
  imageFocalY: 70,
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

class _MemoryStorage implements CartStorage {
  _MemoryStorage([this.value]);
  String? value;
  int clears = 0;

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String v) async => value = v;

  @override
  Future<void> clear() async {
    clears++;
    value = null;
  }
}

class _BrokenStorage implements CartStorage {
  @override
  Future<String?> read() => Future.error(StateError('keystore'));
  @override
  Future<void> write(String value) => Future.error(StateError('keystore'));
  @override
  Future<void> clear() => Future.error(StateError('keystore'));
}

void main() {
  group('saved cart format', () {
    test('a product survives the round trip with everything needed to draw it', () {
      final lines = decodeSavedCart(encodeSavedCart(const [CartLine(product: _milk, quantity: 3)]))!;
      final p = lines.single.product;
      expect(lines.single.quantity, 3);
      expect(p.id, _milk.id);
      expect(p.name, _milk.name);
      expect(p.unit, _milk.unit);
      expect(p.packSize, 'Tetra Pack');
      expect(p.imageUrl, 'https://cdn.example/milk.jpg');
      expect(p.imageFocalX, 30);
      expect(p.imageFocalY, 70);
      expect(p.sellingPrice, 540);
      expect(p.isAvailable, isTrue);
    });

    test('nothing stored is an empty cart', () {
      expect(decodeSavedCart(null), isEmpty);
      expect(decodeSavedCart(''), isEmpty);
    });

    test('corrupt or foreign data is rejected, never thrown', () {
      for (final raw in [
        'not json',
        '[]',
        '{"lines": []}',
        '{"v": 99, "lines": []}',
        '{"v": 1, "lines": "x"}',
        '{"v": 1}',
      ]) {
        expect(decodeSavedCart(raw), isNull, reason: raw);
      }
    });

    test('bad lines are skipped and good ones kept; quantities stay in range', () {
      final raw = jsonEncode({
        'v': kSavedCartVersion,
        'lines': [
          'junk',
          {'product': 'x', 'quantity': 1},
          {'product': {'id': '', 'name': 'No id'}, 'quantity': 1},
          {'product': _eggs.toJson(), 'quantity': 0},
          {'product': _eggs.toJson(), 'quantity': 'two'},
          {'product': _milk.toJson(), 'quantity': 5000},
          {'product': _milk.toJson(), 'quantity': 2}, // a duplicate id
          {'product': _eggs.toJson(), 'quantity': 2},
        ],
      });
      final lines = decodeSavedCart(raw)!;
      expect(lines.map((l) => l.product.id), [_milk.id, _eggs.id]);
      expect(lines.first.quantity, AppValidators.quantityMax);
      expect(lines.last.quantity, 2);
    });

    test('an absurd number of lines is treated as corrupt', () {
      final raw = jsonEncode({
        'v': kSavedCartVersion,
        'lines': List.generate(kSavedCartMaxLines + 1, (_) => {'product': _milk.toJson(), 'quantity': 1}),
      });
      expect(decodeSavedCart(raw), isNull);
    });
  });

  group('CartProvider with storage', () {
    test('every change is written, and a fresh cart restores it', () async {
      final storage = _MemoryStorage();
      final cart = CartProvider(storage: storage)
        ..add(_milk)
        ..add(_milk)
        ..add(_eggs);
      await cart.pendingWrites;

      final relaunched = CartProvider(storage: storage);
      var notified = 0;
      relaunched.addListener(() => notified++);
      await relaunched.restore();

      expect(relaunched.quantityOf(_milk.id), 2);
      expect(relaunched.quantityOf(_eggs.id), 1);
      expect(relaunched.subtotal, 540 * 2 + 605);
      expect(notified, 1);
    });

    test('removing the last item clears what is stored', () async {
      final storage = _MemoryStorage();
      final cart = CartProvider(storage: storage)..add(_milk);
      await cart.pendingWrites;
      expect(storage.value, isNotNull);

      cart.decrement(_milk);
      await cart.pendingWrites;

      expect(storage.value, isNull);
    });

    test('an item added before the restore finishes wins over the saved one', () async {
      final storage = _MemoryStorage(encodeSavedCart(const [
        CartLine(product: _milk, quantity: 4),
        CartLine(product: _eggs, quantity: 1),
      ]));
      final cart = CartProvider(storage: storage)..add(_milk);
      await cart.restore();
      await cart.pendingWrites;

      expect(cart.quantityOf(_milk.id), 1);
      expect(cart.quantityOf(_eggs.id), 1);
      // The merged cart is what is stored now.
      final stored = decodeSavedCart(storage.value)!;
      expect({for (final l in stored) l.product.id: l.quantity}, {_milk.id: 1, _eggs.id: 1});
    });

    test('a cart cleared during launch is not brought back by the restore', () async {
      final storage = _MemoryStorage(encodeSavedCart(const [CartLine(product: _milk, quantity: 2)]));
      final cart = CartProvider(storage: storage);
      final restoring = cart.restore();
      cart.clear();
      await restoring;
      await cart.pendingWrites;

      expect(cart.isEmpty, isTrue);
      expect(storage.value, isNull);
    });

    test('corrupt stored data loads nothing and is removed', () async {
      final storage = _MemoryStorage('{"v": 1, "lines": oops');
      final cart = CartProvider(storage: storage);
      await cart.restore();
      await cart.pendingWrites;

      expect(cart.isEmpty, isTrue);
      expect(storage.value, isNull);
      expect(storage.clears, 1);
    });

    test('restore runs once', () async {
      final storage = _MemoryStorage(encodeSavedCart(const [CartLine(product: _milk, quantity: 2)]));
      final cart = CartProvider(storage: storage);
      await cart.restore();
      cart.remove(_milk.id);
      await cart.restore();
      expect(cart.isEmpty, isTrue);
    });

    test('storage that fails is a cart that is not remembered, not a crash', () async {
      final cart = CartProvider(storage: _BrokenStorage())..add(_milk);
      await cart.restore();
      await cart.pendingWrites;
      expect(cart.quantityOf(_milk.id), 1);
    });

    test('a successful order clears the stored cart', () async {
      final storage = _MemoryStorage();
      final cart = CartProvider(storage: storage)..add(_milk);
      final orders = OrderProvider(
        request: (method, url, {body, query}) async => {
          'success': true,
          'data': {'order': orderJson(id: 'o1')},
        },
      );
      await orders.placeOrder(cart: cart, addressId: 'a1');
      await cart.pendingWrites;

      expect(cart.isEmpty, isTrue);
      expect(storage.value, isNull);
    });

    test('without storage the cart is in memory only', () async {
      final cart = CartProvider()..add(_milk);
      await cart.restore();
      expect(cart.quantityOf(_milk.id), 1);
    });
  });
}
