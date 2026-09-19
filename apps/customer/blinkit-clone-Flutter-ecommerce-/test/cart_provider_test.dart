import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Validation/app_validators.dart';

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

void main() {
  group('CartProvider', () {
    late CartProvider cart;

    setUp(() {
      cart = CartProvider();
    });

    test('Starts empty', () {
      expect(cart.isEmpty, isTrue);
      expect(cart.itemCount, equals(0));
      expect(cart.subtotal, equals(0.0));
    });

    test('Adding a product increments its quantity and the running subtotal', () {
      cart.add(_milk);
      expect(cart.quantityOf(_milk.id), equals(1));
      expect(cart.itemCount, equals(1));
      expect(cart.subtotal, equals(540.0));

      cart.add(_milk);
      expect(cart.quantityOf(_milk.id), equals(2));
      expect(cart.subtotal, equals(1080.0));
    });

    test('Adding two different products tracks each independently', () {
      cart.add(_milk);
      cart.add(_eggs);
      expect(cart.itemCount, equals(2));
      expect(cart.subtotal, equals(540.0 + 605.0));
      expect(cart.lines, hasLength(2));
    });

    test('Decrementing above 1 reduces quantity without removing the line', () {
      cart.add(_milk);
      cart.add(_milk);
      cart.decrement(_milk);
      expect(cart.quantityOf(_milk.id), equals(1));
      expect(cart.isEmpty, isFalse);
    });

    test('Decrementing from 1 removes the line entirely', () {
      cart.add(_milk);
      cart.decrement(_milk);
      expect(cart.quantityOf(_milk.id), equals(0));
      expect(cart.isEmpty, isTrue);
    });

    test('Clear empties the cart', () {
      cart.add(_milk);
      cart.add(_eggs);
      cart.clear();
      expect(cart.isEmpty, isTrue);
      expect(cart.itemCount, equals(0));
    });
  });

  group('quantity rules', () {
    test('quantities stay whole, at least 1, and capped at the backend max',
        () {
      final cart = CartProvider();
      const product = _milk;

      cart.add(product);
      expect(cart.quantityOf(_milk.id), 1);
      expect(cart.quantityOf(_milk.id), isA<int>());

      for (var i = 0; i < 200; i++) {
        cart.add(product);
      }
      // order.schema.ts caps a line at 100.
      expect(cart.quantityOf(_milk.id), AppValidators.quantityMax);

      cart.decrement(product);
      expect(cart.quantityOf(_milk.id), AppValidators.quantityMax - 1);
    });

    test('decrementing past 1 removes the line instead of going negative',
        () {
      final cart = CartProvider();
      const product = _milk;
      cart.add(product);

      cart.decrement(product);
      expect(cart.quantityOf(_milk.id), 0);
      expect(cart.isEmpty, isTrue);

      // Decrementing something not in the cart is a no-op, never negative.
      cart.decrement(product);
      expect(cart.quantityOf(_milk.id), 0);
      expect(cart.subtotal, 0);
    });
  });
}
