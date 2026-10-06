import 'dart:async';

import 'package:ecom/Services/ordering_hours.dart';

/// Runs before every test file in test/. Ordering is closed outside 8 AM -
/// 9 PM Sri Lanka time, so pin the clock to midday there (06:30 UTC = 12:00
/// in Sri Lanka): cart and checkout tests then pass at any hour. A test about
/// closed hours sets OrderingHours.clock itself and restores it.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  OrderingHours.clock = () => DateTime.utc(2026, 10, 6, 6, 30);
  await testMain();
}
