
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product_order_summary.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/UI/Widgets/Organisms/order_bill_card.dart';
import 'package:ecom/UI/Widgets/Organisms/order_status_header.dart';
import 'package:ecom/UI/Widgets/Organisms/order_timeline.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';

Future<void> _pump(WidgetTester tester, Widget child) {
  return tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.appTHeme,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
}

void main() {

  group('OrderStatusHeader', () {
    // C3 wording: label + sentence for every one of the 8 canonical
    // backend statuses (no delivery block, no schedule) - "unknown" is a
    // client-side fallback for an unparseable string, not a backend value.
    const cases = <String, List<String>>{
      'PLACED': ['Order placed', "We've received your order."],
      'PACKED': ['Packed', 'Your order is packed.'],
      'OUT_FOR_DELIVERY': ['Out for delivery', 'Your order is on its way.'],
      'DELIVERED': ['Delivered', 'Delivered. Thank you!'],
      'CANCELLED': ['Cancelled', 'This order was cancelled.'],
      'FAILED': ['Delivery failed', "We couldn't complete this delivery."],
      'CUSTOMER_UNAVAILABLE': ["We couldn't reach you", "The rider couldn't reach you at the address."],
      'ITEM_UNAVAILABLE': ['Item unavailable', "Something couldn't be sourced. Your total has been updated."],
    };

    testWidgets('shows the label and sentence for every status', (tester) async {
      for (final entry in cases.entries) {
        final order = OrderModel.fromJson(orderJson(status: entry.key));
        await _pump(tester, OrderStatusHeader(order: order));

        expect(find.byKey(const Key('order-status-header')), findsOneWidget, reason: entry.key);
        expect(find.text(entry.value[0]), findsOneWidget, reason: entry.key);
        expect(find.text(entry.value[1]), findsOneWidget, reason: entry.key);
      }
    });

    testWidgets('schedule notice shows for a pre-dispatch scheduled order', (tester) async {
      final order = OrderModel.fromJson(
        orderJson(status: 'PLACED', scheduledFor: '2026-09-20T08:00:00.000Z'),
      );
      await _pump(tester, OrderStatusHeader(order: order));

      expect(find.byKey(const Key('order-schedule-notice')), findsOneWidget);
      expect(
        find.text('Scheduled — delivery ${formatScheduled(DateTime.parse('2026-09-20T08:00:00.000Z'))}'),
        findsOneWidget,
      );
    });

    testWidgets('schedule notice is absent once the order is out for delivery', (tester) async {
      final order = OrderModel.fromJson(
        orderJson(status: 'OUT_FOR_DELIVERY', scheduledFor: '2026-09-20T08:00:00.000Z'),
      );
      await _pump(tester, OrderStatusHeader(order: order));

      expect(find.byKey(const Key('order-schedule-notice')), findsNothing);
    });

    testWidgets('cancelled order with a reason shows the Reason line', (tester) async {
      final order = OrderModel.fromJson(
        orderJson(status: 'CANCELLED', cancellationReason: 'Supplier closed today'),
      );
      await _pump(tester, OrderStatusHeader(order: order));

      expect(find.text('Reason: Supplier closed today'), findsOneWidget);
    });

    testWidgets('cancelled order with no reason shows no Reason line', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'CANCELLED'));
      await _pump(tester, OrderStatusHeader(order: order));

      expect(find.textContaining('Reason:'), findsNothing);
    });
  });

  group('OrderTimeline', () {
    testWidgets('renders every history row, oldest first, with the re-stage label', (tester) async {
      final order = OrderModel.fromJson(restagedDeliveredJson());
      await _pump(tester, OrderTimeline(history: order.history));

      expect(find.byKey(const Key('order-timeline')), findsOneWidget);
      for (var i = 0; i < 7; i++) {
        expect(find.byKey(Key('timeline-row-$i')), findsOneWidget, reason: 'row $i');
      }
      expect(find.byKey(const Key('timeline-row-7')), findsNothing);

      // Row 4 (index 4) is the FAILED -> PACKED re-stage.
      expect(timelineLabel(order.history[4]), 'Packed again for redelivery');
      expect(find.text('Packed again for redelivery'), findsOneWidget);

      for (final event in order.history) {
        expect(event.at, isNotNull);
        expect(find.text(formatOrderTime(event.at!)), findsWidgets);
      }
    });

    testWidgets('a PLACED-only order shows exactly one row, no future steps', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'PLACED'));
      expect(order.history, hasLength(1));
      await _pump(tester, OrderTimeline(history: order.history));

      expect(find.byKey(const Key('timeline-row-0')), findsOneWidget);
      expect(find.byKey(const Key('timeline-row-1')), findsNothing);
      // No greyed-out placeholder rows for statuses that never happened.
      expect(find.text('Out for delivery'), findsNothing);
      expect(find.text('Delivered'), findsNothing);
    });

    testWidgets('empty history renders nothing', (tester) async {
      await _pump(tester, const OrderTimeline(history: []));

      expect(find.byKey(const Key('order-timeline')), findsNothing);
      expect(find.byType(SizedBox), findsWidgets);
    });

    testWidgets('an event with an unparseable date shows the label with no time', (tester) async {
      final order = OrderModel.fromJson(
        orderJson(status: 'PLACED', history: [
          [null, 'PLACED', 'not-a-real-date'],
        ]),
      );
      expect(order.history.single.at, isNull);

      await _pump(tester, OrderTimeline(history: order.history));

      expect(find.text('Order placed'), findsOneWidget);
      // No time text is rendered for this row - nothing that looks like a
      // fabricated clock time.
      expect(find.textContaining('AM'), findsNothing);
      expect(find.textContaining('PM'), findsNothing);
    });
  });

  // --- 2026-09 premium redesign (W5) --------------------------------------
  group('OrderSummaryProductCard', () {
    OrderItemModel item({String status = 'SOURCED'}) => OrderModel.fromJson(
          orderJson(items: [itemJson('i1', 'Kotmale Fresh Milk 1L', 2, 540, status: status)]),
        ).items.single;

    testWidgets('carries the shared no-image well, never a broken-image glyph', (tester) async {
      await _pump(tester, OrderSummaryProductCard(item: item()));

      expect(find.byType(BlynkImageWell), findsOneWidget);
      for (final glyph in [Icons.broken_image, Icons.image_not_supported, Icons.hide_image]) {
        expect(find.byIcon(glyph), findsNothing, reason: '$glyph');
      }
    });

    testWidgets('an UNAVAILABLE line strikes the real name; no "was" price is invented', (tester) async {
      await _pump(tester, OrderSummaryProductCard(item: item(status: 'UNAVAILABLE')));

      final name = tester.widget<Text>(find.text('Kotmale Fresh Milk 1L'));
      expect(name.style?.decoration, TextDecoration.lineThrough);
      // Exactly two amounts would mean a fabricated original price beside the
      // real one; this line shows one amount, the one the backend sent.
      final amounts = tester
          .widgetList<Text>(find.byType(Text))
          .where((t) => (t.data ?? '').startsWith('LKR '));
      expect(amounts, hasLength(1));
      expect(find.byType(StruckPrice), findsNothing);
    });

    testWidgets('the thumbnail gives way to the words above a 1.3x text scale', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.appTHeme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2.0)),
            child: child!,
          ),
          home: Scaffold(
            body: SizedBox(
              width: 336,
              child: SingleChildScrollView(child: OrderSummaryProductCard(item: item())),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(BlynkImageWell), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('OrderBillCard', () {
    testWidgets('shows subtotal, delivery fee, total and the pending payment line', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'PLACED', paymentStatus: 'PENDING'));
      await _pump(tester, OrderBillCard(order: order));

      expect(find.text('LKR 1,885'), findsOneWidget);
      expect(find.text('LKR 70'), findsOneWidget);
      expect(find.text('LKR 1,955'), findsOneWidget);
      expect(find.byKey(const Key('order-payment-line')), findsOneWidget);
      expect(find.text(paymentLine(order)), findsOneWidget);
      expect(find.text('Cash on delivery — pay LKR 1,955 to the rider'), findsOneWidget);
    });

    testWidgets('paid order shows "Paid in cash"', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'DELIVERED', paymentStatus: 'PAID'));
      await _pump(tester, OrderBillCard(order: order));

      expect(find.text('Paid in cash'), findsOneWidget);
    });

    testWidgets('cancelled order shows "Nothing to pay"', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'CANCELLED'));
      await _pump(tester, OrderBillCard(order: order));

      expect(find.text('Nothing to pay'), findsOneWidget);
    });

    testWidgets('failed order shows "Not paid"', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'FAILED', paymentStatus: 'PENDING'));
      await _pump(tester, OrderBillCard(order: order));

      expect(find.text('Not paid'), findsOneWidget);
    });
  });
}
