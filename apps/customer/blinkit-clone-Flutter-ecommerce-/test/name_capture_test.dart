import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/Auth/name_capture_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

/// The sign-in name step (owner, 2026-10-08): a customer whose account has no
/// name is asked for it right after the SMS code, and it is saved (PATCH /me).
Map<String, dynamic> _verified(String? name) => {
      'success': true,
      'data': {
        'access_token': 'access-1',
        'refresh_token': 'refresh-1',
        'user': {'id': 'u1', 'phone': '+94762227770', 'role': 'CUSTOMER', 'full_name': name},
      },
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('a new customer (no name) needs one after the code; a named one does not', () async {
    final fresh = AuthProvider(request: ({methodType, url, body}) async => _verified(null));
    await fresh.verifyOtp('0762227770', '123456');
    expect(fresh.needsName, isTrue);

    FlutterSecureStorage.setMockInitialValues({});
    final named = AuthProvider(request: ({methodType, url, body}) async => _verified('Nimal Perera'));
    await named.verifyOtp('0762227770', '123456');
    expect(named.needsName, isFalse);
  });

  testWidgets('asks for the name, refuses one letter, saves it and opens the birthday prompt', timeout: const Timeout(Duration(minutes: 2)), (tester) async {
    final calls = <String>[];
    final auth = AuthProvider(request: ({methodType, url, body}) async {
      calls.add('$methodType $url ${body ?? ''}');
      if (url == '/auth/otp/verify') return _verified(null);
      return {'success': true, 'data': {'profile': {'full_name': body?['full_name']}}};
    });
    // Secure storage is real async: it runs outside the test's fake clock.
    await tester.runAsync(() => auth.verifyOtp('0762227770', '123456'));

    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        home: const NameCaptureScreen(),
        onGenerateRoute: (s) => MaterialPageRoute(builder: (_) => Text('route:${s.name}')),
      ),
    ));

    expect(find.text("What's your name?"), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'N');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(find.textContaining('at least 2 letters'), findsOneWidget);
    expect(calls.where((c) => c.startsWith('PATCH')), isEmpty);

    await tester.enterText(find.byType(TextField), '  Nimal Perera ');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    // The save writes the profile cache (real async), then opens the shop.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    // Explicit pumps: the button's loading spinner never settles.
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }

    expect(calls.last, 'PATCH /me {full_name: Nimal Perera}');
    expect(auth.currentUser?.fullName, 'Nimal Perera');
    expect(auth.needsName, isFalse);
    // First sign-up goes on to the one skippable birthday prompt (owner,
    // 2026-10-09); birthday_prompt_test.dart covers it.
    expect(find.text('route:/auth/birthday'), findsOneWidget);
  });
}
