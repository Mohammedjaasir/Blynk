import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../../../design/tokens.dart';

/// The four-step order tracker (2026-09-30): Order received → Packed →
/// On the way → Delivered. Every step is driven by the order's backend
/// status, which Blynk Operations moves forward (Pack, Handed to rider, Mark
/// delivered). Done steps are ticked with the time the backend recorded, the
/// current step is highlighted, later steps are grey.
///
/// A cancelled order shows no tracker: the status header above already says
/// what happened. A failed delivery or "we couldn't reach you" stops at
/// "On the way" and the header explains.
class OrderProgressTracker extends StatelessWidget {
  const OrderProgressTracker({super.key, required this.order});

  final OrderModel order;

  static const List<String> _labels = ['Order received', 'Packed', 'On the way', 'Delivered'];
  static const List<OrderStatus> _stepStatus = [
    OrderStatus.placed,
    OrderStatus.packed,
    OrderStatus.outForDelivery,
    OrderStatus.delivered,
  ];

  /// Index of the step the order is on, or null when no tracker applies.
  static int? currentStep(OrderStatus status) {
    switch (status) {
      case OrderStatus.placed:
      case OrderStatus.itemUnavailable:
        return 0;
      case OrderStatus.packed:
        return 1;
      case OrderStatus.outForDelivery:
      case OrderStatus.failed:
      case OrderStatus.customerUnavailable:
        return 2;
      case OrderStatus.delivered:
        return 3;
      case OrderStatus.cancelled:
      case OrderStatus.unknown:
        return null;
    }
  }

  /// When the backend recorded reaching [status] (the latest such event).
  DateTime? _reachedAt(OrderStatus status) {
    DateTime? at;
    for (final e in order.history) {
      if (e.newStatus == status && e.at != null) at = e.at;
    }
    if (status == OrderStatus.placed) at ??= order.placedAt;
    return at;
  }

  @override
  Widget build(BuildContext context) {
    final current = currentStep(order.status);
    if (current == null) return const SizedBox.shrink();
    final stopped = order.status == OrderStatus.failed || order.status == OrderStatus.customerUnavailable;

    return Semantics(
      label: 'Order progress: ${_labels[current]}${stopped ? ', stopped' : ''}',
      excludeSemantics: true,
      child: Container(
        key: const Key('order-progress'),
        padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s12),
        decoration: appCardDecoration(),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < _labels.length; i++)
              Expanded(
                child: _Step(
                  label: _labels[i],
                  time: i <= current ? _reachedAt(_stepStatus[i]) : null,
                  state: i < current || (i == current && order.status == OrderStatus.delivered)
                      ? _StepState.done
                      : i == current
                          ? (stopped ? _StepState.stopped : _StepState.current)
                          : _StepState.upcoming,
                  first: i == 0,
                  last: i == _labels.length - 1,
                  leftDone: i <= current,
                  rightDone: i < current,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

enum _StepState { done, current, stopped, upcoming }

class _Step extends StatelessWidget {
  const _Step({
    required this.label,
    required this.time,
    required this.state,
    required this.first,
    required this.last,
    required this.leftDone,
    required this.rightDone,
  });

  final String label;
  final DateTime? time;
  final _StepState state;
  final bool first, last, leftDone, rightDone;

  static const double _dot = 28;
  static const double _rail = 3;

  @override
  Widget build(BuildContext context) {
    const green = BlynkColors.positive;
    final grey = BlynkColors.ink3.withValues(alpha: 0.25);
    final Color dotColor = switch (state) {
      _StepState.done => green,
      _StepState.current => green,
      _StepState.stopped => BlynkColors.problem,
      _StepState.upcoming => grey,
    };

    return Column(
      children: [
        SizedBox(
          height: _dot,
          child: Row(
            children: [
              Expanded(child: first ? const SizedBox() : Container(height: _rail, color: leftDone ? green : grey)),
              Container(
                width: _dot,
                height: _dot,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: state == _StepState.current ? BlynkColors.paper : dotColor,
                  border: Border.all(color: dotColor, width: 3),
                ),
                child: state == _StepState.done
                    ? const Icon(Icons.check_rounded, size: 16, color: BlynkColors.onPositive)
                    : state == _StepState.stopped
                        ? const Icon(BlynkIcons.close, size: 16, color: BlynkColors.paper)
                        : null,
              ),
              Expanded(child: last ? const SizedBox() : Container(height: _rail, color: rightDone ? green : grey)),
            ],
          ),
        ),
        const SizedBox(height: BlynkSpace.s8),
        Text(
          label,
          textAlign: TextAlign.center,
          style: BlynkText.caption.copyWith(
            color: state == _StepState.upcoming ? BlynkColors.ink3 : BlynkColors.ink,
            fontWeight: state == _StepState.current || state == _StepState.stopped ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
        if (time != null)
          Text(
            formatOrderTime(time!),
            textAlign: TextAlign.center,
            style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
          ),
      ],
    );
  }
}
