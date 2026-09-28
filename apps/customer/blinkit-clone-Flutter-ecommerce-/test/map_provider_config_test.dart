import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Organisms/google_map_view.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider_config.dart';
import 'package:ecom/UI/Widgets/Organisms/maplibre_map_view.dart';

import 'fixtures/fake_google_maps_platform.dart';

const _here = GeoPoint(6.4382, 80.0274);

void main() {
  tearDown(() => MapProviderConfig.debugOverride = null);

  group('MapProviderConfig', () {
    test('the default is MapLibre (no MAP_PROVIDER define in tests)', () {
      expect(MapProviderConfig.kind, MapProviderKind.maplibre);
    });

    test('only "google" selects Google; anything else, including junk, is MapLibre', () {
      expect(MapProviderConfig.parse('google'), MapProviderKind.google);
      expect(MapProviderConfig.parse(' Google '), MapProviderKind.google);
      expect(MapProviderConfig.parse('maplibre'), MapProviderKind.maplibre);
      expect(MapProviderConfig.parse(''), MapProviderKind.maplibre);
      expect(MapProviderConfig.parse('mapbox'), MapProviderKind.maplibre);
    });

    test('the debug override wins, and clearing it restores the default', () {
      MapProviderConfig.debugOverride = MapProviderKind.google;
      expect(MapProviderConfig.kind, MapProviderKind.google);
      MapProviderConfig.debugOverride = null;
      expect(MapProviderConfig.kind, MapProviderKind.maplibre);
    });
  });

  group('the neutral factories build exactly one adapter', () {
    test('google (opt-in): TrackingMapView and LocationPickerMapView are the Google adapters', () {
      MapProviderConfig.debugOverride = MapProviderKind.google;
      final tracking = TrackingMapView(initialCenter: _here, initialZoom: 14, markers: const {});
      final picker = LocationPickerMapView(initialPosition: _here, onPositionChanged: (_) {});
      expect(tracking, isA<GoogleTrackingMapView>());
      expect(tracking, isNot(isA<MapLibreTrackingMapView>()));
      expect(picker, isA<GoogleLocationPickerView>());
      expect(picker, isNot(isA<MapLibreLocationPickerView>()));
    });

    test('maplibre (the default): the MapLibre adapters, not the Google ones', () {
      final tracking = TrackingMapView(initialCenter: _here, initialZoom: 14, markers: const {});
      final picker = LocationPickerMapView(initialPosition: _here, onPositionChanged: (_) {});
      expect(tracking, isA<MapLibreTrackingMapView>());
      expect(tracking, isNot(isA<GoogleTrackingMapView>()));
      expect(picker, isA<MapLibreLocationPickerView>());
      expect(picker, isNot(isA<GoogleLocationPickerView>()));
    });

    test('the factories pass key and arguments through', () {
      const key = Key('k');
      final markers = {const MapMarkerSpec(id: 'a', position: _here, tone: MapMarkerTone.destination)};
      final tracking = TrackingMapView(key: key, initialCenter: _here, initialZoom: 9, markers: markers);
      expect(tracking.key, key);
      expect(tracking.initialCenter, _here);
      expect(tracking.initialZoom, 9);
      expect(tracking.markers, markers);
    });

    testWidgets('in a real tree Google (opt-in) builds one Google map view and no MapLibre widget', (tester) async {
      MapProviderConfig.debugOverride = MapProviderKind.google;
      final platform = FakeGoogleMapsPlatform.install();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              SizedBox(height: 200, child: TrackingMapView(initialCenter: _here, initialZoom: 14, markers: const {})),
              SizedBox(
                height: 200,
                child: LocationPickerMapView(initialPosition: _here, onPositionChanged: (_) {}),
              ),
            ],
          ),
        ),
      ));
      await tester.pump();

      expect(find.byType(GoogleTrackingMapView), findsOneWidget);
      expect(find.byType(GoogleLocationPickerView), findsOneWidget);
      expect(find.byType(MapLibreTrackingMapView), findsNothing);
      expect(find.byType(MapLibreLocationPickerView), findsNothing);
      expect(platform.buildCount, 2, reason: 'one native Google map per view, nothing else');
    });

    testWidgets('in a real tree the default builds only MapLibre widgets and no Google map', (tester) async {
      final platform = FakeGoogleMapsPlatform.install();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 200,
            child: TrackingMapView(initialCenter: _here, initialZoom: 14, markers: const {}),
          ),
        ),
      ));

      expect(find.byType(MapLibreTrackingMapView), findsOneWidget);
      expect(find.byType(GoogleTrackingMapView), findsNothing);
      expect(platform.buildCount, 0);
      // The MapLibre body loads its style with real I/O; leave it unmounted
      // before the test ends so nothing outlives it.
      await tester.pumpWidget(const SizedBox());
    });
  });
}
