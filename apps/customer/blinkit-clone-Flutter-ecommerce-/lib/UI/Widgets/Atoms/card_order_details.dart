import 'package:flutter/material.dart';

import '../../../Models/order_model.dart';
import '../../../app_design.dart';

/// Section 5 of the order detail: where the order is going.
///
/// Status, payment and the cancel action live in their own sections now -
/// this card is only the delivery details the customer gave us, written as
/// an address is written rather than as a grid of label/value pairs.
class OrderDetailsCard extends StatelessWidget {
  const OrderDetailsCard({super.key, required this.order});

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final line2 = order.deliveryAddressLine2;
    final instructions = order.deliveryInstructions;
    final notes = order.customerNotes;

    return Container(
      key: const Key('order-delivery-to'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      // Reference detail, not an answer: no border and a quieter fill, so it
      // recedes behind the bill above it.
      decoration: BoxDecoration(
        color: AppSurfaces.subtle,
        borderRadius: AppRadius.cardBorder,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Delivery to',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: AppTextColors.primary,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          if (order.deliveryRecipientName.isNotEmpty)
            Text(
              order.deliveryRecipientName,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppTextColors.primary,
              ),
            ),
          if (order.deliveryRecipientPhone.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              order.deliveryRecipientPhone,
              style: const TextStyle(fontSize: 14, color: AppTextColors.secondary),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          if (order.deliveryAddressLine1.isNotEmpty)
            Text(
              order.deliveryAddressLine1,
              style: const TextStyle(fontSize: 14, color: AppTextColors.primary),
            ),
          if (line2 != null && line2.trim().isNotEmpty)
            Text(
              line2,
              style: const TextStyle(fontSize: 14, color: AppTextColors.primary),
            ),
          if (order.deliveryCity.isNotEmpty)
            Text(
              order.deliveryCity,
              style: const TextStyle(fontSize: 14, color: AppTextColors.primary),
            ),
          if (instructions != null && instructions.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Instructions: $instructions',
              style: const TextStyle(fontSize: 13, color: AppTextColors.secondary),
            ),
          ],
          if (notes != null && notes.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Your note: $notes',
              style: const TextStyle(fontSize: 13, color: AppTextColors.secondary),
            ),
          ],
        ],
      ),
    );
  }
}
