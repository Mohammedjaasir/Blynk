import 'map_provider.dart';
import 'dart:math' as math;

/// Pure marker logic for the map adapter. No SDK, no widgets, no platform
/// calls: everything here is unit-tested without a map.

/// What changed between the markers currently on the map and the wanted set.
class MarkerDiff {
  const MarkerDiff({required this.added, required this.updated, required this.removedIds});
  final List<MapMarkerSpec> added;
  final List<MapMarkerSpec> updated;
  final List<String> removedIds;

  bool get isEmpty => added.isEmpty && updated.isEmpty && removedIds.isEmpty;
}

/// Diffs [applied] (marker id -> what is on the map now) against [wanted].
/// A marker keeps its identity by id: a moved or retoned marker is an
/// *update* of the existing annotation (no remove + add, so no flicker), an
/// unchanged marker is left alone, and only vanished ids are removed.
MarkerDiff diffMarkers(Map<String, MapMarkerSpec> applied, Set<MapMarkerSpec> wanted) {
  final added = <MapMarkerSpec>[];
  final updated = <MapMarkerSpec>[];
  final wantedIds = <String>{};
  for (final marker in wanted) {
    wantedIds.add(marker.id);
    final current = applied[marker.id];
    if (current == null) {
      added.add(marker);
    } else if (current != marker) {
      updated.add(marker);
    }
  }
  final removedIds = [for (final id in applied.keys) if (!wantedIds.contains(id)) id];
  return MarkerDiff(added: added, updated: updated, removedIds: removedIds);
}

/// Hues from the plan (the prior Google-Maps violet/azure pins) rather than
/// AppColors tokens: a destination and a rider must not read as Blynk
/// yellow/green UI chrome, and must stay distinct from each other and from the
/// pale land/water of the map style.
const String destinationMarkerHex = '#8E24AA'; // violet
const String riderMarkerHex = '#1E88E5'; // azure
const String markerStrokeHex = '#FFFFFF';

/// A stale rider is the same azure dot, half faded.
const double staleMarkerOpacity = 0.5;

/// How one marker tone is painted. Plain values so the SDK adapter is a
/// mechanical translation and the mapping is testable without the SDK.
class MarkerPaint {
  const MarkerPaint({
    required this.colorHex,
    required this.opacity,
    required this.radius,
    required this.strokeColorHex,
    required this.strokeWidth,
    required this.strokeOpacity,
  });
  final String colorHex;
  final double opacity;
  final double radius;
  final String strokeColorHex;
  final double strokeWidth;
  final double strokeOpacity;
}

MarkerPaint markerPaintFor(MapMarkerTone tone) {
  final stale = tone == MapMarkerTone.riderStale;
  final opacity = stale ? staleMarkerOpacity : 1.0;
  return MarkerPaint(
    colorHex: tone == MapMarkerTone.destination ? destinationMarkerHex : riderMarkerHex,
    opacity: opacity,
    radius: 9,
    strokeColorHex: markerStrokeHex,
    strokeWidth: 2.5,
    strokeOpacity: opacity,
  );
}

/// The camera fits both markers exactly once: the first time the rider marker
/// is on the map. After that the customer may have panned or zoomed, and
/// re-centering on every location update would fight them.
bool shouldFitCamera({required bool hasFitted, required bool riderPresent}) => riderPresent && !hasFitted;

/// The smallest box (degrees) the fit will use, about 220 m. A rider standing
/// on the destination would otherwise ask the camera to fit a zero-size box.
const double minFitSpanDegrees = 0.002;

/// South/west/north/east edges of a box, in degrees.
class GeoBounds {
  const GeoBounds({required this.south, required this.west, required this.north, required this.east});
  final double south, west, north, east;
}

bool _validCoordinate(GeoPoint p) =>
    p.latitude.isFinite &&
    p.longitude.isFinite &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180;

/// The box containing [a] and [b], grown to at least [minFitSpanDegrees] in
/// each axis (centred on the pair). Null for a non-finite / out-of-range point,
/// so a bad coordinate can never reach the camera.
GeoBounds? boundsFor(GeoPoint a, GeoPoint b) {
  if (!_validCoordinate(a) || !_validCoordinate(b)) return null;
  var south = a.latitude < b.latitude ? a.latitude : b.latitude;
  var north = a.latitude < b.latitude ? b.latitude : a.latitude;
  var west = a.longitude < b.longitude ? a.longitude : b.longitude;
  var east = a.longitude < b.longitude ? b.longitude : a.longitude;
  if (north - south < minFitSpanDegrees) {
    final mid = (north + south) / 2;
    south = mid - minFitSpanDegrees / 2;
    north = mid + minFitSpanDegrees / 2;
  }
  if (east - west < minFitSpanDegrees) {
    final mid = (east + west) / 2;
    west = mid - minFitSpanDegrees / 2;
    east = mid + minFitSpanDegrees / 2;
  }
  return GeoBounds(south: south, west: west, north: north, east: east);
}

/// A rider fix further than this from the last shown position is a jump,
/// not a move, and the marker cuts to it instead of gliding. A rider at
/// 40 km/h covers ~11 m a second; fixes arrive every few seconds, so a real
/// move between two fixes is tens of metres. 250 m is a lost fix, a GPS
/// glitch or a long gap - gliding across it would draw a path the rider
/// never took, which is exactly the fake movement the brief forbids.
const double kMarkerSnapMeters = 250;

const double _earthRadiusMeters = 6371000;

/// Great-circle distance in metres between two points (haversine).
double distanceMeters(GeoPoint a, GeoPoint b) {
  const toRad = 3.141592653589793 / 180;
  final dLat = (b.latitude - a.latitude) * toRad;
  final dLng = (b.longitude - a.longitude) * toRad;
  final la1 = a.latitude * toRad;
  final la2 = b.latitude * toRad;
  final h = _sq(_sin(dLat / 2)) + _cos(la1) * _cos(la2) * _sq(_sin(dLng / 2));
  return 2 * _earthRadiusMeters * _asin(_sqrt(h));
}

/// The point [t] of the way from [a] to [b]. Linear in lat/lng, which over
/// tens of metres is indistinguishable from the great circle.
GeoPoint lerpGeo(GeoPoint a, GeoPoint b, double t) => GeoPoint(
      a.latitude + (b.latitude - a.latitude) * t,
      a.longitude + (b.longitude - a.longitude) * t,
    );

/// Where each marker is currently *shown*, as distinct from where the
/// backend last *put* it. Both map adapters drive one of these from their
/// own ticker: [retarget] when the wanted set changes, [tick] every frame of
/// the glide, [shownSpecs] to render.
///
/// It only ever moves a marker along the straight line between two real
/// fixes. It never extrapolates, never predicts, and cuts on a jump larger
/// than [kMarkerSnapMeters]. Fit-to-bounds keeps using the real specs.
class MarkerMotion {
  final Map<String, GeoPoint> _shown = {};
  final Map<String, GeoPoint> _from = {};
  final Map<String, GeoPoint> _to = {};

  /// The ids currently gliding.
  Iterable<String> get moving => _to.keys;

  /// Takes the new wanted set. Returns true when at least one marker needs
  /// to glide (the caller then runs its ticker from 0); false when every
  /// change was a cut and nothing needs animating. [snapAll] cuts every
  /// change - reduced motion.
  bool retarget(Set<MapMarkerSpec> wanted, {bool snapAll = false}) {
    _from.clear();
    _to.clear();
    final ids = <String>{};
    for (final spec in wanted) {
      ids.add(spec.id);
      final prev = _shown[spec.id];
      if (prev == null || prev == spec.position) {
        _shown[spec.id] = spec.position;
        continue;
      }
      if (snapAll || distanceMeters(prev, spec.position) > kMarkerSnapMeters) {
        _shown[spec.id] = spec.position;
        continue;
      }
      _from[spec.id] = prev;
      _to[spec.id] = spec.position;
    }
    _shown.removeWhere((id, _) => !ids.contains(id));
    return _to.isNotEmpty;
  }

  /// Advances every gliding marker to [t] (0..1, already curved).
  void tick(double t) {
    for (final id in _to.keys) {
      _shown[id] = lerpGeo(_from[id]!, _to[id]!, t);
    }
    if (t >= 1) {
      _from.clear();
      _to.clear();
    }
  }

  /// [wanted], with every position replaced by where it is shown right now.
  Set<MapMarkerSpec> shownSpecs(Set<MapMarkerSpec> wanted) => {
        for (final spec in wanted)
          MapMarkerSpec(id: spec.id, position: _shown[spec.id] ?? spec.position, tone: spec.tone),
      };
}

double _sin(double x) => math.sin(x);
double _cos(double x) => math.cos(x);
double _asin(double x) => math.asin(x);
double _sqrt(double x) => math.sqrt(x);
double _sq(double x) => x * x;
