import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Screens/add_edit_address_screen.dart';
import 'package:ecom/Screens/live_location_picker_screen.dart';
import 'package:ecom/Services/Location/device_location_source.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/app_theme.dart';

class _RecordingAddressProvider extends AddressProvider {
  AddressModel? created;

  @override
  Future<AddressModel?> createAddress(AddressModel address) async {
    created = address;
    return address;
  }
}

class _FakeSource implements DeviceLocationSource {
  _FakeSource(this.fix);
  final DeviceFix fix;
  int calls = 0;

  @override
  Future<bool> isLocationServiceEnabled() async {
    calls++;
    return true;
  }

  @override
  Future<LocationPermissionStatus> checkPermission() async {
    calls++;
    return LocationPermissionStatus.granted;
  }

  @override
  Future<LocationPermissionStatus> requestPermission() async {
    calls++;
    return LocationPermissionStatus.granted;
  }

  @override
  Future<DeviceFix> currentPosition() async {
    calls++;
    return fix;
  }

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;
}

class _FakeMap extends LocationPickerMapView {
  const _FakeMap({required this.onPositionChanged}) : super.constructor();
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

/// The "Use my current location" wiring on the address form. The picker's own
/// behaviour is covered in live_location_picker_screen_test.dart; here it is
/// only the hand-off: what the button does and what lands in the fields.
void main() {
  late _RecordingAddressProvider addresses;
  late _FakeSource source;
  ValueChanged<GeoPoint>? movePin;

  setUp(() {
    addresses = _RecordingAddressProvider();
    source = _FakeSource(const DeviceFix(GeoPoint(6.5, 80.1)));
    movePin = null;
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ChangeNotifierProvider<AddressProvider>.value(
        value: addresses,
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: AddEditAddressScreen(
            locationSource: source,
            pickerMapBuilder: ({required initialPosition, required onPositionChanged}) {
              movePin = onPositionChanged;
              return _FakeMap(onPositionChanged: onPositionChanged);
            },
          ),
        ),
      ),
    );
    await tester.pump();
  }

  // The form's fields are BlynkTextFields wrapped in a FormField (the
  // validator and the Form.validate() gate are unchanged); the shared
  // component is what carries the label now.
  Finder fieldWith(String label) => find.widgetWithText(BlynkTextField, label);

  Future<void> scrollToLocation(WidgetTester tester) async {
    await tester.scrollUntilVisible(find.text('Use my current location'), 200, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
  }

  Future<void> pickLocation(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('address-use-location')));
    await tester.pumpAndSettle();
    expect(find.byType(LiveLocationPickerScreen), findsOneWidget);
    await tester.tap(find.text('Allow location'));
    await tester.pumpAndSettle();
  }

  testWidgets('offers a full-width "Use my current location" button and no manual coordinate fields', (tester) async {
    await pumpScreen(tester);
    await scrollToLocation(tester);

    expect(find.byKey(const Key('address-use-location')), findsOneWidget);
    final button = tester.getRect(find.byKey(const Key('address-use-location')));
    final field = tester.getRect(fieldWith('Address'));
    expect(button.width, field.width, reason: 'the button is full width');
    expect(button.top, greaterThan(field.bottom));
    expect(fieldWith('Latitude'), findsNothing);
    expect(fieldWith('Longitude'), findsNothing);
    expect(source.calls, 0, reason: 'nothing touches the device until the customer taps');
  });

  testWidgets('a confirmed location flips the button and the note', (tester) async {
    await pumpScreen(tester);
    await scrollToLocation(tester);
    expect(find.text('Share your location'), findsOneWidget);
    expect(find.text('Location added'), findsNothing);

    await pickLocation(tester);
    movePin!(const GeoPoint(6.4411, 80.0333));
    await tester.pump();
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveLocationPickerScreen), findsNothing);
    expect(find.text('Location added'), findsOneWidget);
    expect(find.text('The rider will come to this place.'), findsOneWidget);
    expect(find.text('Share your location'), findsNothing);
    expect(find.text('Change my location'), findsOneWidget);
    expect(find.text('Use my current location'), findsNothing);
  });

  testWidgets('a confirmed location is saved at 6 decimals precision', (tester) async {
    await pumpScreen(tester);
    await tester.enterText(fieldWith('Name'), 'QA Tester');
    await tester.enterText(fieldWith('Phone number'), '0771234567');
    await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
    await scrollToLocation(tester);

    await pickLocation(tester);
    movePin!(const GeoPoint(6.44111199, 80.03334999));
    await tester.pump();
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();

    expect(addresses.created!.latitude, 6.441112);
    expect(addresses.created!.longitude, 80.03335);
  });

  testWidgets('backing out of the picker leaves the location unchanged', (tester) async {
    await pumpScreen(tester);
    await tester.enterText(fieldWith('Name'), 'QA Tester');
    await tester.enterText(fieldWith('Phone number'), '0771234567');
    await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
    await scrollToLocation(tester);

    await tester.tap(find.byKey(const Key('address-use-location')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Enter manually'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveLocationPickerScreen), findsNothing);
    expect(find.text('Share your location'), findsOneWidget);
    expect(find.text('Location added'), findsNothing);
    expect(find.text('Use my current location'), findsOneWidget);

    // The location is required: without it nothing is saved and the note
    // under the button turns into a plain request.
    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();
    expect(addresses.created, isNull);
    expect(find.text('Please share your location'), findsOneWidget);
  });

  testWidgets('a new address cannot be saved until the location is shared', (tester) async {
    await pumpScreen(tester);
    await tester.enterText(fieldWith('Name'), 'QA Tester');
    await tester.enterText(fieldWith('Phone number'), '0771234567');
    await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
    await tester.pump();

    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();
    expect(addresses.created, isNull);
    expect(find.text('Please share your location'), findsOneWidget);
    expect(source.calls, 0, reason: 'Save never opens the picker by itself');

    await scrollToLocation(tester);
    await pickLocation(tester);
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();
    expect(find.text('Please share your location'), findsNothing);
    expect(find.text('Location added'), findsOneWidget);

    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();
    expect(addresses.created, isNotNull);
    expect(addresses.created!.latitude, 6.5);
  });

  testWidgets('the picked coordinate flows into the normal save', (tester) async {
    await pumpScreen(tester);
    await tester.enterText(fieldWith('Name'), 'QA Tester');
    await tester.enterText(fieldWith('Phone number'), '0771234567');
    await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
    await scrollToLocation(tester);

    await pickLocation(tester);
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();

    expect(addresses.created, isNotNull);
    expect(addresses.created!.latitude, 6.5);
    expect(addresses.created!.longitude, 80.1);
  });
}
