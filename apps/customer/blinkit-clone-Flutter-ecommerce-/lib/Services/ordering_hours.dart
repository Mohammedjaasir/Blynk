import 'dart:async';

import 'package:flutter/widgets.dart';

/// When customers may place an order: 8 AM - 9 PM Sri Lanka time, every day
/// (owner, 2026-10-06). Mirrors `isWithinOrderingHours` in the backend
/// `utils/time.ts`, which refuses other times with STORE_CLOSED; this copy
/// only lets the cart say so before the customer taps Place order.
///
/// Sri Lanka time is worked out from UTC (UTC+5:30, no daylight saving), so a
/// phone set to another time zone still gets the right answer.
abstract final class OrderingHours {
  static const int openHour = 8;
  static const int closeHour = 21;
  static const Duration _sriLankaOffset = Duration(hours: 5, minutes: 30);

  /// The clock read for "now". Tests pin it (test/flutter_test_config.dart).
  @visibleForTesting
  static DateTime Function() clock = DateTime.now;

  static DateTime _sriLanka(DateTime at) => at.toUtc().add(_sriLankaOffset);

  static bool isOpen([DateTime? at]) {
    final hour = _sriLanka(at ?? clock()).hour;
    return hour >= openHour && hour < closeHour;
  }

  /// Time left until ordering next opens or closes.
  static Duration untilChange([DateTime? at]) {
    final now = _sriLanka(at ?? clock());
    final today = DateTime.utc(now.year, now.month, now.day);
    final open = today.add(const Duration(hours: openHour));
    final close = today.add(const Duration(hours: closeHour));
    final DateTime next;
    if (now.isBefore(open)) {
      next = open;
    } else if (now.isBefore(close)) {
      next = close;
    } else {
      next = open.add(const Duration(days: 1));
    }
    return next.difference(now);
  }
}

/// Rebuilds [builder] with whether ordering is open, and again the moment
/// that changes (8:00 AM / 9:00 PM) while the screen stays open.
class OrderingHoursBuilder extends StatefulWidget {
  const OrderingHoursBuilder({super.key, required this.builder});

  final Widget Function(BuildContext context, bool isOpen) builder;

  @override
  State<OrderingHoursBuilder> createState() => _OrderingHoursBuilderState();
}

class _OrderingHoursBuilderState extends State<OrderingHoursBuilder> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    // A second past the boundary, so the check lands on the new side of it.
    _timer = Timer(OrderingHours.untilChange() + const Duration(seconds: 1), () {
      if (!mounted) return;
      setState(() {});
      _schedule();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, OrderingHours.isOpen());
}
