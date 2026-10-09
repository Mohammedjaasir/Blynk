import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Services/Providers/address.provider.dart';

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
}
