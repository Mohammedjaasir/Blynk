import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/combo_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/Services/reorder.dart';
import 'package:ecom/UI/Widgets/Atoms/card_combo_cart.dart';
import 'package:ecom/UI/Widgets/Atoms/category_offer_banner.dart';
import 'package:ecom/UI/Widgets/Atoms/combo_card.dart';
import 'package:ecom/UI/Widgets/Organisms/home_product_feed.dart';
import 'package:ecom/app_theme.dart';

/// Category offers and combo packs (owner, 2026-10-09). A category can run
/// "10% off everything here" (product prices already carry it); a combo pack
/// is a bundle of products at one price below their own, added to the cart
/// as its own line and sent to POST /orders as `combos: [{combo_id,
/// quantity}]`. The server re-prices both (backend/api/tests/
/// category-offers-and-combos.test.ts).

Map<String, dynamic> _comboJson({
  String id = 'k1',
  String name = 'Breakfast pack',
  Object price = 900,
  Object itemsTotal = 1020,
  Object? saving = 120,
  bool available = true,
  String? imageUrl,
  String? endsAt,
}) =>
    {
      'id': id,
      'name': name,
      'description': 'Everything for a Sunday breakfast',
      'image_url': imageUrl,
      'price': price,
      'ends_at': endsAt,
      'items_total': itemsTotal,
      'saving': saving,
      'is_available': available,
      'items': [
        {
          'product_id': 'p-bread',
          'name': 'Bread',
          'slug': 'bread',
          'unit': '450 g',
          'pack_size': null,
          'image_url': null,
          'image_focal_x': 50,
          'image_focal_y': 50,
          'quantity': 1,
          'selling_price': 220,
          'unit_price': 220,
          'is_available': true,
        },
        {
          'product_id': 'p-eggs',
          'name': 'Eggs',
          'slug': 'eggs',
          'unit': '10 pack',
          'image_url': null,
          'quantity': 2,
          'selling_price': '300.00',
          'unit_price': '280.00',
          'is_available': true,
        },
        {
          'product_id': 'p-milk',
          'name': 'Milk',
          'slug': 'milk',
          'unit': '1 l',
          'quantity': 1,
          'selling_price': 240,
          'unit_price': 240,
          'is_available': available,
        },
      ],
    };

ComboModel _combo({String id = 'k1', bool available = true, Object price = 900}) =>
    ComboModel.tryParse(_comboJson(id: id, available: available, price: price))!;

const _milk = ProductModel(
  id: 'p-milk',
  categoryId: 'c1',
  categoryName: 'Dairy',
  name: 'Milk',
  slug: 'milk',
  sku: 'MILK',
  unit: '1 l',
  sellingPrice: 240,
  isAvailable: true,
);

/// A StoreInfoProvider whose GET /store answered `show_offer_savings`
/// (owner, 2026-10-10): the combo "Save LKR" tag shows only while it is on.
Future<StoreInfoProvider> _store({required bool showOfferSavings}) async {
  final store = StoreInfoProvider(
    request: (_) async => {
      'success': true,
      'data': {'delivery_fee_lkr': 100, 'show_offer_savings': showOfferSavings},
    },
    readCache: () async => null,
    writeCache: (_) async {},
  );
  await store.load();
  return store;
}

Widget _host(WidgetTester tester, Widget child, {CartProvider? cart, ProductProvider? products, StoreInfoProvider? store}) {
  tester.view.physicalSize = const Size(420, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<CartProvider>.value(value: cart ?? CartProvider()),
      if (products != null) ChangeNotifierProvider<ProductProvider>.value(value: products),
      if (store != null) ChangeNotifierProvider<StoreInfoProvider>.value(value: store),
    ],
    child: MaterialApp(theme: AppTheme.theme, home: Scaffold(body: child)),
  );
}

Widget _card(ComboModel combo, {double width = 240}) => Builder(
      builder: (context) => Align(
        alignment: Alignment.topLeft,
        child: SizedBox(
          width: width,
          height: ComboCard.heightFor(context, width),
          child: ComboCard(combo: combo),
        ),
      ),
    );

class _Call {
  _Call(this.method, this.url, this.body);
  final String method;
  final String url;
  final Object? body;
}

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

Map<String, dynamic> _placed() => {
      'success': true,
      'data': {
        'order': {
          'id': 'o1',
          'order_number': 'BL-20261009-0001',
          'order_status': 'PLACED',
          'subtotal_amount': 1800,
          'delivery_fee': 0,
          'total_amount': 1800,
          'items': [],
          'combos': [],
        },
      },
    };

void main() {
  group('ComboModel', () {
    test('parses ComboPublic: price, items total, saving, items with quantities', () {
      final combo = _combo();
      expect(combo.id, 'k1');
      expect(combo.name, 'Breakfast pack');
      expect(combo.description, 'Everything for a Sunday breakfast');
      expect(combo.price, 900);
      expect(combo.itemsTotal, 1020);
      expect(combo.saving, 120);
      expect(combo.hasSaving, isTrue);
      expect(combo.isAvailable, isTrue);
      expect(combo.items.map((i) => i.productId), ['p-bread', 'p-eggs', 'p-milk']);
      expect(combo.items[1].quantity, 2);
      expect(combo.items[1].sellingPrice, 300);
      expect(combo.items[1].unitPrice, 280);
      expect(combo.itemsSummary, 'Bread, Eggs ×2, Milk');
    });

    test('numeric strings, a missing saving and an end date', () {
      final combo = ComboModel.tryParse(_comboJson(
        price: '900.50',
        itemsTotal: '1020.50',
        saving: null,
        endsAt: '2099-01-31T18:30:00.000Z',
      ))!;
      expect(combo.price, 900.5);
      expect(combo.saving, 120, reason: 'items_total - price when the server omits it');
      expect(combo.endsAt, DateTime.utc(2099, 1, 31, 18, 30));
      expect(combo.isLiveAt(DateTime.utc(2099, 1, 31, 18, 29)), isTrue);
      expect(combo.isLiveAt(DateTime.utc(2099, 1, 31, 18, 30)), isFalse);
    });

    test('no saving is drawn when the pack is not cheaper', () {
      final combo = ComboModel.tryParse(_comboJson(price: 1020, itemsTotal: 1020, saving: 0))!;
      expect(combo.hasSaving, isFalse);
    });

    test('anything unusable is null: no id, no price, no items', () {
      expect(ComboModel.tryParse(null), isNull);
      expect(ComboModel.tryParse({..._comboJson(), 'id': ''}), isNull);
      expect(ComboModel.tryParse({..._comboJson(), 'price': 0}), isNull);
      expect(ComboModel.tryParse({..._comboJson(), 'items': []}), isNull);
    });

    test('toJson reads back unchanged (the saved cart snapshot)', () {
      final combo = _combo();
      final back = ComboModel.tryParse(combo.toJson())!;
      expect(back.toJson(), combo.toJson());
      expect(back.itemsSummary, combo.itemsSummary);
    });
  });

  group('ComboCard', () {
    testWidgets('combo price, struck items total, Save tag (switch on), items summary, ADD', (tester) async {
      final cart = CartProvider();
      final store = await _store(showOfferSavings: true);
      await tester.pumpWidget(_host(tester, _card(_combo()), cart: cart, store: store));
      await tester.pumpAndSettle();

      expect(find.text('Breakfast pack'), findsOneWidget);
      expect(find.text('Bread, Eggs ×2, Milk'), findsOneWidget);
      expect(tester.widget<SalePrice>(find.byType(SalePrice)).amount, 900);
      expect(find.byKey(const Key('combo-items-total')), findsOneWidget);
      expect(find.text('LKR 1,020'), findsOneWidget);
      expect(find.byKey(const Key('combo-save-tag')), findsOneWidget);
      expect(find.text('Save LKR 120'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('ADD'));
      await tester.pumpAndSettle();
      expect(cart.comboQuantityOf('k1'), 1);
      expect(find.byKey(const ValueKey('combo-stepper/k1')), findsOneWidget);
    });

    // The "Save LKR X" switch (owner, 2026-10-10): off, or no store answer,
    // means no tag on the card or in the detail sheet.
    testWidgets('savings switch off: no Save tag on the card or the detail', (tester) async {
      final store = await _store(showOfferSavings: false);
      await tester.pumpWidget(_host(tester, _card(_combo()), store: store));
      await tester.pumpAndSettle();
      expect(tester.widget<SalePrice>(find.byType(SalePrice)).amount, 900);
      expect(find.byKey(const Key('combo-items-total')), findsOneWidget);
      expect(find.byType(ComboSaveTag), findsNothing);
      expect(find.textContaining('Save LKR'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('combo-card/k1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('combo-detail')), findsOneWidget);
      expect(find.byType(ComboSaveTag), findsNothing);
      expect(find.textContaining('Save LKR'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('no StoreInfoProvider in the tree: no Save tag', (tester) async {
      await tester.pumpWidget(_host(tester, _card(_combo())));
      await tester.pumpAndSettle();
      expect(find.byType(ComboSaveTag), findsNothing);
    });

    testWidgets('savings switch on: the detail sheet shows the Save tag too', (tester) async {
      final store = await _store(showOfferSavings: true);
      await tester.pumpWidget(_host(tester, _card(_combo()), store: store));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('combo-card/k1')));
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: find.byKey(const Key('combo-detail')), matching: find.text('Save LKR 120')),
        findsOneWidget,
      );
    });

    testWidgets('sold out: a disabled Sold out pill, nothing is added', (tester) async {
      final cart = CartProvider();
      await tester.pumpWidget(_host(tester, _card(_combo(available: false)), cart: cart));
      await tester.pumpAndSettle();
      expect(find.text('Sold out'), findsOneWidget);
      expect(find.text('ADD'), findsNothing);
      await tester.tap(find.text('Sold out'));
      await tester.pumpAndSettle();
      expect(cart.isEmpty, isTrue);
    });

    testWidgets('no struck price and no Save tag without a real saving', (tester) async {
      final combo = ComboModel.tryParse(_comboJson(price: 1020, itemsTotal: 1020, saving: 0))!;
      // Even with the savings switch on (owner, 2026-10-10).
      final store = await _store(showOfferSavings: true);
      await tester.pumpWidget(_host(tester, _card(combo), store: store));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('combo-items-total')), findsNothing);
      expect(find.byKey(const Key('combo-save-tag')), findsNothing);
    });

    testWidgets('tapping opens the detail: items with quantities and prices, Add to cart', (tester) async {
      final cart = CartProvider();
      await tester.pumpWidget(_host(tester, _card(_combo()), cart: cart));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('combo-card/k1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('combo-detail')), findsOneWidget);
      expect(find.text("What's inside"), findsOneWidget);
      expect(find.text('Everything for a Sunday breakfast'), findsOneWidget);
      expect(find.text('× 2 · 10 pack'), findsOneWidget);
      expect(find.text('LKR 560'), findsOneWidget, reason: 'Eggs: 2 x LKR 280');
      await tester.tap(find.byKey(const Key('combo-detail-add')));
      await tester.pumpAndSettle();
      expect(cart.comboQuantityOf('k1'), 1);
    });
  });

  group('cart combo lines', () {
    test('a separate line: totals include combo price x packs, savings add up', () {
      final cart = CartProvider()
        ..add(_milk)
        ..addCombo(_combo())
        ..addCombo(_combo());
      expect(cart.lines.single.product.id, 'p-milk',
          reason: 'a combo never becomes a product line, even with the same product inside');
      expect(cart.comboLines.single.quantity, 2);
      expect(cart.comboLines.single.lineTotal, 1800);
      expect(cart.subtotal, 240 + 1800);
      expect(cart.itemCount, 3);
      expect(cart.comboSavings, 240);
      expect(cart.isEmpty, isFalse);

      cart.decrementCombo(_combo());
      expect(cart.comboQuantityOf('k1'), 1);
      cart.decrementCombo(_combo());
      expect(cart.comboLines, isEmpty);
      cart.remove('p-milk');
      expect(cart.isEmpty, isTrue);
    });

    test('a combo is capped at 20 packs', () {
      final cart = CartProvider();
      for (var i = 0; i < 25; i++) {
        cart.addCombo(_combo());
      }
      expect(cart.comboQuantityOf('k1'), kComboQuantityMax);
    });

    test('a combo-only cart is not empty; clear empties both', () {
      final cart = CartProvider()..addCombo(_combo());
      expect(cart.isEmpty, isFalse);
      cart.clear();
      expect(cart.isEmpty, isTrue);
      expect(cart.comboLines, isEmpty);
    });

    test('saved and restored with the product lines; an older saved cart still reads', () {
      final raw = encodeSavedCart(
        const [CartLine(product: _milk, quantity: 2)],
        combos: [CartComboLine(combo: _combo(), quantity: 3)],
      );
      expect(decodeSavedCart(raw)!.single.quantity, 2);
      final combos = decodeSavedCombos(raw);
      expect(combos.single.combo.id, 'k1');
      expect(combos.single.quantity, 3);
      expect(combos.single.combo.itemsSummary, 'Bread, Eggs ×2, Milk');

      final older = encodeSavedCart(const [CartLine(product: _milk, quantity: 1)]);
      expect(decodeSavedCombos(older), isEmpty);
      expect(decodeSavedCart(older)!.single.product.id, 'p-milk');
    });

    test('syncCombos refreshes a snapshot with the latest combo', () {
      final cart = CartProvider()..addCombo(_combo());
      cart.syncCombos([_combo(price: 850)]);
      expect(cart.comboLines.single.combo.price, 850);
      expect(cart.subtotal, 850);
    });

    testWidgets('the cart line: name, items underneath, price x packs, saving, stepper', (tester) async {
      final cart = CartProvider()
        ..addCombo(_combo())
        ..addCombo(_combo());
      // The saving shows only with the Show 'Save LKR' switch on (owner, 2026-10-10).
      final store = await _store(showOfferSavings: true);
      await tester.pumpWidget(_host(
        tester,
        Consumer<CartProvider>(
          builder: (context, cart, _) => ListView(children: [
            for (final line in cart.comboLines) CartComboCard(line: line),
          ]),
        ),
        cart: cart,
        store: store,
      ));
      await tester.pumpAndSettle();
      expect(find.text('Breakfast pack'), findsOneWidget);
      expect(find.text('Bread'), findsOneWidget);
      expect(find.text('Eggs ×2'), findsOneWidget);
      expect(find.text('Milk'), findsOneWidget);
      expect(find.text('LKR 1,800'), findsOneWidget);
      expect(find.text('2 × LKR 900'), findsOneWidget);
      expect(find.text('You save LKR 240'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // Switch off: no saving line in the cart either.
      final off = await _store(showOfferSavings: false);
      await tester.pumpWidget(_host(
        tester,
        Consumer<CartProvider>(
          builder: (context, cart, _) => ListView(children: [
            for (final line in cart.comboLines) CartComboCard(line: line),
          ]),
        ),
        cart: cart,
        store: off,
      ));
      await tester.pumpAndSettle();
      expect(find.textContaining('You save'), findsNothing);

      await tester.tap(find.byTooltip('Remove Breakfast pack'));
      await tester.pumpAndSettle();
      expect(cart.isEmpty, isTrue);
    });
  });

  group('checkout payload', () {
    test('POST /orders sends combos alongside items', () async {
      final cart = CartProvider()
        ..add(_milk)
        ..addCombo(_combo())
        ..addCombo(_combo());
      final api = _FakeApi((_) => _placed());
      final orders = OrderProvider(request: api.call);
      await orders.placeOrder(cart: cart, addressId: 'a1');
      final body = api.to('/orders').single.body as Map;
      expect(body['items'], [
        {'product_id': 'p-milk', 'quantity': 1},
      ]);
      expect(body['combos'], [
        {'combo_id': 'k1', 'quantity': 2},
      ]);
      expect(cart.isEmpty, isTrue, reason: 'a placed order clears combos too');
    });

    test('a combo-only cart sends empty items and the combos', () async {
      final cart = CartProvider()..addCombo(_combo());
      final api = _FakeApi((_) => _placed());
      await OrderProvider(request: api.call).placeOrder(cart: cart, addressId: 'a1');
      final body = api.to('/orders').single.body as Map;
      expect(body['items'], isEmpty);
      expect(body['combos'], [
        {'combo_id': 'k1', 'quantity': 1},
      ]);
    });

    test('a cart without combos sends no combos key (unchanged payload)', () async {
      final cart = CartProvider()..add(_milk);
      final api = _FakeApi((_) => _placed());
      await OrderProvider(request: api.call).placeOrder(cart: cart, addressId: 'a1');
      expect((api.to('/orders').single.body as Map).containsKey('combos'), isFalse);
    });

    test('validate-coupon gets the combos too, and a combo change makes the preview stale', () async {
      final cart = CartProvider()..addCombo(_combo());
      final api = _FakeApi((_) => {
            'success': true,
            'data': {
              'coupon': {
                'code': 'WELCOME50',
                'discount_amount': 50,
                'subtotal': 900,
                'delivery_fee': 0,
                'total': 850,
              },
            },
          });
      final orders = OrderProvider(request: api.call);
      await orders.applyCoupon('WELCOME50', cart);
      final body = api.to('/orders/validate-coupon').single.body as Map;
      expect(body['combos'], [
        {'combo_id': 'k1', 'quantity': 1},
      ]);
      cart.addCombo(_combo());
      expect(orders.couponIsStale(cart), isTrue);
    });

    test('combo refusals have friendly copy', () async {
      for (final code in ['COMBO_NOT_FOUND', 'COMBO_UNAVAILABLE', 'COMBO_OUT_OF_STOCK']) {
        final error = AppErrors.from(ApiException(code == 'COMBO_OUT_OF_STOCK' ? 409 : 400, 'raw', code: code));
        expect(error.message, contains('combo pack'), reason: code);
        expect(error.message, isNot(contains('raw')));
      }
      final cart = CartProvider()..addCombo(_combo());
      final api = _FakeApi((_) => throw ApiException(409, 'x', code: 'COMBO_OUT_OF_STOCK'));
      final orders = OrderProvider(request: api.call);
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(orders.placeOrderFailure!.message, contains('sold out'));
      expect(cart.isEmpty, isFalse, reason: 'a refused order keeps the cart');
    });
  });

  group('orders with combos', () {
    test('combo items group under their combo; loose items stay loose', () {
      final order = OrderModel.tryParse({
        'id': 'o1',
        'order_status': 'PLACED',
        'items': [
          {'id': 'i1', 'product_name_snapshot': 'Bread', 'quantity': 2, 'order_combo_id': 'oc1'},
          {'id': 'i2', 'product_name_snapshot': 'Eggs', 'quantity': 4, 'order_combo_id': 'oc1'},
          {'id': 'i3', 'product_name_snapshot': 'Rice', 'quantity': 1, 'order_combo_id': null},
        ],
        'combos': [
          {
            'id': 'oc1',
            'order_id': 'o1',
            'combo_id': 'k1',
            'name': 'Breakfast pack',
            'unit_price': '900.00',
            'quantity': 2,
            'subtotal': '1800.00',
            'items_regular_total': '1020.00',
          },
        ],
      })!;
      expect(order.combos.single.name, 'Breakfast pack');
      expect(order.combos.single.subtotal, 1800);
      expect(order.combos.single.itemsRegularTotal, 1020);
      expect(order.itemsOfCombo('oc1').map((i) => i.id), ['i1', 'i2']);
      expect(order.looseItems.map((i) => i.id), ['i3']);
      expect(order.lineNames, ['Breakfast pack', 'Rice']);
    });

    test('an order from a backend without combos is unchanged', () {
      final order = OrderModel.tryParse({
        'id': 'o1',
        'items': [
          {'id': 'i1', 'product_name_snapshot': 'Rice', 'quantity': 1},
        ],
      })!;
      expect(order.combos, isEmpty);
      expect(order.looseItems.single.orderComboId, isNull);
      expect(order.lineNames, ['Rice']);
    });
  });

  group('order again with a combo', () {
    Map<String, dynamic> order() => {
          'id': 'o1',
          'order_status': 'DELIVERED',
          'items': [
            {'id': 'i1', 'product_id': 'p-bread', 'product_name_snapshot': 'Bread', 'quantity': 2, 'order_combo_id': 'oc1'},
            {'id': 'i2', 'product_id': 'p-milk', 'product_name_snapshot': 'Milk', 'quantity': 1},
          ],
          'combos': [
            {'id': 'oc1', 'combo_id': 'k1', 'name': 'Breakfast pack', 'unit_price': 900, 'quantity': 2, 'subtotal': 1800},
          ],
        };

    ProductProvider products({required bool comboLive}) => ProductProvider(request: (url, query) async {
          if (url == '/combos') {
            return {
              'success': true,
              'data': {'combos': comboLive ? [_comboJson()] : []},
            };
          }
          final id = url.split('/').last;
          return {
            'data': {
              'product': {
                'id': id,
                'name': id,
                'slug': id,
                'sku': id,
                'unit': '1',
                'selling_price': 200,
                'is_available': true,
                'category_id': 'c1',
                'category_name': 'Dairy',
              },
            },
          };
        });

    test('a live combo goes back in as packs; loose items as products', () async {
      final cart = CartProvider();
      final result = await reorderInto(
        order: OrderModel.tryParse(order())!,
        products: products(comboLive: true),
        cart: cart,
      );
      expect(cart.comboQuantityOf('k1'), 2);
      expect(cart.quantityOf('p-bread'), 0, reason: "the pack's bread is inside the pack");
      expect(cart.quantityOf('p-milk'), 1);
      expect(result.addedUnits, 3);
    });

    test('an ended combo falls back to its products', () async {
      final cart = CartProvider();
      await reorderInto(order: OrderModel.tryParse(order())!, products: products(comboLive: false), cart: cart);
      expect(cart.comboLines, isEmpty);
      expect(cart.quantityOf('p-bread'), 2);
      expect(cart.quantityOf('p-milk'), 1);
    });
  });

  group('combos from the catalog', () {
    test('GET /combos loads live combos; a catalog refresh reloads them', () async {
      var calls = 0;
      final provider = ProductProvider(request: (url, query) async {
        if (url == '/combos') {
          calls++;
          return {
            'success': true,
            'data': {
              'combos': [_comboJson(), _comboJson(id: 'k2', available: false), {'id': 'bad'}],
            },
          };
        }
        return {'success': true, 'data': {'categories': [], 'products': [], 'promotions': []}};
      });
      await provider.loadCombos();
      expect(provider.combos.map((c) => c.id), ['k1', 'k2']);
      expect(provider.comboById('k2')!.isAvailable, isFalse);
      await provider.refreshCatalog(force: true);
      expect(calls, 2);
    });

    testWidgets('Home: a Combo packs rail above the Offers rail, hidden when empty', (tester) async {
      Future<ProductProvider> pump(List<Map<String, dynamic>> combos) async {
        final provider = ProductProvider(request: (url, query) async {
          if (url == '/combos') return {'success': true, 'data': {'combos': combos}};
          if (url == '/catalog/products' || url == '/products') {
            return {
              'success': true,
              'data': {
                'products': [
                  {
                    'id': 'p1',
                    'category_id': 'c1',
                    'category_name': 'Dairy',
                    'name': 'Milk',
                    'slug': 'milk',
                    'sku': 'M',
                    'unit': '1 l',
                    'selling_price': 240,
                    'is_available': true,
                  },
                ],
                'pagination': {'page': 1, 'limit': 100, 'total': 1, 'total_pages': 1},
              },
            };
          }
          return {'success': true, 'data': {'categories': []}};
        });
        await tester.pumpWidget(_host(
          tester,
          const CustomScrollView(slivers: [HomeProductFeed()]),
          products: provider,
        ));
        await tester.pumpAndSettle();
        return provider;
      }

      await pump([_comboJson()]);
      expect(find.byKey(const ValueKey('home-combos')), findsOneWidget);
      expect(find.text(HomeProductFeed.combosTitle), findsOneWidget);
      expect(find.byType(ComboCard), findsOneWidget);
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('home-combos'))).dy,
        lessThan(tester.getTopLeft(find.byKey(const ValueKey('home-all-products'))).dy),
      );

      await pump(const []);
      expect(find.byKey(const ValueKey('home-combos')), findsNothing);
      expect(find.text(HomeProductFeed.combosTitle), findsNothing);
    });
  });

  group('category offers', () {
    test('CategoryModel parses offer_percent / offer_ends_at', () {
      final c = CategoryModel.fromJson({
        'id': 'c1',
        'name': 'Dairy',
        'slug': 'dairy',
        'offer_percent': '10.00',
        'offer_ends_at': '2099-01-31T18:30:00.000Z',
      });
      expect(c.offerPercent, 10);
      expect(c.offerEndsAt, DateTime.utc(2099, 1, 31, 18, 30));
      expect(c.isOfferActive, isTrue);
      expect(c.offerPercentLabel, '10%');
      expect(CategoryModel.fromJson({'id': 'c', 'name': 'x', 'slug': 'x', 'offer_percent': 12.5}).offerPercentLabel,
          '12.5%');
    });

    test('no offer, an ended one or garbage: inactive', () {
      expect(CategoryModel.fromJson({'id': 'c', 'name': 'x', 'slug': 'x'}).isOfferActive, isFalse);
      expect(
        CategoryModel.fromJson({'id': 'c', 'name': 'x', 'slug': 'x', 'offer_percent': 10, 'offer_ends_at': '2000-01-01T00:00:00Z'})
            .isOfferActive,
        isFalse,
      );
      expect(CategoryModel.fromJson({'id': 'c', 'name': 'x', 'slug': 'x', 'offer_percent': 'abc'}).offerPercent, isNull);
      expect(CategoryModel.fromJson({'id': 'c', 'name': 'x', 'slug': 'x', 'offer_percent': 100}).offerPercent, isNull);
    });

    test('a product priced by a category offer says so (offer_kind)', () {
      final p = ProductModel.fromJson({
        'id': 'p',
        'name': 'Milk',
        'selling_price': 250,
        'offer_price': 225,
        'offer_kind': 'CATEGORY',
        'is_available': true,
      });
      expect(p.isCategoryOffer, isTrue);
      expect(p.effectivePrice, 225);
      expect(ProductModel.fromJson(p.toJson()).offerKind, 'CATEGORY');
      expect(ProductModel.fromJson({'id': 'q', 'offer_kind': 'WHATEVER'}).offerKind, isNull);
    });

    testWidgets('the banner: "10% off everything here", with the end date when there is one', (tester) async {
      const open = CategoryModel(id: 'c1', name: 'Dairy', slug: 'dairy', offerPercent: 10);
      await tester.pumpWidget(_host(tester, const CategoryOfferBanner(category: open)));
      expect(find.text('10% off everything here'), findsOneWidget);

      final ending = CategoryModel(
        id: 'c1',
        name: 'Dairy',
        slug: 'dairy',
        offerPercent: 10,
        offerEndsAt: DateTime.now().add(const Duration(days: 2)),
      );
      await tester.pumpWidget(_host(tester, CategoryOfferBanner(category: ending)));
      expect(find.textContaining('10% off everything here until '), findsOneWidget);

      const none = CategoryModel(id: 'c1', name: 'Dairy', slug: 'dairy');
      await tester.pumpWidget(_host(tester, const CategoryOfferBanner(category: none)));
      expect(find.byKey(const Key('category-offer-banner')), findsNothing);
    });
  });
}
