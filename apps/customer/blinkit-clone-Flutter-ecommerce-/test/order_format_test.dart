import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/order_status_labels.dart';
import 'package:ecom/app_colors.dart';
import 'package:ecom/app_design.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/order_fixtures.dart';

void main() {
  test('money shows cents only when there are any', () {
    expect(formatLkr(1955), 'LKR 1,955');
    expect(formatLkr(1214.5), 'LKR 1,214.50');
    expect(formatLkr(70), 'LKR 70');
  });

  test('money decides whole-vs-cents from the rounded value, not the raw double', () {
    // 999.999 rounds to 1000.00 for display; it must not show spurious cents.
    expect(formatLkr(999.999), 'LKR 1,000');
    // 1955.004 rounds to 1955.00 for display; same rule.
    expect(formatLkr(1955.004), 'LKR 1,955');
    expect(formatLkr(0), 'LKR 0');
    expect(formatLkr(1000000), 'LKR 1,000,000');
    expect(formatLkr(1214.5), 'LKR 1,214.50');
    expect(formatLkr(70.1), 'LKR 70.10');
  });

  test('times are local and human', () {
    expect(formatOrderTime(DateTime(2026, 9, 19, 15, 42)), '19 Sep, 3:42 PM');
    expect(formatOrderTime(DateTime(2026, 9, 19, 0, 5)), '19 Sep, 12:05 AM');
    expect(formatScheduled(DateTime(2026, 9, 20, 8)), 'from 8:00 AM, Sun 20 Sep');
  });

  test('labels, sentences, payment', () {
    expect(orderStatusLabel(OrderStatus.failed), 'Delivery failed');
    expect(orderStatusLabel(OrderStatus.customerUnavailable), "We couldn't reach you");
    final arrived = OrderModel.fromJson(
      orderJson(status: 'OUT_FOR_DELIVERY', delivery: {'assignment_status': 'ARRIVED_AT_CUSTOMER'}),
    );
    expect(orderStatusSentence(arrived), 'Your rider has arrived.');
    expect(paymentLine(OrderModel.fromJson(orderJson())), 'Cash on delivery — pay LKR 1,955 to the rider');
    expect(paymentLine(OrderModel.fromJson(restagedDeliveredJson())), 'Paid in cash');
    expect(paymentLine(OrderModel.fromJson(orderJson(status: 'CANCELLED'))), 'Nothing to pay');
    expect(paymentLine(OrderModel.fromJson(orderJson(status: 'FAILED'))), 'Not paid');
    final h = OrderModel.fromJson(restagedDeliveredJson()).history;
    expect(timelineLabel(h[4]), 'Packed again for redelivery');
    expect(timelineLabel(h[1]), 'Packed');
  });

  group('C4: assignment wording is never inferred from status/timestamps alone', () {
    test('PACKED with delivery: null falls back to the generic packed sentence', () {
      final o = OrderModel.fromJson(orderJson(status: 'PACKED', delivery: null));
      expect(orderStatusSentence(o), 'Your order is packed.');
    });

    test('OUT_FOR_DELIVERY with delivery: null falls back to the generic on-its-way sentence', () {
      final o = OrderModel.fromJson(orderJson(status: 'OUT_FOR_DELIVERY', delivery: null));
      expect(orderStatusSentence(o), 'Your order is on its way.');
    });

    test('CANCELLED with a leftover ASSIGNED delivery still reads as cancelled', () {
      final o = OrderModel.fromJson(
        orderJson(status: 'CANCELLED', delivery: {'assignment_status': 'ASSIGNED'}),
      );
      expect(orderStatusSentence(o), 'This order was cancelled.');
    });

    test('PACKED with delivery ASSIGNED says a rider has been assigned', () {
      final o = OrderModel.fromJson(
        orderJson(status: 'PACKED', delivery: {'assignment_status': 'ASSIGNED'}),
      );
      expect(orderStatusSentence(o), 'A rider has been assigned.');
    });
  });

  test('orderStatusTone covers every status with the approved grouping', () {
    expect(orderStatusTone(OrderStatus.delivered), OrderTone.success);
    expect(orderStatusTone(OrderStatus.cancelled), OrderTone.neutral);
    expect(orderStatusTone(OrderStatus.unknown), OrderTone.neutral);
    expect(orderStatusTone(OrderStatus.failed), OrderTone.problem);
    expect(orderStatusTone(OrderStatus.customerUnavailable), OrderTone.problem);
    expect(orderStatusTone(OrderStatus.itemUnavailable), OrderTone.problem);
    expect(orderStatusTone(OrderStatus.placed), OrderTone.active);
    expect(orderStatusTone(OrderStatus.packed), OrderTone.active);
    expect(orderStatusTone(OrderStatus.outForDelivery), OrderTone.active);
  });

  test('orderToneColor maps tones to the Blynk tokens', () {
    expect(orderToneColor(OrderTone.problem), const Color(0xffB42318));
    // W9: was `AppColors.primaryGreenColor`. That green measures 4.36:1 on the
    // order-detail page background and the header paints it at headline size,
    // so the colour moved to the darker `positiveOnBackground` that exists for
    // exactly this pairing. The floor was not touched; see the group below.
    expect(orderToneColor(OrderTone.success), AppTextColors.positiveOnBackground);
    expect(orderToneColor(OrderTone.neutral), AppTextColors.onBackground);
  });

  // W9 guard. `orderToneColor` is a TEXT colour: `order_status_header.dart`
  // renders it at headline size on the order-detail page and
  // `order_timeline.dart` at label size inside a white card. Every tone has to
  // clear the AA 4.5:1 text floor on BOTH surfaces. Driving the loop from
  // `OrderTone.values` means a tone added later is covered without editing
  // this test.
  group('every order tone clears 4.5:1 on every surface it is painted on', () {
    // The two surfaces these two widgets actually land on, kept beside the
    // reason each one is in the list.
    const surfaces = <String, Color>{
      // `order_summary_screen.dart` / `user_orders_screen.dart` scaffold.
      'the order page background (#EDF2F8)': AppColors.greyWhiteColor,
      // `appCardDecoration()` — the timeline card and the orders-list rows.
      'a white card': BlynkColors.paper,
    };

    test('the surface list is not empty (non-vacuity)', () {
      expect(surfaces, isNotEmpty);
      expect(OrderTone.values, hasLength(4));
    });

    for (final tone in OrderTone.values) {
      for (final surface in surfaces.entries) {
        test('${tone.name} on ${surface.key}', () {
          expect(
            contrastRatio(orderToneColor(tone), surface.value),
            greaterThanOrEqualTo(4.5),
            reason: 'Tune the colour, never the floor: '
                '${tone.name} measures '
                '${contrastRatio(orderToneColor(tone), surface.value).toStringAsFixed(2)}:1.',
          );
        });
      }
    }

    // The measurement is proven able to fail: the two colours this map used to
    // return are still declared, and both still measure BELOW the floor on the
    // page background. If this ever passes, the ratio function has stopped
    // discriminating and every assertion above is worthless.
    test('the two colours that were replaced still measure as failures', () {
      expect(
        contrastRatio(AppColors.primaryGreenColor, AppColors.greyWhiteColor),
        lessThan(4.5),
        reason: 'primaryGreenColor is the 4.36:1 value W9 replaced.',
      );
      expect(
        contrastRatio(AppTextColors.secondary, AppColors.greyWhiteColor),
        lessThan(4.5),
        reason: 'AppTextColors.secondary is the 4.29:1 value W9 replaced.',
      );
    });
  });
}
