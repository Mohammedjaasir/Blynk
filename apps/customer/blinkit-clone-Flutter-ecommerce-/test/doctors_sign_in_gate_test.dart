import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_clinics_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/Services/post_login_destination.dart';
import 'package:ecom/UI/Widgets/Atoms/doctors_sign_in_prompt.dart';
import 'package:ecom/UI/Widgets/Organisms/dental_home_entry.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';

import 'fixtures/dental_fixtures.dart';

/// "Doctors need sign-in" (owner, 2026-10-10: "For the doctor thing, they
/// must add their phone number and get registered. Otherwise it should not
/// show the doctor things. If they want to go to the doctors section, they
/// must log in or create an account; then only they can see.").
///
/// Home's "Channel doctors" row stays visible; a guest tapping it while the
/// switch is on (GET /store `doctors_require_sign_in`, on when unknown) gets
/// "Sign in to see doctors", whose login ends back on the doctors. A 401
/// SIGN_IN_REQUIRED from the dental API shows the same prompt.

/// An auth whose signed-in state a test can flip (the fake login does).
class _SwitchAuth extends AuthProvider {
  _SwitchAuth({this.signedIn = false});

  bool signedIn;

  @override
  bool get isAuthenticated => signedIn;

  void setSignedIn(bool value) {
    signedIn = value;
    notifyListeners();
  }
}

/// The dental API: the clinic list, or a thrown error.
class _DentalApi {
  final calls = <String>[];
  Object? error;

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    calls.add('$method $url');
    if (error != null) throw error!;
    if (url == '/dental/clinics') {
      return {
        'success': true,
        'data': {
          'clinics': [clinicJson()],
          'pagination': {'page': 1, 'limit': 20, 'total': 1, 'total_pages': 1},
        },
      };
    }
    throw ApiException(404, 'No route for $url', code: 'NOT_FOUND');
  }
}

/// GET /store with (or without) the doctors switch.
StoreInfoProvider _store({Object? requireSignIn = _missing}) => StoreInfoProvider(
      request: (_) async => {
        'success': true,
        'data': {
          'delivery_fee_lkr': 100,
          'hub_name': 'Dharga Town',
          if (!identical(requireSignIn, _missing)) 'doctors_require_sign_in': requireSignIn,
        },
      },
      readCache: () async => null,
      writeCache: (_) async {},
    );

const Object _missing = Object();

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    PostLoginDestination.clear();
    PostLoginDestination.now = DateTime.now;
  });

  /// Home's entry over the real routes; `/login` is a stand-in for the phone
  /// OTP flow whose "verify" signs in and ends like the real one
  /// (PostLoginDestination.goHome), and `/home` is the shop.
  Future<void> pumpApp(
    WidgetTester tester, {
    required _SwitchAuth auth,
    required StoreInfoProvider store,
    required _DentalApi api,
    List<String>? pushed,
  }) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await store.load();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<StoreInfoProvider>.value(value: store),
          ChangeNotifierProvider(create: (_) => DentalProvider(request: api.call)),
        ],
        child: MaterialApp(
          theme: AppTheme.theme,
          home: const Scaffold(body: SafeArea(child: DentalHomeEntry())),
          onGenerateRoute: (settings) {
            pushed?.add(settings.name ?? '');
            switch (settings.name) {
              case '/login':
                return MaterialPageRoute(
                  settings: settings,
                  builder: (context) => Scaffold(
                    body: Center(
                      child: TextButton(
                        onPressed: () {
                          auth.setSignedIn(true);
                          PostLoginDestination.goHome(Navigator.of(context));
                        },
                        child: const Text('fake verify'),
                      ),
                    ),
                  ),
                );
              case '/home':
                return MaterialPageRoute(settings: settings, builder: (_) => const Scaffold(body: Text('the shop')));
            }
            return AppRouter.generateRoute(settings);
          },
        ),
      ),
    );
    await tester.pump();
  }

  Future<void> tapDoctors(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('dental-clinics-entry')));
    await tester.pumpAndSettle();
  }

  group('GET /store doctors_require_sign_in', () {
    test('only a real false turns it off; missing or malformed means sign in', () {
      expect(StoreInfoProvider.parseDoctorsRequireSignIn({'doctors_require_sign_in': false}), isFalse);
      expect(StoreInfoProvider.parseDoctorsRequireSignIn({'doctors_require_sign_in': true}), isTrue);
      expect(StoreInfoProvider.parseDoctorsRequireSignIn(<String, dynamic>{}), isTrue);
      expect(StoreInfoProvider.parseDoctorsRequireSignIn({'doctors_require_sign_in': 'false'}), isTrue);
      expect(StoreInfoProvider.parseDoctorsRequireSignIn({'doctors_require_sign_in': 0}), isTrue);
      expect(StoreInfoProvider.parseDoctorsRequireSignIn(null), isTrue);
    });

    test('the provider starts on and follows the server', () async {
      final store = _store(requireSignIn: false);
      expect(store.doctorsRequireSignIn, isTrue);
      await store.load();
      expect(store.doctorsRequireSignIn, isFalse);

      final unknown = _store();
      await unknown.load();
      expect(unknown.doctorsRequireSignIn, isTrue);
    });

    test('a 401 SIGN_IN_REQUIRED maps to the doctors prompt; a plain 401 does not', () {
      final doctors = AppErrors.from(ApiException(401, 'Sign in with your phone number to see doctors.', code: 'SIGN_IN_REQUIRED'));
      expect(doctors.isDoctorsSignIn, isTrue);
      expect(doctors.title, 'Sign in to see doctors');
      expect(doctors.needsLogin, isTrue);
      expect(AppErrors.from(ApiException(401, 'expired', code: 'TOKEN_EXPIRED')).isDoctorsSignIn, isFalse);
      expect(AppErrors.unauthorized.isDoctorsSignIn, isFalse);
    });
  });

  group('A guest while "Doctors need sign-in" is on', () {
    testWidgets('sees Channel doctors on Home, but tapping it shows the sign-in prompt and loads no doctors',
        (tester) async {
      final api = _DentalApi();
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: true), api: api);

      expect(find.text('Channel doctors'), findsOneWidget);
      await tapDoctors(tester);

      expect(find.text(DoctorsSignInPrompt.title), findsOneWidget);
      expect(find.text(DoctorsSignInPrompt.message), findsOneWidget);
      expect(find.text(DoctorsSignInPrompt.actionLabel), findsOneWidget);
      expect(find.byType(DentalClinicsScreen), findsNothing);
      expect(find.text('Smile Dental Clinic'), findsNothing);
      expect(api.calls, isEmpty);
    });

    testWidgets('the same when GET /store has not said (an older backend): on by default', (tester) async {
      final api = _DentalApi();
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(), api: api);
      await tapDoctors(tester);

      expect(find.text(DoctorsSignInPrompt.title), findsOneWidget);
      expect(api.calls, isEmpty);
    });

    testWidgets('"Log in / Sign up" runs the login, and after it the doctors open', (tester) async {
      final api = _DentalApi();
      final pushed = <String>[];
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: true), api: api, pushed: pushed);
      await tapDoctors(tester);

      await tester.tap(find.byKey(DoctorsSignInPrompt.actionKey));
      await tester.pumpAndSettle();
      expect(pushed.last, '/login');
      expect(PostLoginDestination.pending?.name, '/dental/clinics');

      await tester.tap(find.text('fake verify'));
      await tester.pumpAndSettle();

      // The shop underneath, the doctors on top.
      expect(pushed.sublist(pushed.length - 2), ['/home', '/dental/clinics']);
      expect(find.byType(DentalClinicsScreen), findsOneWidget);
      expect(find.text('Smile Dental Clinic'), findsOneWidget);
      expect(find.text(DoctorsSignInPrompt.title), findsNothing);
      // Only the clinic list, and only after the login (the prompt's own
      // route may also fetch once on its way out).
      expect(api.calls, isNotEmpty);
      expect(api.calls.toSet(), {'GET /dental/clinics'});
      expect(PostLoginDestination.pending, isNull);

      // Back from the doctors is the shop.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('the shop'), findsOneWidget);
    });

    testWidgets('a deep link straight to a clinic is guarded too, and comes back to that clinic', (tester) async {
      final api = _DentalApi();
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: true), api: api);
      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      navigator.pushNamed('/dental/clinic', arguments: 'c1');
      await tester.pumpAndSettle();
      expect(find.text(DoctorsSignInPrompt.title), findsOneWidget);
      expect(api.calls, isEmpty);

      await tester.tap(find.byKey(DoctorsSignInPrompt.actionKey));
      await tester.pumpAndSettle();
      expect(PostLoginDestination.pending?.name, '/dental/clinic');
      expect(PostLoginDestination.pending?.arguments, 'c1');
    });

    testWidgets('booking and a doctor profile are guarded too', (tester) async {
      final api = _DentalApi();
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: true), api: api);
      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      for (final name in ['/dental/doctor', '/dental/book']) {
        navigator.pushNamed(name, arguments: {'doctorId': 'd1', 'clinicId': 'c1'});
        await tester.pumpAndSettle();
        expect(find.text(DoctorsSignInPrompt.title), findsOneWidget, reason: name);
        navigator.pop();
        await tester.pumpAndSettle();
      }
      expect(api.calls, isEmpty);
    });

    testWidgets('backing out of the login forgets the doctors, so a later login does not jump there',
        (tester) async {
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: true), api: _DentalApi());
      await tapDoctors(tester);
      await tester.tap(find.byKey(DoctorsSignInPrompt.actionKey));
      await tester.pumpAndSettle();
      expect(PostLoginDestination.pending, isNotNull);

      tester.state<NavigatorState>(find.byType(Navigator)).pop();
      await tester.pumpAndSettle();

      expect(find.text(DoctorsSignInPrompt.title), findsOneWidget);
      expect(PostLoginDestination.pending, isNull);
    });

    testWidgets('signing in while the prompt shows opens the doctors in place', (tester) async {
      final auth = _SwitchAuth();
      final api = _DentalApi();
      await pumpApp(tester, auth: auth, store: _store(requireSignIn: true), api: api);
      await tapDoctors(tester);
      expect(find.text(DoctorsSignInPrompt.title), findsOneWidget);

      auth.setSignedIn(true);
      await tester.pumpAndSettle();

      expect(find.text('Smile Dental Clinic'), findsOneWidget);
    });
  });

  group('Unaffected', () {
    testWidgets('a signed-in customer opens the doctors as before', (tester) async {
      final api = _DentalApi();
      await pumpApp(tester, auth: _SwitchAuth(signedIn: true), store: _store(requireSignIn: true), api: api);
      await tapDoctors(tester);

      expect(find.text(DoctorsSignInPrompt.title), findsNothing);
      expect(find.text('Smile Dental Clinic'), findsOneWidget);
      expect(api.calls, ['GET /dental/clinics']);
    });

    testWidgets('with the switch off, a guest browses the doctors as before', (tester) async {
      final api = _DentalApi();
      await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: false), api: api);
      await tapDoctors(tester);

      expect(find.text(DoctorsSignInPrompt.title), findsNothing);
      expect(find.text('Smile Dental Clinic'), findsOneWidget);
    });
  });

  testWidgets('a 401 SIGN_IN_REQUIRED from the dental API shows the same prompt, whose login comes back here',
      (tester) async {
    // The app still thought the switch was off (an older GET /store answer).
    final api = _DentalApi()
      ..error = ApiException(401, 'Sign in with your phone number to see doctors.', code: 'SIGN_IN_REQUIRED');
    final pushed = <String>[];
    await pumpApp(tester, auth: _SwitchAuth(), store: _store(requireSignIn: false), api: api, pushed: pushed);
    await tapDoctors(tester);

    expect(api.calls, ['GET /dental/clinics']);
    expect(find.byType(DentalClinicsScreen), findsOneWidget);
    expect(find.text(DoctorsSignInPrompt.title), findsOneWidget);
    expect(find.text('Try again'), findsNothing);

    await tester.tap(find.byKey(DoctorsSignInPrompt.actionKey));
    await tester.pumpAndSettle();
    expect(pushed.last, '/login');
    expect(PostLoginDestination.pending?.name, '/dental/clinics');
  });

  group('PostLoginDestination', () {
    test('is used once', () {
      PostLoginDestination.remember('/dental/clinics');
      expect(PostLoginDestination.take()?.name, '/dental/clinics');
      expect(PostLoginDestination.take(), isNull);
    });

    test('a login started over 30 minutes ago goes to the shop only', () {
      var clock = DateTime(2026, 10, 10, 9);
      PostLoginDestination.now = () => clock;
      PostLoginDestination.remember('/dental/clinics');
      clock = clock.add(const Duration(minutes: 29));
      expect(PostLoginDestination.pending?.name, '/dental/clinics');
      clock = clock.add(const Duration(minutes: 2));
      expect(PostLoginDestination.pending, isNull);
    });
  });
}
