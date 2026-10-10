import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'Providers/store_info.provider.dart';

/// The FALLBACK ordering hours: the store's default 8 AM - 9 PM Sri Lanka
/// time. Ops/Admin now decide the hours, closures and holidays, and GET
/// /store's status (StoreInfoProvider.isOpenAt) is what screens follow; this
/// clock is used only until /store answers or when it cannot be reached
/// (owner, 2026-10-10). [clock] is still the app's one "now" for store time.
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

  /// The app's "now" for store time, read through [clock] so tests can pin
  /// it (owner, 2026-10-10).
  static DateTime now() => clock();

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
/// that changes while the screen stays open. Open/closed comes from the
/// store's live status (StoreInfoProvider) when it is in the tree, else the
/// fallback clock; when the moment comes it also asks GET /store again, so a
/// closure staff set or lifted shows promptly (owner, 2026-10-10).
class OrderingHoursBuilder extends StatefulWidget {
  const OrderingHoursBuilder({super.key, required this.builder});

  final Widget Function(BuildContext context, bool isOpen) builder;

  @override
  State<OrderingHoursBuilder> createState() => _OrderingHoursBuilderState();
}

class _OrderingHoursBuilderState extends State<OrderingHoursBuilder> {
  Timer? _timer;
  DateTime? _target;

  void _schedule(StoreInfoProvider? store, DateTime now) {
    final next = store != null ? store.nextChangeAfter(now) : now.add(OrderingHours.untilChange(now));
    if (next == _target && _timer != null) return;
    _timer?.cancel();
    _timer = null;
    _target = next;
    if (next == null) return;
    // A second past the boundary, so the check lands on the new side of it.
    final wait = next.difference(now) + const Duration(seconds: 1);
    _timer = Timer(wait.isNegative ? const Duration(seconds: 1) : wait, () {
      if (!mounted) return;
      _timer = null;
      _target = null;
      setState(() {});
      context.read<StoreInfoProvider?>()?.refresh(force: true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<StoreInfoProvider?>();
    final now = OrderingHours.now();
    _schedule(store, now);
    return widget.builder(context, store?.isOpenAt(now) ?? OrderingHours.isOpen(now));
  }
}
