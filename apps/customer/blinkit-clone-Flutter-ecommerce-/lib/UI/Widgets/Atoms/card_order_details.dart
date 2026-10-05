import 'package:flutter/material.dart';

import '../../../Models/order_model.dart';
import '../../../design/tokens.dart';

/// Section 5 of the order detail: where the order is going.
///
/// Status, payment and the cancel action live in their own sections now -
/// this card is only the delivery details the customer gave us, written as
/// an address is written rather than as a grid of label/value pairs.
///
/// W8 re-skin: the last order-detail card on the legacy `AppSpacing` /
/// `AppTextColors` / `AppSurfaces` shims now names the same tokens as the
/// sections above it. Identical rendered values, identical layout, identical
/// conditional sections.
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
      padding: const EdgeInsets.all(BlynkSpace.s16),
      // Reference detail, not an answer: no border and a quieter fill, so it
      // recedes behind the bill above it.
      decoration: const BoxDecoration(
        color: BlynkColors.well,
        borderRadius: BlynkWell.radius,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Delivery to',
            style: BlynkText.heading.copyWith(fontWeight: FontWeight.w800, color: BlynkColors.ink),
          ),
          const SizedBox(height: BlynkSpace.s12),
          if (order.deliveryRecipientName.isNotEmpty)
            Text(
              order.deliveryRecipientName,
              style: BlynkText.rowLabel.copyWith(color: BlynkColors.ink),
            ),
          if (order.deliveryRecipientPhone.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              order.deliveryRecipientPhone,
              style: BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
          ],
          if (order.deliveryAlternatePhone != null) ...[
            const SizedBox(height: 2),
            Text(
              'Additional phone: ${order.deliveryAlternatePhone}',
              style: BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
          ],
          const SizedBox(height: BlynkSpace.s8),
          if (order.deliveryAddressLine1.isNotEmpty)
            Text(
              order.deliveryAddressLine1,
              style: BlynkText.body.copyWith(color: BlynkColors.ink),
            ),
          if (line2 != null && line2.trim().isNotEmpty)
            Text(
              line2,
              style: BlynkText.body.copyWith(color: BlynkColors.ink),
            ),
          if (order.deliveryCity.isNotEmpty)
            Text(
              order.deliveryCity,
              style: BlynkText.body.copyWith(color: BlynkColors.ink),
            ),
          if (instructions != null && instructions.trim().isNotEmpty) ...[
            const SizedBox(height: BlynkSpace.s8),
            Text(
              'Instructions: $instructions',
              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
            ),
          ],
          if (notes != null && notes.trim().isNotEmpty) ...[
            const SizedBox(height: BlynkSpace.s4),
            Text(
              'Your note: $notes',
              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
            ),
          ],
        ],
      ),
    );
  }
}
