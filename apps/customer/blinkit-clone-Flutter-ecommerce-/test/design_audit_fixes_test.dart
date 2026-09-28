import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Screens/add_edit_address_screen.dart';
import 'package:ecom/Screens/live_location_picker_screen.dart';
import 'package:ecom/Services/Location/device_location_source.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider_config.dart';
import 'package:ecom/UI/Widgets/Organisms/map_tile_config.dart' show kMapStyleAsset, debugMapStyleSource;
import 'package:ecom/app_colors.dart';
import 'package:ecom/app_design.dart';
import 'package:ecom/app_theme.dart';

/// Regression tests for the live-location design audit's fix wave: text-scale
/// clipping (H1), caption contrast (M1), the "Map unavailable" surface (M2) and
/// copy (M3), failure icon colour (M6), the address button (M7) and the picker
/// hierarchy (M8).

// -- WCAG 2.x contrast ------------------------------------------------------

double _channel(double c) => c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();

double _luminance(Color c) => 0.2126 * _channel(c.r) + 0.7152 * _channel(c.g) + 0.0722 * _channel(c.b);

/// WCAG contrast ratio of two opaque colours (1..21).
double contrastRatio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

// -- Fakes ------------------------------------------------------------------

class _Source implements DeviceLocationSource {
  bool serviceEnabled = true;
  LocationPermissionStatus check = LocationPermissionStatus.denied;
  LocationPermissionStatus request = LocationPermissionStatus.granted;
  Object? positionError;

  @override
  Future<bool> isLocationServiceEnabled() async => serviceEnabled;

  @override
  Future<LocationPermissionStatus> checkPermission() async => check;

  @override
  Future<LocationPermissionStatus> requestPermission() async => request;

  @override
  Future<DeviceFix> currentPosition() async {
    final error = positionError;
    if (error != null) throw error;
    return const DeviceFix(GeoPoint(6.4382, 80.0274), accuracyMeters: 8);
  }

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;
}

class _FakeMap extends LocationPickerMapView {
  const _FakeMap() : super.constructor();

  @override
  Widget build(BuildContext context) => const SizedBox.expand(child: ColoredBox(color: Colors.blueGrey));
}

LocationPickerMapView _fakeMapBuilder({
  required GeoPoint initialPosition,
  required ValueChanged<GeoPoint> onPositionChanged,
}) =>
    const _FakeMap();

/// MaterialApp whose text scale is forced, the way a large system font would.
Widget _scaled(double scale, Widget home) => MaterialApp(
      theme: AppTheme.appTHeme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: home,
    );

/// The real map widgets load their style asset with real I/O, which the
/// fake-async clock does not drive: wait (really) until [finder] shows up.
Future<void> _awaitReal(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 50 && finder.evaluate().isEmpty; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pump();
  }
  await tester.pumpAndSettle();
}

/// These tests assert the MapLibre adapter's "Map unavailable" state, so they
/// pin MapLibre and force the style to be unavailable (the default is now a
/// real worldwide style URL).
void _useMapLibreAdapter() {
  MapProviderConfig.debugOverride = MapProviderKind.maplibre;
  debugMapStyleSource = () => null;
  addTearDown(() {
    MapProviderConfig.debugOverride = null;
    debugMapStyleSource = null;
  });
}

void _phone(WidgetTester tester, {double width = 360, double height = 800}) {
  // The real map widgets read a bundled style asset through rootBundle, which
  // caches the future; a cached one left over from an earlier test never
  // completes inside a later test's fake-async zone.
  rootBundle.evict(kMapStyleAsset);
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// A button is not clipped when it is at least 48 dp tall (the touch target),
/// holds its whole label plus padding, and the tap centre actually reaches it.
Future<void> _expectReachable(WidgetTester tester, Finder label, {required Type button}) async {
  await tester.ensureVisible(label);
  await tester.pumpAndSettle();
  expect(label.hitTestable(), findsOneWidget, reason: '$label must be hit-testable');
  final buttonFinder = find.ancestor(of: label, matching: find.byType(button));
  final buttonSize = tester.getSize(buttonFinder.first);
  final labelSize = tester.getSize(label);
  expect(buttonSize.height, greaterThanOrEqualTo(48), reason: '$label button is under the 48 dp target');
  // The button must hold the whole (possibly wrapped) label plus its own
  // vertical padding (12 dp each side at least); a fixed 50 dp box cut a wrapped
  // 1.6x label in half.
  expect(
    buttonSize.height,
    greaterThanOrEqualTo(labelSize.height + 24),
    reason: '$label is taller than its button (clipped)',
  );
}

void main() {
  group('contrast (WCAG 2.x, AA text = 4.5:1)', () {
    test('the helper reproduces the audit numbers', () {
      expect(contrastRatio(AppColors.primaryGreenColor, AppColors.greyWhiteColor), closeTo(4.36, 0.01));
      expect(contrastRatio(AppColors.primaryGreenColor, Colors.white), closeTo(4.90, 0.01));
      expect(contrastRatio(Colors.black, Colors.white), closeTo(21, 0.001));
    });

    test('the brand green fails AA as 13 px text on the page background (why the new token exists)', () {
      expect(contrastRatio(AppColors.primaryGreenColor, AppColors.greyWhiteColor), lessThan(4.5));
    });

    test('"Live" caption: positiveOnBackground on the order page is >= 4.5:1 (5.29)', () {
      final ratio = contrastRatio(AppTextColors.positiveOnBackground, AppColors.greyWhiteColor);
      expect(ratio, greaterThanOrEqualTo(4.5));
      expect(ratio, closeTo(5.29, 0.01));
    });

    test('positiveOnBackground is still >= 4.5:1 on white', () {
      expect(contrastRatio(AppTextColors.positiveOnBackground, Colors.white), greaterThanOrEqualTo(4.5));
    });

    test('other text pairs the fixes rely on', () {
      // Picker instruction / coordinate label sit on the white sheet.
      expect(contrastRatio(AppTextColors.primary, Colors.white), greaterThanOrEqualTo(4.5));
      expect(contrastRatio(AppTextColors.secondary, Colors.white), greaterThanOrEqualTo(4.5));
      // Failure icon on the picker scaffold.
      expect(contrastRatio(AppTextColors.problem, AppSurfaces.subtle), greaterThanOrEqualTo(4.5));
      // Caption text on the order page.
      expect(contrastRatio(AppTextColors.onBackground, AppColors.greyWhiteColor), greaterThanOrEqualTo(4.5));
    });
  });

  group('picker at 1.6x text scale (H1)', () {
    Future<void> pumpPicker(WidgetTester tester, _Source source, {double scale = 1.6}) async {
      _phone(tester);
      await tester.pumpWidget(
        _scaled(scale, LiveLocationPickerScreen(locationSource: source, mapBuilder: _fakeMapBuilder)),
      );
      await tester.pumpAndSettle();
    }

    Future<void> allow(WidgetTester tester) async {
      // At 1.6x the explanation scrolls: bring the button on screen first.
      await tester.ensureVisible(find.text('Allow location'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Allow location'));
      await tester.pumpAndSettle();
    }

    testWidgets('explain: Allow location and Enter manually are reachable and not clipped', (tester) async {
      await pumpPicker(tester, _Source());
      expect(tester.takeException(), isNull);
      await _expectReachable(tester, find.text('Allow location'), button: ElevatedButton);
      expect(find.text('Enter manually').hitTestable(), findsOneWidget);
    });

    testWidgets('denied: Try again is reachable and not clipped', (tester) async {
      final source = _Source()..request = LocationPermissionStatus.denied;
      await pumpPicker(tester, source);
      await allow(tester);
      expect(find.byKey(const Key('picker-denied')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _expectReachable(tester, find.text('Try again'), button: ElevatedButton);
      expect(find.text('Enter manually').hitTestable(), findsOneWidget);
    });

    testWidgets('blocked: Open settings and Try again are both reachable and not clipped', (tester) async {
      final source = _Source()..check = LocationPermissionStatus.deniedForever;
      await pumpPicker(tester, source);
      await allow(tester);
      expect(find.byKey(const Key('picker-denied-forever')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _expectReachable(tester, find.text('Open settings'), button: ElevatedButton);
      await _expectReachable(tester, find.text('Try again'), button: OutlinedButton);
    });

    testWidgets('services off: Open location settings and Try again are reachable and not clipped', (tester) async {
      final source = _Source()..serviceEnabled = false;
      await pumpPicker(tester, source);
      await allow(tester);
      expect(find.byKey(const Key('picker-services-off')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _expectReachable(tester, find.text('Open location settings'), button: ElevatedButton);
      await _expectReachable(tester, find.text('Try again'), button: OutlinedButton);
    });

    testWidgets('error: Try again is reachable and not clipped', (tester) async {
      final source = _Source()..positionError = const DeviceLocationException(DeviceLocationFailure.timeout);
      await pumpPicker(tester, source);
      await allow(tester);
      expect(find.byKey(const Key('picker-error')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _expectReachable(tester, find.text('Try again'), button: ElevatedButton);
    });

    testWidgets('ready: Cancel and Confirm location are full labels, same width, reachable', (tester) async {
      await pumpPicker(tester, _Source());
      await allow(tester);
      expect(find.byKey(const Key('picker-ready')), findsOneWidget);
      expect(tester.takeException(), isNull);

      await _expectReachable(tester, find.text('Cancel'), button: OutlinedButton);
      await _expectReachable(tester, find.text('Confirm location'), button: ElevatedButton);
      // The whole label is laid out on one line box set (not FittedBox-shrunk):
      // the rendered glyph size must still be the scaled 15 px * 1.6 = 24.
      final confirm = tester.widget<Text>(find.text('Confirm location'));
      expect(find.ancestor(of: find.text('Confirm location'), matching: find.byType(FittedBox)), findsNothing);
      expect(confirm.style?.fontSize, isNull, reason: 'label inherits the button style, never shrunk');
      final cancelSize = tester.getSize(find.widgetWithText(OutlinedButton, 'Cancel'));
      final confirmSize = tester.getSize(find.widgetWithText(ElevatedButton, 'Confirm location'));
      expect(cancelSize.width, confirmSize.width, reason: 'stacked full-width at a large text scale');
    });

    testWidgets('ready at 1.3x keeps the side-by-side row with a shared height', (tester) async {
      await pumpPicker(tester, _Source(), scale: 1.3);
      await allow(tester);
      expect(tester.takeException(), isNull);
      final cancel = tester.getRect(find.widgetWithText(OutlinedButton, 'Cancel'));
      final confirm = tester.getRect(find.widgetWithText(ElevatedButton, 'Confirm location'));
      expect(cancel.top, confirm.top);
      expect(cancel.height, confirm.height);
      await _expectReachable(tester, find.text('Confirm location'), button: ElevatedButton);
    });

    testWidgets('ready at 1.0x: buttons of one shared height (>= 50 dp) side by side', (tester) async {
      await pumpPicker(tester, _Source(), scale: 1.0);
      await allow(tester);
      final cancel = tester.getRect(find.widgetWithText(OutlinedButton, 'Cancel'));
      final confirm = tester.getRect(find.widgetWithText(ElevatedButton, 'Confirm location'));
      expect(cancel.height, greaterThanOrEqualTo(50));
      expect(cancel.height, confirm.height);
      expect(cancel.top, confirm.top);
      expect(cancel.right, lessThan(confirm.left));
    });
  });

  group('picker copy, icons and hierarchy (M3, M6, M8)', () {
    Future<void> reachReady(WidgetTester tester, {bool fakeMap = true}) async {
      _phone(tester, height: 900);
      if (!fakeMap) _useMapLibreAdapter(); // this path asserts the MapLibre adapter's unavailable state
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.appTHeme,
          home: LiveLocationPickerScreen(locationSource: _Source(), mapBuilder: fakeMap ? _fakeMapBuilder : null),
        ),
      );
      await tester.tap(find.text('Allow location'));
      await tester.pumpAndSettle();
      if (!fakeMap) await _awaitReal(tester, find.byKey(const Key('map-unavailable')));
    }

    const normalHint = 'Move the map to put the pin on your exact delivery spot.';

    testWidgets('normal state keeps the "move the map" instruction', (tester) async {
      await reachReady(tester);
      expect(find.text(normalHint), findsOneWidget);
      expect(find.textContaining('not available'), findsNothing);
    });

    testWidgets('map unavailable: no "move the map", an honest line that Confirm uses the device location', (tester) async {
      await reachReady(tester, fakeMap: false);

      expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
      expect(find.text(normalHint), findsNothing);
      expect(find.textContaining('Move the map'), findsNothing);
      expect(
        find.text('The map is not available right now. Confirm location will use your device location.'),
        findsOneWidget,
      );
      // Confirm still works and still returns the device fix.
      expect(find.text('Confirm location').hitTestable(), findsOneWidget);
    });

    testWidgets('a new attempt after the map came back restores the normal instruction', (tester) async {
      // The unavailable flag is per attempt: fake map => never flagged, and a
      // Try again cycle from error keeps the normal copy.
      final source = _Source()..positionError = const DeviceLocationException(DeviceLocationFailure.timeout);
      _phone(tester, height: 900);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.appTHeme,
          home: LiveLocationPickerScreen(locationSource: source, mapBuilder: _fakeMapBuilder),
        ),
      );
      await tester.tap(find.text('Allow location'));
      await tester.pumpAndSettle();
      source.positionError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text(normalHint), findsOneWidget);
    });

    testWidgets('failure, blocked and services-off icons use the problem colour, never the success green', (tester) async {
      Color iconColor(String key) => tester
          .widget<Icon>(find.descendant(of: find.byKey(Key(key)), matching: find.byType(Icon)).first)
          .color!;

      _phone(tester);
      final source = _Source()..request = LocationPermissionStatus.denied;
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.appTHeme,
          home: LiveLocationPickerScreen(locationSource: source, mapBuilder: _fakeMapBuilder),
        ),
      );
      // Explain keeps the friendly green.
      expect(iconColor('picker-explain'), AppColors.primaryGreenColor);

      await tester.tap(find.text('Allow location'));
      await tester.pumpAndSettle();
      expect(iconColor('picker-denied'), AppTextColors.problem);

      source.check = LocationPermissionStatus.deniedForever;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(iconColor('picker-denied-forever'), AppTextColors.problem);

      source.serviceEnabled = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(iconColor('picker-services-off'), AppTextColors.problem);

      source
        ..serviceEnabled = true
        ..check = LocationPermissionStatus.granted
        ..positionError = const DeviceLocationException(DeviceLocationFailure.timeout);
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(iconColor('picker-error'), AppTextColors.problem);
    });

    testWidgets('ready: the instruction is the primary text, the coordinate label is secondary', (tester) async {
      await reachReady(tester);
      final instruction = tester.widget<Text>(find.byKey(const Key('picker-instruction')));
      final coordinates = tester.widget<Text>(find.byKey(const Key('picker-coordinates')));

      expect(instruction.style!.fontSize!, greaterThan(coordinates.style!.fontSize!));
      expect(instruction.style!.fontWeight!.value, greaterThan(coordinates.style!.fontWeight!.value));
      expect(instruction.style!.color, AppTextColors.primary);
      expect(coordinates.style!.color, AppTextColors.secondary);
      // Both strings are still there.
      expect(find.text('6.438200, 80.027400'), findsOneWidget);
      expect(find.text('Delivery location'), findsOneWidget);
    });
  });

  group('"Map unavailable" surface (M2)', () {
    testWidgets('is a white bordered card, visibly distinct from the order page and from the old tile grey',
        (tester) async {
      _phone(tester);
      _useMapLibreAdapter(); // the tile-config failure that shows this card is MapLibre-specific
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            backgroundColor: AppColors.greyWhiteColor,
            body: SizedBox(
              height: 220,
              child: TrackingMapView(
                initialCenter: const GeoPoint(6.4382, 80.0274),
                initialZoom: 14,
                markers: const {},
              ),
            ),
          ),
        ),
      );
      // Real style-asset I/O (no tile URL configured in tests): let it finish.
      await _awaitReal(tester, find.byKey(const Key('map-unavailable')));

      final card = tester.widget<Container>(find.byKey(const Key('map-unavailable')));
      final decoration = card.decoration! as BoxDecoration;
      expect(decoration.color, Colors.white);
      expect(decoration.color, isNot(AppColors.greyWhiteColor));
      expect(decoration.color, isNot(AppSurfaces.tile), reason: 'the old fill was 1.00:1 against the page');
      expect(decoration.border, isNotNull);
      expect((decoration.border! as Border).top.color, AppSurfaces.border);
      expect(find.text('Map unavailable'), findsOneWidget);
    });
  });

  group('address form (H1 / M7)', () {
    late _RecordingAddresses addresses;
    setUp(() => addresses = _RecordingAddresses());

    Future<void> pumpForm(WidgetTester tester, {double scale = 1.0}) async {
      _phone(tester);
      await tester.pumpWidget(
        ChangeNotifierProvider<AddressProvider>.value(
          value: addresses,
          child: _scaled(scale, const AddEditAddressScreen()),
        ),
      );
      await tester.pump();
    }

    Future<void> scrollToButton(WidgetTester tester) async {
      await tester.scrollUntilVisible(find.text('Use my current location'), 200, scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
    }

    testWidgets('"Use my current location" is >= 48 dp tall and has room above it (1.0x)', (tester) async {
      await pumpForm(tester);
      await scrollToButton(tester);

      final button = find.ancestor(of: find.text('Use my current location'), matching: find.byType(OutlinedButton)).first;
      expect(tester.getSize(button).height, greaterThanOrEqualTo(48));

      // Same 12 dp breathing room above the button as below it (the note above
      // ends, then AppSpacing.md, then the button).
      final note = tester.getBottomLeft(find.text('Your delivery location helps us confirm service availability.'));
      final top = tester.getTopLeft(button).dy;
      expect(top - note.dy, greaterThanOrEqualTo(AppSpacing.md));
    });

    testWidgets('at 1.6x the label is not clipped and the button stays reachable', (tester) async {
      await pumpForm(tester, scale: 1.6);
      expect(tester.takeException(), isNull);
      await scrollToButton(tester);
      await _expectReachable(tester, find.text('Use my current location'), button: OutlinedButton);
    });

    // W7: Save address is now BlynkButton.cta (the flat-yellow CTA), which is
    // a token-driven surface rather than an ElevatedButton, and Cancel is
    // BlynkButton.secondary. Only the widget the label is looked up under
    // changed - every assertion below (>= 48 dp, the whole label plus its
    // padding, hit-testable, one shared height >= 50) is the same, and the
    // shared height is now 56 (BlynkCta.minHeight) rather than 50.
    testWidgets('at 1.6x Cancel and Save address are full labels and reachable', (tester) async {
      await pumpForm(tester, scale: 1.6);
      expect(tester.takeException(), isNull);
      await _expectReachable(tester, find.text('Save address'), button: BlynkButton);
      await _expectReachable(tester, find.text('Cancel'), button: BlynkButton);
      expect(find.ancestor(of: find.text('Save address'), matching: find.byType(FittedBox)), findsNothing);
    });

    testWidgets('at 1.0x the bottom bar keeps Cancel and Save side by side at one shared height (>= 50 dp)', (tester) async {
      await pumpForm(tester);
      final cancel = tester.getRect(find.widgetWithText(BlynkButton, 'Cancel'));
      final save = tester.getRect(find.widgetWithText(BlynkButton, 'Save address'));
      expect(cancel.height, greaterThanOrEqualTo(50));
      expect(cancel.height, save.height);
      expect(cancel.top, save.top);
    });
  });
}

class _RecordingAddresses extends AddressProvider {
  AddressModel? created;

  @override
  Future<AddressModel?> createAddress(AddressModel address) async {
    created = address;
    return address;
  }
}
