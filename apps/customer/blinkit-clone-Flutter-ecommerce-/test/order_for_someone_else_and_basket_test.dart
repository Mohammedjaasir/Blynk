import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/card_cart_prices_detail.dart';
import 'package:ecom/UI/Widgets/Organisms/checkout_recipient_section.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';

/// Owner, 2026-10-12: free delivery above a basket amount ("Add LKR X more
/// for free delivery", fee 0 once reached) and ordering for family /
/// someone else at checkout (receiver for this order only, a rider note,
/// "needs help"). The server decides both again at placeOrder
/// (backend/api/tests/basket-free-delivery.test.ts,
/// backend/api/tests/order-for-someone-else.test.ts).

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

Map<String, dynamic> _checkoutInfo({
  Map<String, dynamic>? basket,
  Map<String, dynamic>? someoneElse,
}) =>
    {
      'success': true,
      'data': {
        'delivery_fee_lkr': 100,
        'standard_delivery_fee_lkr': 100,
        'coupons_enabled': false,
        'free_delivery': {'enabled': false, 'count': 0, 'used': 0, 'remaining': 0, 'applies': false},
        if (basket != null) 'basket_free_delivery': basket,
        if (someoneElse != null) 'order_for_someone_else': someoneElse,
      },
    };

StoreInfoProvider _store(Map<String, dynamic> info) =>
    StoreInfoProvider(request: (_) async => info, readCache: () async => null, writeCache: (_) async {});

/// Answers POST /orders and keeps the bodies.
class _Api {
  final bodies = <Map>[];

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    bodies.add(body as Map);
    return {
      'success': true,
      'data': {'order': orderJson(id: 'o1')},
    };
  }
}

Future<void> _pumpSummary(WidgetTester tester, StoreInfoProvider store, {int quantity = 1}) async {
  final cart = CartProvider();
  for (var i = 0; i < quantity; i++) {
    cart.add(_milk);
  }
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
  group('BasketFreeDelivery', () {
    test('parses the setting; ignores malformed ones', () {
      expect(BasketFreeDelivery.tryParse({'enabled': true, 'min_subtotal_lkr': 3000}),
          const BasketFreeDelivery(enabled: true, minSubtotal: 3000));
      expect(BasketFreeDelivery.tryParse({'enabled': true, 'min_subtotal_lkr': '2500.5'})!.minSubtotal, 2500.5);
      expect(BasketFreeDelivery.tryParse(null), isNull);
      expect(BasketFreeDelivery.tryParse({'enabled': 'yes', 'min_subtotal_lkr': 3000}), isNull);
      expect(BasketFreeDelivery.tryParse({'enabled': true, 'min_subtotal_lkr': 0}), isNull);
      expect(BasketFreeDelivery.tryParse({'enabled': true, 'min_subtotal_lkr': -1}), isNull);
    });

    test('reached at or above the amount; what is left; progress', () {
      const b = BasketFreeDelivery(enabled: true, minSubtotal: 3000);
      expect(b.reachedBy(3000), isTrue);
      expect(b.reachedBy(2999.99), isFalse);
      expect(b.remainingFor(2550), 450);
      expect(b.remainingFor(3500), 0);
      expect(b.progressFor(1500), 0.5);
      expect(b.progressFor(4000), 1);
      const off = BasketFreeDelivery(enabled: false, minSubtotal: 3000);
      expect(off.reachedBy(5000), isFalse);
      expect(off.remainingFor(100), 0);
    });
  });

  group('StoreInfoProvider', () {
    test('the fee for a cart drops to 0 once the basket reaches the amount', () async {
      final p = _store(_checkoutInfo(basket: {'enabled': true, 'min_subtotal_lkr': 1000}));
      await p.loadCheckoutInfo(signedIn: true);
      expect(p.basketFreeDelivery, const BasketFreeDelivery(enabled: true, minSubtotal: 1000));
      expect(p.checkoutDeliveryFeeFor(540), 100);
      expect(p.checkoutDeliveryFeeFor(1080), 0);
      // Without the basket (an older backend, or switched off) nothing changes.
      final older = _store(_checkoutInfo());
      await older.loadCheckoutInfo(signedIn: true);
      expect(older.basketFreeDelivery, isNull);
      expect(older.checkoutDeliveryFeeFor(100000), 100);
      final off = _store(_checkoutInfo(basket: {'enabled': false, 'min_subtotal_lkr': 1000}));
      await off.loadCheckoutInfo(signedIn: true);
      expect(off.checkoutDeliveryFeeFor(5000), 100);
    });

    test('reads "for someone else"; signed out forgets it', () async {
      final p = _store(_checkoutInfo(someoneElse: {'enabled': true, 'send_code_to_receiver': false}));
      await p.loadCheckoutInfo(signedIn: true);
      expect(p.someoneElseOrdering, const SomeoneElseOrdering(enabled: true, sendCodeToReceiver: false));
      await p.loadCheckoutInfo(signedIn: false);
      expect(p.someoneElseOrdering, isNull);
      expect(SomeoneElseOrdering.tryParse({'enabled': 'on'}), isNull);
    });
  });

  group('Order summary', () {
    testWidgets('below the amount: the fee and "Add LKR X more for free delivery"', (tester) async {
      final store = _store(_checkoutInfo(basket: {'enabled': true, 'min_subtotal_lkr': 1000}));
      await store.loadCheckoutInfo(signedIn: true);
      await _pumpSummary(tester, store);
      expect(find.byKey(BasketFreeDeliveryProgress.progressKey), findsOneWidget);
      expect(find.text('Add ${formatLkr(460)} more for free delivery'), findsOneWidget);
      expect(find.byKey(const Key('summary-free-delivery')), findsNothing);
    });

    testWidgets('at or above the amount: FREE, with the basket note', (tester) async {
      final store = _store(_checkoutInfo(basket: {'enabled': true, 'min_subtotal_lkr': 1000}));
      await store.loadCheckoutInfo(signedIn: true);
      await _pumpSummary(tester, store, quantity: 2);
      expect(find.byKey(const Key('summary-free-delivery')), findsOneWidget);
      expect(find.text('Free delivery on orders of ${formatLkr(1000)} or more.'), findsOneWidget);
      expect(find.byKey(BasketFreeDeliveryProgress.progressKey), findsNothing);
    });

    testWidgets('switched off: nothing about it', (tester) async {
      final store = _store(_checkoutInfo(basket: {'enabled': false, 'min_subtotal_lkr': 1000}));
      await store.loadCheckoutInfo(signedIn: true);
      await _pumpSummary(tester, store, quantity: 2);
      expect(find.byKey(BasketFreeDeliveryProgress.progressKey), findsNothing);
      expect(find.byKey(const Key('summary-free-delivery')), findsNothing);
    });
  });

  group('OrderProvider: order for someone else', () {
    test('sends the receiver, the note and needs_help; then clears them', () async {
      final api = _Api();
      final orders = OrderProvider(request: api.call, idempotencyKeyGenerator: () => 'k1');
      final cart = CartProvider()..add(_milk);
      orders
        ..setForSomeoneElse(true)
        ..setRecipientName('  Amma   Fathima ')
        ..setRecipientPhone('070 945 0001')
        ..setDeliveryNote('Blue gate')
        ..setNeedsHelp(true);
      expect(orders.checkoutDetailsProblem(), isNull);
      await orders.placeOrder(cart: cart, addressId: 'a1');
      expect(api.bodies.single, containsPair('for_someone_else', true));
      expect(api.bodies.single['recipient'], {'name': 'Amma Fathima', 'phone': '+94709450001'});
      expect(api.bodies.single['delivery_note'], 'Blue gate');
      expect(api.bodies.single['needs_help'], true);
      expect(orders.forSomeoneElse, isFalse);
      expect(orders.recipientName, '');
      expect(orders.needsHelp, isFalse);
    });

    test('switched off by staff (or toggled off): no receiver is sent', () async {
      final api = _Api();
      final orders = OrderProvider(request: api.call, idempotencyKeyGenerator: () => 'k1');
      orders
        ..setForSomeoneElse(true)
        ..setRecipientName('Amma')
        ..setRecipientPhone('0709450001');
      await orders.placeOrder(cart: CartProvider()..add(_milk), addressId: 'a1', allowForSomeoneElse: false);
      expect(api.bodies.single.containsKey('for_someone_else'), isFalse);
      expect(api.bodies.single.containsKey('recipient'), isFalse);
      expect(api.bodies.single.containsKey('needs_help'), isFalse);
    });

    test('validates the receiver before sending', () {
      final orders = OrderProvider(request: _Api().call);
      orders.setForSomeoneElse(true);
      expect(orders.checkoutDetailsProblem(), "Enter the receiver's name");
      orders.setRecipientName('Amma');
      orders.setRecipientPhone('0112345678');
      expect(orders.checkoutDetailsProblem(), "Enter the receiver's Sri Lankan mobile number");
      orders.setRecipientPhone('0771234567');
      expect(orders.checkoutDetailsProblem(), isNull);
      expect(orders.checkoutDetailsProblem(allowForSomeoneElse: false), isNull);
    });
  });

  group('CheckoutRecipientSection', () {
    Future<OrderProvider> pump(WidgetTester tester, StoreInfoProvider store) async {
      final orders = OrderProvider(request: _Api().call);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: orders),
            ChangeNotifierProvider.value(value: store),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: const Scaffold(body: SingleChildScrollView(child: CheckoutRecipientSection())),
          ),
        ),
      );
      await tester.pump();
      return orders;
    }

    testWidgets('allowed: the toggle shows the receiver fields', (tester) async {
      final store = _store(_checkoutInfo(someoneElse: {'enabled': true, 'send_code_to_receiver': true}));
      await store.loadCheckoutInfo(signedIn: true);
      final orders = await pump(tester, store);
      expect(find.text(CheckoutRecipientSection.forSomeoneElseLabel), findsOneWidget);
      expect(find.byKey(CheckoutRecipientSection.nameKey), findsNothing);
      await tester.tap(find.byKey(CheckoutRecipientSection.forSomeoneElseKey));
      await tester.pump();
      expect(orders.forSomeoneElse, isTrue);
      expect(find.byKey(CheckoutRecipientSection.nameKey), findsOneWidget);
      expect(find.byKey(CheckoutRecipientSection.phoneKey), findsOneWidget);
      await tester.enterText(find.descendant(of: find.byKey(CheckoutRecipientSection.phoneKey), matching: find.byType(EditableText)), '0709450001');
      await tester.pump();
      expect(orders.recipientPhone, '0709450001');
      await tester.tap(find.byKey(CheckoutRecipientSection.needsHelpKey));
      await tester.pump();
      expect(orders.needsHelp, isTrue);
    });

    testWidgets('not allowed (or unknown): no toggle; the note and needs help remain', (tester) async {
      final store = _store(_checkoutInfo(someoneElse: {'enabled': false, 'send_code_to_receiver': true}));
      await store.loadCheckoutInfo(signedIn: true);
      await pump(tester, store);
      expect(find.text(CheckoutRecipientSection.forSomeoneElseLabel), findsNothing);
      expect(find.text(CheckoutRecipientSection.needsHelpLabel), findsOneWidget);
      expect(find.byKey(CheckoutRecipientSection.noteKey), findsOneWidget);
    });
  });
}
