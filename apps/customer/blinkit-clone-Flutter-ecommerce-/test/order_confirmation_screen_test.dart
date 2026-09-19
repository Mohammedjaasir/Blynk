import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/order_confirmation_screen.dart';
import 'package:ecom/Services/Providers/order.provider.dart';

import 'fixtures/order_fixtures.dart';

/// The real provider with [lastPlacedOrder] replaced by fixed state, in the
/// style of orders_screen_test.dart's `_FixedOrders`.
class _FixedLastOrder extends OrderProvider {
  _FixedLastOrder(this._order);

  final OrderModel? _order;

  @override
  OrderModel? get lastPlacedOrder => _order;
}

void main() {
  group('Order confirmation screen', () {
    late List<RouteSettings> pushed;

    Future<void> pumpScreen(WidgetTester tester, OrderModel? order) async {
      pushed = [];
      await tester.pumpWidget(
        ChangeNotifierProvider<OrderProvider>.value(
          value: _FixedLastOrder(order),
          child: MaterialApp(
            home: const OrderConfirmationScreen(),
            onGenerateRoute: (settings) {
              pushed.add(settings);
              return MaterialPageRoute(builder: (_) => const SizedBox.shrink(), settings: settings);
            },
          ),
        ),
      );
      // The Lottie hero (Assets/cart_packing.json) repeats forever, so
      // pumpAndSettle() never returns - pump a few bounded ticks instead
      // (same pattern as widget_test.dart's looping-Lottie slide).
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    testWidgets('button reads "View order" and "Track Your Order" is gone', (tester) async {
      final order = OrderModel.fromJson(orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false));
      await pumpScreen(tester, order);
      expect(find.text('View order'), findsOneWidget);
      expect(find.text('Track Your Order'), findsNothing);
    });

    testWidgets('tapping "View order" pushes /order with the order id', (tester) async {
      final order = OrderModel.fromJson(orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false));
      await pumpScreen(tester, order);

      await tester.tap(find.byKey(const Key('view-order')));
      await tester.pump();

      expect(pushed.map((s) => s.name), contains('/order'));
      expect(pushed.firstWhere((s) => s.name == '/order').arguments, equals('o1'));
    });

    testWidgets('amount line shows the total and "Cash on delivery" for COD', (tester) async {
      final order = OrderModel.fromJson(orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false));
      await pumpScreen(tester, order);
      expect(find.byKey(const Key('confirmation-amount')), findsOneWidget);
      expect(find.text('Rs. 1,955 · Cash on delivery'), findsOneWidget);
    });

    testWidgets('a scheduled order shows the schedule line', (tester) async {
      const iso = '2026-09-20T08:00:00.000Z';
      final order = OrderModel.fromJson(
        orderJson(id: 'o1', number: 'BL-20260919-0001', scheduledFor: iso, detail: false),
      );
      await pumpScreen(tester, order);
      expect(find.byKey(const Key('confirmation-schedule')), findsOneWidget);
      expect(
        find.text('Scheduled — delivery ${formatScheduled(DateTime.parse(iso))}'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.schedule), findsOneWidget);
    });

    testWidgets('an immediate order shows no schedule line', (tester) async {
      final order = OrderModel.fromJson(orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false));
      await pumpScreen(tester, order);
      expect(find.byKey(const Key('confirmation-schedule')), findsNothing);
      expect(find.byIcon(Icons.schedule), findsNothing);
    });

    testWidgets('lastPlacedOrder == null disables the button and shows no amount/schedule lines',
        (tester) async {
      await pumpScreen(tester, null);

      final button = tester.widget<ElevatedButton>(find.byKey(const Key('view-order')));
      expect(button.onPressed, isNull);
      expect(find.byKey(const Key('confirmation-amount')), findsNothing);
      expect(find.byKey(const Key('confirmation-schedule')), findsNothing);
    });

    testWidgets('amount line shows the plain total (no "Cash on delivery") for a non-COD order',
        (tester) async {
      final order = OrderModel.fromJson({
        ...orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false),
        'payment_method': 'ONLINE',
      });
      await pumpScreen(tester, order);
      expect(find.byKey(const Key('confirmation-amount')), findsOneWidget);
      expect(find.text('Rs. 1,955'), findsOneWidget);
      expect(find.textContaining('Cash on delivery'), findsNothing);
    });

    testWidgets('does not overflow at 360x800 with a scheduled order', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      const iso = '2026-09-20T08:00:00.000Z';
      final order = OrderModel.fromJson(
        orderJson(id: 'o1', number: 'BL-20260919-0001', scheduledFor: iso, detail: false),
      );
      await pumpScreen(tester, order);

      expect(tester.takeException(), isNull);
      expect(
        find.text('Scheduled — delivery ${formatScheduled(DateTime.parse(iso))}'),
        findsOneWidget,
      );
    });
  });
}
