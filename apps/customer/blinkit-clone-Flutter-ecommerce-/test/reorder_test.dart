import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/reorder.dart';
import 'package:ecom/UI/Widgets/Organisms/order_again_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'fixtures/order_fixtures.dart';

/// A catalog product as GET /catalog/products/:id returns it.
Map<String, dynamic> _product(String id, String name, num price, {bool available = true}) => {
      'data': {
        'product': {
          'id': id,
          'name': name,
          'slug': id,
          'sku': 'SKU-$id',
          'unit': '1 pc',
          'selling_price': price,
          'is_available': available,
          'category_id': 'c1',
          'category_name': 'Groceries',
        },
      },
    };

/// Answers GET /catalog/products/<id> from [catalog]; anything missing is a
/// 404, and [offline] makes every call a dropped connection.
ProductProvider _products(Map<String, Map<String, dynamic>> catalog, {bool offline = false}) {
  return ProductProvider(request: (url, query) async {
    if (offline) throw Exception('SocketException: Failed host lookup');
    final id = url.split('/').last;
    final hit = catalog[id];
    if (hit == null) throw ApiException(404, 'Product not found');
    return hit;
  });
}

OrderModel _order({String status = 'DELIVERED', List<Map<String, dynamic>>? items}) =>
    OrderModel.fromJson(orderJson(status: status, items: items));

void main() {
  group('reorderInto', () {
    test('puts every product back at today\'s price and the old quantities', () async {
      // itemJson('i1', ...) has product id 'p-i1'.
      final products = _products({
        'p-i1': _product('p-i1', 'Kotmale Fresh Milk 1L', 560),
        'p-i2': _product('p-i2', 'Butter 200g', 805),
      });
      final cart = CartProvider();

      final result = await reorderInto(order: _order(), products: products, cart: cart);

      expect(result.addedUnits, 3);
      expect(result.unavailable, isEmpty);
      expect(result.offline, isFalse);
      expect(cart.quantityOf('p-i1'), 2);
      expect(cart.quantityOf('p-i2'), 1);
      // Today's price, not the 540 the old order was placed at.
      expect(cart.subtotal, 2 * 560 + 805);
    });

    test('skips products that are out of stock or gone, and names them', () async {
      final products = _products({
        'p-i1': _product('p-i1', 'Kotmale Fresh Milk 1L', 540, available: false),
        // p-i2 is missing -> 404 (deleted or deactivated).
      });
      final order = _order(items: [
        itemJson('i1', 'Kotmale Fresh Milk 1L', 2, 540),
        itemJson('i2', 'Butter 200g', 1, 805),
      ]);
      final cart = CartProvider();

      final result = await reorderInto(order: order, products: products, cart: cart);

      expect(result.addedUnits, 0);
      expect(result.unavailable, ['Kotmale Fresh Milk 1L', 'Butter 200g']);
      expect(cart.isEmpty, isTrue);
    });

    test('adds to what is already in the cart', () async {
      final products = _products({
        'p-i1': _product('p-i1', 'Kotmale Fresh Milk 1L', 540),
        'p-i2': _product('p-i2', 'Butter 200g', 805),
      });
      final cart = CartProvider();
      await products.loadProductDetail('p-i1');
      cart.add(products.productDetail('p-i1')!);

      await reorderInto(order: _order(), products: products, cart: cart);

      expect(cart.quantityOf('p-i1'), 3);
    });

    test('offline: nothing is added and it says so', () async {
      final cart = CartProvider();
      final result = await reorderInto(order: _order(), products: _products({}, offline: true), cart: cart);

      expect(result.offline, isTrue);
      expect(result.addedUnits, 0);
      expect(cart.isEmpty, isTrue);
    });
  });

  test('addQuantity respects the 100-per-item cap', () async {
    final products = _products({'p-i1': _product('p-i1', 'Milk', 540)});
    await products.loadProductDetail('p-i1');
    final cart = CartProvider();

    expect(cart.addQuantity(products.productDetail('p-i1')!, 98), 98);
    expect(cart.addQuantity(products.productDetail('p-i1')!, 5), 2);
    expect(cart.quantityOf('p-i1'), 100);
  });

  test('only finished orders with items offer Order again', () {
    expect(canReorder(_order(status: 'DELIVERED')), isTrue);
    expect(canReorder(_order(status: 'CANCELLED')), isTrue);
    expect(canReorder(_order(status: 'FAILED')), isTrue);
    expect(canReorder(_order(status: 'PLACED')), isFalse);
    expect(canReorder(_order(status: 'OUT_FOR_DELIVERY')), isFalse);
    expect(canReorder(_order(items: [])), isFalse);
  });

  testWidgets('tapping Order again fills the cart and opens it', (tester) async {
    final products = _products({
      'p-i1': _product('p-i1', 'Kotmale Fresh Milk 1L', 540),
      'p-i2': _product('p-i2', 'Butter 200g', 805),
    });
    final cart = CartProvider();

    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<ProductProvider>.value(value: products),
        ChangeNotifierProvider<CartProvider>.value(value: cart),
      ],
      child: MaterialApp(
        routes: {'/cart': (_) => const Scaffold(body: Text('cart page'))},
        home: Scaffold(body: Center(child: OrderAgainButton(order: _order()))),
      ),
    ));

    await tester.tap(find.text('Order again'));
    await tester.pumpAndSettle();

    expect(find.text('cart page'), findsOneWidget);
    expect(find.text('Added 3 items to your cart.'), findsOneWidget);
    expect(cart.itemCount, 3);
  });

  testWidgets('when nothing is available it stays and explains', (tester) async {
    final cart = CartProvider();
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<ProductProvider>.value(value: _products({})),
        ChangeNotifierProvider<CartProvider>.value(value: cart),
      ],
      child: MaterialApp(
        routes: {'/cart': (_) => const Scaffold(body: Text('cart page'))},
        home: Scaffold(body: Center(child: OrderAgainButton(order: _order()))),
      ),
    ));

    await tester.tap(find.text('Order again'));
    await tester.pumpAndSettle();

    expect(find.text('cart page'), findsNothing);
    expect(find.text("These items aren't available right now."), findsOneWidget);
    expect(cart.isEmpty, isTrue);
  });
}
