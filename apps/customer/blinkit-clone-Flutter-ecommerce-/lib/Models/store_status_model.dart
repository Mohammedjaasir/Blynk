import 'colombo_time.dart';

/// One day of the store's regular hours (`hours.days.<key>` on GET /store).
/// A closed day still carries open/close, which mean nothing then.
class StoreDayHours {
  const StoreDayHours({required this.closed, required this.open, required this.close});

  final bool closed;

  /// Minutes since Colombo midnight.
  final int open;
  final int close;

  static StoreDayHours? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final open = parseHhMm(raw['open']);
    final close = parseHhMm(raw['close']);
    final closed = raw['closed'] == true;
    if (open == null || close == null) return closed ? const StoreDayHours(closed: true, open: 0, close: 0) : null;
    if (!closed && open >= close) return null;
    return StoreDayHours(closed: closed, open: open, close: close);
  }

  /// "8 AM – 9 PM", or "closed".
  String get label => closed ? 'closed' : formatHoursRange(open, close);
}

/// A day the store is shut (`upcoming_holidays[]`).
class StoreHoliday {
  const StoreHoliday({required this.date, this.reason});

  /// YYYY-MM-DD, Colombo calendar.
  final String date;
  final String? reason;

  static StoreHoliday? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final date = raw['date'];
    if (date is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date)) return null;
    final reason = raw['reason'];
    return StoreHoliday(
      date: date,
      reason: reason is String && reason.trim().isNotEmpty ? reason.trim() : null,
    );
  }

  /// 'Sat 12 Oct', or the raw date if it does not parse.
  String get dateLabel {
    final d = DateTime.tryParse('${date}T00:00:00Z');
    if (d == null) return date;
    return '${colomboWeekdays[d.weekday - 1]} ${d.day} ${colomboMonths[d.month - 1]}';
  }
}

String _ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// The store's hours and open/closed status as GET /store sends them. Since
/// the store timing became Ops/Admin's to decide, these replace the fixed
/// hours the app used to carry; StoreInfo's hour constants are now only the
/// fallback for when GET /store has not answered (owner, 2026-10-10).
///
/// [isOpenNow] is null for a backend that sends hours but no status: the app
/// then keeps judging open/closed by its own clock.
class StoreStatus {
  const StoreStatus({
    required this.fetchedAt,
    this.deliveryStart,
    this.deliveryEnd,
    this.sameEveryDay = true,
    this.days = const {},
    this.isOpenNow,
    this.closedKind = 'OPEN',
    this.closedReason,
    this.reopensAt,
    this.nextOpenAt,
    this.todayOpen,
    this.todayClose,
    this.upcomingHolidays = const [],
    this.deliverySlotsEnabled = false,
  });

  /// When this answer arrived (the app clock).
  final DateTime fetchedAt;

  /// `delivery_hours`: today's hours, or the next open day's if today is
  /// closed. Minutes since Colombo midnight.
  final int? deliveryStart;
  final int? deliveryEnd;

  final bool sameEveryDay;

  /// By [storeDayKeys] key; empty when the server sent none.
  final Map<String, StoreDayHours> days;

  final bool? isOpenNow;

  /// OPEN, OUTSIDE_HOURS, CLOSED_DAY, HOLIDAY or CLOSED_NOW.
  final String closedKind;

  /// The staff reason (a close-now switch) or the holiday's name.
  final String? closedReason;

  final DateTime? reopensAt;

  /// The next moment orders are taken; null when open, or closed with no
  /// known reopening.
  final DateTime? nextOpenAt;

  /// `today_hours`, null when today is a closed day or a holiday.
  final int? todayOpen;
  final int? todayClose;

  final List<StoreHoliday> upcomingHolidays;

  final bool deliverySlotsEnabled;

  /// Null for anything that carries neither usable hours nor a status.
  static StoreStatus? tryParse(Object? data, {required DateTime fetchedAt}) {
    if (data is! Map) return null;
    final delivery = data['delivery_hours'];
    int? start = delivery is Map ? parseHhMm(delivery['start']) : null;
    int? end = delivery is Map ? parseHhMm(delivery['end']) : null;
    if (start == null || end == null || start >= end) start = end = null;
    final isOpen = data['is_open_now'];
    if (start == null && isOpen is! bool) return null;

    final hours = data['hours'];
    final rawDays = hours is Map ? hours['days'] : null;
    final days = <String, StoreDayHours>{};
    if (rawDays is Map) {
      for (final key in storeDayKeys) {
        final day = StoreDayHours.tryParse(rawDays[key]);
        if (day != null) days[key] = day;
      }
    }
    final today = data['today_hours'];
    int? todayOpen = today is Map ? parseHhMm(today['open']) : null;
    int? todayClose = today is Map ? parseHhMm(today['close']) : null;
    if (todayOpen == null || todayClose == null || todayOpen >= todayClose) todayOpen = todayClose = null;
    final reason = data['closed_reason'];
    final kind = data['closed_kind'];
    final holidays = data['upcoming_holidays'];
    DateTime? date(Object? v) => v is String ? DateTime.tryParse(v) : null;

    return StoreStatus(
      fetchedAt: fetchedAt,
      deliveryStart: start,
      deliveryEnd: end,
      sameEveryDay: hours is Map ? hours['same_every_day'] != false : true,
      days: days,
      isOpenNow: isOpen is bool ? isOpen : null,
      closedKind: kind is String && kind.isNotEmpty ? kind : (isOpen == false ? 'OUTSIDE_HOURS' : 'OPEN'),
      closedReason: reason is String && reason.trim().isNotEmpty ? reason.trim() : null,
      reopensAt: date(data['reopens_at']),
      nextOpenAt: date(data['next_open_at']),
      todayOpen: todayOpen,
      todayClose: todayClose,
      upcomingHolidays: holidays is List
          ? holidays.map(StoreHoliday.tryParse).whereType<StoreHoliday>().toList()
          : const [],
      deliverySlotsEnabled: data['delivery_slots_enabled'] == true,
    );
  }

  /// "8 AM – 9 PM" from `delivery_hours`; null when it was missing.
  String? get hoursLabel =>
      deliveryStart == null ? null : formatHoursRange(deliveryStart!, deliveryEnd!);

  /// "8 AM" / "8:30 AM": when ordering opens (the start of [hoursLabel]).
  String? get opensAtLabel => deliveryStart == null ? null : formatClockTime(deliveryStart!);

  /// The week in words for Help: "8 AM – 9 PM, every day", or runs of days
  /// that share hours ("Mon–Fri 8 AM – 9 PM, Sat 9 AM – 1 PM, Sun closed").
  /// Null when the server sent no week.
  String? get weekSentence {
    if (days.length != storeDayKeys.length) {
      return hoursLabel == null ? null : '$hoursLabel, every day';
    }
    final labels = [for (final k in storeDayKeys) days[k]!.label];
    if (labels.toSet().length == 1) {
      return labels.first == 'closed' ? null : '${labels.first}, every day';
    }
    final parts = <String>[];
    var i = 0;
    while (i < labels.length) {
      var j = i;
      while (j + 1 < labels.length && labels[j + 1] == labels[i]) {
        j++;
      }
      final run = i == j ? colomboWeekdays[i] : '${colomboWeekdays[i]}–${colomboWeekdays[j]}';
      parts.add('$run ${labels[i]}');
      i = j + 1;
    }
    return parts.join(', ');
  }

  bool _isHoliday(DateTime colomboDay) => upcomingHolidays.any((h) => h.date == _ymd(colomboDay));

  /// Open by the regular week alone (no closure known) at [now].
  bool? _openByHours(DateTime now) {
    final day = colomboDate(now);
    final hours = days[storeDayKeys[day.weekday - 1]];
    if (hours == null) return null;
    if (hours.closed || _isHoliday(day)) return false;
    final m = colomboMinutesOfDay(now);
    return m >= hours.open && m < hours.close;
  }

  /// The next opening by the regular week and the holidays, after [now].
  DateTime? _nextOpenFromHours(DateTime now) {
    final today = colomboDate(now);
    for (var i = 0; i <= 7; i++) {
      final day = today.add(Duration(days: i));
      final hours = days[storeDayKeys[day.weekday - 1]];
      if (hours == null || hours.closed || _isHoliday(day)) continue;
      final at = colomboInstant(day, hours.open);
      if (at.isAfter(now)) return at;
    }
    return null;
  }

  /// Whether orders are taken at [now], from this answer. The answer is a
  /// snapshot, so it is aged sensibly until the next refresh: a closure
  /// ends at its [nextOpenAt], and an open store closes at today's closing
  /// time (owner, 2026-10-10). Null when the server sent no status.
  bool? isOpenAt(DateTime now) {
    final open = isOpenNow;
    if (open == null) return null;
    if (!open) {
      final next = nextOpenAt;
      return next != null && !now.isBefore(next);
    }
    if (colomboDaysBetween(fetchedAt, now) != 0) return _openByHours(now) ?? true;
    final close = todayClose;
    return close == null || colomboMinutesOfDay(now) < close;
  }

  /// When [isOpenAt] next flips after [now], so a screen can update (and
  /// ask the server again) right then; null when unknown.
  DateTime? nextChangeAfter(DateTime now) {
    final open = isOpenAt(now);
    if (open == null) return null;
    if (open) {
      final close = todayClose;
      if (close == null) return null;
      final at = colomboInstant(colomboDate(now), close);
      return at.isAfter(now) ? at : null;
    }
    final next = nextOpenFor(now);
    return next != null && next.isAfter(now) ? next : null;
  }

  /// When the store opens again, seen from [now] while it is closed: the
  /// server's [nextOpenAt], or, once an open answer has aged past closing
  /// time, the next opening by the week. Null = not known (closed until
  /// staff reopen).
  DateTime? nextOpenFor(DateTime now) =>
      isOpenNow == false ? nextOpenAt : _nextOpenFromHours(now);

  /// The closed banner: "Closed now — back at 8 AM tomorrow", "Closed today —
  /// back Sat 8 AM", "Closed — Rain · back at 3:30 PM", "Closed for now —
  /// Rain" when no reopening is known (owner, 2026-10-10).
  String closedText(DateTime now) {
    final reason = isOpenNow == false ? closedReason : null;
    final next = nextOpenFor(now);
    if (next == null) return reason == null ? 'Closed for now' : 'Closed for now — $reason';
    final when = backWhen(next, now);
    if (reason != null) return 'Closed — $reason · back $when';
    final wholeDay = isOpenNow == false && (closedKind == 'HOLIDAY' || closedKind == 'CLOSED_DAY');
    return '${wholeDay ? 'Closed today' : 'Closed now'} — back $when';
  }

  /// "at 8 AM" (later today), "at 8 AM tomorrow", "Sat 8 AM" (this week) or
  /// "Sat 12 Oct 8 AM", for reopening at [next] seen from [now] (Colombo).
  static String backWhen(DateTime next, DateTime now) {
    final time = formatClockTime(colomboMinutesOfDay(next));
    final days = colomboDaysBetween(now, next);
    if (days <= 0) return 'at $time';
    if (days == 1) return 'at $time tomorrow';
    final d = colomboWallClock(next);
    final weekday = colomboWeekdays[d.weekday - 1];
    if (days < 7) return '$weekday $time';
    return '$weekday ${d.day} ${colomboMonths[d.month - 1]} $time';
  }
}
