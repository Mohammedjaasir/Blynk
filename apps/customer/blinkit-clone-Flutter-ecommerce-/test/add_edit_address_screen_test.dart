import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Screens/add_edit_address_screen.dart';
import 'package:ecom/Services/Location/device_location_source.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/design/tokens.dart';
import 'package:ecom/app_theme.dart';

/// Records what the screen asks the provider to do without touching the
/// network - the real AddressProvider's API calls are exercised by the live
/// integration flow instead.
class _RecordingAddressProvider extends AddressProvider {
  AddressModel? created;
  String? updatedId;
  Map<String, dynamic>? updatedPayload;
  bool shouldFail = false;

  /// What the customer "already has" - decides whether a new address is the
  /// first (and therefore the default).
  List<AddressModel> existingList = [];

  @override
  List<AddressModel> get addresses => existingList;

  @override
  Future<AddressModel?> createAddress(AddressModel address) async {
    if (shouldFail) throw Exception('network');
    created = address;
    return address;
  }

  @override
  Future<AddressModel?> updateAddress(
    String id,
    Map<String, dynamic> payload,
  ) async {
    if (shouldFail) throw Exception('network');
    updatedId = id;
    updatedPayload = payload;
    return null;
  }
}

/// A device that always grants and reports one fix, and a map that draws
/// nothing: enough to share a location, which a new address now requires.
class _FakeSource implements DeviceLocationSource {
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermissionStatus> checkPermission() async => LocationPermissionStatus.granted;
  @override
  Future<LocationPermissionStatus> requestPermission() async => LocationPermissionStatus.granted;
  @override
  Future<DeviceFix> currentPosition() async => const DeviceFix(GeoPoint(6.5, 80.1));
  @override
  Future<bool> openAppSettings() async => true;
  @override
  Future<bool> openLocationSettings() async => true;
}

class _FakeMap extends LocationPickerMapView {
  const _FakeMap() : super.constructor();
  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

class _FakeAuth extends AuthProvider {
  _FakeAuth(this._user);
  final UserModel? _user;

  @override
  UserModel? get currentUser => _user;
}

UserModel _user(String? name, String phone) =>
    UserModel(id: 'u1', phone: phone, fullName: name, role: 'CUSTOMER');

// Shaped exactly like a row from GET /api/v1/me/addresses.
final _existing = AddressModel.fromJson(const {
  'id': 'a0000001-0000-0000-0000-000000000001',
  'label': 'Work',
  'recipient_name': 'QA Tester',
  'recipient_phone': '+94771234567',
  'address_line1': 'No. 12, Test Lane',
  'address_line2': null,
  'city': 'Dharga Town',
  'postal_code': null,
  'latitude': 6.4382,
  'longitude': 80.0274,
  'delivery_instructions': null,
  'is_default': true,
});

void main() {
  late _RecordingAddressProvider addresses;

  setUp(() => addresses = _RecordingAddressProvider());

  Future<void> pumpScreen(
    WidgetTester tester, {
    AddressModel? existing,
    Size size = const Size(400, 900),
    AuthProvider? auth,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    Widget app = MaterialApp(
      theme: AppTheme.appTHeme,
      home: AddEditAddressScreen(
        existing: existing,
        locationSource: _FakeSource(),
        pickerMapBuilder: ({required initialPosition, required onPositionChanged}) => const _FakeMap(),
      ),
    );
    app = MultiProvider(
      providers: [
        ChangeNotifierProvider<AddressProvider>.value(value: addresses),
        if (auth != null) ChangeNotifierProvider<AuthProvider>.value(value: auth),
      ],
      child: app,
    );
    await tester.pumpWidget(app);
    await tester.pump();
  }

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> scrollToBottom(WidgetTester tester) async {
    for (var i = 0; i < 3; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, -260));
      await tester.pump();
    }
  }

  // The form's fields are BlynkTextFields wrapped in a FormField (the
  // validator and the Form.validate() gate are unchanged); the shared
  // component is what carries the label now.
  Finder fieldWith(String label) =>
      find.widgetWithText(BlynkTextField, label);

  String textOf(WidgetTester tester, String label) => tester
      .widget<TextField>(
          find.descendant(of: fieldWith(label), matching: find.byType(TextField)))
      .controller!
      .text;

  /// Required for a new address: tap the button, allow, confirm the pin.
  Future<void> shareLocation(WidgetTester tester) async {
    final button = find.byKey(const Key('address-use-location'));
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Allow location'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm location'));
    await tester.pumpAndSettle();
  }

  Future<void> fillRequired(WidgetTester tester) async {
    await tester.enterText(fieldWith('Name'), 'QA Tester');
    await tester.enterText(fieldWith('Phone number'), '0771234567');
    await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
    await tester.pump();
    await shareLocation(tester);
  }

  group('structure', () {
    testWidgets('shows the four plain fields, the location button and the pinned bar',
        (tester) async {
      await pumpScreen(tester);

      expect(find.text('Add Address'), findsOneWidget);
      expect(fieldWith('Name'), findsOneWidget);
      expect(fieldWith('Phone number'), findsOneWidget);
      expect(fieldWith('Another phone number (optional)'), findsOneWidget);
      expect(fieldWith('Address'), findsOneWidget);
      expect(find.text('Who will receive the order'), findsOneWidget);
      expect(find.text('07XXXXXXXX'), findsOneWidget);
      expect(find.text('Family or neighbour'), findsOneWidget);
      expect(find.text('House number, street, near which place'), findsOneWidget);
      expect(find.byKey(const Key('address-use-location')), findsOneWidget);
      expect(find.text('Use my current location'), findsOneWidget);
      expect(find.text('Save address'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
    });

    testWidgets('no Home/Work/Other picker, headings, coordinates, notes or default switch',
        (tester) async {
      await pumpScreen(tester);
      await scrollToBottom(tester);

      for (final gone in const [
        'Save address as', 'Home', 'Work', 'Other', 'Address name',
        'Contact', 'Delivery address', 'Location', 'Delivery notes',
        'Latitude', 'Longitude', 'Delivery instructions',
        'Default delivery address',
      ]) {
        expect(find.text(gone), findsNothing, reason: gone);
      }
      expect(fieldWith('Latitude'), findsNothing);
      expect(fieldWith('Longitude'), findsNothing);
      expect(find.byType(Switch), findsNothing);
    });

    testWidgets('tells the customer to stand at home and tap the button',
        (tester) async {
      await pumpScreen(tester);

      expect(find.text('Share your location'), findsOneWidget);
      expect(
        find.text('Stand at your home and tap the button, so the rider can find you.'),
        findsOneWidget,
      );
      expect(find.text('Location added'), findsNothing);
    });
  });

  group('new address prefill and defaults', () {
    testWidgets('without an AuthProvider the name and phone start empty',
        (tester) async {
      await pumpScreen(tester);
      expect(textOf(tester, 'Name'), '');
      expect(textOf(tester, 'Phone number'), '');
    });

    testWidgets('name and phone come from the account (+94 shown as 0)',
        (tester) async {
      await pumpScreen(tester, auth: _FakeAuth(_user('Nimal Perera', '+94771234567')));
      expect(textOf(tester, 'Name'), 'Nimal Perera');
      expect(textOf(tester, 'Phone number'), '0771234567');

      await tester.enterText(fieldWith('Address'), 'No. 3, Temple Road');
      await shareLocation(tester);
      await tester.tap(find.text('Save address'));
      await settle(tester);
      expect(addresses.created?.recipientName, 'Nimal Perera');
      expect(addresses.created?.recipientPhone, '+94771234567');
    });

    testWidgets('an account without a name leaves the name empty', (tester) async {
      await pumpScreen(tester, auth: _FakeAuth(_user(null, '+94771234567')));
      expect(textOf(tester, 'Name'), '');
      expect(textOf(tester, 'Phone number'), '0771234567');
    });

    testWidgets('a new address is saved with the label Home', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created?.label, 'Home');
    });

    testWidgets('the first address becomes the default', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created?.isDefault, isTrue);
    });

    testWidgets('a later address is not the default', (tester) async {
      addresses.existingList = [_existing];
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created?.isDefault, isFalse);
    });
  });

  group('editing', () {
    testWidgets('prefills every real field and offers Change my location',
        (tester) async {
      await pumpScreen(tester, existing: _existing);

      expect(find.text('Edit Address'), findsOneWidget);
      expect(find.text('QA Tester'), findsOneWidget);
      expect(find.text('+94771234567'), findsOneWidget);
      expect(find.text('No. 12, Test Lane'), findsOneWidget);
      // City and postal code are not asked (the hub's city is used).
      expect(fieldWith('City'), findsNothing);
      expect(fieldWith('Postal code'), findsNothing);
      // An existing address already has a location.
      expect(find.text('Change my location'), findsOneWidget);
      expect(find.text('Use my current location'), findsNothing);
      expect(find.text('Location added'), findsOneWidget);
      expect(find.text('The rider will come to this place.'), findsOneWidget);
    });

    testWidgets('an edit ignores the signed-in account for name and phone',
        (tester) async {
      await pumpScreen(tester,
          existing: _existing,
          auth: _FakeAuth(_user('Someone Else', '+94700000000')));
      expect(textOf(tester, 'Name'), 'QA Tester');
      expect(textOf(tester, 'Phone number'), '+94771234567');
    });

    testWidgets('saving an edit sends the existing id and payload',
        (tester) async {
      await pumpScreen(tester, existing: _existing);

      await tester.enterText(fieldWith('Address'), 'No. 99, New Lane');
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.updatedId, _existing.id);
      expect(addresses.updatedPayload?['address_line1'], 'No. 99, New Lane');
      expect(addresses.updatedPayload?['label'], 'Work');
      expect(addresses.updatedPayload?['is_default'], true);
      expect(addresses.updatedPayload?['latitude'], 6.4382);
    });

    testWidgets('an edit keeps its label, instructions and default flag',
        (tester) async {
      final withNotes = AddressModel.fromJson({
        ..._existing.toCreatePayload(),
        'id': _existing.id,
        'label': 'Integration Test Home',
        'delivery_instructions': 'Leave at the gate',
        'is_default': true,
      });
      await pumpScreen(tester, existing: withNotes);

      await tester.enterText(fieldWith('Address'), 'No. 99, New Lane');
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.updatedPayload?['label'], 'Integration Test Home');
      expect(addresses.updatedPayload?['delivery_instructions'], 'Leave at the gate');
      expect(addresses.updatedPayload?['is_default'], true);
    });

    testWidgets('a non-default edit stays non-default even with no other addresses',
        (tester) async {
      final notDefault = AddressModel.fromJson({
        ..._existing.toCreatePayload(),
        'id': _existing.id,
        'is_default': false,
      });
      await pumpScreen(tester, existing: notDefault);

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.updatedPayload?['is_default'], false);
    });
  });

  group('behaviour', () {
    testWidgets('blocks saving until the required fields are filled',
        (tester) async {
      await pumpScreen(tester);

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(find.text('Enter a valid recipient name'), findsOneWidget);
      expect(find.text('Enter a valid Sri Lankan mobile number'), findsOneWidget);
      expect(find.text('Enter your street address'), findsOneWidget);
      expect(addresses.created, isNull);
    });

    testWidgets('optional fields stay optional and are sent as null',
        (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created, isNotNull);
      expect(addresses.created!.addressLine2, isNull);
      expect(addresses.created!.postalCode, isNull);
      expect(addresses.created!.deliveryInstructions, isNull);
      expect(addresses.created!.city, 'Dharga Town');
      // The location the customer shared (required for a new address).
      expect(addresses.created!.latitude, 6.5);
      expect(addresses.created!.longitude, 80.1);
    });

    testWidgets('a failed save keeps the form open', (tester) async {
      addresses.shouldFail = true;
      await pumpScreen(tester);
      await fillRequired(tester);

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(find.byType(AddEditAddressScreen), findsOneWidget);
      expect(find.text('No. 12, Test Lane'), findsOneWidget);
    });

    testWidgets('Cancel leaves without saving', (tester) async {
      await tester.pumpWidget(
        ChangeNotifierProvider<AddressProvider>.value(
          value: addresses,
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const AddEditAddressScreen(),
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await settle(tester);
      expect(find.byType(AddEditAddressScreen), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      await settle(tester);

      expect(find.byType(AddEditAddressScreen), findsNothing);
      expect(addresses.created, isNull);
    });
  });

  group('additional phone (migration 024)', () {
    testWidgets('sits under Phone number, optional, with its hint',
        (tester) async {
      await pumpScreen(tester);

      final alt = fieldWith('Another phone number (optional)');
      expect(alt, findsOneWidget);
      expect(find.text('Family or neighbour'), findsOneWidget);
      expect(
        tester.getTopLeft(alt).dy,
        greaterThan(tester.getTopLeft(fieldWith('Phone number')).dy),
      );
    });

    testWidgets('left empty, it is sent as null', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created, isNotNull);
      expect(addresses.created!.alternatePhone, isNull);
      final payload = addresses.created!.toCreatePayload();
      expect(payload.containsKey('alternate_phone'), isTrue);
      expect(payload['alternate_phone'], isNull);
    });

    testWidgets('a real number is normalized to E.164', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.enterText(fieldWith('Another phone number (optional)'), '071 234 5678');

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created?.alternatePhone, '+94712345678');
    });

    testWidgets('refuses letters while typing, like the phone number',
        (tester) async {
      await pumpScreen(tester);

      await tester.enterText(fieldWith('Another phone number (optional)'), 'abc071x234');
      await tester.pump();

      expect(textOf(tester, 'Another phone number (optional)'), '071234');
    });

    testWidgets('an invalid number blocks saving', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.enterText(fieldWith('Another phone number (optional)'), '12345');

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(find.text('Enter a valid Sri Lankan mobile number'), findsOneWidget);
      expect(addresses.created, isNull);
    });

    testWidgets('the phone number again (any format) blocks saving',
        (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.enterText(fieldWith('Another phone number (optional)'), '+94 77 123 4567');

      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(find.text('Use a different number from the recipient phone'), findsOneWidget);
      expect(addresses.created, isNull);
    });

    testWidgets('an edit prefills it, and clearing it sends null',
        (tester) async {
      final withAlt = AddressModel.fromJson({
        ..._existing.toCreatePayload(),
        'id': _existing.id,
        'alternate_phone': '+94712345678',
      });
      await pumpScreen(tester, existing: withAlt);

      expect(find.text('+94712345678'), findsOneWidget);
      await tester.enterText(fieldWith('Another phone number (optional)'), '');
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.updatedId, _existing.id);
      expect(addresses.updatedPayload!.containsKey('alternate_phone'), isTrue);
      expect(addresses.updatedPayload!['alternate_phone'], isNull);
    });
  });

  group('validation (reported bug)', () {
    testWidgets('rejects "bbA Tester" in the phone field', (tester) async {
      await pumpScreen(tester);

      await tester.enterText(fieldWith('Name'), 'bbA Tester');
      await tester.enterText(fieldWith('Phone number'), 'bbA Tester');
      await tester.enterText(fieldWith('Address'), 'No. 12, Test Lane');
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(find.text('Enter a valid Sri Lankan mobile number'), findsOneWidget);
      expect(addresses.created, isNull, reason: 'nothing may reach the API');
      // The same string is a perfectly good name, and is not flagged.
      expect(find.text('Enter a valid recipient name'), findsNothing);
    });

    testWidgets('accepts a real number and normalizes it to E.164',
        (tester) async {
      await pumpScreen(tester);

      await tester.enterText(fieldWith('Name'), '  Mohammed   Jaasir ');
      await tester.enterText(fieldWith('Phone number'), '077 123 4567');
      await tester.enterText(fieldWith('Address'), 'No. 12,  Test Lane');
      await shareLocation(tester);
      await tester.tap(find.text('Save address'));
      await settle(tester);

      expect(addresses.created, isNotNull);
      expect(addresses.created!.recipientPhone, '+94771234567');
      // Whitespace is normalized on the way to the API.
      expect(addresses.created!.recipientName, 'Mohammed Jaasir');
      expect(addresses.created!.addressLine1, 'No. 12, Test Lane');
    });

    testWidgets('the phone field refuses letters while typing',
        (tester) async {
      await pumpScreen(tester);

      await tester.enterText(fieldWith('Phone number'), 'abc077x123');
      await tester.pump();

      expect(textOf(tester, 'Phone number'), '077123');
    });

    testWidgets('an old address keeps its second line, city and postal code',
        (tester) async {
      final legacy = AddressModel.fromJson(const {
        'id': 'a0000001-0000-0000-0000-000000000002',
        'label': 'Home',
        'recipient_name': 'QA Tester',
        'recipient_phone': '+94771234567',
        'address_line1': 'No. 5, Main Street',
        'address_line2': 'Near the mosque',
        'city': 'Dharga Town',
        'postal_code': '12090',
        'latitude': 6.4382,
        'longitude': 80.0274,
        'delivery_instructions': null,
        'is_default': false,
      });
      await pumpScreen(tester, existing: legacy);
      // Both lines are folded into the one Address box.
      expect(find.text('No. 5, Main Street, Near the mosque'), findsOneWidget);
      await tester.tap(find.text('Save address'));
      await settle(tester);
      expect(addresses.updatedPayload?['address_line1'], 'No. 5, Main Street, Near the mosque');
      expect(addresses.updatedPayload?['address_line2'], isNull);
      expect(addresses.updatedPayload?['city'], 'Dharga Town');
      expect(addresses.updatedPayload?['postal_code'], '12090');
    });
  });

  group('premium form presentation (W7)', () {
    testWidgets('a validation message is presented by the shared field, not Material decoration',
        (tester) async {
      await pumpScreen(tester);
      await tester.tap(find.text('Save address'));
      await settle(tester);

      final phone = tester.widget<BlynkTextField>(fieldWith('Phone number'));
      expect(phone.errorText, 'Enter a valid Sri Lankan mobile number');

      // The component's own error treatment: a 2 dp problem border and the
      // inline glyph, one per failing field. No rule was relaxed - all three
      // required fields still fail.
      final field = tester.widget<TextField>(
        find.descendant(of: fieldWith('Phone number'), matching: find.byType(TextField)),
      );
      final border = field.decoration!.enabledBorder! as OutlineInputBorder;
      expect(border.borderSide.color, BlynkColors.problem);
      expect(border.borderSide.width, 2);
      expect(find.byIcon(BlynkIcons.error), findsNWidgets(3));
    });

    // The pinned bar holds a BlynkButton.cta, whose inner Container carries an
    // alignment and therefore EXPANDS to fill any bounded height it is given.
    // In a bottomNavigationBar slot that would eat the whole screen and leave
    // the form at zero height - and no finder would notice, because a
    // zero-high body still builds. Only a measurement catches it.
    testWidgets('the pinned action bar is a bar, not the whole page', (tester) async {
      await pumpScreen(tester, size: const Size(400, 900));

      final save = tester.getSize(find.widgetWithText(BlynkButton, 'Save address'));
      expect(save.height, lessThan(120), reason: 'the CTA has swallowed the height budget');
      expect(tester.getSize(find.byType(ListView)).height, greaterThan(600),
          reason: 'the form body must keep the rest of the screen');
    });

    testWidgets('exactly one yellow ACTION on the screen, and it is Save address', (tester) async {
      await pumpScreen(tester);

      final yellowAction = find.descendant(
        of: find.byType(BlynkButton),
        matching: find.byWidgetPredicate(
          (w) => w is Container && w.decoration is BoxDecoration && (w.decoration! as BoxDecoration).color == BlynkCta.fill,
        ),
      );
      expect(yellowAction, findsOneWidget);
      expect(
        find.ancestor(of: yellowAction, matching: find.widgetWithText(BlynkButton, 'Save address')),
        findsOneWidget,
      );
    });
  });

  group('layout', () {
    for (final size in const [
      Size(320, 640),
      Size(375, 812),
      Size(414, 896),
      Size(768, 1024),
      Size(1440, 900),
    ]) {
      testWidgets('no overflow at ${size.width}x${size.height}',
          (tester) async {
        await pumpScreen(tester, size: size);
        await settle(tester);

        expect(tester.takeException(), isNull);
        // The action bar stays pinned and visible at every size.
        expect(find.text('Save address'), findsOneWidget);
        final bar = tester.getRect(find.text('Save address'));
        expect(bar.bottom, lessThanOrEqualTo(size.height));
      });
    }

    testWidgets('the form is centred and capped on desktop', (tester) async {
      await pumpScreen(tester, size: const Size(1440, 900));
      await settle(tester);

      final form = tester.getRect(find.byType(Form));
      expect(form.width, lessThanOrEqualTo(560));
      expect((form.center.dx - 720).abs(), lessThan(1));
    });
  });
}
