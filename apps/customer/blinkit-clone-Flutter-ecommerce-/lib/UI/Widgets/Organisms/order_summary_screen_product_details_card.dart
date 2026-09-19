import 'package:flutter/material.dart';

import '../../../Models/order_model.dart';
import '../../../app_design.dart';
import '../Atoms/card_product_order_summary.dart';

/// Section 3 of the order detail: what was ordered, straight from the
/// order's item snapshots (name, unit, quantity and line subtotal as the
/// backend recorded them at placement).
class OrderSummaryProductsDetails extends StatelessWidget {
  const OrderSummaryProductsDetails({
    super.key,
    required this.order,
  });

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final itemCount = order.items.fold<int>(0, (sum, i) => sum + i.quantity);

    return Container(
      key: const Key('order-items'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.cardBorder,
        border: Border.all(color: AppSurfaces.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Items',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppTextColors.primary,
                  ),
                ),
              ),
              Text(
                '$itemCount ${itemCount == 1 ? 'item' : 'items'}',
                style: const TextStyle(fontSize: 13, color: AppTextColors.secondary),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final item in order.items) OrderSummaryProductCard(item: item),
        ],
      ),
    );
  }
}
