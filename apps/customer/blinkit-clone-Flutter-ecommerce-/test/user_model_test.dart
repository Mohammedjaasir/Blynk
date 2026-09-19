import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/user_model.dart';

void main() {
  group('UserModel Serialization Tests', () {
    test('Correctly deserializes user JSON from backend', () {
      final json = {
        'id': 'a0000001-0000-0000-0000-000000000001',
        'phone': '+94771234567',
        'email': 'customer@blynk.lk',
        'full_name': 'Ahmed Rizvi',
        'role': 'CUSTOMER',
        'is_active': true,
        'created_at': '2026-09-01T00:00:00Z',
      };

      final user = UserModel.fromJson(json);

      expect(user.id, equals('a0000001-0000-0000-0000-000000000001'));
      expect(user.phone, equals('+94771234567'));
      expect(user.email, equals('customer@blynk.lk'));
      expect(user.fullName, equals('Ahmed Rizvi'));
      expect(user.role, equals('CUSTOMER'));
      expect(user.isActive, isTrue);
      expect(user.createdAt, equals('2026-09-01T00:00:00Z'));
    });

    test('Correctly serializes and deserializes UserModel to/from string', () {
      final user = UserModel(
        id: 'u-123',
        phone: '+94771234567',
        fullName: 'Test User',
        role: 'CUSTOMER',
      );

      final jsonStr = user.toJsonString();
      final restored = UserModel.fromJsonString(jsonStr);

      expect(restored.id, equals(user.id));
      expect(restored.phone, equals(user.phone));
      expect(restored.fullName, equals(user.fullName));
      expect(restored.role, equals(user.role));
      expect(restored.isActive, isTrue);
    });
  });
}
