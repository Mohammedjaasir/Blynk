import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/order_confirmation_screen.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/design/tokens.dart';

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

    Future<void> pumpScreen(WidgetTester tester, OrderModel? order, {bool reduceMotion = false}) async {
      pushed = [];
      await tester.pumpWidget(
        ChangeNotifierProvider<OrderProvider>.value(
          value: _FixedLastOrder(order),
          child: MediaQuery(
            data: MediaQueryData(disableAnimations: reduceMotion),
            child: MaterialApp(
            home: const OrderConfirmationScreen(),
            onGenerateRoute: (settings) {
              pushed.add(settings);
              return MaterialPageRoute(builder: (_) => const SizedBox.shrink(), settings: settings);
            },
            ),
          ),
        ),
      );
      // A few bounded ticks (the hero used to be a looping Lottie; it is a static check mark now).
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
      expect(find.text('LKR 1,955 · Cash on delivery'), findsOneWidget);
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

      // W4: "View order" is now the shared BlynkButton.cta (flat Blynk Yellow)
      // instead of an ElevatedButton wearing appPrimaryButtonStyle. Same
      // assertion, same strength: with no order there is nothing to open, so
      // the button must be genuinely disabled, not merely styled as such.
      final button = tester.widget<BlynkButton>(find.byKey(const Key('view-order')));
      expect(button.onPressed, isNull);
      // ...and it is genuinely inert, not merely styled grey.
      await tester.tap(find.byKey(const Key('view-order')));
      await tester.pump();
      expect(pushed.map((s) => s.name), isNot(contains('/order')));
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
      expect(find.text('LKR 1,955'), findsOneWidget);
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

    testWidgets('the hero is a check mark that settles once: no Lottie, nothing loops', (tester) async {
      final order = OrderModel.fromJson(orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false));
      await pumpScreen(tester, order);
      final check = tester.widget<Icon>(find.byIcon(BlynkIcons.check));
      expect(check.color, BlynkColors.positive);
      // Motion M10: the medallion settles in once (scale + fade, emphasized).
      // What this pin guards is that it ENDS: pumpAndSettle throws on a loop.
      expect(find.byType(TweenAnimationBuilder<double>), findsWidgets);
      await tester.pumpAndSettle();
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('reduced motion: the check mark is simply there', (tester) async {
      final order = OrderModel.fromJson(orderJson(id: 'o1', number: 'BL-20260919-0001', detail: false));
      await pumpScreen(tester, order, reduceMotion: true);
      expect(find.byIcon(BlynkIcons.check), findsOneWidget);
      expect(find.byType(TweenAnimationBuilder<double>), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('the scheduled pill outline is lineStrong, not the 1.2:1 hairline', (tester) async {
      const iso = '2026-09-20T08:00:00.000Z';
      final order = OrderModel.fromJson(
        orderJson(id: 'o1', number: 'BL-20260919-0001', scheduledFor: iso, detail: false),
      );
      await pumpScreen(tester, order);
      final pill = tester.widget<Container>(
        find.ancestor(of: find.byKey(const Key('confirmation-schedule')), matching: find.byType(Container)).first,
      );
      expect(((pill.decoration! as BoxDecoration).border! as Border).top.color, BlynkColors.lineStrong);
    });
  });
}
