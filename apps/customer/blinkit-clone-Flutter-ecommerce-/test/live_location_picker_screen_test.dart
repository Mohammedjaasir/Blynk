import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Screens/live_location_picker_screen.dart';
import 'package:ecom/Services/Location/device_location_source.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider_config.dart';
import 'package:ecom/UI/Widgets/Organisms/map_tile_config.dart';
import 'package:ecom/UI/Widgets/Organisms/order_tracking_map.dart' show mapAttributionText;
import 'package:ecom/app_theme.dart';

/// Scripted stand-in for the device: no native call is ever made, and every
/// call is recorded so tests can prove what was (not) asked, and in what order.
class _FakeLocationSource implements DeviceLocationSource {
  bool serviceEnabled = true;
  LocationPermissionStatus checkResult = LocationPermissionStatus.denied;
  LocationPermissionStatus requestResult = LocationPermissionStatus.granted;
  DeviceFix fix = const DeviceFix(GeoPoint(6.4382, 80.0274), accuracyMeters: 8);

  /// When set, currentPosition() throws it (once per assignment).
  Object? positionError;

  /// When set, currentPosition() waits on it - holds the "locating" state.
  Completer<DeviceFix>? positionGate;

  final List<String> calls = [];

  @override
  Future<bool> isLocationServiceEnabled() async {
    calls.add('service');
    return serviceEnabled;
  }

  @override
  Future<LocationPermissionStatus> checkPermission() async {
    calls.add('check');
    return checkResult;
  }

  @override
  Future<LocationPermissionStatus> requestPermission() async {
    calls.add('request');
    return requestResult;
  }

  @override
  Future<DeviceFix> currentPosition() async {
    calls.add('position');
    final gate = positionGate;
    if (gate != null) return gate.future;
    final error = positionError;
    if (error != null) {
      positionError = null;
      throw error;
    }
    return fix;
  }

  @override
  Future<bool> openAppSettings() async {
    calls.add('openAppSettings');
    return true;
  }

  @override
  Future<bool> openLocationSettings() async {
    calls.add('openLocationSettings');
    return true;
  }
}

/// A map stand-in: no platform view. Exposes what the screen handed it.
class _FakeMap extends LocationPickerMapView {
  const _FakeMap({required this.initialPosition, required this.onPositionChanged})
      : super.constructor(key: const Key('fake-picker-map'));

  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  Widget build(BuildContext context) => const SizedBox.expand(child: ColoredBox(color: Colors.blueGrey));
}

void main() {
  late _FakeLocationSource source;
  _FakeMap? lastMap;
  Future<GeoPoint?>? result;
  var popped = false;

  setUp(() {
    source = _FakeLocationSource();
    lastMap = null;
    result = null;
    popped = false;
  });

  LocationPickerMapView fakeMapBuilder({
    required GeoPoint initialPosition,
    required ValueChanged<GeoPoint> onPositionChanged,
  }) {
    final map = _FakeMap(initialPosition: initialPosition, onPositionChanged: onPositionChanged);
    lastMap = map;
    return map;
  }

  /// Opens the picker as a pushed route from a launcher page, the way the
  /// address screen does, so Navigator.pop results can be observed.
  Future<void> openPicker(WidgetTester tester, {bool fakeMap = true}) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.appTHeme,
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () {
                result = Navigator.of(context).push<GeoPoint>(
                  MaterialPageRoute(
                    builder: (_) => LiveLocationPickerScreen(
                      locationSource: source,
                      mapBuilder: fakeMap ? fakeMapBuilder : null,
                    ),
                  ),
                );
                result!.then((_) => popped = true);
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> tapAllow(WidgetTester tester) async {
    await tester.tap(find.text('Allow location'));
    await tester.pumpAndSettle();
  }

  group('explain before prompt (plan 3 / 12)', () {
    testWidgets('shows the explanation first and makes no device call before the button', (tester) async {
      await openPicker(tester);

      expect(find.byKey(const Key('picker-explain')), findsOneWidget);
      expect(find.textContaining('only to pin your delivery address'), findsOneWidget);
      expect(find.textContaining('never used to track you'), findsOneWidget);
      expect(find.text('Allow location'), findsOneWidget);
      expect(find.text('Enter manually'), findsOneWidget);
      expect(source.calls, isEmpty, reason: 'no permission or location call before the explicit button');
      expect(lastMap, isNull);
    });

    testWidgets('only the button asks: service, check, request, then the position', (tester) async {
      await openPicker(tester);
      await tapAllow(tester);

      expect(source.calls, ['service', 'check', 'request', 'position']);
    });

    testWidgets('an already-granted permission is not asked again', (tester) async {
      source.checkResult = LocationPermissionStatus.granted;
      await openPicker(tester);
      await tapAllow(tester);

      expect(source.calls, ['service', 'check', 'position']);
      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
    });

    testWidgets('Enter manually on the explanation pops null without any device call', (tester) async {
      await openPicker(tester);

      await tester.tap(find.text('Enter manually'));
      await tester.pumpAndSettle();

      expect(await result, isNull);
      expect(source.calls, isEmpty);
    });
  });

  group('granted', () {
    testWidgets('shows a locating state, then centres the map on the device position with a coordinate label',
        (tester) async {
      source.positionGate = Completer<DeviceFix>();
      await openPicker(tester);
      await tester.tap(find.text('Allow location'));
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('picker-locating')), findsOneWidget);
      expect(find.byKey(const Key('fake-picker-map')), findsNothing);

      source.positionGate!.complete(const DeviceFix(GeoPoint(6.4382, 80.0274)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
      expect(lastMap!.initialPosition, const GeoPoint(6.4382, 80.0274));
      expect(find.text('6.438200, 80.027400'), findsOneWidget);
      expect(find.text('Confirm location'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
    });

    testWidgets('moving the pin (map reports a new position) updates the label live', (tester) async {
      await openPicker(tester);
      await tapAllow(tester);

      lastMap!.onPositionChanged(const GeoPoint(6.44, 80.03));
      await tester.pump();

      expect(find.text('6.440000, 80.030000'), findsOneWidget);
      expect(find.text('6.438200, 80.027400'), findsNothing);
      expect(lastMap!.initialPosition, const GeoPoint(6.4382, 80.0274), reason: 'the map is only ever seeded with the first fix');
    });

    testWidgets('Confirm pops the moved coordinate', (tester) async {
      await openPicker(tester);
      await tapAllow(tester);
      lastMap!.onPositionChanged(const GeoPoint(6.45, 80.05));
      await tester.pump();

      await tester.tap(find.text('Confirm location'));
      await tester.pumpAndSettle();

      expect(await result, const GeoPoint(6.45, 80.05));
    });

    testWidgets('Confirm without moving the pin pops the device position', (tester) async {
      await openPicker(tester);
      await tapAllow(tester);

      await tester.tap(find.text('Confirm location'));
      await tester.pumpAndSettle();

      expect(await result, const GeoPoint(6.4382, 80.0274));
    });

    testWidgets('Cancel pops null', (tester) async {
      await openPicker(tester);
      await tapAllow(tester);

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(await result, isNull);
    });

    testWidgets('shows no distance, radius hint, address lookup or ETA', (tester) async {
      await openPicker(tester);
      await tapAllow(tester);

      for (final needle in ['km', 'radius', 'ETA', 'minutes', 'within']) {
        expect(find.textContaining(needle), findsNothing, reason: needle);
      }
    });
  });

  group('denied', () {
    testWidgets('explains, offers retry and manual entry; retry asks again and can then succeed', (tester) async {
      source.requestResult = LocationPermissionStatus.denied;
      await openPicker(tester);
      await tapAllow(tester);

      expect(find.byKey(const Key('picker-denied')), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Enter manually'), findsOneWidget);
      expect(lastMap, isNull);

      source.requestResult = LocationPermissionStatus.granted;
      source.calls.clear();
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(source.calls, contains('request'));
      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
    });

    testWidgets('Enter manually from denied pops null', (tester) async {
      source.requestResult = LocationPermissionStatus.denied;
      await openPicker(tester);
      await tapAllow(tester);

      await tester.tap(find.text('Enter manually'));
      await tester.pumpAndSettle();

      expect(await result, isNull);
    });
  });

  group('denied forever', () {
    testWidgets('does not re-prompt and offers Open settings', (tester) async {
      source.checkResult = LocationPermissionStatus.deniedForever;
      await openPicker(tester);
      await tapAllow(tester);

      expect(source.calls, ['service', 'check'], reason: 'the OS will not show a prompt again');
      expect(find.byKey(const Key('picker-denied-forever')), findsOneWidget);

      await tester.tap(find.text('Open settings'));
      await tester.pumpAndSettle();
      expect(source.calls, contains('openAppSettings'));
      expect(find.text('Enter manually'), findsOneWidget);
    });

    testWidgets('a request that comes back deniedForever lands in the same state', (tester) async {
      source.requestResult = LocationPermissionStatus.deniedForever;
      await openPicker(tester);
      await tapAllow(tester);

      expect(find.byKey(const Key('picker-denied-forever')), findsOneWidget);
    });

    testWidgets('after fixing it in settings, Try again proceeds', (tester) async {
      source.checkResult = LocationPermissionStatus.deniedForever;
      await openPicker(tester);
      await tapAllow(tester);

      source.checkResult = LocationPermissionStatus.granted;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
    });
  });

  group('location services off', () {
    testWidgets('explains, makes no permission request, offers location settings', (tester) async {
      source.serviceEnabled = false;
      await openPicker(tester);
      await tapAllow(tester);

      expect(find.byKey(const Key('picker-services-off')), findsOneWidget);
      expect(source.calls, ['service']);

      await tester.tap(find.text('Open location settings'));
      await tester.pumpAndSettle();
      expect(source.calls, contains('openLocationSettings'));
      expect(find.text('Enter manually'), findsOneWidget);
    });

    testWidgets('Try again after switching services on continues', (tester) async {
      source.serviceEnabled = false;
      await openPicker(tester);
      await tapAllow(tester);

      source.serviceEnabled = true;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
    });

    testWidgets('a position failure reporting services off lands in the same state', (tester) async {
      source.positionError = const DeviceLocationException(DeviceLocationFailure.serviceDisabled);
      await openPicker(tester);
      await tapAllow(tester);

      expect(find.byKey(const Key('picker-services-off')), findsOneWidget);
    });
  });

  group('locating failure', () {
    testWidgets('a timeout shows an error with retry and manual entry; retry can succeed', (tester) async {
      source.positionError = const DeviceLocationException(DeviceLocationFailure.timeout);
      await openPicker(tester);
      await tapAllow(tester);

      expect(find.byKey(const Key('picker-error')), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Enter manually'), findsOneWidget);
      expect(lastMap, isNull, reason: 'never fabricates a position');

      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
    });

    testWidgets('an unexpected exception never crashes the screen', (tester) async {
      source.positionError = StateError('platform blew up');
      await openPicker(tester);
      await tapAllow(tester);

      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('picker-error')), findsOneWidget);
    });

    testWidgets('a permission error while locating lands in the denied state', (tester) async {
      source.positionError = const DeviceLocationException(DeviceLocationFailure.permissionDenied);
      await openPicker(tester);
      await tapAllow(tester);

      expect(find.byKey(const Key('picker-denied')), findsOneWidget);
    });

    testWidgets('an exception thrown by the permission calls is handled too', (tester) async {
      source = _ThrowingSource();
      await openPicker(tester);
      await tapAllow(tester);

      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('picker-error')), findsOneWidget);
      await tester.tap(find.text('Enter manually'));
      await tester.pumpAndSettle();
      expect(await result, isNull);
    });
  });

  group('map unavailable (default map builder, no tile config in tests)', () {
    // Google is the default provider; this group asserts the MapLibre adapter's
    // tile-config failure, so it pins MapLibre.
    setUp(() {
      MapProviderConfig.debugOverride = MapProviderKind.maplibre;
      debugMapStyleSource = () => null; // force "no usable style"
    });
    tearDown(() {
      MapProviderConfig.debugOverride = null;
      debugMapStyleSource = null;
    });

    testWidgets('shows an honest unavailable state, the label, and Confirm still works', (tester) async {
      await openPicker(tester, fakeMap: false);
      await tester.tap(find.text('Allow location'));
      // The style asset loads via real I/O, which the fake-async clock does not
      // drive: let it finish, then pump the resulting setState.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
      expect(find.text('Map unavailable'), findsOneWidget);
      expect(find.byKey(const Key('picker-pin')), findsNothing, reason: 'a fixed pin over a missing map would mislead');
      expect(find.text('6.438200, 80.027400'), findsOneWidget);
      expect(find.text(mapAttributionText), findsOneWidget);

      await tester.tap(find.text('Confirm location'));
      await tester.pumpAndSettle();
      expect(await result, const GeoPoint(6.4382, 80.0274));
      expect(popped, isTrue);
    });
  });
}

class _ThrowingSource extends _FakeLocationSource {
  @override
  Future<bool> isLocationServiceEnabled() async => throw StateError('channel error');
}
