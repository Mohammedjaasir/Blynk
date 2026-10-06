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

  group('SMS preferences (GET/PATCH /me)', () {
    Map<String, dynamic> profile(Map<String, dynamic> extra) => {
          'id': 'u1',
          'phone': '+94771234567',
          'role': 'CUSTOMER',
          ...extra,
        };

    test('a language never picked (null) parses as no selection', () {
      final user = UserModel.fromJson(profile({'sms_language': null, 'sms_offers': true}));
      expect(user.smsLanguage, isNull);
      expect(user.smsOffers, isTrue);
    });

    test('each wire language parses to its choice', () {
      expect(UserModel.fromJson(profile({'sms_language': 'si'})).smsLanguage, SmsLanguage.sinhala);
      expect(UserModel.fromJson(profile({'sms_language': 'ta'})).smsLanguage, SmsLanguage.tamil);
      expect(UserModel.fromJson(profile({'sms_language': 'en'})).smsLanguage, SmsLanguage.english);
      // A value this app does not know is treated as not picked.
      expect(UserModel.fromJson(profile({'sms_language': 'fr'})).smsLanguage, isNull);
    });

    test('sms_offers false is an opt-out; true or missing means receiving offers', () {
      expect(UserModel.fromJson(profile({'sms_offers': false})).smsOffers, isFalse);
      expect(UserModel.fromJson(profile({'sms_offers': true})).smsOffers, isTrue);
      expect(UserModel.fromJson(profile({})).smsOffers, isTrue);
    });

    test('the labels show each language in its own script with English', () {
      expect(SmsLanguage.values.map((l) => l.label), [
        'සිංහල (Sinhala)',
        'தமிழ் (Tamil)',
        'English',
      ]);
    });

    test('round-trips through the saved-session JSON', () {
      final user = UserModel.fromJson(profile({'sms_language': 'ta', 'sms_offers': false}));
      final restored = UserModel.fromJsonString(user.toJsonString());
      expect(restored.smsLanguage, SmsLanguage.tamil);
      expect(restored.smsOffers, isFalse);
    });
  });
}
