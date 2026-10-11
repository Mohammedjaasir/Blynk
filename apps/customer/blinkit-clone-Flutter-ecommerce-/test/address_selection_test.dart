import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Screens/user_address_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/app_theme.dart';

/// Owner, 2026-10-10: a newly added address must be the selected one, not
/// the first address saved earlier.
Map<String, dynamic> _row(String id, {bool isDefault = false}) => {
      'id': id,
      'label': 'Home',
      'recipient_name': 'Nimal',
      'recipient_phone': '+94771234567',
      'address_line1': 'Line $id',
      'city': 'Dharga Town',
      'latitude': 6.4382,
      'longitude': 80.0274,
      'is_default': isDefault,
    };

void main() {
  test('adding a new default address selects it and unmarks the old one', () async {
    final provider = AddressProvider(request: ({methodType, url, body}) async {
      if (methodType == 'GET') {
        return {'success': true, 'data': {'addresses': [_row('a', isDefault: true)]}};
      }
      return {'success': true, 'data': {'address': _row('b', isDefault: true)}};
    });
    await provider.loadAddresses();
    expect(provider.defaultAddress?.id, 'a');

    await provider.createAddress(AddressModel.fromJson(_row('b', isDefault: true)));

    expect(provider.defaultAddress?.id, 'b');
    expect(provider.addresses.where((x) => x.isDefault).map((x) => x.id), ['b']);
  });

  test('editing an address into the default moves the selection to it', () async {
    final provider = AddressProvider(request: ({methodType, url, body}) async {
      if (methodType == 'GET') {
        return {'success': true, 'data': {'addresses': [_row('a', isDefault: true), _row('b')]}};
      }
      return {'success': true, 'data': {'address': _row('b', isDefault: true)}};
    });
    await provider.loadAddresses();
    await provider.updateAddress('b', {'is_default': true});
    expect(provider.defaultAddress?.id, 'b');
    expect(provider.addresses.where((x) => x.isDefault).length, 1);
  });

  // Owner, 2026-10-11: "choose the address by click, instead of making it
  // default".
  group('choosing the delivery address', () {
    AddressProvider twoAddresses({List<String>? calls}) =>
        AddressProvider(request: ({methodType, url, body}) async {
          calls?.add('$methodType $url');
          return {
            'success': true,
            'data': {
              'addresses': [_row('a', isDefault: true), _row('b')],
            },
          };
        });

    test('checkout delivers to the default until another is chosen', () async {
      final provider = twoAddresses();
      await provider.loadAddresses();
      expect(provider.selectedAddress?.id, 'a');
      expect(provider.isSelected('a'), isTrue);
    });

    test('choosing an address does not make it the default or call the API', () async {
      final calls = <String>[];
      final provider = twoAddresses(calls: calls);
      await provider.loadAddresses();
      calls.clear();

      provider.selectAddress('b');

      expect(provider.selectedAddress?.id, 'b');
      expect(provider.defaultAddress?.id, 'a');
      expect(provider.addresses.firstWhere((x) => x.id == 'a').isDefault, isTrue);
      expect(calls, isEmpty);
    });

    test('deleting the chosen address falls back to the default; logout forgets it', () async {
      final provider = twoAddresses();
      await provider.loadAddresses();
      provider.selectAddress('b');
      await provider.deleteAddress('b');
      expect(provider.selectedAddress?.id, 'a');

      provider.selectAddress('a');
      provider.clear();
      expect(provider.selectedAddress, isNull);
    });

    test('a newly added address is the one chosen, default or not', () async {
      final provider = AddressProvider(request: ({methodType, url, body}) async {
        if (methodType == 'GET') {
          return {
            'success': true,
            'data': {'addresses': [_row('a', isDefault: true)]},
          };
        }
        return {'success': true, 'data': {'address': _row('c')}};
      });
      await provider.loadAddresses();
      await provider.createAddress(AddressModel.fromJson(_row('c')));
      expect(provider.selectedAddress?.id, 'c');
      expect(provider.defaultAddress?.id, 'a');
    });

    Future<AddressProvider> openFromCheckout(WidgetTester tester) async {
      tester.view.physicalSize = const Size(400, 860);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final provider = twoAddresses();
      await tester.pumpWidget(
        ChangeNotifierProvider<AddressProvider>.value(
          value: provider,
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const UserAddressScreen(pickMode: true),
                      ),
                    ),
                    child: const Text('Checkout'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Checkout'));
      await tester.pumpAndSettle();
      return provider;
    }

    testWidgets('from checkout, tapping a card chooses it and goes back', (tester) async {
      final provider = await openFromCheckout(tester);
      expect(find.text('Choose delivery address'), findsOneWidget);
      // The default is the one in use until another is tapped.
      expect(find.text('Delivering here'), findsOneWidget);
      expect(find.text('Default'), findsOneWidget);

      await tester.tap(find.text('Line b'));
      await tester.pumpAndSettle();

      expect(provider.selectedAddress?.id, 'b');
      expect(provider.defaultAddress?.id, 'a', reason: 'choosing never changes the default');
      expect(find.text('Checkout'), findsOneWidget, reason: 'back on checkout');
    });

    testWidgets('from Profile, tapping a card marks it and stays', (tester) async {
      tester.view.physicalSize = const Size(400, 860);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final provider = twoAddresses();
      await tester.pumpWidget(
        ChangeNotifierProvider<AddressProvider>.value(
          value: provider,
          child: MaterialApp(theme: AppTheme.appTHeme, home: const UserAddressScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('My Addresses'), findsOneWidget);

      await tester.tap(find.text('Line b'));
      await tester.pumpAndSettle();

      expect(provider.selectedAddress?.id, 'b');
      expect(find.text('My Addresses'), findsOneWidget);
      // b carries "Delivering here"; a keeps "Default" and its card still
      // offers nothing to set (it is the default), b still offers Set default.
      expect(find.text('Delivering here'), findsOneWidget);
      expect(find.text('Default'), findsOneWidget);
      expect(find.text('Set default'), findsOneWidget);
      final b = find.byKey(const ValueKey('address-card-b'));
      expect(find.descendant(of: b, matching: find.text('Delivering here')), findsOneWidget);
    });
  });
}
