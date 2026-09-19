import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../Models/order_status_labels.dart';
import '../../../app_design.dart';

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
                Icon(orderStatusIcon(order.status), color: color, size: 26),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    orderStatusLabel(order.status),
                    style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              orderStatusSentence(order),
              style: const TextStyle(color: AppTextColors.onBackground, fontSize: 14),
            ),
            if (showsReason) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Reason: $reason',
                style: const TextStyle(color: AppTextColors.onBackground, fontSize: 14),
              ),
            ],
            if (order.showsScheduleNotice) ...[
              const SizedBox(height: AppSpacing.md),
              Container(
                key: const Key('order-schedule-notice'),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppRadius.chip),
                  border: Border.all(color: AppSurfaces.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.schedule, size: 16, color: AppTextColors.secondary),
                    const SizedBox(width: AppSpacing.xs),
                    Flexible(
                      child: Text(
                        'Scheduled — delivery ${formatScheduled(order.scheduledFor!)}',
                        style: const TextStyle(
                          color: AppTextColors.primary,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
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
