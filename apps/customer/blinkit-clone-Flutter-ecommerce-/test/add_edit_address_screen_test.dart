import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Screens/add_edit_address_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/app_colors.dart';
import 'package:ecom/app_theme.dart';

/// Records what the screen asks the provider to do without touching the
/// network - the real AddressProvider's API calls are exercised by the live
/// integration flow instead.
class _RecordingAddressProvider extends AddressProvider {
  AddressModel? created;
  String? updatedId;
  Map<String, dynamic>? updatedPayload;
  bool shouldFail = false;

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
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ChangeNotifierProvider<AddressProvider>.value(
        value: addresses,
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: AddEditAddressScreen(existing: existing),
        ),
      ),
    );
    await tester.pump();
  }

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  // The form is taller than a phone viewport, so anything below the fold
  // needs scrolling into existence before it can be asserted on.
  Future<void> scrollToBottom(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, -260));
      await tester.pump();
    }
  }

  Finder fieldWith(String label) =>
      find.widgetWithText(TextFormField, label);

  Future<void> fillRequired(WidgetTester tester) async {
    await tester.enterText(fieldWith('Recipient name'), 'QA Tester');
    await tester.enterText(fieldWith('Recipient phone'), '0771234567');
    await tester.enterText(fieldWith('Address line 1'), 'No. 12, Test Lane');
    await tester.pump();
  }

  group('structure', () {
    testWidgets('groups the form into labelled sections', (tester) async {
      await pumpScreen(tester);

      expect(find.text('Add Address'), findsOneWidget);
      expect(find.text('Save address as'), findsOneWidget);
      expect(find.text('CONTACT'), findsOneWidget);
      expect(find.text('DELIVERY ADDRESS'), findsOneWidget);

      await scrollToBottom(tester);
      expect(find.text('LOCATION'), findsOneWidget);
      expect(find.text('DELIVERY NOTES'), findsOneWidget);
      expect(find.text('Save Address'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
    });

    testWidgets('explains the coordinates without implying a map',
        (tester) async {
      await pumpScreen(tester);
      await scrollToBottom(tester);

      expect(find.text('Delivery location'), findsOneWidget);
      expect(
        find.text(
          'Your delivery location helps us confirm service availability.',
        ),
        findsOneWidget,
      );
      // The old developer-facing note is gone, and no map is faked.
      expect(find.textContaining('No map picker'), findsNothing);
      expect(find.textContaining('map'), findsNothing);
      // The real hub coordinates are still the defaults.
      expect(find.text('6.4382'), findsOneWidget);
      expect(find.text('80.0274'), findsOneWidget);
    });

    testWidgets('default-address setting reads as a setting, not a form row',
        (tester) async {
      await pumpScreen(tester);
      await scrollToBottom(tester);

      expect(find.text('Default delivery address'), findsOneWidget);
      expect(
        find.text('Use this address automatically at checkout'),
        findsOneWidget,
      );
      final toggle = tester.widget<Switch>(find.byType(Switch));
      expect(toggle.value, isFalse);
      expect(toggle.activeTrackColor, AppColors.primaryYellowColor);
    });
  });

  group('address name picker', () {
    testWidgets('defaults to Home and saves it as the label', (tester) async {
      await pumpScreen(tester);
      // No free-text name field while a preset is chosen.
      expect(fieldWith('Address name'), findsNothing);

      await fillRequired(tester);
      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(addresses.created?.label, 'Home');
    });

    testWidgets('Work preset writes into the same backend field',
        (tester) async {
      await pumpScreen(tester);

      await tester.tap(find.text('Work'));
      await tester.pump();
      await fillRequired(tester);
      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(addresses.created?.label, 'Work');
    });

    testWidgets('Other reveals a custom name and requires it', (tester) async {
      await pumpScreen(tester);

      await tester.tap(find.text('Other'));
      await tester.pump();
      expect(fieldWith('Address name'), findsOneWidget);

      await fillRequired(tester);
      await tester.tap(find.text('Save Address'));
      await settle(tester);
      expect(find.text('Enter a valid address name'), findsOneWidget);
      expect(addresses.created, isNull);

      await tester.enterText(fieldWith('Address name'), 'Parents');
      await tester.tap(find.text('Save Address'));
      await settle(tester);
      expect(addresses.created?.label, 'Parents');
    });
  });

  group('editing', () {
    testWidgets('prefills every real field and preselects the preset',
        (tester) async {
      await pumpScreen(tester, existing: _existing);

      expect(find.text('Edit Address'), findsOneWidget);
      expect(find.text('QA Tester'), findsOneWidget);
      expect(find.text('+94771234567'), findsOneWidget);
      expect(find.text('No. 12, Test Lane'), findsOneWidget);
      expect(find.text('Dharga Town'), findsOneWidget);
      await scrollToBottom(tester);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);
      // 'Work' matched a preset, so no custom name field is shown.
      expect(fieldWith('Address name'), findsNothing);
    });

    testWidgets('a custom label reopens under Other', (tester) async {
      final custom = AddressModel.fromJson({
        ..._existing.toCreatePayload(),
        'id': _existing.id,
        'label': 'Integration Test Home',
      });
      await pumpScreen(tester, existing: custom);

      expect(fieldWith('Address name'), findsOneWidget);
      expect(find.text('Integration Test Home'), findsOneWidget);
    });

    testWidgets('saving an edit sends the existing id and payload',
        (tester) async {
      await pumpScreen(tester, existing: _existing);

      await tester.enterText(fieldWith('Address line 1'), 'No. 99, New Lane');
      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(addresses.updatedId, _existing.id);
      expect(addresses.updatedPayload?['address_line1'], 'No. 99, New Lane');
      expect(addresses.updatedPayload?['label'], 'Work');
      expect(addresses.updatedPayload?['is_default'], true);
      expect(addresses.updatedPayload?['latitude'], 6.4382);
    });
  });

  group('behaviour', () {
    testWidgets('blocks saving until the required fields are filled',
        (tester) async {
      await pumpScreen(tester);

      await tester.tap(find.text('Save Address'));
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

      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(addresses.created, isNotNull);
      expect(addresses.created!.addressLine2, isNull);
      expect(addresses.created!.postalCode, isNull);
      expect(addresses.created!.deliveryInstructions, isNull);
      expect(addresses.created!.city, 'Dharga Town');
    });

    testWidgets('the default toggle is carried through', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await scrollToBottom(tester);

      await tester.tap(find.byType(Switch));
      await tester.pump();
      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(addresses.created?.isDefault, isTrue);
    });

    testWidgets('a failed save keeps the form open', (tester) async {
      addresses.shouldFail = true;
      await pumpScreen(tester);
      await fillRequired(tester);

      await tester.tap(find.text('Save Address'));
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

  group('validation (reported bug)', () {
    testWidgets('rejects "bbA Tester" in the phone field', (tester) async {
      await pumpScreen(tester);

      await tester.enterText(fieldWith('Recipient name'), 'bbA Tester');
      await tester.enterText(fieldWith('Recipient phone'), 'bbA Tester');
      await tester.enterText(fieldWith('Address line 1'), 'No. 12, Test Lane');
      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(find.text('Enter a valid Sri Lankan mobile number'), findsOneWidget);
      expect(addresses.created, isNull, reason: 'nothing may reach the API');
      // The same string is a perfectly good name, and is not flagged.
      expect(find.text('Enter a valid recipient name'), findsNothing);
    });

    testWidgets('accepts a real number and normalizes it to E.164',
        (tester) async {
      await pumpScreen(tester);

      await tester.enterText(fieldWith('Recipient name'), '  Mohammed   Jaasir ');
      await tester.enterText(fieldWith('Recipient phone'), '077 123 4567');
      await tester.enterText(fieldWith('Address line 1'), 'No. 12,  Test Lane');
      await tester.tap(find.text('Save Address'));
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

      await tester.enterText(fieldWith('Recipient phone'), 'abc077x123');
      await tester.pump();

      final field = tester.widget<TextField>(
        find.descendant(
          of: fieldWith('Recipient phone'),
          matching: find.byType(TextField),
        ),
      );
      expect(field.controller!.text, '077123');
    });

    testWidgets('out-of-range coordinates are rejected', (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await scrollToBottom(tester);
      await tester.enterText(fieldWith('Latitude'), '91');
      await tester.tap(find.text('Save Address'));
      await settle(tester);

      expect(find.text('Enter a valid latitude'), findsOneWidget);
      expect(addresses.created, isNull);
    });

    testWidgets('a bad postal code is rejected, empty is fine',
        (tester) async {
      await pumpScreen(tester);
      await fillRequired(tester);
      await tester.enterText(fieldWith('Postal code'), '123');
      await tester.tap(find.text('Save Address'));
      await settle(tester);
      expect(find.text('Enter a valid 5-digit postal code'), findsOneWidget);

      await tester.enterText(fieldWith('Postal code'), '12500');
      await tester.tap(find.text('Save Address'));
      await settle(tester);
      expect(addresses.created?.postalCode, '12500');
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
        expect(find.text('Save Address'), findsOneWidget);
        final bar = tester.getRect(find.text('Save Address'));
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
