import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/store_info.dart';

void main() {
  group('StoreInfo', () {
    test('holds the single-hub facts the backend enforces', () {
      expect(StoreInfo.hubName, 'Dharga Town');
      expect(StoreInfo.country, 'Sri Lanka');
      expect(StoreInfo.deliveryHoursLabel, '8 AM – 9 PM');
      expect(StoreInfo.serviceRadiusKm, 4);
      expect(StoreInfo.flatDeliveryFee, 70.0);
      expect(StoreInfo.paymentMethodLabel, 'Cash on delivery');
    });

    test('has no support contact until one is decided (D5)', () {
      expect(StoreInfo.supportContact, isNull);
    });
  });

  group('business facts are not repeated as literals in lib/', () {
    final files = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .where((f) => !f.path.replaceAll(r'\', '/').endsWith('Services/store_info.dart'))
        .toList();

    // Comments may mention a fact; rendered code may not hard-code it.
    String code(File f) => f
        .readAsLinesSync()
        .where((l) => !l.trimLeft().startsWith('//'))
        .join('\n');

    test('hub name, hours, radius, fee and payment label come from StoreInfo', () {
      final literals = <String, RegExp>{
        'Dharga': RegExp(r'Dharga'),
        '8 AM': RegExp(r'8(:00)? AM'),
        '9 PM': RegExp(r'9(:00)? PM'),
        '4 km': RegExp(r'\b4 km\b'),
        'LKR 70': RegExp(r'Rs\. 70\b'),
        'Cash on Delivery': RegExp(r'[Cc]ash on [Dd]elivery'),
      };
      final offenders = <String>[];
      for (final f in files) {
        final text = code(f);
        literals.forEach((name, pattern) {
          if (pattern.hasMatch(text)) offenders.add('${f.path}: $name');
        });
      }
      expect(offenders, isEmpty);
    });
  });
}
