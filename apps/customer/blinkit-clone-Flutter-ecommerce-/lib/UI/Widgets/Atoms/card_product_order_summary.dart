import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../app_design.dart';

/// One line of the order's Items section: what it was, how much of it, and
/// what it cost.
///
/// Only the two item states the customer is affected by get a caption. The
/// internal sourcing states (`PENDING`, `SOURCED`, `PACKED`) are the store's
/// business, not the customer's, and are never shown.
class OrderSummaryProductCard extends StatelessWidget {
  const OrderSummaryProductCard({super.key, required this.item});

  final OrderItemModel item;

  @override
  Widget build(BuildContext context) {
    // RESOLVE_ITEM takes an UNAVAILABLE line out of the totals and out of
    // the amount the rider collects, so the line is struck through: it is
    // shown for the record, but it is not part of the bill.
    final unavailable = item.itemStatus == 'UNAVAILABLE';
    final substituted = item.itemStatus == 'SUBSTITUTED';
    final caption = unavailable
        ? 'Unavailable — not charged'
        : substituted
            ? 'Replaced by the store'
            : null;
    final strike = unavailable ? TextDecoration.lineThrough : null;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.productNameSnapshot,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTextColors.primary,
                    decoration: strike,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${item.unitSnapshot} × ${item.quantity}',
                  style: const TextStyle(fontSize: 12, color: AppTextColors.secondary),
                ),
                if (caption != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    caption,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: unavailable ? AppTextColors.problem : AppTextColors.secondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Text(
            formatLkr(item.subtotal),
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: unavailable ? AppTextColors.secondary : AppTextColors.primary,
              decoration: strike,
            ),
          ),
        ],
      ),
    );
  }
}
