import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../Models/order_status_labels.dart';
import '../../../design/tokens.dart';

/// The order-detail status header. It sits directly on the page background
/// (not a card) and renders exactly what `OrderModel` holds: no clock, no
/// network, no inferred rider wording beyond what `orderStatusSentence`
/// already decided from the backend's `delivery.assignmentStatus`.
class OrderStatusHeader extends StatelessWidget {
  const OrderStatusHeader({super.key, required this.order});

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final tone = orderStatusTone(order.status);
    final color = orderToneColor(tone);
    final reason = order.cancellationReason;
    final showsReason = order.status == OrderStatus.cancelled && reason != null && reason.isNotEmpty;

    return Semantics(
      header: true,
      child: Container(
        key: const Key('order-status-header'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(orderStatusIcon(order.status), color: color, size: BlynkIcons.md),
                const SizedBox(width: BlynkSpace.s8),
                Expanded(
                  child: Text(
                    orderStatusLabel(order.status),
                    style: BlynkText.headline.copyWith(color: color),
                  ),
                ),
              ],
            ),
            const SizedBox(height: BlynkSpace.s4),
            Text(
              orderStatusSentence(order),
              style: BlynkText.body.copyWith(color: BlynkColors.ink3),
            ),
            if (showsReason) ...[
              const SizedBox(height: BlynkSpace.s4),
              Text(
                'Reason: $reason',
                style: BlynkText.body.copyWith(color: BlynkColors.ink3),
              ),
            ],
            if (order.showsScheduleNotice) ...[
              const SizedBox(height: BlynkSpace.s12),
              Container(
                key: const Key('order-schedule-notice'),
                padding: const EdgeInsets.symmetric(
                  horizontal: BlynkSpace.s12,
                  vertical: BlynkSpace.s8,
                ),
                decoration: const BoxDecoration(
                  color: BlynkColors.well,
                  borderRadius: BlynkRadius.full,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.schedule, size: BlynkIcons.xs, color: BlynkColors.ink3),
                    const SizedBox(width: BlynkSpace.s4),
                    Flexible(
                      child: Text(
                        // "Scheduled: Tomorrow 8–10 AM" (owner, 2026-10-10).
                        scheduledLine(order)!,
                        style: BlynkText.caption.copyWith(color: BlynkColors.ink),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
