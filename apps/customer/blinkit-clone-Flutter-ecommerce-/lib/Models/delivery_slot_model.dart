/// One scheduled-delivery window from GET /orders/slots. The labels are the
/// server's own ('Today' / 'Tomorrow' / 'Sat 12 Oct', '8–10 AM'), shown as
/// sent (owner, 2026-10-10).
class DeliverySlot {
  const DeliverySlot({
    required this.start,
    required this.end,
    required this.dayLabel,
    required this.timeLabel,
    required this.label,
    required this.remaining,
    required this.available,
  });

  /// The ISO start exactly as the server sent it: POST /orders takes back
  /// this very string as `delivery_slot_start`.
  final String start;
  final String end;
  final String dayLabel;
  final String timeLabel;

  /// 'Today 4–6 PM'.
  final String label;
  final int remaining;

  /// False when the slot is full.
  final bool available;

  static DeliverySlot? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final start = raw['start'];
    final end = raw['end'];
    final day = raw['day_label'];
    final time = raw['time_label'];
    if (start is! String || DateTime.tryParse(start) == null) return null;
    if (end is! String || day is! String || time is! String) return null;
    final remaining = raw['remaining'] is num ? (raw['remaining'] as num).toInt() : 0;
    final label = raw['label'];
    return DeliverySlot(
      start: start,
      end: end,
      dayLabel: day,
      timeLabel: time,
      label: label is String && label.isNotEmpty ? label : '$day $time',
      remaining: remaining < 0 ? 0 : remaining,
      available: raw['available'] == true && remaining > 0,
    );
  }
}

/// GET /orders/slots: whether scheduled delivery is on, whether "As soon as
/// possible" is allowed right now, and the windows (owner, 2026-10-10).
class DeliverySlots {
  const DeliverySlots({required this.enabled, required this.asapAvailable, this.slots = const []});

  static const DeliverySlots off = DeliverySlots(enabled: false, asapAvailable: true);

  final bool enabled;
  final bool asapAvailable;
  final List<DeliverySlot> slots;

  static DeliverySlots? tryParse(Object? raw) {
    if (raw is! Map || raw['enabled'] is! bool) return null;
    final enabled = raw['enabled'] as bool;
    final list = raw['slots'];
    return DeliverySlots(
      enabled: enabled,
      asapAvailable: raw['asap_available'] is bool ? raw['asap_available'] as bool : raw['is_open_now'] == true,
      slots: enabled && list is List ? list.map(DeliverySlot.tryParse).whereType<DeliverySlot>().toList() : const [],
    );
  }

  /// The slots grouped by day label, in the server's order.
  List<MapEntry<String, List<DeliverySlot>>> get byDay {
    final groups = <String, List<DeliverySlot>>{};
    for (final s in slots) {
      groups.putIfAbsent(s.dayLabel, () => []).add(s);
    }
    return groups.entries.toList();
  }

  /// The slot that starts at [start] and still has room; null otherwise.
  DeliverySlot? availableSlot(String? start) {
    if (start == null) return null;
    for (final s in slots) {
      if (s.start == start) return s.available ? s : null;
    }
    return null;
  }
}
