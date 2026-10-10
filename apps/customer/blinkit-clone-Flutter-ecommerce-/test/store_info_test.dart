import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/help_screen.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/Services/store_info.dart';
import 'package:ecom/app_theme.dart';

void main() {
  group('StoreInfo', () {
    test('holds the single-hub facts the backend enforces', () {
      expect(StoreInfo.hubName, 'Dharga Town');
      expect(StoreInfo.country, 'Sri Lanka');
      // The FALLBACK hours only: the live ones come from GET /store
      // (owner, 2026-10-10).
      expect(StoreInfo.deliveryHoursLabel, '8 AM – 9 PM');
      expect(StoreInfo.opensAtLabel, '8 AM');
      expect(StoreInfo.serviceRadiusKm, 4);
      expect(StoreInfo.defaultDeliveryFee, 100.0);
      expect(StoreInfo.paymentMethodLabel, 'Cash on delivery');
    });

    test('support: phone and WhatsApp on the same number (owner, 2026-10-08)', () {
      expect(StoreInfo.supportPhone, '+94717107374');
      expect(StoreInfo.supportPhoneLabel, '+94 71 710 7374');
      expect(StoreInfo.supportWhatsAppUrl, 'https://wa.me/94717107374');
    });
  });

  group('business facts are not repeated as literals in lib/', () {
    final allFiles = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .toList();
    bool isStoreInfo(File f) => f.path.replaceAll(r'\', '/').endsWith('Services/store_info.dart');
    final files = allFiles.where((f) => !isStoreInfo(f)).toList();

    // Comments may mention a fact; rendered code may not hard-code it.
    String code(File f) => f
        .readAsLinesSync()
        .where((l) => !l.trimLeft().startsWith('//'))
        .join('\n');

    test('hub name, radius, fee and payment label come from StoreInfo', () {
      final literals = <String, RegExp>{
        'Dharga': RegExp(r'Dharga'),
        '4 km': RegExp(r'\b4 km\b'),
        'LKR 100': RegExp(r'(Rs\.|LKR) (70|100)\b'),
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

    // Ops/Admin decide the store hours (owner, 2026-10-10). The ONLY hour
    // literals allowed anywhere in lib/ are the two fallback constants in
    // store_info.dart - not even elsewhere in that file.
    final hourLiterals = <String, RegExp>{
      '8 AM': RegExp(r'8(:00)? AM'),
      '9 PM': RegExp(r'9(:00)? PM'),
    };
    final fallbackDeclaration = RegExp(r'static const String (deliveryHoursLabel|opensAtLabel) = ');

    test('no hour literal outside the fallback constants in store_info.dart', () {
      final offenders = <String>[];
      for (final f in allFiles) {
        final lines = f.readAsLinesSync().where((l) => !l.trimLeft().startsWith('//'));
        for (final line in lines) {
          if (isStoreInfo(f) && fallbackDeclaration.hasMatch(line)) continue;
          hourLiterals.forEach((name, pattern) {
            if (pattern.hasMatch(line)) offenders.add('${f.path}: $name in "${line.trim()}"');
          });
        }
      }
      expect(offenders, isEmpty);
    });

    test('the fallback constants are only read by StoreInfoProvider (the live-label seam)', () {
      final fallbackUse = RegExp(r'StoreInfo\.(deliveryHoursLabel|opensAtLabel)');
      final offenders = files
          .where((f) => !f.path.replaceAll(r'\', '/').endsWith('Services/Providers/store_info.provider.dart'))
          .where((f) => fallbackUse.hasMatch(code(f)))
          .map((f) => f.path)
          .toList();
      expect(offenders, isEmpty);
    });

    test('every screen that shows the hours reads the live label', () {
      for (final path in [
        'lib/Screens/help_screen.dart',
        'lib/UI/Widgets/Organisms/home_screen_app_bar.dart',
        'lib/Screens/app_about_screen.dart',
        'lib/Screens/Auth/login_screen.dart',
      ]) {
        expect(code(File(path)), contains('watchHoursLabel(context)'), reason: path);
      }
    });
  });

  group('the live label reaches the UI (owner, 2026-10-10)', () {
    Future<StoreInfoProvider> loaded(Map<String, dynamic> data) async {
      final store = StoreInfoProvider(
        request: (_) async => {'success': true, 'data': data},
        readCache: () async => null,
        writeCache: (_) async {},
      );
      await store.load();
      return store;
    }

    Future<void> pumpHelp(WidgetTester tester, StoreInfoProvider? store) async {
      // Tall enough that the "Our store" lines below the answers are built.
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      const help = HelpScreen();
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.appTHeme,
        home: store == null ? help : ChangeNotifierProvider<StoreInfoProvider>.value(value: store, child: help),
      ));
    }

    testWidgets('Help says the hours Ops/Admin set, half hours included', (tester) async {
      final store = await loaded({
        'delivery_fee_lkr': 100,
        'delivery_hours': {'start': '09:30', 'end': '18:00', 'timezone': 'Asia/Colombo'},
        'is_open_now': true,
        'closed_kind': 'OPEN',
      });
      await pumpHelp(tester, store);
      expect(find.text('Deliveries go out 9:30 AM – 6 PM.'), findsOneWidget);
      expect(find.textContaining(StoreInfo.deliveryHoursLabel), findsNothing);
    });

    testWidgets('Help falls back to the constant when GET /store is unavailable', (tester) async {
      await pumpHelp(tester, null);
      expect(find.text('Deliveries go out ${StoreInfo.deliveryHoursLabel}.'), findsOneWidget);
    });

    testWidgets('watchHoursLabel follows the provider as it changes', (tester) async {
      final store = StoreInfoProvider(
        request: (_) async => {
          'data': {
            'delivery_hours': {'start': '07:00', 'end': '22:30'},
          },
        },
        readCache: () async => null,
        writeCache: (_) async {},
      );
      await tester.pumpWidget(ChangeNotifierProvider<StoreInfoProvider>.value(
        value: store,
        child: Builder(
          builder: (context) => Text(watchHoursLabel(context), textDirection: TextDirection.ltr),
        ),
      ));
      expect(find.text(StoreInfo.deliveryHoursLabel), findsOneWidget);
      await tester.runAsync(store.load);
      await tester.pump();
      expect(find.text('7 AM – 10:30 PM'), findsOneWidget);
    });
  });
}
