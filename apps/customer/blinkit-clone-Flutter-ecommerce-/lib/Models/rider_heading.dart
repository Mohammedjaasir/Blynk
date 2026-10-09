import 'dart:math' as math;

/// Which way the rider is travelling, for the bike icon that turns with the
/// road (owner, 2026-10-10). Pure: no widgets, no map SDK.
///
/// The rider app sends no GPS heading (the location API carries latitude,
/// longitude, accuracy and timestamps only), so the heading is the compass
/// bearing from the previous fix to the new one.

/// Fixes closer together than this do not change the heading: GPS jitter
/// while the rider waits at a junction would otherwise spin the bike around.
const double kHeadingMinMoveMeters = 8;

const double _earthRadiusMeters = 6371000;
double _rad(double d) => d * math.pi / 180;

/// Great-circle distance in metres.
double headingDistanceMeters(double lat1, double lng1, double lat2, double lng2) {
  final dLat = _rad(lat2 - lat1);
  final dLng = _rad(lng2 - lng1);
  final h = math.pow(math.sin(dLat / 2), 2) +
      math.cos(_rad(lat1)) * math.cos(_rad(lat2)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * _earthRadiusMeters * math.asin(math.sqrt(h));
}

/// Initial compass bearing from (lat1, lng1) to (lat2, lng2), degrees
/// clockwise from north in [0, 360). 0 = north, 90 = east.
double bearingDegrees(double lat1, double lng1, double lat2, double lng2) {
  final phi1 = _rad(lat1);
  final phi2 = _rad(lat2);
  final dLng = _rad(lng2 - lng1);
  final y = math.sin(dLng) * math.cos(phi2);
  final x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dLng);
  final deg = math.atan2(y, x) * 180 / math.pi;
  return (deg + 360) % 360;
}

/// Degrees from [a] to [b] the short way round, in (-180, 180].
double angleDelta(double a, double b) {
  var d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/// The angle [t] of the way from [a] to [b], turning the short way (350 to 10
/// turns 20 degrees through north, never 340 the long way). In [0, 360).
double lerpAngle(double a, double b, double t) => ((a + angleDelta(a, b) * t) % 360 + 360) % 360;
