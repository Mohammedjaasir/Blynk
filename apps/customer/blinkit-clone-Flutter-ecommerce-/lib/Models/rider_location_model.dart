enum LocationFreshness { live, stale, offline }

/// LIVE up to ~2x the rider app's send interval (plan §4, §10); STALE up to a
/// longer ceiling; OFFLINE beyond that. Always computed from server
/// timestamps, never a client guess.
const _liveWindow = Duration(seconds: 18);
const _staleCeiling = Duration(minutes: 2);

/// Age is measured between instants (zone-independent). A `capturedAt` in the
/// future (clock skew) yields a negative age and is treated as live.
LocationFreshness classifyFreshness(DateTime capturedAt, {DateTime? now}) {
  final n = now ?? DateTime.now().toUtc();
  final age = n.difference(capturedAt);
  if (age <= _liveWindow) return LocationFreshness.live;
  if (age <= _staleCeiling) return LocationFreshness.stale;
  return LocationFreshness.offline;
}

double? _finiteDouble(Object? v) {
  if (v == null) return null;
  final d = double.tryParse(v.toString().trim());
  return d != null && d.isFinite ? d : null;
}

final _isoStamp = RegExp(r'^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})');

/// Dart's [DateTime.tryParse] silently rolls impossible dates over (month 13
/// becomes next January), which would fabricate a timestamp. Require a full
/// ISO timestamp and reject out-of-range components before trusting it.
DateTime? _dateTime(Object? v) {
  if (v == null) return null;
  final s = v.toString().trim();
  final m = _isoStamp.firstMatch(s);
  if (m == null) return null;
  final year = int.parse(m[1]!), month = int.parse(m[2]!), day = int.parse(m[3]!);
  final hour = int.parse(m[4]!), minute = int.parse(m[5]!);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  if (day < 1 || day > DateTime.utc(year, month + 1, 0).day) return null;
  return DateTime.tryParse(s);
}

/// One rider location fix as sent on the SSE `location` event
/// (`{latitude, longitude, accuracy, captured_at, received_at}`).
class RiderLocationPoint {
  const RiderLocationPoint({
    required this.latitude,
    required this.longitude,
    required this.accuracy,
    required this.capturedAt,
    required this.receivedAt,
  });
  final double latitude, longitude;

  /// Metres; null when the rider's phone reported none (the backend stores
  /// 0 or a missing value as unknown and sends `accuracy: null`).
  final double? accuracy;
  final DateTime capturedAt, receivedAt;

  /// Returns null on any missing/invalid coordinate or timestamp - a point is
  /// never fabricated. Coordinates must be finite and in range. Accuracy is
  /// optional: missing, null, unparseable or not above 0 means "unknown", and
  /// the position is still shown.
  static RiderLocationPoint? tryParse(Object? json) {
    if (json is! Map) return null;
    final lat = _finiteDouble(json['latitude']);
    final lng = _finiteDouble(json['longitude']);
    final rawAcc = _finiteDouble(json['accuracy']);
    final acc = rawAcc != null && rawAcc > 0 ? rawAcc : null;
    final capturedAt = _dateTime(json['captured_at']);
    final receivedAt = _dateTime(json['received_at']);
    if (lat == null || lng == null || capturedAt == null || receivedAt == null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return RiderLocationPoint(
      latitude: lat,
      longitude: lng,
      accuracy: acc,
      capturedAt: capturedAt,
      receivedAt: receivedAt,
    );
  }
}
