/// The road route from the rider to the customer's door, as the backend's
/// `GET /orders/:id/route` returns it (owner, 2026-10-10 - this reverses the
/// earlier plan rule D.13 "no route, no ETA"). Computed by the self-hosted
/// OSRM on the server; the app never estimates a time itself.
class RiderRoute {
  const RiderRoute({
    required this.points,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.computedAt,
  });

  /// (latitude, longitude) pairs from the rider to the door.
  final List<(double, double)> points;
  final int distanceMeters;
  final int durationSeconds;
  final DateTime computedAt;

  /// `{coordinates: [[lng, lat], ...], distance_m, duration_s, computed_at}`.
  /// Null on anything malformed - a route is never half-trusted.
  static RiderRoute? tryParse(Object? json) {
    if (json is! Map) return null;
    final raw = json['coordinates'];
    final distance = json['distance_m'];
    final duration = json['duration_s'];
    final computedAt = DateTime.tryParse('${json['computed_at']}');
    if (raw is! List || raw.length < 2 || distance is! num || duration is! num || computedAt == null) return null;
    if (!distance.isFinite || !duration.isFinite || distance < 0 || duration < 0) return null;
    final points = <(double, double)>[];
    for (final p in raw) {
      if (p is! List || p.length < 2 || p[0] is! num || p[1] is! num) return null;
      final lng = (p[0] as num).toDouble();
      final lat = (p[1] as num).toDouble();
      if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) return null;
      points.add((lat, lng));
    }
    return RiderRoute(
      points: points,
      distanceMeters: distance.round(),
      durationSeconds: duration.round(),
      computedAt: computedAt,
    );
  }
}

/// "Arriving in ~6 min" from OSRM's driving time. Whole minutes, rounded up,
/// never below 1 (a rider 40 s away is "~1 min", not "~0 min").
String arrivingText(int durationSeconds) {
  final minutes = durationSeconds <= 0 ? 1 : (durationSeconds / 60).ceil();
  return 'Arriving in ~$minutes min';
}
