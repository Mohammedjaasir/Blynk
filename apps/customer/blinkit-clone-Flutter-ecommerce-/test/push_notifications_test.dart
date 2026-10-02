import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/push/push_notifications.dart';
import 'package:ecom/Services/push/push_platform.dart';
import 'package:ecom/app_theme.dart';

/// Phase 6 push notifications, with a fake device side: no Firebase here.
class FakePushPlatform implements PushPlatform {
  FakePushPlatform({this.launch, this.failInit = false, this.token = 'tok-1'});

  Map<String, dynamic>? launch;
  bool failInit;
  String? token;
  int initCalls = 0;
  int permissionCalls = 0;
  int deleteCalls = 0;
  final taps$ = StreamController<Map<String, dynamic>>.broadcast();
  final refresh$ = StreamController<String>.broadcast();

  @override
  String get platformName => 'android';
  @override
  Future<void> initialize() async {
    initCalls++;
    if (failInit) throw StateError('google-services.json missing');
  }

  @override
  Future<Map<String, dynamic>?> launchData() async => launch;
  @override
  Stream<Map<String, dynamic>> get taps => taps$.stream;
  @override
  Future<String?> getToken() async => token;
  @override
  Stream<String> get onTokenRefresh => refresh$.stream;
  @override
  Future<void> deleteToken() async => deleteCalls++;
  @override
  Future<void> requestPermission() async => permissionCalls++;
}

class Calls {
  final registered = <String>[];
  final unregistered = <String>[];
}

PushNotifications makePush(FakePushPlatform platform, Calls calls, {bool enabled = true}) => PushNotifications(
      platform: platform,
      enabled: enabled,
      register: (token, platform) async => calls.registered.add('$token/$platform'),
      unregister: (token, access) async => calls.unregistered.add('$token/$access'),
    );

Future<void> pumpFrames(WidgetTester tester, [int frames = 40]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PushTarget', () {
    test('an order update opens the order, a back-in-stock alert the product', () {
      final order = PushTarget.fromData({'type': 'order', 'order_id': 'o-1'})!;
      expect((order.route, order.id), ('/order', 'o-1'));
      final product = PushTarget.fromData({'type': 'product', 'product_id': 'p-1'})!;
      expect((product.route, product.id), ('/product', 'p-1'));
    });

    test('anything else opens nothing', () {
      expect(PushTarget.fromData(null), isNull);
      expect(PushTarget.fromData({}), isNull);
      expect(PushTarget.fromData({'type': 'order'}), isNull);
      expect(PushTarget.fromData({'type': 'order', 'order_id': '  '}), isNull);
      expect(PushTarget.fromData({'type': 'promo', 'id': 'x'}), isNull);
    });
  });

  group('PushNotifications', () {
    test('disabled (the web build): never touches the platform, every call is a no-op', () async {
      final platform = FakePushPlatform(launch: {'type': 'order', 'order_id': 'o-1'});
      final calls = Calls();
      final push = makePush(platform, calls, enabled: false);
      expect(await push.start(), isFalse);
      await push.signedIn();
      await push.requestPermission();
      await push.signedOut(accessToken: 'a');
      expect(await push.takeLaunchTarget(), isNull);
      expect(platform.initCalls, 0);
      expect(platform.permissionCalls, 0);
      expect(platform.deleteCalls, 0);
      expect(calls.registered, isEmpty);
    });

    test('a failed Firebase start leaves the app running with push off', () async {
      final platform = FakePushPlatform(failInit: true);
      final calls = Calls();
      final push = makePush(platform, calls);
      expect(await push.start(), isFalse);
      await push.signedIn();
      await push.requestPermission();
      expect(calls.registered, isEmpty);
      expect(platform.permissionCalls, 0);
    });

    test('nothing happens before start (tests and the start-up race)', () async {
      final calls = Calls();
      final push = makePush(FakePushPlatform(), calls);
      await push.signedIn();
      expect(calls.registered, isEmpty);
      expect(await push.takeLaunchTarget(), isNull);
    });

    test('sign-in registers the token; a refreshed token is registered again while signed in', () async {
      final platform = FakePushPlatform();
      final calls = Calls();
      final push = makePush(platform, calls);
      await push.start();
      await push.signedIn();
      expect(calls.registered, ['tok-1/android']);

      platform.refresh$.add('tok-2');
      await Future<void>.delayed(Duration.zero);
      expect(calls.registered, ['tok-1/android', 'tok-2/android']);

      await push.signedOut(accessToken: 'access-1');
      expect(calls.unregistered, ['tok-2/access-1']);
      expect(platform.deleteCalls, 1);

      // Signed out: a refresh is not registered.
      platform.refresh$.add('tok-3');
      await Future<void>.delayed(Duration.zero);
      expect(calls.registered, hasLength(2));
    });

    test('logout without an access token still retires the token at FCM', () async {
      final platform = FakePushPlatform();
      final calls = Calls();
      final push = makePush(platform, calls);
      await push.start();
      await push.signedIn();
      await push.signedOut();
      expect(calls.unregistered, isEmpty);
      expect(platform.deleteCalls, 1);
    });

    test('a failing registration (offline) is swallowed', () async {
      final push = PushNotifications(
        platform: FakePushPlatform(),
        enabled: true,
        register: (_, __) async => throw ApiException(503, 'offline'),
        unregister: (_, __) async {},
      );
      await push.start();
      await push.signedIn(); // does not throw
    });

    test('the launch tap (cold start) is handed out once', () async {
      final push = makePush(FakePushPlatform(launch: {'type': 'product', 'product_id': 'p-9'}), Calls());
      await push.start();
      final first = await push.takeLaunchTarget();
      expect((first?.route, first?.id), ('/product', 'p-9'));
      expect(await push.takeLaunchTarget(), isNull);
    });

    test('permission is asked only when push is on', () async {
      final platform = FakePushPlatform();
      final push = makePush(platform, Calls());
      await push.start();
      await push.requestPermission();
      expect(platform.permissionCalls, 1);
    });

    testWidgets('a tap (background or foreground) opens the order or the product', (tester) async {
      final platform = FakePushPlatform();
      final navigatorKey = GlobalKey<NavigatorState>();
      final opened = <String>[];
      final push = makePush(platform, Calls());
      addTearDown(push.dispose);
      await tester.pumpWidget(MaterialApp(
        navigatorKey: navigatorKey,
        home: const Text('home'),
        onGenerateRoute: (settings) {
          opened.add('${settings.name} ${settings.arguments}');
          return MaterialPageRoute(settings: settings, builder: (_) => Text('${settings.name}'));
        },
      ));
      await tester.runAsync(() => push.start(navigatorKey: navigatorKey));

      platform.taps$.add({'type': 'order', 'order_id': 'o-7'});
      await tester.pumpAndSettle();
      platform.taps$.add({'type': 'product', 'product_id': 'p-7'});
      await tester.pumpAndSettle();
      platform.taps$.add({'type': 'unknown'});
      await tester.pumpAndSettle();
      expect(opened, ['/order o-7', '/product p-7']);
    });
  });

  group('PushSessionSync', () {
    setUp(() {
      TokenStorage.resetSerialQueueForTest();
      FlutterSecureStorage.setMockInitialValues({
        'blynk_access_token': 'access-1',
        'blynk_refresh_token': 'refresh-1',
      });
    });
    tearDown(TokenStorage.resetSerialQueueForTest);

    testWidgets('registers on a restored session and unregisters on logout', (tester) async {
      final platform = FakePushPlatform();
      final calls = Calls();
      final push = makePush(platform, calls);
      addTearDown(push.dispose);
      await tester.runAsync(() => push.start());
      final auth = AuthProvider(request: ({methodType, url, body}) async => {});
      addTearDown(auth.dispose);

      await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: PushSessionSync(push: push, child: const SizedBox()),
      ));
      await tester.runAsync(() => auth.restoreSession());
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      expect(calls.registered, ['tok-1/android']);

      await tester.runAsync(() => auth.logout());
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      expect(calls.unregistered, ['tok-1/access-1']);
      expect(platform.deleteCalls, 1);
    });
  });

  group('SessionGate', () {
    late PushNotifications previous;
    setUp(() {
      previous = PushNotifications.instance;
      TokenStorage.resetSerialQueueForTest();
      FlutterSecureStorage.setMockInitialValues({});
    });
    tearDown(() {
      PushNotifications.instance = previous;
      TokenStorage.resetSerialQueueForTest();
    });

    testWidgets('a notification that launched the app opens its order once the gate has decided', (tester) async {
      final push = makePush(FakePushPlatform(launch: {'type': 'order', 'order_id': 'o-42'}), Calls());
      PushNotifications.instance = push;
      await tester.runAsync(() => push.start());
      final auth = AuthProvider(request: ({methodType, url, body}) async => throw ApiException(503, 'offline'));
      addTearDown(auth.dispose);
      final routes = <String>[];
      final navigatorKey = GlobalKey<NavigatorState>();
      final messengerKey = GlobalKey<ScaffoldMessengerState>();

      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider(create: (_) => AddressProvider()),
          ChangeNotifierProvider(create: (_) => OrderProvider(request: (m, u, {body, query}) async => {})),
          ChangeNotifierProvider(create: (_) => CartProvider()),
          ChangeNotifierProvider(create: (_) => LocationProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.theme,
          navigatorKey: navigatorKey,
          scaffoldMessengerKey: messengerKey,
          builder: (context, child) => SessionEndListener(
            navigatorKey: navigatorKey,
            messengerKey: messengerKey,
            child: child!,
          ),
          onGenerateRoute: (settings) {
            routes.add('${settings.name} ${settings.arguments}');
            final Widget page = settings.name == '/' ? const SessionGate() : Scaffold(body: Text('${settings.name}'));
            return MaterialPageRoute(settings: settings, builder: (_) => page);
          },
        ),
      ));
      await pumpFrames(tester);
      expect(routes, contains('/order o-42'));
      expect(routes.where((r) => r.startsWith('/order')), hasLength(1));
    });
  });
}
