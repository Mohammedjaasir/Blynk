import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/push/push_notifications.dart';
import 'package:ecom/Services/push/push_platform.dart';
import 'package:ecom/UI/Widgets/Atoms/notify_me_button.dart';
import 'package:ecom/app_theme.dart';

/// "Notify me when it's back" on a sold-out product (phase 6), against a
/// fake catalog API and a fake push platform.
const _id = 'b0000001-0000-0000-0000-000000000001';

Map<String, dynamic> _detail({bool available = false, bool subscribed = false}) => {
      'success': true,
      'data': {
        'product': {
          'id': _id,
          'category_id': 'c1',
          'category_name': 'Dairy & Eggs',
          'name': 'Kotmale Fresh Milk 1L',
          'slug': 'kotmale-fresh-milk-1l',
          'description': null,
          'sku': 'SKU-DAI-001',
          'barcode': null,
          'unit': '1 L',
          'pack_size': null,
          'image_url': null,
          'selling_price': 540,
          'is_available': available,
          'notify_me_subscribed': subscribed,
        },
      },
    };

class _PermissionCounter implements PushPlatform {
  int asked = 0;
  @override
  String get platformName => 'android';
  @override
  Future<void> initialize() async {}
  @override
  Future<Map<String, dynamic>?> launchData() async => null;
  @override
  Stream<Map<String, dynamic>> get taps => const Stream.empty();
  @override
  Future<String?> getToken() async => null;
  @override
  Stream<String> get onTokenRefresh => const Stream.empty();
  @override
  Future<void> deleteToken() async {}
  @override
  Future<void> requestPermission() async => asked++;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, dynamic> Function() detail;
  late List<String> mutations;
  late Future<dynamic> Function(String method, String url) onMutate;
  late _PermissionCounter permission;
  late PushNotifications previousPush;

  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({});
    detail = () => _detail();
    mutations = [];
    onMutate = (method, url) async => {'success': true};
    permission = _PermissionCounter();
    previousPush = PushNotifications.instance;
    PushNotifications.instance = PushNotifications(
      platform: permission,
      enabled: true,
      register: (_, __) async {},
      unregister: (_, __) async {},
    );
  });
  tearDown(() {
    PushNotifications.instance = previousPush;
    TokenStorage.resetSerialQueueForTest();
  });

  Future<AuthProvider> signedIn(WidgetTester tester) async {
    FlutterSecureStorage.setMockInitialValues({'blynk_access_token': 'a', 'blynk_refresh_token': 'r'});
    final auth = AuthProvider(request: ({methodType, url, body}) async => {});
    await tester.runAsync(() => auth.restoreSession());
    return auth;
  }

  Future<List<String>> pump(WidgetTester tester, AuthProvider auth) async {
    await tester.runAsync(() => PushNotifications.instance.start());
    tester.view.physicalSize = const Size(400, 860);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final routes = <String>[];
    final products = ProductProvider(
      request: (url, query) async => detail(),
      mutate: (method, url) {
        mutations.add('$method $url');
        return onMutate(method, url);
      },
    );
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: products),
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        home: const ProductDetailsScreen(productId: _id),
        onGenerateRoute: (settings) {
          routes.add(settings.name ?? '');
          return MaterialPageRoute(settings: settings, builder: (_) => Text('route:${settings.name}'));
        },
      ),
    ));
    await settle(tester);
    return routes;
  }

  testWidgets('a sold-out product offers the button; an available one does not', (tester) async {
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await pump(tester, auth);
    expect(find.text(kNotifyMeLabel), findsOneWidget);

    detail = () => _detail(available: true);
    final again = AuthProvider();
    addTearDown(again.dispose);
    await pump(tester, again);
    expect(find.text(kNotifyMeLabel), findsNothing);
  });

  testWidgets('a guest is sent to log in, and nothing is sent', (tester) async {
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    final routes = await pump(tester, auth);
    await tester.ensureVisible(find.text(kNotifyMeLabel));
    await tester.tap(find.text(kNotifyMeLabel));
    await settle(tester);
    expect(routes, contains('/login'));
    expect(mutations, isEmpty);
  });

  testWidgets('signed in: tapping subscribes, says so, and asks to allow notifications', (tester) async {
    final auth = await signedIn(tester);
    addTearDown(auth.dispose);
    await pump(tester, auth);
    await tester.ensureVisible(find.text(kNotifyMeLabel));
    await tester.tap(find.text(kNotifyMeLabel));
    await settle(tester);
    expect(mutations, ['POST /catalog/products/$_id/notify-me']);
    expect(find.text(kNotifyMeOnLabel), findsOneWidget);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
    expect(permission.asked, 1);

    // Tapping again cancels.
    await tester.tap(find.text(kNotifyMeOnLabel));
    await settle(tester);
    expect(mutations.last, 'DELETE /catalog/products/$_id/notify-me');
    expect(find.text(kNotifyMeLabel), findsOneWidget);
  });

  testWidgets('shows an existing alert from the product response', (tester) async {
    detail = () => _detail(subscribed: true);
    final auth = await signedIn(tester);
    addTearDown(auth.dispose);
    await pump(tester, auth);
    expect(find.text(kNotifyMeOnLabel), findsOneWidget);
  });

  testWidgets('if it came back meanwhile (409), the page re-reads and shows it on sale', (tester) async {
    final auth = await signedIn(tester);
    addTearDown(auth.dispose);
    await pump(tester, auth);
    onMutate = (method, url) async {
      detail = () => _detail(available: true);
      throw ApiException(409, 'This product is available now.', code: 'PRODUCT_AVAILABLE');
    };
    await tester.ensureVisible(find.text(kNotifyMeLabel));
    await tester.tap(find.text(kNotifyMeLabel));
    await settle(tester);
    expect(find.text(kNotifyMeLabel), findsNothing);
    expect(find.text('Available'), findsOneWidget);
  });
}

// Bounded: skeleton pulses repeat forever, so pumpAndSettle can't.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
