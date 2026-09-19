import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/Validation/app_validators.dart';

void main() {
  group('the reported bug', () {
    test('"bbA Tester" is rejected as a phone number', () {
      expect(AppValidators.phone('bbA Tester'),
          'Enter a valid Sri Lankan mobile number');
      expect(AppValidators.isValidPhone('bbA Tester'), isFalse);
      expect(AppValidators.normalizePhone('bbA Tester'), isNull);
    });

    test('"bbA Tester" is still a perfectly good recipient name', () {
      expect(AppValidators.recipientName('bbA Tester'), isNull);
    });

    test('a real Sri Lankan mobile is accepted', () {
      expect(AppValidators.phone('0771234567'), isNull);
      expect(AppValidators.phone('+94 76 222 7777'), isNull);
    });
  });

  group('phone', () {
    test('normalizes every accepted spelling to E.164', () {
      for (final input in [
        '0771234567',
        '771234567',
        '94771234567',
        '+94771234567',
        ' 077 123 4567 ',
        '077-123-4567',
        '(077) 123 4567',
      ]) {
        expect(AppValidators.normalizePhone(input), '+94771234567',
            reason: input);
      }
    });

    test('accepts exactly the operator prefixes the backend accepts', () {
      for (final prefix in ['70', '71', '72', '74', '75', '76', '77', '78']) {
        expect(AppValidators.isValidPhone('0${prefix}1234567'), isTrue,
            reason: prefix);
      }
      // 73 and 79 are not issued; the backend rejects them, so the app must.
      for (final prefix in ['73', '79']) {
        expect(AppValidators.isValidPhone('0${prefix}1234567'), isFalse,
            reason: prefix);
      }
    });

    test('rejects the usual bad input', () {
      for (final input in [
        '',
        '   ',
        '123',
        'abcdefghij',
        '07123abc45',
        '0112345678', // landline
        '07712345', // too short
        '0771234567899', // too long
        '+919876543210', // not Sri Lankan
      ]) {
        expect(AppValidators.isValidPhone(input), isFalse, reason: '"$input"');
      }
      expect(AppValidators.isValidPhone(null), isFalse);
    });
  });

  group('normalization', () {
    test('trims and collapses whitespace', () {
      expect(AppValidators.normalizeText('  Mohammed   Jaasir  '),
          'Mohammed Jaasir');
      expect(AppValidators.normalizeText(null), '');
      expect(AppValidators.normalizeText('   '), '');
    });

    test('optional values become null, not empty strings', () {
      expect(AppValidators.optionalText('  '), isNull);
      expect(AppValidators.optionalText(''), isNull);
      expect(AppValidators.optionalText(' Floor 2 '), 'Floor 2');
    });

    test('search is normalized and capped at the backend limit', () {
      expect(AppValidators.normalizeSearch('  fresh   milk '), 'fresh milk');
      expect(AppValidators.normalizeSearch('rice 5kg'), 'rice 5kg');
      expect(AppValidators.normalizeSearch('a' * 500).length,
          AppValidators.searchMax);
      expect(AppValidators.isSearchable('   '), isFalse);
      expect(AppValidators.isSearchable('milk'), isTrue);
    });
  });

  group('recipient name', () {
    test('accepts real names', () {
      for (final name in [
        'Mohammed Jaasir',
        "O'Brien",
        'Anne-Marie',
        'Rajendra Bray',
      ]) {
        expect(AppValidators.recipientName(name), isNull, reason: name);
      }
      // Normalized before length checks.
      expect(AppValidators.recipientName('  Mohammed   Jaasir  '), isNull);
    });

    test('rejects digits, symbols, empties and overlong values', () {
      for (final name in ['', '   ', 'A', '12345', 'J@asir', '@@@', 'Jaasir 3']) {
        expect(AppValidators.recipientName(name),
            'Enter a valid recipient name',
            reason: '"$name"');
      }
      expect(AppValidators.recipientName('a' * 81), isNotNull);
      expect(AppValidators.recipientName('a' * 80), isNull);
    });
  });

  group('address name', () {
    test('accepts the presets and reasonable custom names', () {
      for (final name in [
        'Home',
        'Work',
        'Office',
        'Parents House',
        'Flat 2B',
        'Home (New)',
      ]) {
        expect(AppValidators.addressName(name), isNull, reason: name);
      }
    });

    test('rejects blank, too short, too long and symbol-only', () {
      for (final name in ['', '   ', 'H', '###', 'a' * 31]) {
        expect(AppValidators.addressName(name), 'Enter a valid address name',
            reason: '"$name"');
      }
    });
  });

  group('address lines and city', () {
    test('line 1 accepts real street addresses', () {
      for (final line in [
        'No. 12, Test Lane',
        '123 Main Street',
        '45/2 Galle Road',
        '#7 Hill View',
      ]) {
        expect(AppValidators.addressLine1(line), isNull, reason: line);
      }
    });

    test('line 1 rejects blank, too short and overlong', () {
      for (final line in ['', '   ', 'No', 'a' * 151]) {
        expect(AppValidators.addressLine1(line), 'Enter your street address',
            reason: '"$line"');
      }
    });

    test('line 2 is optional but still bounded', () {
      expect(AppValidators.addressLine2(''), isNull);
      expect(AppValidators.addressLine2('   '), isNull);
      expect(AppValidators.addressLine2('Apartment 4B'), isNull);
      expect(AppValidators.addressLine2('Near Central Mosque'), isNull);
      expect(AppValidators.addressLine2('a' * 151), isNotNull);
    });

    test('city rejects numbers and empties, accepts real names', () {
      expect(AppValidators.city('Dharga Town'), isNull);
      expect(AppValidators.city('Colombo'), isNull);
      // Real Sri Lankan spelling - digits are fine, numeric-only is not.
      expect(AppValidators.city('Colombo 7'), isNull);
      for (final city in ['', '  ', 'C', '12345', '7', 'a' * 65]) {
        expect(AppValidators.city(city), 'Enter a valid city',
            reason: '"$city"');
      }
    });
  });

  group('postal code', () {
    test('empty is fine, five digits is fine, anything else is not', () {
      expect(AppValidators.postalCode(''), isNull);
      expect(AppValidators.postalCode('   '), isNull);
      expect(AppValidators.postalCode('12500'), isNull);
      for (final code in ['1234', '123456', 'ABCDE', '12 34']) {
        expect(AppValidators.postalCode(code),
            'Enter a valid 5-digit postal code',
            reason: code);
      }
    });
  });

  group('coordinates', () {
    test('accept the real hub values and the range boundaries', () {
      expect(AppValidators.latitude('6.4382'), isNull);
      expect(AppValidators.longitude('80.0274'), isNull);
      expect(AppValidators.latitude('-90'), isNull);
      expect(AppValidators.latitude('90'), isNull);
      expect(AppValidators.longitude('-180'), isNull);
      expect(AppValidators.longitude('180'), isNull);
    });

    test('reject out-of-range, non-numeric and non-finite values', () {
      for (final value in ['', '  ', 'abc', '6.4a', '90.1', '-91', 'NaN',
        'Infinity']) {
        expect(AppValidators.latitude(value), 'Enter a valid latitude',
            reason: '"$value"');
      }
      for (final value in ['180.1', '-181', 'east']) {
        expect(AppValidators.longitude(value), 'Enter a valid longitude',
            reason: '"$value"');
      }
    });
  });

  group('delivery instructions', () {
    test('optional, bounded, and not whitespace-only', () {
      expect(AppValidators.deliveryInstructions(''), isNull);
      expect(AppValidators.deliveryInstructions('   '), isNull);
      expect(AppValidators.deliveryInstructions('Leave at the gate'), isNull);
      expect(
        AppValidators.deliveryInstructions('Call when you arrive - gate 2!'),
        isNull,
      );
      expect(AppValidators.deliveryInstructions('a' * 301), isNotNull);
    });
  });

  group('otp', () {
    test('exactly six digits', () {
      expect(AppValidators.otp('123456'), isNull);
      for (final otp in ['', '12345', '1234567', 'abcdef', '12 34 56', '12a456']) {
        expect(AppValidators.otp(otp), 'Enter the 6-digit OTP',
            reason: '"$otp"');
      }
    });
  });

  group('quantity', () {
    test('whole numbers within the backend per-item range', () {
      expect(AppValidators.isValidQuantity(1), isTrue);
      expect(AppValidators.isValidQuantity(100), isTrue);
      expect(AppValidators.isValidQuantity(0), isFalse);
      expect(AppValidators.isValidQuantity(-1), isFalse);
      expect(AppValidators.isValidQuantity(101), isFalse);
      expect(AppValidators.isValidQuantity(1.5), isFalse);
      expect(AppValidators.isValidQuantity(double.nan), isFalse);
      expect(AppValidators.isValidQuantity(null), isFalse);
    });
  });
}
