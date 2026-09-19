import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/constants.dart';

void main() {
  group('Sri Lankan Phone Validation Tests', () {
    test('Validates 10-digit Sri Lankan phone numbers with leading 0', () {
      expect(isValidSriLankanPhone('0771234567'), isTrue);
      expect(isValidSriLankanPhone('0712345678'), isTrue);
      expect(isValidSriLankanPhone('0781234567'), isTrue);
      expect(isValidSriLankanPhone('0701234567'), isTrue);
      expect(isValidSriLankanPhone('0721234567'), isTrue);
      expect(isValidSriLankanPhone('0741234567'), isTrue);
      expect(isValidSriLankanPhone('0751234567'), isTrue);
      expect(isValidSriLankanPhone('0761234567'), isTrue);
      expect(isValidSriLankanPhone('0762227777'), isTrue);
    });

    test('Validates 11-digit Sri Lankan phone numbers starting with 94', () {
      expect(isValidSriLankanPhone('94771234567'), isTrue);
      expect(isValidSriLankanPhone('94762227777'), isTrue);
    });

    test('Validates phone numbers with spaces (e.g. 76 222 7777 or 076 222 7777)', () {
      expect(isValidSriLankanPhone('76 222 7777'), isTrue);
      expect(isValidSriLankanPhone('076 222 7777'), isTrue);
      expect(isValidSriLankanPhone('+94 76 222 7777'), isTrue);
      expect(isValidSriLankanPhone('94 76 222 7777'), isTrue);
    });

    test('Validates Sri Lankan phone numbers with +94 international prefix', () {
      expect(isValidSriLankanPhone('+94771234567'), isTrue);
      expect(isValidSriLankanPhone('+94712345678'), isTrue);
      expect(isValidSriLankanPhone('+94781234567'), isTrue);
    });

    test('Validates 9-digit local numbers starting with 7', () {
      expect(isValidSriLankanPhone('771234567'), isTrue);
      expect(isValidSriLankanPhone('712345678'), isTrue);
      expect(isValidSriLankanPhone('762227777'), isTrue);
    });

    test('Rejects invalid phone numbers', () {
      expect(isValidSriLankanPhone(''), isFalse);
      expect(isValidSriLankanPhone(null), isFalse);
      expect(isValidSriLankanPhone('0112345678'), isFalse); // Landline
      expect(isValidSriLankanPhone('07712345'), isFalse); // Too short
      expect(isValidSriLankanPhone('0771234567899'), isFalse); // Too long
      expect(isValidSriLankanPhone('+919876543210'), isFalse); // Indian number
      expect(isValidSriLankanPhone('077abcdefg'), isFalse); // Alphabetic
    });

    test('Formats Sri Lankan numbers to E.164 (+947XXXXXXXX)', () {
      expect(formatToE164('0771234567'), equals('+94771234567'));
      expect(formatToE164('+94771234567'), equals('+94771234567'));
      expect(formatToE164('771234567'), equals('+94771234567'));
      expect(formatToE164('94771234567'), equals('+94771234567'));
      expect(formatToE164('94762227777'), equals('+94762227777'));
      expect(formatToE164('76 222 7777'), equals('+94762227777'));
      expect(formatToE164('076 222 7777'), equals('+94762227777'));
      expect(formatToE164('+94 76 222 7777'), equals('+94762227777'));
    });
  });
}
