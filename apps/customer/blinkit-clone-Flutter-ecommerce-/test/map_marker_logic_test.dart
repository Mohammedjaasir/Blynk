import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Organisms/map_marker_logic.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';

MapMarkerSpec _dest([double lat = 6.4382, double lng = 80.0274]) =>
    MapMarkerSpec(id: 'destination', position: GeoPoint(lat, lng), tone: MapMarkerTone.destination);
MapMarkerSpec _rider(double lat, double lng, {MapMarkerTone tone = MapMarkerTone.riderLive}) =>
    MapMarkerSpec(id: 'rider', position: GeoPoint(lat, lng), tone: tone);

void main() {
  group('value equality', () {
    test('GeoPoint and MapMarkerSpec compare by value', () {
      expect(const GeoPoint(1, 2), const GeoPoint(1, 2));
      expect(const GeoPoint(1, 2).hashCode, const GeoPoint(1, 2).hashCode);
      expect(const GeoPoint(1, 2) == const GeoPoint(1, 3), isFalse);
      expect(_rider(1, 2), _rider(1, 2));
      expect({_rider(1, 2)}.contains(_rider(1, 2)), isTrue);
      expect(_rider(1, 2) == _rider(1, 2, tone: MapMarkerTone.riderStale), isFalse);
    });
  });

  group('diffMarkers', () {
    test('first apply adds everything', () {
      final d = diffMarkers({}, {_dest(), _rider(6.44, 80.03)});
      expect(d.added.map((m) => m.id).toSet(), {'destination', 'rider'});
      expect(d.updated, isEmpty);
      expect(d.removedIds, isEmpty);
      expect(d.isEmpty, isFalse);
    });

    test('identical marker set is a no-op (no platform calls, no flicker)', () {
      final applied = {'destination': _dest(), 'rider': _rider(6.44, 80.03)};
      final d = diffMarkers(applied, {_dest(), _rider(6.44, 80.03)});
      expect(d.isEmpty, isTrue);
    });

    test('a moved rider is an update of the same id, not remove+add', () {
      final applied = {'destination': _dest(), 'rider': _rider(6.44, 80.03)};
      final d = diffMarkers(applied, {_dest(), _rider(6.441, 80.031)});
      expect(d.added, isEmpty);
      expect(d.removedIds, isEmpty);
      expect(d.updated, hasLength(1));
      expect(d.updated.single.id, 'rider');
      expect(d.updated.single.position, const GeoPoint(6.441, 80.031));
    });

    test('a live to stale tone change is an update', () {
      final applied = {'rider': _rider(6.44, 80.03)};
      final d = diffMarkers(applied, {_rider(6.44, 80.03, tone: MapMarkerTone.riderStale)});
      expect(d.updated.single.tone, MapMarkerTone.riderStale);
      expect(d.added, isEmpty);
    });

    test('a marker absent from the new set is removed', () {
      final applied = {'destination': _dest(), 'rider': _rider(6.44, 80.03)};
      final d = diffMarkers(applied, {_dest()});
      expect(d.removedIds, ['rider']);
      expect(d.added, isEmpty);
      expect(d.updated, isEmpty);
    });

    test('rider appearing later is an add; destination is untouched', () {
      final d = diffMarkers({'destination': _dest()}, {_dest(), _rider(6.44, 80.03)});
      expect(d.added.single.id, 'rider');
      expect(d.updated, isEmpty);
      expect(d.removedIds, isEmpty);
    });
  });

  group('markerPaintFor', () {
    test('destination is violet, opaque', () {
      final p = markerPaintFor(MapMarkerTone.destination);
      expect(p.colorHex, '#8E24AA');
      expect(p.opacity, 1.0);
    });

    test('live rider is azure, opaque', () {
      final p = markerPaintFor(MapMarkerTone.riderLive);
      expect(p.colorHex, '#1E88E5');
      expect(p.opacity, 1.0);
    });

    test('stale rider keeps the azure colour at 0.5 opacity (stroke fades with it)', () {
      final live = markerPaintFor(MapMarkerTone.riderLive);
      final stale = markerPaintFor(MapMarkerTone.riderStale);
      expect(stale.colorHex, live.colorHex);
      expect(stale.opacity, 0.5);
      expect(stale.strokeOpacity, 0.5);
    });

    test('every tone has a positive radius and a white stroke', () {
      for (final t in MapMarkerTone.values) {
        final p = markerPaintFor(t);
        expect(p.radius, greaterThan(0));
        expect(p.strokeColorHex, '#FFFFFF');
        expect(p.strokeWidth, greaterThan(0));
      }
    });
  });

  group('shouldFitCamera (fit once, when the rider first appears)', () {
    test('fits when a rider is present and no fit has happened yet', () {
      expect(shouldFitCamera(hasFitted: false, riderPresent: true), isTrue);
    });
    test('does not fit without a rider', () {
      expect(shouldFitCamera(hasFitted: false, riderPresent: false), isFalse);
    });
    test('never re-fits once fitted, so a customer pan is not undone', () {
      expect(shouldFitCamera(hasFitted: true, riderPresent: true), isFalse);
      expect(shouldFitCamera(hasFitted: true, riderPresent: false), isFalse);
    });
  });

  group('boundsFor', () {
    test('spans both points with south-west / north-east ordering', () {
      final b = boundsFor(const GeoPoint(6.4382, 80.0274), const GeoPoint(6.45, 80.02))!;
      expect(b.south, 6.4382);
      expect(b.north, 6.45);
      expect(b.west, 80.02);
      expect(b.east, 80.0274);
    });

    test('order of the two points does not matter', () {
      final a = boundsFor(const GeoPoint(6.4, 80.0), const GeoPoint(6.5, 80.1))!;
      final b = boundsFor(const GeoPoint(6.5, 80.1), const GeoPoint(6.4, 80.0))!;
      expect(a.south, b.south);
      expect(a.north, b.north);
      expect(a.west, b.west);
      expect(a.east, b.east);
    });

    test('rider on top of the destination gets a minimum span instead of a zero-size box', () {
      final b = boundsFor(const GeoPoint(6.4382, 80.0274), const GeoPoint(6.4382, 80.0274))!;
      expect(b.north - b.south, greaterThanOrEqualTo(minFitSpanDegrees));
      expect(b.east - b.west, greaterThanOrEqualTo(minFitSpanDegrees));
      expect((b.north + b.south) / 2, closeTo(6.4382, 1e-9));
      expect((b.east + b.west) / 2, closeTo(80.0274, 1e-9));
    });

    test('non-finite or out-of-range input yields no bounds (never a bad camera call)', () {
      expect(boundsFor(const GeoPoint(double.nan, 80), const GeoPoint(6, 80)), isNull);
      expect(boundsFor(const GeoPoint(6, 80), const GeoPoint(91, 80)), isNull);
      expect(boundsFor(const GeoPoint(6, 80), const GeoPoint(6, double.infinity)), isNull);
    });
  });

  group('marker motion (M11)', () {
    test('distance: two fixes 55 m apart, and the jump the tests use is ~780 m', () {
      expect(distanceMeters(const GeoPoint(6.4500, 80.0400), const GeoPoint(6.4505, 80.0400)), closeTo(55, 2));
      expect(distanceMeters(const GeoPoint(6.4500, 80.0400), const GeoPoint(6.4550, 80.0450)), closeTo(780, 15));
      expect(distanceMeters(const GeoPoint(1, 2), const GeoPoint(1, 2)), 0);
    });

    test('lerp is linear between the two real points and never beyond them', () {
      const a = GeoPoint(6.4500, 80.0400);
      const b = GeoPoint(6.4510, 80.0420);
      expect(lerpGeo(a, b, 0), a);
      expect(lerpGeo(a, b, 1), b);
      final mid = lerpGeo(a, b, 0.5);
      expect(mid.latitude, closeTo(6.4505, 1e-9));
      expect(mid.longitude, closeTo(80.0410, 1e-9));
    });

    test('a small move glides: shown position is between the fixes mid-way, at the fix at the end', () {
      final m = MarkerMotion();
      m.retarget({_dest(), _rider(6.4500, 80.0400)});
      expect(m.retarget({_dest(), _rider(6.4505, 80.0400)}), isTrue, reason: 'needs a glide');
      m.tick(0.5);
      final shown = m.shownSpecs({_dest(), _rider(6.4505, 80.0400)}).singleWhere((s) => s.id == 'rider');
      expect(shown.position.latitude, closeTo(6.45025, 1e-9));
      m.tick(1);
      expect(m.shownSpecs({_dest(), _rider(6.4505, 80.0400)}).singleWhere((s) => s.id == 'rider').position,
          const GeoPoint(6.4505, 80.0400));
      expect(m.moving, isEmpty);
    });

    test('a jump beyond the snap distance cuts: no glide, no path the rider never took', () {
      final m = MarkerMotion();
      m.retarget({_rider(6.4500, 80.0400)});
      expect(m.retarget({_rider(6.4550, 80.0450)}), isFalse);
      expect(m.shownSpecs({_rider(6.4550, 80.0450)}).single.position, const GeoPoint(6.4550, 80.0450));
    });

    test('reduced motion (snapAll) cuts even a small move', () {
      final m = MarkerMotion();
      m.retarget({_rider(6.4500, 80.0400)});
      expect(m.retarget({_rider(6.4505, 80.0400)}, snapAll: true), isFalse);
      expect(m.shownSpecs({_rider(6.4505, 80.0400)}).single.position, const GeoPoint(6.4505, 80.0400));
    });

    test('the first sighting of a marker is a cut, and a removed marker is forgotten', () {
      final m = MarkerMotion();
      expect(m.retarget({_rider(6.45, 80.04)}), isFalse);
      expect(m.retarget({_dest()}), isFalse);
      expect(m.shownSpecs({_dest()}).single.id, 'destination');
      // Seen again after removal: a cut, not a glide from where it last was.
      expect(m.retarget({_dest(), _rider(6.4505, 80.0400)}), isFalse);
    });

    test('the destination never moves, so it never glides', () {
      final m = MarkerMotion();
      m.retarget({_dest(), _rider(6.4500, 80.0400)});
      expect(m.retarget({_dest(), _rider(6.4505, 80.0400)}), isTrue);
      expect(m.moving, ['rider']);
    });
  });
}
