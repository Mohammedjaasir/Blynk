import 'dart:async';
import 'dart:ui' show CheckedState;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Screens/sms_preferences_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/profile.provider.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import '../fixtures/component_host.dart';
import '../fixtures/session_fakes.dart';

/// Answers GET /me with [profile] and PATCH /me by merging the body into it
/// (what the backend does), recording every call - no network.
class _FakeMe {
  _FakeMe({String? language = 'en', bool offers = true})
      : profile = {
          'id': 'u1',
          'phone': '+94771234567',
          'full_name': 'Nimal Perera',
          'role': 'CUSTOMER',
          'is_active': true,
          'sms_language': language,
          'sms_offers': offers,
        };

  final Map<String, dynamic> profile;
  final calls = <Map<String, dynamic>>[];

  /// Set to make the next PATCH fail (or hang) instead.
  Future<dynamic> Function()? patchResponse;

  /// Set to make GET fail.
  Object? getError;

  Future<dynamic> call({String? methodType, String? url, dynamic body}) async {
    calls.add({'method': methodType, 'url': url, 'body': body});
    if (methodType == 'GET') {
      if (getError != null) throw getError!;
      return {
        'success': true,
        'data': {'profile': Map<String, dynamic>.of(profile)},
      };
    }
    final custom = patchResponse;
    if (custom != null) return custom();
    profile.addAll((body as Map).cast<String, dynamic>());
    return {
      'success': true,
      'data': {'profile': Map<String, dynamic>.of(profile)},
    };
  }

  List<Map<String, dynamic>> get patches => calls.where((c) => c['method'] == 'PATCH').toList();
}

/// [languageChoice] null means the screen's own default (the launch flag).
Future<void> _pump(WidgetTester tester, _FakeMe api, {double textScale = 1, bool? languageChoice}) async {
  await tester.pumpWidget(
    componentHost(
      tester,
      languageChoice == null
          ? SmsPreferencesScreen(provider: ProfileProvider(request: api.call))
          : SmsPreferencesScreen(provider: ProfileProvider(request: api.call), languageChoice: languageChoice),
      textScale: textScale,
      center: false,
      height: 900,
    ),
  );
  await tester.pumpAndSettle();
}

bool _switchValue(WidgetTester tester) => tester.widget<Switch>(find.byType(Switch)).value;

Finder _choice(String label) => find.bySemanticsLabel(label);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('launch default: English-only offers', () {
    test('the language choice is switched off', () {
      expect(SmsPreferencesScreen.smsLanguageChoiceEnabled, isFalse);
      expect(const SmsPreferencesScreen().languageChoice, isFalse);
    });

    testWidgets('shows only the Offers by SMS switch: no language rows, heading or hint', (tester) async {
      final api = _FakeMe(language: null, offers: true);
      await _pump(tester, api);

      expect(find.text('Offers by SMS'), findsOneWidget);
      expect(find.text('Get Blynk offers and discounts by SMS. Order updates still arrive.'), findsOneWidget);
      expect(_switchValue(tester), isTrue);
      for (final hidden in [
        'SMS language',
        'Offer SMS are sent in this language.',
        'Pick a language for offer SMS',
        'සිංහල (Sinhala)',
        'தமிழ் (Tamil)',
        'English',
      ]) {
        expect(find.text(hidden), findsNothing, reason: hidden);
      }
      expect(find.byIcon(BlynkIcons.choiceOn), findsNothing);
      expect(find.byIcon(BlynkIcons.choiceOff), findsNothing);

      // The switch still saves, and no language PATCH is ever sent.
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      expect(api.patches, [
        {'method': 'PATCH', 'url': '/me', 'body': {'sms_offers': false}},
      ]);
    });
  });

  testWidgets('loads GET /me and shows the current language and switch', (tester) async {
    final handle = tester.ensureSemantics();
    final api = _FakeMe(language: 'si', offers: true);
    await _pump(tester, api, languageChoice: true);

    expect(api.calls.first, {'method': 'GET', 'url': '/me', 'body': null});
    expect(find.text('SMS language'), findsOneWidget);
    expect(find.text('සිංහල (Sinhala)'), findsOneWidget);
    expect(find.text('தமிழ் (Tamil)'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Offers by SMS'), findsOneWidget);
    expect(find.text('Get Blynk offers and discounts by SMS. Order updates still arrive.'), findsOneWidget);
    expect(find.text('Pick a language for offer SMS'), findsNothing);

    // Exactly one choice is marked, and it is Sinhala.
    expect(find.byIcon(BlynkIcons.choiceOn), findsOneWidget);
    expect(find.byIcon(BlynkIcons.choiceOff), findsNWidgets(2));
    expect(
      tester.getSemantics(_choice('සිංහල (Sinhala)')).getSemanticsData().flagsCollection.isChecked,
      CheckedState.isTrue,
    );
    expect(
      tester.getSemantics(_choice('English')).getSemanticsData().flagsCollection.isChecked,
      CheckedState.isFalse,
    );
    expect(_switchValue(tester), isTrue);
    handle.dispose();
  });

  testWidgets('no language picked yet: nothing is selected and a hint says to pick one', (tester) async {
    await _pump(tester, _FakeMe(language: null, offers: false), languageChoice: true);

    expect(find.text('Pick a language for offer SMS'), findsOneWidget);
    expect(find.byIcon(BlynkIcons.choiceOn), findsNothing);
    expect(find.byIcon(BlynkIcons.choiceOff), findsNWidgets(3));
    expect(_switchValue(tester), isFalse);
  });

  testWidgets('choosing Tamil saves at once with PATCH { sms_language: ta }', (tester) async {
    final api = _FakeMe(language: null);
    await _pump(tester, api, languageChoice: true);

    await tester.tap(find.text('தமிழ் (Tamil)'));
    await tester.pumpAndSettle();

    expect(api.patches, [
      {'method': 'PATCH', 'url': '/me', 'body': {'sms_language': 'ta'}},
    ]);
    expect(find.text('Pick a language for offer SMS'), findsNothing);
    expect(find.byIcon(BlynkIcons.choiceOn), findsOneWidget);
    final tamilRow = find.ancestor(of: find.text('தமிழ் (Tamil)'), matching: find.byType(Row)).first;
    expect(find.descendant(of: tamilRow, matching: find.byIcon(BlynkIcons.choiceOn)), findsOneWidget);
  });

  testWidgets('choosing the language already chosen sends nothing', (tester) async {
    final api = _FakeMe(language: 'en');
    await _pump(tester, api, languageChoice: true);

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(api.patches, isEmpty);
  });

  testWidgets('turning the switch off saves PATCH { sms_offers: false }', (tester) async {
    final api = _FakeMe(offers: true);
    await _pump(tester, api);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(api.patches, [
      {'method': 'PATCH', 'url': '/me', 'body': {'sms_offers': false}},
    ]);
    expect(_switchValue(tester), isFalse);
  });

  testWidgets('the switch is disabled while its save is in flight, so one tap sends once', (tester) async {
    final api = _FakeMe(offers: true);
    final pending = Completer<dynamic>();
    api.patchResponse = () => pending.future;
    await _pump(tester, api);

    await tester.tap(find.byType(Switch));
    await tester.pump();
    expect(_switchValue(tester), isFalse); // shown at once
    expect(tester.widget<Switch>(find.byType(Switch)).onChanged, isNull);
    await tester.tap(find.byType(Switch));
    await tester.pump();
    expect(api.patches, hasLength(1));

    pending.complete({
      'success': true,
      'data': {
        'profile': {'id': 'u1', 'phone': '+94771234567', 'role': 'CUSTOMER', 'sms_language': 'en', 'sms_offers': false},
      },
    });
    await tester.pumpAndSettle();
    expect(_switchValue(tester), isFalse);
    expect(tester.widget<Switch>(find.byType(Switch)).onChanged, isNotNull);
  });

  testWidgets('a failed save puts the switch back and shows the mapped error', (tester) async {
    final api = _FakeMe(offers: true);
    api.patchResponse = () async => throw ApiException(500, 'pg: relation does not exist');
    await _pump(tester, api);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(api.patches, hasLength(1));
    expect(_switchValue(tester), isTrue);
    expect(find.text('Something went wrong on our side. Try again in a moment.'), findsOneWidget);
    expect(find.textContaining('pg:'), findsNothing);
  });

  testWidgets('a failed language save puts the old choice back', (tester) async {
    final api = _FakeMe(language: null);
    api.patchResponse = () async => throw ApiException(500, 'boom');
    await _pump(tester, api, languageChoice: true);

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();

    expect(find.byIcon(BlynkIcons.choiceOn), findsNothing);
    expect(find.text('Pick a language for offer SMS'), findsOneWidget);
    expect(find.text('Something went wrong on our side. Try again in a moment.'), findsOneWidget);
  });

  testWidgets('a failed load says so and Try again loads it', (tester) async {
    final api = _FakeMe()..getError = ApiException(500, 'raw');
    await _pump(tester, api);

    expect(find.text("We couldn't load your SMS settings"), findsOneWidget);
    expect(find.byType(Switch), findsNothing);

    api.getError = null;
    await tester.tap(find.byKey(const Key('sms-settings-retry')));
    await tester.pumpAndSettle();
    expect(find.text('Offers by SMS'), findsOneWidget);
  });

  for (final scale in kTextScales) {
    for (final languageChoice in [false, true]) {
      testWidgets('does not overflow at text scale $scale (language choice $languageChoice)', (tester) async {
        await _pump(tester, _FakeMe(language: null), textScale: scale, languageChoice: languageChoice);
        expect(tester.takeException(), isNull);
      });
    }
  }

  group('Profile entry point', () {
    Future<List<String>> pumpProfile(WidgetTester tester, AuthProvider auth) async {
      final pushed = <String>[];
      tester.view.physicalSize = const Size(400, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: auth,
          child: MaterialApp(
            theme: AppTheme.theme,
            home: const ProfileScreen(),
            onGenerateRoute: (settings) {
              pushed.add(settings.name ?? '');
              return MaterialPageRoute(builder: (_) => const SizedBox());
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      return pushed;
    }

    testWidgets('a guest tapping SMS & offers is sent to log in', (tester) async {
      final pushed = await pumpProfile(tester, AuthProvider());
      await tester.tap(find.text('SMS & offers'));
      await tester.pumpAndSettle();
      expect(pushed, ['/login']);
      expect(find.byType(SmsPreferencesScreen), findsNothing);
    });

    testWidgets('a signed-in customer gets the SMS settings screen', (tester) async {
      final pushed = <String>[];
      final api = _FakeMe(language: 'ta');
      tester.view.physicalSize = const Size(400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: SignedInAuth(),
          child: MaterialApp(
            theme: AppTheme.theme,
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => SmsPreferencesScreen.open(
                    context,
                    provider: ProfileProvider(request: api.call),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
            onGenerateRoute: (settings) {
              pushed.add(settings.name ?? '');
              return MaterialPageRoute(builder: (_) => const SizedBox());
            },
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(pushed, isEmpty);
      expect(find.byType(SmsPreferencesScreen), findsOneWidget);
      expect(find.text('SMS & offers'), findsOneWidget); // the app bar title
    });
  });
}
