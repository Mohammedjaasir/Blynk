import 'package:flutter/material.dart';

import '../../../Models/order_model.dart';
import '../../../Models/order_status_labels.dart';
import '../../../app_design.dart';

/// The chip's foreground/background pair for a tone - the single source of
/// truth used by both the widget below and its contrast tests. Every pair
/// keeps >= 4.5:1 text contrast (WCAG 2.x) against BOTH the white page
/// background and the app's off-white page background
/// (`AppColors.greyWhiteColor`), since the chip is used on both (order
/// detail's white page and the orders list, which sits on the grey-white
/// scaffold). `success` and `neutral` are deliberately darker than the raw
/// brand/secondary tokens - the raw tokens read fine to the eye but fail the
/// 4.5:1 minimum once alpha-composited over a real background. The
/// backgrounds are transparent: the status is set as type on the card that
/// already contains it, so Blynk Yellow keeps meaning "tap this" rather than
/// quietly becoming a status colour.
({Color foreground, Color background}) orderChipColors(OrderTone tone) {
  switch (tone) {
    case OrderTone.active:
      return (foreground: AppTextColors.primary, background: Colors.transparent);
    case OrderTone.success:
      const fg = Color(0xff0A6B19); // darker than AppColors.primaryGreenColor for contrast
      return (foreground: fg, background: Colors.transparent);
    case OrderTone.neutral:
      const fg = Color(0xff4B5563); // darker than AppTextColors.secondary for contrast
      return (foreground: fg, background: Colors.transparent);
    case OrderTone.problem:
      const fg = AppTextColors.problem;
      return (foreground: fg, background: Colors.transparent);
  }
}

/// A status badge that always pairs an icon with the word - colour is never
/// the only signal (Global Constraints: no colour-only meaning). Every tone
/// keeps its text at >= 4.5:1 contrast against its own background (see
/// `orderChipColors`).
class OrderStatusChip extends StatelessWidget {
  const OrderStatusChip({super.key, required this.status});

  final OrderStatus status;

  @override
  Widget build(BuildContext context) {
    final tone = orderStatusTone(status);
    final fg = orderChipColors(tone).foreground;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(orderStatusIcon(status), size: 16, color: fg),
        const SizedBox(width: AppSpacing.xs),
        Text(
          orderStatusLabel(status),
          style: TextStyle(color: fg, fontSize: 13, fontWeight: FontWeight.w800),
        ),
      ],
    );
  }
}
