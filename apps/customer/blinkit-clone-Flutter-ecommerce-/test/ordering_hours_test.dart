import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/ordering_hours.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_screen_payment_container.dart';
import 'package:ecom/app_theme.dart';

// Sri Lanka is UTC+5:30: 02:30 UTC is 8:00 AM there, 15:30 UTC is 9:00 PM.
DateTime _utc(int hour, int minute) => DateTime.utc(2026, 10, 6, hour, minute);

void main() {
  final pinned = OrderingHours.clock;
  tearDown(() => OrderingHours.clock = pinned);

  group('OrderingHours (8 AM - 9 PM Sri Lanka time)', () {
    test('opens at 8:00 AM and closes at 9:00 PM', () {
      expect(OrderingHours.isOpen(_utc(2, 29)), isFalse); // 7:59 AM
      expect(OrderingHours.isOpen(_utc(2, 30)), isTrue); // 8:00 AM
      expect(OrderingHours.isOpen(_utc(15, 29)), isTrue); // 8:59 PM
      expect(OrderingHours.isOpen(_utc(15, 30)), isFalse); // 9:00 PM
      expect(OrderingHours.isOpen(_utc(18, 30)), isFalse); // midnight
    });

    test('uses Sri Lanka time whatever the phone time zone', () {
      // The same instant written with another offset is still 8:59 PM there.
      final sameInstant = DateTime.parse('2026-10-06T16:29:00+01:00');
      expect(OrderingHours.isOpen(sameInstant), isTrue);
    });

    test('counts down to the next opening or closing', () {
      expect(OrderingHours.untilChange(_utc(2, 0)), const Duration(minutes: 30)); // 7:30 AM -> 8 AM
      expect(OrderingHours.untilChange(_utc(15, 0)), const Duration(minutes: 30)); // 8:30 PM -> 9 PM
      expect(OrderingHours.untilChange(_utc(16, 30)), const Duration(hours: 10)); // 10 PM -> 8 AM
    });
  });

  group('the cart outside ordering hours', () {
    Future<void> pumpBar(WidgetTester tester) async {
      tester.view.physicalSize = const Size(900, 860);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final cart = CartProvider()
        ..add(ProductModel.fromJson({
          'id': 'b1',
          'category_id': 'c1',
          'category_name': 'Dairy & Eggs',
          'name': 'Kotmale Fresh Milk 1L',
          'slug': 'b1',
          'sku': 'SKU-b1',
          'unit': '1 L',
          'selling_price': 540,
          'is_available': true,
        }));
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AddressProvider>.value(
              value: AddressProvider(request: ({methodType, url, body}) async => {'data': {'addresses': []}})),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<OrderProvider>.value(
              value: OrderProvider(request: (method, url, {body, query}) async => throw StateError('no order'))),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: const Scaffold(body: Align(alignment: Alignment.bottomCenter, child: CartScreenPaymentContainer())),
        ),
      ));
    }

    bool placeEnabled(WidgetTester tester) => tester
        .widget<BlynkButton>(find.ancestor(of: find.text('Place order'), matching: find.byType(BlynkButton)))
        .onPressed != null;

    testWidgets('at night: the note shows and Place order is off', (tester) async {
      OrderingHours.clock = () => _utc(17, 0); // 10:30 PM
      await pumpBar(tester);
      expect(find.text(ClosedForOrdersNote.text), findsOneWidget);
      expect(placeEnabled(tester), isFalse);
    });

    testWidgets('in ordering hours: no note, Place order is on', (tester) async {
      OrderingHours.clock = () => _utc(6, 30); // 12:00 noon
      await pumpBar(tester);
      expect(find.text(ClosedForOrdersNote.text), findsNothing);
      expect(placeEnabled(tester), isTrue);
    });

    testWidgets('opens by itself at 8 AM while the cart stays open', (tester) async {
      var now = _utc(2, 29); // 7:59 AM
      OrderingHours.clock = () => now;
      await pumpBar(tester);
      expect(find.text(ClosedForOrdersNote.text), findsOneWidget);

      now = _utc(2, 30).add(const Duration(seconds: 1)); // 8:00:01 AM
      await tester.pump(const Duration(minutes: 1, seconds: 1));
      expect(find.text(ClosedForOrdersNote.text), findsNothing);
      expect(placeEnabled(tester), isTrue);
    });
  });
}
