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

  String textOf(WidgetTester tester, String label) => tester
      .widget<TextField>(find.descendant(of: fieldWith(label), matching: find.byType(TextField)))
      .controller!
      .text;

  testWidgets('offers "Use my current location" above the manual latitude/longitude fields', (tester) async {
    await pumpScreen(tester);
    await scrollToLocation(tester);

    final button = tester.getTopLeft(find.text('Use my current location'));
    expect(button.dy, lessThan(tester.getTopLeft(fieldWith('Latitude')).dy));
    expect(fieldWith('Latitude'), findsOneWidget, reason: 'manual fields stay as fallback / correction');
    expect(fieldWith('Longitude'), findsOneWidget);
    expect(source.calls, 0, reason: 'nothing touches the device until the customer taps');
  });

  testWidgets('a confirmed location fills the latitude and longitude fields (6 decimals)', (tester) async {
    await pumpScreen(tester);
    await scrollToLocation(tester);

    await tester.tap(find.text('Use my current location'));
    await tester.pumpAndSettle();
    expect(find.byType(LiveLocationPickerScreen), findsOneWidget);
    await tester.tap(find.text('Allow location'));
    await tester.pumpAndSettle();
    movePin!(const GeoPoint(6.4411, 80.0333));
    await tester.pump();
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveLocationPickerScreen), findsNothing);
    expect(textOf(tester, 'Latitude'), '6.441100');
    expect(textOf(tester, 'Longitude'), '80.033300');
  });

  testWidgets('cancelling / entering manually leaves the fields untouched', (tester) async {
    await pumpScreen(tester);
    await scrollToLocation(tester);

    await tester.tap(find.text('Use my current location'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Enter manually'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveLocationPickerScreen), findsNothing);
    expect(textOf(tester, 'Latitude'), '6.4382');
    expect(textOf(tester, 'Longitude'), '80.0274');
  });

  testWidgets('the picked coordinate flows into the normal save', (tester) async {
    await pumpScreen(tester);
    await tester.enterText(fieldWith('Recipient name'), 'QA Tester');
    await tester.enterText(fieldWith('Recipient phone'), '0771234567');
    await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
    await scrollToLocation(tester);

    await tester.tap(find.text('Use my current location'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Allow location'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();

    expect(addresses.created, isNotNull);
    expect(addresses.created!.latitude, 6.5);
    expect(addresses.created!.longitude, 80.1);
  });
}
