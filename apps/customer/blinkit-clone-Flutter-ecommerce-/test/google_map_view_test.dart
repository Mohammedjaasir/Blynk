import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart' as gm;

import 'package:ecom/UI/Widgets/Organisms/google_map_view.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/fake_google_maps_platform.dart';

const _destination = GeoPoint(6.4382, 80.0274);
const _riderA = GeoPoint(6.4500, 80.0400);
const _riderB = GeoPoint(6.4550, 80.0450);

MapMarkerSpec _dest() =>
    const MapMarkerSpec(id: 'destination', position: _destination, tone: MapMarkerTone.destination);
MapMarkerSpec _rider(GeoPoint at, {MapMarkerTone tone = MapMarkerTone.riderLive}) =>
    MapMarkerSpec(id: 'rider', position: at, tone: tone);

/// A tiny per-tone byte string, so a test can tell which tone an icon came from
/// without drawing anything.
Uint8List _toneBytes(MapMarkerTone tone) => Uint8List.fromList([tone.index, 7, 7]);

Uint8List _bytesOf(gm.BitmapDescriptor icon) => (icon as gm.BytesMapBitmap).byteData;

Widget _host(Widget child, {double textScale = 1.0, bool disableAnimations = false, double height = 220}) {
  return MaterialApp(
    builder: (context, page) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
        disableAnimations: disableAnimations,
      ),
      child: page!,
    ),
    home: Scaffold(body: SizedBox(width: 360, height: height, child: child)),
  );
}

GoogleTrackingMapView _tracking(Set<MapMarkerSpec> markers, {String? semanticsLabel}) => GoogleTrackingMapView(
      initialCenter: _destination,
      initialZoom: 14,
      markers: markers,
      semanticsLabel: semanticsLabel,
    );

void main() {
  late FakeGoogleMapsPlatform platform;

  setUp(() {
    platform = FakeGoogleMapsPlatform.install();
    GoogleMarkerIcons.clearCache();
    GoogleMarkerIcons.debugRenderer = (tone, ratio) async => gm.BitmapDescriptor.bytes(_toneBytes(tone));
    addTearDown(() {
      GoogleMarkerIcons.debugRenderer = null;
      GoogleMarkerIcons.clearCache();
    });
  });

  /// Lets the icon futures resolve and the post-frame camera fit run.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 4; i++) {
      await tester.pump();
    }
  }

  group('tracking view', () {
    testWidgets('builds exactly one Google map with the initial camera', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest()})));
      await settle(tester);

      expect(platform.buildCount, 1);
      expect(platform.lastMap.initialCameraPosition.target, const gm.LatLng(6.4382, 80.0274));
      expect(platform.lastMap.initialCameraPosition.zoom, 14);
    });

    testWidgets('is read-only: every interaction switch is off, pointers are ignored, no gesture recognizers',
        (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);

      final c = platform.lastMap.initialConfiguration;
      expect(c.scrollGesturesEnabled, isFalse);
      expect(c.zoomGesturesEnabled, isFalse);
      expect(c.rotateGesturesEnabled, isFalse);
      expect(c.tiltGesturesEnabled, isFalse);
      expect(c.zoomControlsEnabled, isFalse);
      expect(c.mapToolbarEnabled, isFalse);
      expect(c.compassEnabled, isFalse);
      expect(c.myLocationEnabled, isFalse);
      expect(c.myLocationButtonEnabled, isFalse);
      expect(c.indoorViewEnabled, isFalse);
      expect(c.trafficEnabled, isFalse);
      expect(c.buildingsEnabled, isFalse);
      expect(c.liteModeEnabled, isNot(isTrue), reason: 'lite mode is not used');
      expect(platform.lastMap.widgetConfiguration.gestureRecognizers, isEmpty,
          reason: 'no EagerGestureRecognizer: the surrounding list must keep scrolling');

      final ignore = find.descendant(of: find.byType(GoogleTrackingMapView), matching: find.byType(IgnorePointer));
      expect(ignore, findsWidgets);
      expect(tester.widgetList<IgnorePointer>(ignore).any((w) => w.ignoring), isTrue);
      expect(
        find.descendant(of: ignore.first, matching: find.byKey(const Key('fake-google-map'))),
        findsOneWidget,
        reason: 'the map itself sits inside the IgnorePointer',
      );
    });

    testWidgets('keeps a small constant bottom inset for the Google logo', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest()})));
      await settle(tester);
      final padding = platform.lastMap.initialConfiguration.padding;
      expect(padding, isNotNull);
      expect(padding!.bottom, googleMapLogoClearance);
      expect(googleMapLogoClearance, lessThanOrEqualTo(16));
    });

    testWidgets('uses no Map ID, no cloud map id, no style JSON and no advanced markers', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderB)})));
      await settle(tester);

      for (final config in platform.lastMap.allConfigurations) {
        expect(config.mapId, anyOf(isNull, isEmpty), reason: "no Map ID");
        expect(config.style, anyOf(isNull, isEmpty), reason: "no style JSON");
        expect(config.markerType, isNot(gm.MarkerType.advancedMarker));
      }
      for (final marker in platform.lastMap.currentMarkers.values) {
        expect(marker, isNot(isA<gm.AdvancedMarker>()));
      }
    });

    testWidgets('markers map 1:1 from the specs: id, position, tone icon, anchor, stacking', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);

      final markers = platform.lastMap.currentMarkers;
      expect(markers.keys.map((k) => k.value), unorderedEquals(['destination', 'rider']));

      final destination = markers[const gm.MarkerId('destination')]!;
      final rider = markers[const gm.MarkerId('rider')]!;
      expect(destination.position, const gm.LatLng(6.4382, 80.0274));
      expect(rider.position, const gm.LatLng(6.4500, 80.0400));
      expect(_bytesOf(destination.icon), _toneBytes(MapMarkerTone.destination));
      expect(_bytesOf(rider.icon), _toneBytes(MapMarkerTone.riderLive));
      expect(destination.anchor, const Offset(0.5, 22 / 24), reason: 'the pin tip sits on the coordinate');
      expect(rider.anchor, const Offset(0.5, 0.5), reason: 'the rider disc is centred on the coordinate');
      expect(rider.zIndexInt, greaterThan(destination.zIndexInt), reason: 'the rider draws above the destination');
    });

    testWidgets('a stale rider gets its own icon', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA, tone: MapMarkerTone.riderStale)})));
      await settle(tester);
      final rider = platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!;
      expect(_bytesOf(rider.icon), _toneBytes(MapMarkerTone.riderStale));
      expect(_bytesOf(rider.icon), isNot(_toneBytes(MapMarkerTone.riderLive)));
    });

    testWidgets('moving the rider updates the SAME marker id: no add, no remove', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      platform.lastMap.markerUpdates.clear();

      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderB)})));
      await settle(tester);

      expect(platform.lastMap.changed, [const gm.MarkerId('rider')]);
      expect(platform.lastMap.added, isEmpty);
      expect(platform.lastMap.removed, isEmpty);
      expect(platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!.position, const gm.LatLng(6.4550, 80.0450));
    });

    testWidgets('a small move glides between two real fixes over one slow beat', (tester) async {
      const riderNear = GeoPoint(6.4505, 80.0400); // ~55 m north of _riderA
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      platform.lastMap.markerUpdates.clear(); // the initial adds are not the move

      await tester.pumpWidget(_host(_tracking({_dest(), _rider(riderNear)})));
      await tester.pump();
      await tester.pump(BlynkMotion.slow ~/ 2);
      final mid = platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!.position;
      expect(mid.latitude, greaterThan(_riderA.latitude), reason: 'on its way north');
      expect(mid.latitude, lessThan(riderNear.latitude), reason: 'not there yet');
      expect(mid.longitude, closeTo(_riderA.longitude, 1e-9), reason: 'straight line between the fixes');

      await tester.pump(BlynkMotion.slow);
      await tester.pump();
      expect(platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!.position,
          gm.LatLng(riderNear.latitude, riderNear.longitude));
      expect(platform.lastMap.changed, everyElement(const gm.MarkerId('rider')), reason: 'only the rider ever updates');
      expect(platform.lastMap.added, isEmpty);
      expect(platform.lastMap.removed, isEmpty);
    });

    testWidgets('a large jump cuts to the new fix at once: no invented path', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderB)}))); // ~780 m
      await settle(tester);
      expect(platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!.position,
          gm.LatLng(_riderB.latitude, _riderB.longitude));
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('reduced motion: even a small move cuts', (tester) async {
      const riderNear = GeoPoint(6.4505, 80.0400);
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)}), disableAnimations: true));
      await settle(tester);
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(riderNear)}), disableAnimations: true));
      await settle(tester);
      expect(platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!.position,
          gm.LatLng(riderNear.latitude, riderNear.longitude));
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('going stale re-icons the same marker id in place', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      platform.lastMap.markerUpdates.clear();

      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA, tone: MapMarkerTone.riderStale)})));
      await settle(tester);

      expect(platform.lastMap.changed, [const gm.MarkerId('rider')]);
      expect(platform.lastMap.added, isEmpty);
      expect(platform.lastMap.removed, isEmpty);
      expect(_bytesOf(platform.lastMap.currentMarkers[const gm.MarkerId('rider')]!.icon),
          _toneBytes(MapMarkerTone.riderStale));
    });

    testWidgets('removing a spec removes only that marker', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      platform.lastMap.markerUpdates.clear();

      await tester.pumpWidget(_host(_tracking({_dest()})));
      await settle(tester);

      expect(platform.lastMap.removed, [const gm.MarkerId('rider')]);
      expect(platform.lastMap.currentMarkers.keys.map((k) => k.value), ['destination']);
    });

    testWidgets('a marker with a non-finite coordinate never reaches the map', (tester) async {
      await tester.pumpWidget(_host(_tracking({
        _dest(),
        _rider(const GeoPoint(double.nan, 80.04)),
      })));
      await settle(tester);
      expect(platform.lastMap.currentMarkers.keys.map((k) => k.value), ['destination']);
    });

    testWidgets('one marker: no camera fit is requested', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest()})));
      await settle(tester);
      expect(platform.cameraCalls, isEmpty);
    });

    testWidgets('two markers: both are fitted exactly once, and never again on later updates', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);

      expect(platform.cameraCalls, hasLength(1));
      final call = platform.cameraCalls.single;
      expect(call.kind, 'animate');
      expect(call.isFitBounds, isTrue);
      final fit = call.update as gm.CameraUpdateNewLatLngBounds;
      expect(fit.bounds.southwest, const gm.LatLng(6.4382, 80.0274));
      expect(fit.bounds.northeast, const gm.LatLng(6.4500, 80.0400));
      expect(fit.padding, 48);

      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderB)})));
      await settle(tester);
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      expect(platform.cameraCalls, hasLength(1), reason: 'the customer may have moved on: never re-centre');
    });

    testWidgets('the rider appearing after the destination triggers the one fit', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest()})));
      await settle(tester);
      expect(platform.cameraCalls, isEmpty);

      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      expect(platform.cameraCalls.where((c) => c.isFitBounds), hasLength(1));
    });

    testWidgets('reduced motion: the fit moves the camera instead of animating it', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)}), disableAnimations: true));
      await settle(tester);
      expect(platform.cameraCalls.single.kind, 'move');
    });

    testWidgets('a fit that throws (map not laid out yet) is retried, not fatal', (tester) async {
      platform.failCameraCalls = 1;
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(platform.cameraCalls, isEmpty);

      await tester.pump(const Duration(milliseconds: 300));
      await settle(tester);
      expect(platform.cameraCalls.where((c) => c.isFitBounds), hasLength(1));
    });

    testWidgets('a fit that keeps failing gives up after a few tries and never throws', (tester) async {
      platform.failCameraCalls = 100;
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
      expect(tester.takeException(), isNull);
      expect(platform.failCameraCalls, 100 - 3, reason: 'one attempt plus two retries');
      expect(platform.cameraCalls, isEmpty);
    });

    testWidgets('disposing while a fit retry is pending leaves no timer and no error', (tester) async {
      platform.failCameraCalls = 100;
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
    });

    testWidgets('an icon that cannot be drawn falls back to the stock marker rather than no marker',
        (tester) async {
      GoogleMarkerIcons.debugRenderer = (tone, ratio) async => throw StateError('no canvas');
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);

      final markers = platform.lastMap.currentMarkers;
      expect(markers, hasLength(2));
      for (final marker in markers.values) {
        expect(marker.icon, isNot(isA<gm.BytesMapBitmap>()));
      }
    });

    testWidgets('exposes one labelled map to assistive tech and hides the platform view internals', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);

      expect(find.bySemanticsLabel('Map showing the rider and your delivery address'), findsOneWidget);
      handle.dispose();
    });

    // Task-F1 review-fix round 1 (Important finding): ClinicLocationMap's
    // `label` is defeated unless GoogleTrackingMapView's own hardcoded
    // Semantics node can be overridden. These two tests exercise the REAL
    // adapter directly (not clinic_location_map_test.dart's fake, which has
    // no Semantics node of its own and could not have caught this).
    testWidgets('semanticsLabel, when given, replaces the default rider/delivery phrase entirely', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(_tracking({_dest()}, semanticsLabel: 'Smile Dental Clinic')));
      await settle(tester);

      expect(find.bySemanticsLabel('Smile Dental Clinic'), findsOneWidget);
      expect(find.bySemanticsLabel('Map showing the rider and your delivery address'), findsNothing);
      handle.dispose();
    });

    testWidgets('no semanticsLabel given: falls back to the exact original rider/delivery phrase, unchanged',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);

      expect(find.bySemanticsLabel('Map showing the rider and your delivery address'), findsOneWidget,
          reason: 'every existing OrderTrackingMap call site must announce exactly what it did before this fix');
      handle.dispose();
    });

    testWidgets('does not overflow at text scale 2.0', (tester) async {
      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)}), textScale: 2.0));
      await settle(tester);
      expect(tester.takeException(), isNull);
    });
  });

  group('location picker', () {
    late List<GeoPoint> reported;

    Widget picker({double textScale = 1.0}) => _host(
          GoogleLocationPickerView(initialPosition: _destination, onPositionChanged: reported.add),
          textScale: textScale,
          height: 500,
        );

    setUp(() => reported = []);

    testWidgets('is an interactive map: scroll and zoom on, rotate/tilt/location/toolbar off, eager gestures',
        (tester) async {
      await tester.pumpWidget(picker());
      await settle(tester);

      final c = platform.lastMap.initialConfiguration;
      expect(c.scrollGesturesEnabled, isTrue);
      expect(c.zoomGesturesEnabled, isTrue);
      expect(c.rotateGesturesEnabled, isFalse);
      expect(c.tiltGesturesEnabled, isFalse);
      expect(c.myLocationEnabled, isFalse);
      expect(c.myLocationButtonEnabled, isFalse);
      expect(c.mapToolbarEnabled, isFalse);
      expect(c.trackCameraPosition, isTrue, reason: 'the camera centre is only reported when it is tracked');
      expect(c.padding == null || c.padding == EdgeInsets.zero, isTrue, reason: 'padding would shift the centre');
      expect(c.mapId, anyOf(isNull, isEmpty), reason: "no Map ID");
      expect(c.style, anyOf(isNull, isEmpty), reason: "no style JSON");
      expect(platform.lastMap.initialCameraPosition.target, const gm.LatLng(6.4382, 80.0274));

      final recognizers = platform.lastMap.widgetConfiguration.gestureRecognizers;
      expect(recognizers, hasLength(1));
      expect(recognizers.single.constructor(), isA<EagerGestureRecognizer>());
    });

    testWidgets('shows the fixed centre pin, labelled, and never a marker', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(picker());
      await settle(tester);

      expect(find.byKey(const Key('picker-pin')), findsOneWidget);
      expect(find.bySemanticsLabel('Delivery location pin'), findsOneWidget);
      final icon = tester.widget<Icon>(find.descendant(of: find.byKey(const Key('picker-pin')), matching: find.byType(Icon)));
      expect(icon.color, BlynkColors.ink);
      expect(platform.lastMap.currentMarkers, isEmpty);
      handle.dispose();
    });

    testWidgets('reports the camera target while moving and once more, with the last target, when idle',
        (tester) async {
      await tester.pumpWidget(picker());
      await settle(tester);
      final id = platform.createdIds.last;

      platform.emit(gm.CameraMoveEvent(id, const gm.CameraPosition(target: gm.LatLng(6.44, 80.03), zoom: 16)));
      await tester.pump();
      platform.emit(gm.CameraMoveEvent(id, const gm.CameraPosition(target: gm.LatLng(6.45, 80.04), zoom: 16)));
      await tester.pump();
      expect(reported, [const GeoPoint(6.44, 80.03), const GeoPoint(6.45, 80.04)]);

      platform.emit(gm.CameraIdleEvent(id));
      await tester.pump();
      expect(reported, [const GeoPoint(6.44, 80.03), const GeoPoint(6.45, 80.04), const GeoPoint(6.45, 80.04)]);
    });

    testWidgets('idle with no earlier move reports nothing (no position was chosen)', (tester) async {
      await tester.pumpWidget(picker());
      await settle(tester);
      platform.emit(gm.CameraIdleEvent(platform.createdIds.last));
      await tester.pump();
      expect(reported, isEmpty);
    });

    testWidgets('does not overflow at text scale 2.0', (tester) async {
      await tester.pumpWidget(picker(textScale: 2.0));
      await settle(tester);
      expect(tester.takeException(), isNull);
    });
  });

  group('platform without Google Maps support (Windows / Linux / macOS)', () {
    testWidgets('the tracking view shows the honest unavailable card and builds no Google map', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      try {
        await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
        await settle(tester);

        expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
        expect(find.text('Map unavailable'), findsOneWidget);
        expect(platform.buildCount, 0);
        expect(platform.cameraCalls, isEmpty);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });

    testWidgets('the picker shows the card with no pin, reports nothing and sends the notification once',
        (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      try {
        final reported = <GeoPoint>[];
        var notifications = 0;
        await tester.pumpWidget(_host(
          NotificationListener<PickerMapUnavailableNotification>(
            onNotification: (_) {
              notifications++;
              return true;
            },
            child: GoogleLocationPickerView(initialPosition: _destination, onPositionChanged: reported.add),
          ),
          height: 500,
        ));
        await settle(tester);

        expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
        expect(find.byKey(const Key('picker-pin')), findsNothing, reason: 'a pin over no map would look like a choice');
        expect(platform.buildCount, 0);
        expect(notifications, 1);
        expect(reported, isEmpty);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });

    testWidgets('web is unsupported (no Maps JS script is configured): unavailable card, no Google map',
        (tester) async {
      // On web defaultTargetPlatform is usually android, so the web flag must win.
      debugTreatAsWeb = true;
      addTearDown(() => debugTreatAsWeb = null);
      expect(defaultTargetPlatform, TargetPlatform.android);

      await tester.pumpWidget(_host(_tracking({_dest(), _rider(_riderA)})));
      await settle(tester);
      expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
      expect(find.text('Map unavailable'), findsOneWidget);
      expect(platform.buildCount, 0);
      expect(platform.cameraCalls, isEmpty);
    });

    testWidgets('web picker: card, no pin, nothing reported, notification sent once', (tester) async {
      debugTreatAsWeb = true;
      addTearDown(() => debugTreatAsWeb = null);
      final reported = <GeoPoint>[];
      var notifications = 0;
      await tester.pumpWidget(_host(
        NotificationListener<PickerMapUnavailableNotification>(
          onNotification: (_) {
            notifications++;
            return true;
          },
          child: GoogleLocationPickerView(initialPosition: _destination, onPositionChanged: reported.add),
        ),
        height: 500,
      ));
      await settle(tester);

      expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
      expect(find.byKey(const Key('picker-pin')), findsNothing);
      expect(platform.buildCount, 0);
      expect(notifications, 1);
      expect(reported, isEmpty);
    });

    testWidgets('iOS counts as supported', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      try {
        await tester.pumpWidget(_host(_tracking({_dest()})));
        await settle(tester);
        expect(platform.buildCount, 1);
        expect(find.byKey(const Key('map-unavailable')), findsNothing);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });

    testWidgets('the unavailable card does not overflow at text scale 2.0', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      try {
        await tester.pumpWidget(_host(_tracking({_dest()}), textScale: 2.0));
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(find.text('Map unavailable'), findsOneWidget);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });
  });

  group('marker icons', () {
    testWidgets('the real renderer draws a PNG for every tone at the requested pixel ratio', (tester) async {
      GoogleMarkerIcons.debugRenderer = null;
      final bytes = <MapMarkerTone, Uint8List>{};
      for (final tone in MapMarkerTone.values) {
        final icon = await tester.runAsync(() => GoogleMarkerIcons.renderMarkerIcon(tone, 2.0));
        expect(icon, isA<gm.BytesMapBitmap>(), reason: '$tone');
        final data = _bytesOf(icon!);
        expect(data.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47], reason: '$tone is not a PNG');
        expect((icon as gm.BytesMapBitmap).imagePixelRatio, 2.0);
        bytes[tone] = data;
      }
      expect(bytes[MapMarkerTone.riderLive], isNot(bytes[MapMarkerTone.riderStale]));
      expect(bytes[MapMarkerTone.destination], isNot(bytes[MapMarkerTone.riderLive]));
    });

    testWidgets('an icon is drawn once per tone and pixel ratio, then reused', (tester) async {
      var draws = 0;
      GoogleMarkerIcons.debugRenderer = (tone, ratio) async {
        draws++;
        return gm.BitmapDescriptor.bytes(_toneBytes(tone));
      };
      await GoogleMarkerIcons.iconFor(MapMarkerTone.riderLive, 2.0);
      await GoogleMarkerIcons.iconFor(MapMarkerTone.riderLive, 2.0);
      await GoogleMarkerIcons.iconFor(MapMarkerTone.riderLive, 3.0);
      await GoogleMarkerIcons.iconFor(MapMarkerTone.destination, 2.0);
      expect(draws, 3);
    });

    testWidgets('a failed draw is not cached: the next request tries again', (tester) async {
      var attempts = 0;
      GoogleMarkerIcons.debugRenderer = (tone, ratio) async {
        attempts++;
        if (attempts == 1) throw StateError('first draw fails');
        return gm.BitmapDescriptor.bytes(_toneBytes(tone));
      };
      await expectLater(GoogleMarkerIcons.iconFor(MapMarkerTone.riderLive, 2.0), throwsStateError);
      await GoogleMarkerIcons.iconFor(MapMarkerTone.riderLive, 2.0);
      expect(attempts, 2);
    });
  });
}
