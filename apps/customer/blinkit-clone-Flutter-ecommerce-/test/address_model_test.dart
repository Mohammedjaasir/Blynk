import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/address_model.dart';

void main() {
  group('AddressModel', () {
    test('Parses a backend address response (matches customer_addresses schema)', () {
      final json = {
        "id": "a0000001-0000-0000-0000-000000000001",
        "label": "Home",
        "recipient_name": "Jane Silva",
        "recipient_phone": "+94771234567",
        "address_line1": "12 Galle Road",
        "address_line2": null,
        "city": "Dharga Town",
        "postal_code": "12345",
        "latitude": 6.4382,
        "longitude": 80.0274,
        "delivery_instructions": "Ring the bell twice",
        "is_default": true,
      };

      final address = AddressModel.fromJson(json);

      expect(address.recipientName, equals("Jane Silva"));
      expect(address.city, equals("Dharga Town"));
      expect(address.latitude, closeTo(6.4382, 0.0001));
      expect(address.isDefault, isTrue);
      expect(address.displaySummary, equals("12 Galle Road, Dharga Town"));
    });

    test('toCreatePayload sends the exact field names the backend schema requires', () {
      const address = AddressModel(
        id: '',
        label: 'Home',
        recipientName: 'Jane Silva',
        recipientPhone: '+94771234567',
        addressLine1: '12 Galle Road',
        city: 'Dharga Town',
        latitude: 6.4382,
        longitude: 80.0274,
      );

      final payload = address.toCreatePayload();

      // Field names must exactly match createAddressSchema in
      // backend/api/src/modules/users/address.schema.ts.
      expect(payload.keys, containsAll([
        'label',
        'recipient_name',
        'recipient_phone',
        'address_line1',
        'address_line2',
        'city',
        'postal_code',
        'latitude',
        'longitude',
        'delivery_instructions',
        'is_default',
      ]));
      expect(payload['latitude'], isA<double>());
      expect(payload['longitude'], isA<double>());
    });
  });
}
