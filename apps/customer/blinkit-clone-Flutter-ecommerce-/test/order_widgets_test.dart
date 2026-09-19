import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/order_status_labels.dart';
import 'package:ecom/UI/Widgets/Atoms/order_status_chip.dart';
import 'package:ecom/UI/Widgets/Organisms/order_bill_card.dart';
import 'package:ecom/UI/Widgets/Organisms/order_status_header.dart';
import 'package:ecom/UI/Widgets/Organisms/order_timeline.dart';
import 'package:ecom/app_colors.dart';
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

// --- WCAG 2.x contrast, computed rather than eyeballed ---------------------

double _srgbToLinear(double c) => c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();

double _relativeLuminance(double r, double g, double b) =>
    0.2126 * _srgbToLinear(r) + 0.7152 * _srgbToLinear(g) + 0.0722 * _srgbToLinear(b);

double _contrastRatio(double lum1, double lum2) {
  final lighter = math.max(lum1, lum2);
  final darker = math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/// The WCAG contrast ratio between an opaque foreground colour and a
/// (possibly translucent) background colour, after alpha-compositing
/// (straight alpha) `background` over the real, opaque page colour `base`
/// sitting behind the chip.
double _contrastAgainst({required Color foreground, required Color background, required Color base}) {
  final a = background.a;
  final r = background.r * a + base.r * (1 - a);
  final g = background.g * a + base.g * (1 - a);
  final b = background.b * a + base.b * (1 - a);
  final fgLum = _relativeLuminance(foreground.r, foreground.g, foreground.b);
  final bgLum = _relativeLuminance(r, g, b);
  return _contrastRatio(fgLum, bgLum);
}

void main() {
  group('OrderStatusChip', () {
    testWidgets('always pairs an icon with the label - never colour alone', (tester) async {
      await _pump(tester, const OrderStatusChip(status: OrderStatus.delivered));

      expect(find.text('Delivered'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle), findsOneWidget);
    });

    testWidgets('problem tone pairs an alert icon with the label', (tester) async {
      await _pump(tester, const OrderStatusChip(status: OrderStatus.failed));

      expect(find.text('Delivery failed'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });

    // The chip is used both on the order-detail page (white) and in the
    // orders list (AppColors.greyWhiteColor scaffold) - every tone must
    // clear the 4.5:1 minimum text contrast on both, computed here rather
    // than trusted by eye.
    group('every tone clears 4.5:1 WCAG text contrast on both page backgrounds', () {
      const white = Color(0xffFFFFFF);
      const greyWhite = AppColors.greyWhiteColor;

      for (final tone in OrderTone.values) {
        test(tone.name, () {
          final colors = orderChipColors(tone);
          final onWhite = _contrastAgainst(foreground: colors.foreground, background: colors.background, base: white);
          final onGreyWhite =
              _contrastAgainst(foreground: colors.foreground, background: colors.background, base: greyWhite);

          expect(onWhite, greaterThanOrEqualTo(4.5), reason: '${tone.name} on white was ${onWhite.toStringAsFixed(2)}:1');
          expect(
            onGreyWhite,
            greaterThanOrEqualTo(4.5),
            reason: '${tone.name} on grey-white was ${onGreyWhite.toStringAsFixed(2)}:1',
          );
        });
      }
    });
  });

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

  group('OrderBillCard', () {
    testWidgets('shows subtotal, delivery fee, total and the pending payment line', (tester) async {
      final order = OrderModel.fromJson(orderJson(status: 'PLACED', paymentStatus: 'PENDING'));
      await _pump(tester, OrderBillCard(order: order));

      expect(find.text('Rs. 1,885'), findsOneWidget);
      expect(find.text('Rs. 70'), findsOneWidget);
      expect(find.text('Rs. 1,955'), findsOneWidget);
      expect(find.byKey(const Key('order-payment-line')), findsOneWidget);
      expect(find.text(paymentLine(order)), findsOneWidget);
      expect(find.text('Cash on delivery — pay Rs. 1,955 to the rider'), findsOneWidget);
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
