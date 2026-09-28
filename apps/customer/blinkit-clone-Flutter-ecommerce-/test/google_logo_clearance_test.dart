import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/live_location_picker_screen.dart';
import 'package:ecom/Services/Location/device_location_source.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/google_map_view.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider_config.dart';
import 'package:ecom/UI/Widgets/Organisms/order_tracking_map.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/fake_google_maps_platform.dart';
import 'fixtures/order_fixtures.dart';
import 'fixtures/tracking_fakes.dart';

/// Google's logo and copyright must stay visible and unobscured (plan 11.5, 12):
/// nothing Blynk draws may sit over the map's bottom strip, and no OpenStreetMap
/// credit belongs on a Google map. The strip is deliberately generous: the full
/// width and the bottom [_logoStrip] dp of the map (the logo is ~ 24 dp tall,
/// inset a few dp from the corner).
const double _logoStrip = 48;

OrderModel _order() => OrderModel.fromJson({
      ...orderJson(status: 'OUT_FOR_DELIVERY'),
      'delivery_latitude': '6.4382',
      'delivery_longitude': '80.0274',
    });

/// Widgets that paint visible content (text, glyphs, images, buttons, filled
/// boxes). The map itself, the hairline frame (a border only, ignores pointers
/// and paints nothing inside) and layout widgets are not in this set.
bool _paintsContent(Widget w) =>
    w is Text || w is Icon || w is Image || w is ButtonStyleButton || w is IconButton || w is Container;

void main() {
  tearDown(() => MapProviderConfig.debugOverride = null);

  group('OrderTrackingMap over a Google map', () {
    // Google is opt-in since MapLibre became the default (2026-09-28).
    setUp(() => MapProviderConfig.debugOverride = MapProviderKind.google);

    late SpyLocationProvider provider;

    Future<void> pumpTracking(WidgetTester tester, {bool withRider = true}) async {
      provider = SpyLocationProvider();
      provider.watch('order-1');
      if (withRider) provider.sendPoint();
      await tester.pumpWidget(
        ChangeNotifierProvider<LocationProvider>.value(
          value: provider,
          child: MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(child: OrderTrackingMap(order: _order(), mapBuilder: fakeMapBuilder)),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
    }

    testWidgets('draws no OpenStreetMap credit (Google selected)', (tester) async {
      await pumpTracking(tester);
      expect(MapProviderConfig.kind, MapProviderKind.google);
      expect(find.byKey(const Key('map-attribution')), findsNothing);
      expect(find.text(mapAttributionText), findsNothing);
      await tester.pumpWidget(const SizedBox());
      provider.dispose();
    });

    testWidgets('nothing drawn by OrderTrackingMap intersects the reserved logo strip', (tester) async {
      await pumpTracking(tester);
      final frame = tester.getRect(find.byKey(const Key('order-tracking-map-frame')));
      final strip = Rect.fromLTRB(frame.left, frame.bottom - _logoStrip, frame.right, frame.bottom);

      // Everything the widget paints, wherever it sits.
      final painted = find.descendant(of: find.byType(OrderTrackingMap), matching: find.byWidgetPredicate(_paintsContent));
      expect(painted, findsWidgets, reason: 'the caption row must be found, or this test proves nothing');
      for (final element in painted.evaluate()) {
        final rect = tester.getRect(find.byElementPredicate((e) => identical(e, element)));
        expect(rect.overlaps(strip), isFalse, reason: '${element.widget.runtimeType} at $rect overlaps the logo strip $strip');
      }

      // Inside the map frame only the map and the border may exist.
      final insideFrame =
          find.descendant(of: find.byKey(const Key('order-tracking-map-frame')), matching: find.byWidgetPredicate(_paintsContent));
      expect(insideFrame, findsNothing);

      // The caption row sits below the map, not over it.
      expect(tester.getRect(find.byKey(const Key('order-tracking-caption'))).top, greaterThanOrEqualTo(frame.bottom));
      await tester.pumpWidget(const SizedBox());
      provider.dispose();
    });

    testWidgets('the Google adapter reserves a constant bottom inset for the logo', (tester) async {
      final platform = FakeGoogleMapsPlatform.install();
      GoogleMarkerIcons.debugRenderer = null;
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: 220,
              child: GoogleTrackingMapView(initialCenter: GeoPoint(6.4382, 80.0274), initialZoom: 14, markers: {}),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(platform.lastMap.initialConfiguration.padding!.bottom, googleMapLogoClearance);
    });
  });

  group('OrderTrackingMap over MapLibre (rollback) keeps its OpenStreetMap credit', () {
    testWidgets('the chip is drawn bottom-left, exactly once', (tester) async {
      MapProviderConfig.debugOverride = MapProviderKind.maplibre;
      final provider = SpyLocationProvider()..watch('order-1');
      await tester.pumpWidget(
        ChangeNotifierProvider<LocationProvider>.value(
          value: provider,
          child: MaterialApp(
            home: Scaffold(body: OrderTrackingMap(order: _order(), mapBuilder: fakeMapBuilder)),
          ),
        ),
      );
      await tester.pump();
      expect(find.text(mapAttributionText), findsOneWidget);
      expect(find.byKey(const Key('map-attribution')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      provider.dispose();
    });
  });

  group('the location picker screen over a Google map', () {
    setUp(() => MapProviderConfig.debugOverride = MapProviderKind.google);

    testWidgets('only the fixed pin sits over the map; the info panel is below it; no OSM credit', (tester) async {
      tester.view.physicalSize = const Size(400, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final platform = FakeGoogleMapsPlatform.install();
      GoogleMarkerIcons.debugRenderer = null;

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.appTHeme,
          home: LiveLocationPickerScreen(locationSource: _Source()),
        ),
      );
      await tester.tap(find.text('Allow location'));
      await tester.pumpAndSettle();

      expect(platform.buildCount, 1);
      expect(find.byKey(const Key('picker-pin')), findsOneWidget);
      expect(find.text(mapAttributionText), findsNothing);
      expect(find.byKey(const Key('map-attribution')), findsNothing);

      final map = tester.getRect(find.byKey(const Key('fake-google-map')));
      final strip = Rect.fromLTRB(map.left, map.bottom - _logoStrip, map.right, map.bottom);
      // Everything painted over the map (inside the view's own Stack) must not reach the strip.
      final overMap = find.descendant(of: find.byType(GoogleLocationPickerView), matching: find.byWidgetPredicate(_paintsContent));
      for (final element in overMap.evaluate()) {
        final rect = tester.getRect(find.byElementPredicate((e) => identical(e, element)));
        expect(rect.overlaps(strip), isFalse, reason: '${element.widget.runtimeType} at $rect overlaps the logo strip');
      }
      // The panel with the coordinates and buttons starts below the map.
      expect(tester.getRect(find.byKey(const Key('picker-instruction'))).top, greaterThanOrEqualTo(map.bottom));
      expect(tester.getRect(find.byKey(const Key('picker-coordinates'))).top, greaterThanOrEqualTo(map.bottom));
    });
  });
}

class _Source extends DeviceLocationSource {
  @override
  Future<LocationPermissionStatus> checkPermission() async => LocationPermissionStatus.denied;
  @override
  Future<LocationPermissionStatus> requestPermission() async => LocationPermissionStatus.granted;
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<DeviceFix> currentPosition() async => const DeviceFix(GeoPoint(6.4382, 80.0274));
  @override
  Future<bool> openAppSettings() async => true;
  @override
  Future<bool> openLocationSettings() async => true;
}
