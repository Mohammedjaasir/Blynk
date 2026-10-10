import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../../../design/tokens.dart';

/// The bill card: subtotal / delivery fee / any coupon discount or birthday gift / total, then the one payment
/// line (`paymentLine`). Pure - it renders exactly what `OrderModel` holds.
class OrderBillCard extends StatelessWidget {
  const OrderBillCard({super.key, required this.order});

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final line = paymentLine(order);
    // Mirrors paymentLine's own PAID branch exactly (order_format.dart) -
    // cancelled is checked first there too, so a cancelled-but-still-marked-
    // PAID order (a refund case) never gets styled as a fresh cash payment.
    final isPaid = order.paymentStatus == 'PAID' && order.status != OrderStatus.cancelled;

    return Container(
      padding: const EdgeInsets.all(BlynkSpace.s16),
      decoration: appCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Bill', style: BlynkText.sectionHeader),
          const SizedBox(height: BlynkSpace.s16),
          _row('Subtotal', formatLkr(order.subtotalAmount)),
          const SizedBox(height: BlynkSpace.s8),
          _row('Delivery fee', formatLkr(order.deliveryFee)),
          // Coupon (backend migration 018) or the birthday gift (owner,
          // 2026-10-09; never both): the total already has it taken off.
          // Referral reward and points (owner, 2026-10-10) are their own
          // lines below, so this one is only the coupon / gift part.
          if (order.couponOrGiftDiscount > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            Row(
              key: const Key('order-bill-discount'),
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Text(
                    order.hasBirthdayGift
                        ? 'Birthday gift'
                        : order.couponCode != null
                            ? 'Discount (${order.couponCode})'
                            : 'Discount',
                    overflow: TextOverflow.ellipsis,
                    style: BlynkText.body.copyWith(color: BlynkColors.positiveInk),
                  ),
                ),
                Text(
                  '−${formatLkr(order.hasBirthdayGift ? order.birthdayDiscountAmount : order.couponOrGiftDiscount)}',
                  style: BlynkText.body.copyWith(color: BlynkColors.positiveInk),
                ),
              ],
            ),
          ],
          if (order.referralDiscountAmount > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            _discountRow(const Key('order-bill-referral'), 'Referral reward', order.referralDiscountAmount),
          ],
          if (order.pointsDiscountAmount > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            _discountRow(
              const Key('order-bill-points'),
              order.pointsRedeemed > 0 ? 'Blynk Points (${order.pointsRedeemed} used)' : 'Blynk Points',
              order.pointsDiscountAmount,
            ),
          ],
          const SizedBox(height: BlynkSpace.s16),
          // The one rule on the page: it separates the itemisation from the
          // answer, which is a different job from decorating a section break.
          const SizedBox(
            height: 1,
            child: DecoratedBox(decoration: BoxDecoration(color: BlynkColors.line)),
          ),
          const SizedBox(height: BlynkSpace.s16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Expanded(child: Text('Total', style: BlynkText.sectionHeader)),
              Text(formatLkr(order.totalAmount), style: BlynkType.priceTotal),
            ],
          ),
          Container(
            margin: const EdgeInsets.only(top: BlynkSpace.s16),
            padding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s12,
              vertical: BlynkSpace.s8,
            ),
            decoration: BoxDecoration(
              borderRadius: BlynkRadius.full,
              color: isPaid ? BlynkColors.positiveTint : BlynkColors.well,
            ),
            child: Row(
              key: const Key('order-payment-line'),
              children: [
                if (isPaid) ...[
                  const Icon(BlynkIcons.check, size: BlynkIcons.xs, color: BlynkColors.positiveInk),
                  const SizedBox(width: BlynkSpace.s4),
                ],
                Flexible(
                  child: Text(
                    line,
                    style: BlynkText.caption.copyWith(
                      color: isPaid ? BlynkColors.positiveInk : BlynkColors.ink,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// A green "−LKR 150" line (owner, 2026-10-10).
  Widget _discountRow(Key key, String label, double amount) {
    return Row(
      key: key,
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.body.copyWith(color: BlynkColors.positiveInk),
          ),
        ),
        Text('−${formatLkr(amount)}', style: BlynkText.body.copyWith(color: BlynkColors.positiveInk)),
      ],
    );
  }

  Widget _row(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
        ),
        Text(value, style: BlynkText.body),
      ],
    );
  }
}
