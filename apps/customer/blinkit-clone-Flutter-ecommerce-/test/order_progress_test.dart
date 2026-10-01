import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/order_progress_tracker.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';

const _id = 'c0000001-0000-0000-0000-000000000001';

Widget _tracker(String status, {List<List<String?>>? history}) => MaterialApp(
      theme: AppTheme.appTHeme,
      home: Scaffold(
        body: OrderProgressTracker(order: OrderModel.fromJson(orderJson(status: status, history: history))),
      ),
    );

void main() {
  group('four-step tracker', () {
    test('maps every backend status to its step', () {
      expect(OrderProgressTracker.currentStep(OrderStatus.placed), 0);
      expect(OrderProgressTracker.currentStep(OrderStatus.itemUnavailable), 0);
      expect(OrderProgressTracker.currentStep(OrderStatus.packed), 1);
      expect(OrderProgressTracker.currentStep(OrderStatus.outForDelivery), 2);
      expect(OrderProgressTracker.currentStep(OrderStatus.failed), 2);
      expect(OrderProgressTracker.currentStep(OrderStatus.customerUnavailable), 2);
      expect(OrderProgressTracker.currentStep(OrderStatus.delivered), 3);
      expect(OrderProgressTracker.currentStep(OrderStatus.cancelled), isNull);
    });

    testWidgets('shows all four steps and says where the order is', (tester) async {
      await tester.pumpWidget(_tracker('PACKED', history: [
        [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
        ['PLACED', 'PACKED', '2026-09-19T10:12:00.000Z'],
      ]));
      for (final label in ['Order received', 'Packed', 'On the way', 'Delivered']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.bySemanticsLabel('Order progress: Packed'), findsOneWidget);
    });

    testWidgets('a stopped delivery is marked stopped at On the way', (tester) async {
      await tester.pumpWidget(_tracker('FAILED'));
      expect(find.bySemanticsLabel('Order progress: On the way, stopped'), findsOneWidget);
    });

    testWidgets('a cancelled order shows no tracker', (tester) async {
      await tester.pumpWidget(_tracker('CANCELLED'));
      expect(find.byKey(const Key('order-progress')), findsNothing);
    });
  });

  group('the order page follows Operations by itself', () {
    Future<List<String>> pump(WidgetTester tester, List<String> statuses) async {
      final calls = <String>[];
      var n = 0;
      final provider = OrderProvider(request: (method, url, {body, query}) async {
        calls.add('$method $url');
        final status = statuses[n < statuses.length ? n : statuses.length - 1];
        n++;
        return {
          'success': true,
          'data': {'order': orderJson(status: status)},
        };
      });
      await tester.pumpWidget(ChangeNotifierProvider<OrderProvider>.value(
        value: provider,
        child: MaterialApp(theme: AppTheme.appTHeme, home: const OrderSummaryScreen(orderId: _id)),
      ));
      await tester.pumpAndSettle();
      return calls;
    }

    testWidgets('an unfinished order is re-read every 20 seconds', (tester) async {
      final calls = await pump(tester, ['PLACED', 'PACKED']);
      expect(calls, hasLength(1));
      expect(find.bySemanticsLabel('Order progress: Order received'), findsOneWidget);

      await tester.pump(OrderSummaryScreen.refreshEvery);
      await tester.pumpAndSettle();

      expect(calls, hasLength(2));
      expect(find.bySemanticsLabel('Order progress: Packed'), findsOneWidget);
    });

    testWidgets('a delivered order is not re-read', (tester) async {
      final calls = await pump(tester, ['DELIVERED']);
      await tester.pump(OrderSummaryScreen.refreshEvery * 3);
      await tester.pumpAndSettle();
      expect(calls, hasLength(1));
    });
  });
}
