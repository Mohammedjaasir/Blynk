// Sri Lanka (Asia/Colombo) clock helpers, with no `intl` dependency.
//
// Store hours, closures and delivery slots are all Colombo times. Customers'
// phones are almost always on Colombo time, but these helpers work from
// UTC + 5:30 (Sri Lanka has no daylight saving) so a phone set to another
// zone still reads the store's own clock (owner, 2026-10-10).

const Duration colomboOffset = Duration(hours: 5, minutes: 30);

const List<String> colomboWeekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const List<String> colomboMonths = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// The day keys the backend uses for store hours, Monday first.
const List<String> storeDayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/// [at] as a Colombo wall clock: a UTC-flagged DateTime whose fields
/// (year, month, day, hour, minute, weekday) are the Colombo ones.
DateTime colomboWallClock(DateTime at) => at.toUtc().add(colomboOffset);

/// Minutes since Colombo midnight at [at].
int colomboMinutesOfDay(DateTime at) {
  final d = colomboWallClock(at);
  return d.hour * 60 + d.minute;
}

/// The Colombo calendar date of [at] (a UTC-flagged midnight).
DateTime colomboDate(DateTime at) {
  final d = colomboWallClock(at);
  return DateTime.utc(d.year, d.month, d.day);
}

/// Calendar days from [from] to [to], both read on the Colombo clock
/// (0 = same day, 1 = the next day, -1 = the day before).
int colomboDaysBetween(DateTime from, DateTime to) =>
    colomboDate(to).difference(colomboDate(from)).inHours ~/ 24;

/// The instant of [minutesOfDay] on Colombo calendar day [date] (a
/// UTC-flagged midnight as from [colomboDate]).
DateTime colomboInstant(DateTime date, int minutesOfDay) =>
    DateTime.utc(date.year, date.month, date.day).add(Duration(minutes: minutesOfDay)).subtract(colomboOffset);

/// "HH:MM" (24 h) as minutes since midnight; null for anything else.
int? parseHhMm(Object? raw) {
  if (raw is! String) return null;
  final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(raw.trim());
  if (m == null) return null;
  final h = int.parse(m.group(1)!);
  final min = int.parse(m.group(2)!);
  if (h > 24 || min > 59 || (h == 24 && min != 0)) return null;
  return h * 60 + min;
}

String _hour12(int minutesOfDay) {
  final h = (minutesOfDay ~/ 60) % 24;
  final h12 = h % 12 == 0 ? 12 : h % 12;
  final min = minutesOfDay % 60;
  return min == 0 ? '$h12' : '$h12:${min.toString().padLeft(2, '0')}';
}

String _meridiem(int minutesOfDay) => ((minutesOfDay ~/ 60) % 24) < 12 ? 'AM' : 'PM';

/// A clock time the way the store says it: whole hours bare, half hours
/// with their minutes ("8:30 AM"), noon as 12 PM.
String formatClockTime(int minutesOfDay) => '${_hour12(minutesOfDay)} ${_meridiem(minutesOfDay)}';

/// Opening hours, "open – close" with spaced en dash (the label style the
/// app has always used for delivery hours).
String formatHoursRange(int openMinutes, int closeMinutes) =>
    '${formatClockTime(openMinutes)} – ${formatClockTime(closeMinutes)}';

/// A short window, the slot style the backend uses for `time_label`: one
/// meridiem when both ends share it ("8–10 AM", "8:30–9:30 AM"), else both
/// ("11 AM–1 PM").
String formatTimeWindow(int startMinutes, int endMinutes) {
  final sameHalf = _meridiem(startMinutes) == _meridiem(endMinutes);
  return sameHalf
      ? '${_hour12(startMinutes)}–${_hour12(endMinutes)} ${_meridiem(endMinutes)}'
      : '${formatClockTime(startMinutes)}–${formatClockTime(endMinutes)}';
}

/// 'Today', 'Tomorrow' or 'Sat 12 Oct' for [at] relative to [now], on the
/// Colombo calendar (the `day_label` style of GET /orders/slots).
String colomboDayLabel(DateTime at, DateTime now) {
  final days = colomboDaysBetween(now, at);
  if (days == 0) return 'Today';
  if (days == 1) return 'Tomorrow';
  final d = colomboWallClock(at);
  return '${colomboWeekdays[d.weekday - 1]} ${d.day} ${colomboMonths[d.month - 1]}';
}
