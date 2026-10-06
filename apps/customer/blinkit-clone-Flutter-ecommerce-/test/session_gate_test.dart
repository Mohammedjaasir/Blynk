import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Infrastructure/LocalStorage/guest_choice_storage.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/app_theme.dart';

final _user = UserModel(id: 'u1', phone: '+94771234567', role: 'CUSTOMER', fullName: 'Nimal Perera');

Map<String, String> _signedInStorage({bool withUser = true}) => {
      'blynk_access_token': 'access-1',
      'blynk_refresh_token': 'refresh-1',
      if (withUser) 'blynk_user_profile': _user.toJsonString(),
    };

/// Answers by URL; anything not listed is a network failure (offline).
AuthRequest _requests(Map<String, Future<dynamic> Function()> byUrl, [List<String>? log]) {
  return ({String? methodType, String? url, dynamic body}) {
    log?.add('$methodType $url');
    final handler = byUrl[url];
    if (handler == null) return Future.error(ApiException(503, 'offline', code: 'NETWORK_ERROR'));
    return handler();
  };
}

const _meOk = {
  'success': true,
  'data': {
    'user': {'id': 'u1', 'phone': '+94771234567', 'role': 'CUSTOMER', 'full_name': 'Nimal Perera'},
  },
};

final _navigatorKey = GlobalKey<NavigatorState>();
final _messengerKey = GlobalKey<ScaffoldMessengerState>();

/// Never shows the real shell (it would load the catalog); '/home' is a marker.
Widget _app(AuthProvider auth, {List<String>? routes}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthProvider>.value(value: auth),
      ChangeNotifierProvider(create: (_) => AddressProvider()),
      ChangeNotifierProvider(create: (_) => OrderProvider(request: (m, u, {body, query}) async => {})),
      ChangeNotifierProvider(create: (_) => CartProvider()),
      ChangeNotifierProvider(create: (_) => LocationProvider()),
    ],
    child: MaterialApp(
      theme: AppTheme.theme,
      navigatorKey: _navigatorKey,
      scaffoldMessengerKey: _messengerKey,
      builder: (context, child) => SessionEndListener(
        navigatorKey: _navigatorKey,
        messengerKey: _messengerKey,
        child: child!,
      ),
      onGenerateRoute: (settings) {
        routes?.add(settings.name ?? '');
        final Widget page = switch (settings.name) {
          '/' => const SessionGate(),
          '/login' => const LoginScreen(),
          _ => const Scaffold(body: Center(child: Text('shop home'))),
        };
        return MaterialPageRoute(settings: settings, builder: (_) => page);
      },
    ),
  );
}

/// Bounded pumps: the login screen has a looping animation, so never settle.
///
/// There is no launch animation to wait out any more - Android's native
/// splash is the whole opening and the gate holds for nothing - so this is
/// back to covering just the session read and the route change.
Future<void> _pumpFrames(WidgetTester tester, {int frames = 40, void Function()? each}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
    each?.call();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // A widget test can end with a storage call unfinished; do not let it block the next test.
  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(TokenStorage.resetSerialQueueForTest);

  group('SessionGate', () {
    testWidgets('signed in: goes straight to the shop and never shows the login screen', (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final pendingMe = Completer<dynamic>();
      final auth = AuthProvider(request: _requests({'/auth/me': () => pendingMe.future}));
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      // Android's native splash is the opening. What Flutter puts up while it
      // reads the session is deliberately blank - no second logo, no spinner,
      // nothing to read - so the splash's white simply continues.
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byType(Text), findsNothing);
      expect(find.byType(LoginScreen), findsNothing);

      var loginSeen = false;
      await _pumpFrames(tester, each: () {
        if (find.byType(LoginScreen).evaluate().isNotEmpty) loginSeen = true;
      });

      expect(loginSeen, isFalse);
      expect(find.text('shop home'), findsOneWidget);
      // ...while the background check is still waiting on the network.
      expect(pendingMe.isCompleted, isFalse);
      expect(auth.isAuthenticated, isTrue);
      expect(auth.currentUser?.fullName, 'Nimal Perera');
    });

    testWidgets('signed out: shows the login screen with its Skip', (tester) async {
      final auth = AuthProvider(request: _requests({}));
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester);

      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('Skip'), findsOneWidget);
      expect(find.text('shop home'), findsNothing);
      expect(auth.isAuthenticated, isFalse);
    });

    testWidgets('a guest who skipped before goes straight to the shop', (tester) async {
      FlutterSecureStorage.setMockInitialValues({'blynk_login_skipped': '1'});
      final auth = AuthProvider(request: _requests({}));
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      var loginSeen = false;
      await _pumpFrames(tester, each: () {
        if (find.byType(LoginScreen).evaluate().isNotEmpty) loginSeen = true;
      });

      expect(loginSeen, isFalse);
      expect(find.text('shop home'), findsOneWidget);
      expect(auth.isAuthenticated, isFalse, reason: 'still a guest, just not asked again');
    });

    test('Skip for now is remembered on the device', () async {
      expect(await GuestChoiceStorage.hasSkippedLogin(), isFalse);
      await GuestChoiceStorage.rememberSkippedLogin();
      expect(await GuestChoiceStorage.hasSkippedLogin(), isTrue);
    });

    testWidgets('a refresh token alone (no cached user) is still a session', (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage(withUser: false));
      final auth = AuthProvider(request: _requests({}));
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester);

      expect(find.text('shop home'), findsOneWidget);
      expect(find.byType(LoginScreen), findsNothing);
    });

    testWidgets('an access token without a refresh token is not a session', (tester) async {
      FlutterSecureStorage.setMockInitialValues({'blynk_access_token': 'access-1'});
      final auth = AuthProvider(request: _requests({}));
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester);

      expect(find.byType(LoginScreen), findsOneWidget);
      expect(await TokenStorage.getAccessToken(), isNull);
    });

    testWidgets('offline while restoring: still the shop, still signed in, tokens kept', (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final calls = <String>[];
      final auth = AuthProvider(request: _requests({}, calls)); // every call fails as offline
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester);

      expect(find.text('shop home'), findsOneWidget);
      expect(find.byType(LoginScreen), findsNothing);
      expect(calls, contains('GET /auth/me'));
      expect(auth.isAuthenticated, isTrue);
      expect(await TokenStorage.getRefreshToken(), 'refresh-1');
      expect(await TokenStorage.getUserCache(), isNotNull);
    });

    testWidgets('a 401 answered by a failing refresh (5xx) keeps the session', (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final auth = AuthProvider(
        request: _requests({
          '/auth/me': () => Future.error(ApiException(401, 'expired')),
          '/auth/refresh': () => Future.error(ApiException(503, 'down')),
        }),
      );
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester);

      expect(find.text('shop home'), findsOneWidget);
      expect(auth.isAuthenticated, isTrue);
      expect(await TokenStorage.getRefreshToken(), 'refresh-1');
    });

    testWidgets('a 401 then an accepted refresh renews the tokens and the profile', (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage(withUser: false));
      var meCalls = 0;
      final auth = AuthProvider(
        request: _requests({
          '/auth/me': () async {
            if (meCalls++ == 0) throw ApiException(401, 'expired');
            return _meOk;
          },
          '/auth/refresh': () async => {
                'success': true,
                'data': {'access_token': 'access-2', 'refresh_token': 'refresh-2'},
              },
        }),
      );
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester);

      expect(find.text('shop home'), findsOneWidget);
      expect(await TokenStorage.getRefreshToken(), 'refresh-2');
      expect(auth.currentUser?.fullName, 'Nimal Perera');
    });

    testWidgets(
        'a 401 refresh rejection ends the session: state cleared, login screen, plain message',
        (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final auth = AuthProvider(
        request: _requests({
          '/auth/me': () => Future.error(ApiException(401, 'expired')),
          '/auth/refresh': () => Future.error(ApiException(401, 'refresh token revoked')),
        }),
      );
      addTearDown(auth.dispose);
      final ended = <SessionEndReason>[];
      auth.onSessionEnded.listen(ended.add);

      await tester.pumpWidget(_app(auth));
      await _pumpFrames(tester, frames: 20);

      expect(ended, [SessionEndReason.rejected]);
      expect(auth.isAuthenticated, isFalse);
      expect(auth.currentUser, isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(await TokenStorage.getAccessToken(), isNull);
      expect(await TokenStorage.getUserCache(), isNull);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text(kSessionEndedMessage), findsOneWidget);
    });
  });

  group('SessionEndListener (the HTTP layer reports a rejected refresh token)', () {
    testWidgets('signs out, clears user state and returns to /login with the message', (tester) async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final auth = AuthProvider(request: _requests({'/auth/me': () async => _meOk}));
      addTearDown(auth.dispose);
      final routes = <String>[];

      await tester.pumpWidget(_app(auth, routes: routes));
      await _pumpFrames(tester);
      expect(find.text('shop home'), findsOneWidget);

      ApiService.reportSessionRejected();
      await _pumpFrames(tester, frames: 20);

      expect(auth.isAuthenticated, isFalse);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('shop home'), findsNothing);
      expect(find.text(kSessionEndedMessage), findsOneWidget);
      expect(routes.last, '/login');
    });

    testWidgets('a rejection while nobody is signed in changes nothing', (tester) async {
      final auth = AuthProvider(request: _requests({}));
      addTearDown(auth.dispose);
      final routes = <String>[];

      await tester.pumpWidget(_app(auth, routes: routes));
      await _pumpFrames(tester);
      final before = List<String>.of(routes);

      ApiService.reportSessionRejected();
      await _pumpFrames(tester);

      expect(routes, before);
      expect(find.text(kSessionEndedMessage), findsNothing);
    });
  });

  group('AuthProvider restore, in isolation', () {
    test('restoreSession is local: it answers true before the network answers', () async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final pending = Completer<dynamic>();
      final auth = AuthProvider(request: _requests({'/auth/me': () => pending.future}));

      expect(await auth.restoreSession(), isTrue);
      expect(auth.hasRestored, isTrue);
      expect(auth.isAuthenticated, isTrue);
      pending.complete(_meOk);
      auth.dispose();
    });

    test('restoreSession is idempotent (one storage read, one background check)', () async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final calls = <String>[];
      final auth = AuthProvider(request: _requests({'/auth/me': () async => _meOk}, calls));

      final results = await Future.wait([auth.restoreSession(), auth.restoreSession()]);
      await Future<void>.delayed(Duration.zero);

      expect(results, [true, true]);
      expect(calls.where((c) => c == 'GET /auth/me'), hasLength(1));
      auth.dispose();
    });

    test('refreshToken keeps the session when the server is unreachable', () async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final auth = AuthProvider(request: _requests({}));
      await auth.restoreSession();

      expect(await auth.refreshToken(), isFalse);
      expect(auth.isAuthenticated, isTrue);
      expect(await TokenStorage.getRefreshToken(), 'refresh-1');
      auth.dispose();
    });

    test('logout signs out at once and revokes the token in the background', () async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final calls = <String>[];
      final revoke = Completer<dynamic>();
      final auth = AuthProvider(
        request: _requests({
          '/auth/me': () async => _meOk,
          '/auth/logout': () => revoke.future,
        }, calls),
      );
      await auth.restoreSession();

      await auth.logout(); // returns although the server has not answered

      expect(auth.isAuthenticated, isFalse);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(calls, contains('POST /auth/logout'));
      revoke.complete({'success': true});
      auth.dispose();
    });

    test('a logout the customer chose does not raise the forced session-end event', () async {
      FlutterSecureStorage.setMockInitialValues(_signedInStorage());
      final auth = AuthProvider(request: _requests({'/auth/me': () async => _meOk}));
      await auth.restoreSession();
      final ended = <SessionEndReason>[];
      auth.onSessionEnded.listen(ended.add);

      await auth.logout();
      await Future<void>.delayed(Duration.zero);

      expect(ended, isEmpty);
      auth.dispose();
    });
  });
}
