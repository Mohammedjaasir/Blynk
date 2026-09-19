import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../app_colors.dart';
import '../../../app_design.dart';

/// The bill card: subtotal / delivery fee / total, then the one payment
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
      padding: const EdgeInsets.all(AppSpacing.lg),
      // The only card on the detail page with a shadow: money gets the lift,
      // the reference detail below it recedes.
      decoration: appCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Bill',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppTextColors.primary),
          ),
          const SizedBox(height: AppSpacing.md),
          _row('Subtotal', formatLkr(order.subtotalAmount)),
          const SizedBox(height: AppSpacing.sm),
          _row('Delivery fee', formatLkr(order.deliveryFee)),
          const SizedBox(height: AppSpacing.md),
          // The rule separates the itemisation from the answer.
          Container(height: 1, color: AppSurfaces.border),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Expanded(
                child: Text(
                  'Total',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppTextColors.primary,
                  ),
                ),
              ),
              Text(
                formatLkr(order.totalAmount),
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppTextColors.primary,
                ),
              ),
            ],
          ),
          Container(
            margin: const EdgeInsets.only(top: AppSpacing.md),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              borderRadius: AppRadius.fieldBorder,
              color: isPaid
                  ? AppColors.primaryGreenColor.withValues(alpha: 0.08)
                  : AppSurfaces.subtle,
            ),
            child: Row(
              key: const Key('order-payment-line'),
              children: [
                if (isPaid) ...[
                  const Icon(Icons.check_circle, size: 16, color: AppColors.primaryGreenColor),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Flexible(
                  child: Text(
                    line,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: isPaid ? AppColors.primaryGreenColor : AppTextColors.primary,
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

  Widget _row(String label, String value) {
    const style = TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w500,
      color: AppTextColors.primary,
    );
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: style.copyWith(color: AppTextColors.secondary),
          ),
        ),
        Text(value, style: style),
      ],
    );
  }
}
