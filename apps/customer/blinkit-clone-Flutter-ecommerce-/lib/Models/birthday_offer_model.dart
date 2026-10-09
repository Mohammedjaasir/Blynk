import 'package:flutter/foundation.dart';

/// The birthday gift (owner, 2026-10-09): a % off ONE order in the
/// customer's birthday week (birthday +-3 days, Asia/Colombo), applied by the
/// server at checkout. Ops / Admin switch it on and set the %. This is the
/// `birthday_offer` block on `GET /me` and `GET /orders/checkout-info`.
///
/// The server decides; the app only words it. [eligible] is the one flag the
/// banners and the checkout estimate read.
@immutable
class BirthdayOffer {
  const BirthdayOffer({
    required this.enabled,
    required this.percent,
    required this.hasBirthday,
    required this.inWindow,
    required this.used,
    required this.eligible,
    this.birthday,
    this.windowStart,
    this.windowEnd,
  });

  /// The store switch (Ops / Admin).
  final bool enabled;

  /// e.g. 10 for 10% off the item subtotal.
  final double percent;

  /// The customer has saved a date of birth.
  final bool hasBirthday;

  /// Today is inside the birthday week.
  final bool inWindow;

  /// The gift was already used for this birthday.
  final bool used;

  /// The next order gets [percent] off its item subtotal.
  final bool eligible;

  final DateTime? birthday;
  final DateTime? windowStart;
  final DateTime? windowEnd;

  /// Null for anything that is not a well-formed offer (absent on a backend
  /// that predates the birthday gift).
  static BirthdayOffer? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final enabled = raw['enabled'];
    final eligible = raw['eligible'];
    final percent = _num(raw['percent']);
    if (enabled is! bool || eligible is! bool || percent == null) return null;
    final ok = percent > 0 && percent < 100;
    return BirthdayOffer(
      enabled: enabled,
      percent: ok ? percent : 0,
      hasBirthday: raw['has_birthday'] == true,
      inWindow: raw['in_window'] == true,
      used: raw['used'] == true,
      // A percentage the app cannot word is never shown as a gift.
      eligible: eligible && ok,
      birthday: parseIsoDate(raw['birthday']),
      windowStart: parseIsoDate(raw['window_start']),
      windowEnd: parseIsoDate(raw['window_end']),
    );
  }

  static double? _num(Object? v) => switch (v) {
        num n => n.toDouble(),
        String s => double.tryParse(s.trim()),
        _ => null,
      };

  /// "10%" or "12.5%" - whole numbers without decimals.
  String get percentLabel {
    final text = percent.toStringAsFixed(2).replaceFirst(RegExp(r'\.?0+$'), '');
    return '$text%';
  }

  /// The banner on Home, the cart and checkout while [eligible].
  String get bannerText => 'Happy birthday! $percentLabel off one order this week';

  /// The estimated gift on an item subtotal, rounded to the cent. Only an
  /// estimate: the server prices the order (and picks the larger of a coupon
  /// and this gift) when it is placed.
  double estimateOn(double itemSubtotal) {
    if (!eligible || itemSubtotal <= 0) return 0;
    return (itemSubtotal * percent).round() / 100;
  }

  /// This offer once its gift has been used (an order took it).
  BirthdayOffer markedUsed() => BirthdayOffer(
        enabled: enabled,
        percent: percent,
        hasBirthday: hasBirthday,
        inWindow: inWindow,
        used: true,
        eligible: false,
        birthday: birthday,
        windowStart: windowStart,
        windowEnd: windowEnd,
      );

  @override
  bool operator ==(Object other) =>
      other is BirthdayOffer &&
      other.enabled == enabled &&
      other.percent == percent &&
      other.hasBirthday == hasBirthday &&
      other.inWindow == inWindow &&
      other.used == used &&
      other.eligible == eligible &&
      other.birthday == birthday &&
      other.windowStart == windowStart &&
      other.windowEnd == windowEnd;

  @override
  int get hashCode =>
      Object.hash(enabled, percent, hasBirthday, inWindow, used, eligible, birthday, windowStart, windowEnd);
}

/// A "YYYY-MM-DD" calendar date as a local midnight [DateTime], or null.
/// Dates of birth are calendar days, never instants, so no time zone applies.
DateTime? parseIsoDate(Object? raw) {
  if (raw is! String) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(raw.trim());
  if (m == null) return null;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  final date = DateTime(y, mo, d);
  // 2023-02-30 rolls over in DateTime; that is not a real date.
  if (date.month != mo || date.day != d) return null;
  return date;
}

/// [date] as the wire's "YYYY-MM-DD".
String formatIsoDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

const List<String> monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// "14 March 1995".
String formatBirthday(DateTime date) => '${date.day} ${monthNames[date.month - 1]} ${date.year}';

/// The number of days in [month] (1-12) of [year].
int daysInMonth(int year, int month) => DateTime(year, month + 1, 0).day;

/// The dates of birth the backend accepts: an age of 5 to 120, never in the
/// future. [today] is injectable for tests.
({DateTime earliest, DateTime latest}) dateOfBirthRange([DateTime? today]) {
  final now = today ?? DateTime.now();
  // 29 February less N years is 28 February in a non-leap year.
  DateTime yearsAgo(int years) {
    final year = now.year - years;
    final day = now.day.clamp(1, daysInMonth(year, now.month));
    return DateTime(year, now.month, day);
  }

  return (earliest: yearsAgo(120), latest: yearsAgo(5));
}

/// A favourite category as `GET /me` names it.
@immutable
class FavouriteCategory {
  const FavouriteCategory({required this.id, required this.name});

  final String id;
  final String name;

  static FavouriteCategory? tryParse(Object? raw) {
    if (raw is! Map || raw['id'] == null) return null;
    return FavouriteCategory(id: raw['id'].toString(), name: (raw['name'] ?? '').toString());
  }

  Map<String, dynamic> toJson() => {'id': id, 'name': name};

  @override
  bool operator ==(Object other) => other is FavouriteCategory && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);
}
