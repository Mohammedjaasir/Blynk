import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../Models/order_status_labels.dart';
import '../../../app_design.dart';

/// "What happened": one row per `history[]` entry, oldest first, exactly as
/// the backend recorded it. No future/greyed/placeholder steps - a status
/// that never appears in `history` never gets a row here, and a row with
/// `at == null` never invents a time.
class OrderTimeline extends StatelessWidget {
  const OrderTimeline({super.key, required this.history});

  final List<OrderStatusEvent> history;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) return const SizedBox.shrink();

    return Container(
      key: const Key('order-timeline'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.cardBorder,
        border: Border.all(color: AppSurfaces.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'What happened',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppTextColors.primary),
          ),
          const SizedBox(height: AppSpacing.md),
          for (var i = 0; i < history.length; i++) _row(i, history[i], isLast: i == history.length - 1),
        ],
      ),
    );
  }

  Widget _row(int index, OrderStatusEvent event, {required bool isLast}) {
    final label = timelineLabel(event);
    final time = event.at == null ? null : formatOrderTime(event.at!);
    // The row's own recorded status already says the same thing in words -
    // this only adds emphasis to it, it never carries meaning on its own.
    final tone = orderToneColor(orderStatusTone(event.newStatus));

    return Semantics(
      label: time == null ? label : '$label, $time',
      excludeSemantics: true,
      child: Container(
        key: Key('timeline-row-$index'),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Fixed-width gutter: the 10px past dots, the 12px final dot and
            // the rail all centre on the same x, and every row's label
            // therefore starts on the same x too.
            SizedBox(
              width: 12,
              child: Column(
                children: [
                  Container(
                    width: isLast ? 12 : 10,
                    height: isLast ? 12 : 10,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isLast ? tone : Colors.white,
                      border: isLast
                          ? null
                          : Border.all(color: tone.withValues(alpha: 0.45), width: 2),
                    ),
                  ),
                  if (!isLast)
                    Container(
                      width: 2,
                      height: AppSpacing.lg,
                      color: const Color(0xffDCE2EC),
                    ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.md - 2),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        color: tone,
                      ),
                    ),
                    if (time != null) ...[
                      const SizedBox(height: 2),
                      Text(time, style: const TextStyle(fontSize: 12, color: AppTextColors.secondary)),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
