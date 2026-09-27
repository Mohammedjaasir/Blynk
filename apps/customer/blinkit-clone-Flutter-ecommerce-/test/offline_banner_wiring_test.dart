import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Screens/user_cart_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/connectivity_hint.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/UI/Widgets/Atoms/offline_banner.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/motion.dart';
import 'package:ecom/main.dart' show buildAppProviders;

const _bannerText = "You're offline. Showing saved items.";

Map<String, dynamic> _product() => {
      'id': 'b1',
      'category_id': 'c1',
      'category_name': 'Dairy & Eggs',
      'name': 'Kotmale Fresh Milk 1L',
      'slug': 'milk',
      'sku': 'SKU-1',
      'unit': '1 L',
      'selling_price': 540,
      'is_available': true,
    };

Map<String, dynamic> _productsPage() => {
      'success': true,
      'data': {
        'products': [_product()],
        'pagination': {'page': 1, 'limit': 100, 'total': 1, 'total_pages': 1},
      },
    };

Map<String, dynamic> _categories() => {
      'success': true,
      'data': {
        'categories': [
          {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'description': null, 'image_url': null, 'display_order': 1},
        ],
      },
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ConnectivityHint', () {
    late ConnectivityHint hint;
    late int notified;

    setUp(() {
      hint = ConnectivityHint();
      notified = 0;
      hint.addListener(() => notified++);
    });

    tearDown(() => hint.dispose());

    test('starts online', () => expect(hint.isOffline, isFalse));

    test('an offline-kind failure sets it and a success clears it', () {
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      expect(hint.isOffline, isTrue);
      hint.record(null);
      expect(hint.isOffline, isFalse);
      expect(notified, 2);
    });

    test('a backend 5xx never claims offline, and clears an earlier offline', () {
      for (final status in [500, 502, 503, 504]) {
        hint.record(ApiException(status, 'x'));
        expect(hint.isOffline, isFalse, reason: '$status');
      }
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      expect(hint.isOffline, isTrue);
      hint.record(ApiException(500, 'x'));
      expect(hint.isOffline, isFalse, reason: 'the server answered, so the network works');
    });

    test('a 4xx answer proves the network works', () {
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      hint.record(ApiException(404, 'x'));
      expect(hint.isOffline, isFalse);
    });

    test('a timeout is inconclusive: it leaves the hint as it was', () {
      hint.record(ApiException(408, 'x', code: 'TIMEOUT'));
      expect(hint.isOffline, isFalse);
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      hint.record(ApiException(408, 'x', code: 'TIMEOUT'));
      expect(hint.isOffline, isTrue);
    });

    test('listeners are only told about a change', () {
      hint.record(null);
      hint.record(null);
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      expect(notified, 1);
    });

    test('anything else thrown counts as an unknown failure, not offline', () {
      hint.record(StateError('x'));
      expect(hint.isOffline, isFalse);
    });
  });

  group('fed by the real HTTP client', () {
    late HttpServer server;
    late ConnectivityHint hint;
    var status = 200;

    setUp(() async {
      HttpOverrides.global = null; // flutter_test answers every request with a 400
      FlutterSecureStorage.setMockInitialValues({});
      TokenStorage.resetSerialQueueForTest();
      status = 200;
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) async {
        request.response
          ..statusCode = status
          ..headers.contentType = ContentType.json
          ..write(jsonEncode({'success': status == 200, 'error': {'message': 'boom', 'code': 'X'}}));
        await request.response.close();
      });
      dotenv.testLoad(fileInput: 'API_BASE_URL=http://127.0.0.1:${server.port}/api/v1');
      ApiService.resetDio();
      hint = ConnectivityHint()..attach();
    });

    tearDown(() async {
      hint.dispose();
      await server.close(force: true);
      ApiService.resetDio();
    });

    Future<Object?> call() async {
      try {
        return await ApiService.requestMethods(methodType: 'GET', url: '/catalog/categories');
      } catch (e) {
        return e;
      }
    }

    test('a lost connection sets it, and the next answer clears it (a 500 included)', () async {
      // Point the client at a port nothing listens on: a real connection error.
      final closed = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final deadPort = closed.port;
      await closed.close();
      dotenv.testLoad(fileInput: 'API_BASE_URL=http://127.0.0.1:$deadPort/api/v1');
      ApiService.resetDio();

      final failed = await call();
      expect(failed, isA<ApiException>());
      expect(AppErrors.from(failed).isOffline, isTrue);
      expect(hint.isOffline, isTrue);

      dotenv.testLoad(fileInput: 'API_BASE_URL=http://127.0.0.1:${server.port}/api/v1');
      ApiService.resetDio();
      status = 500;
      await call();
      expect(hint.isOffline, isFalse, reason: 'a 5xx is an answer from the backend, not a lost connection');
    });

    test('a 200 keeps it clear; a 5xx alone never sets it', () async {
      await call();
      expect(hint.isOffline, isFalse);
      status = 503;
      await call();
      expect(hint.isOffline, isFalse);
    });

    test('a disposed hint detaches itself and does not unhook a newer one', () async {
      final other = ConnectivityHint()..attach();
      hint.dispose(); // not the current observer any more
      expect(ApiService.networkObserver, isNotNull);
      other.dispose();
      expect(ApiService.networkObserver, isNull);
      hint = ConnectivityHint(); // for tearDown
    });
  });

  test('the app provides one ConnectivityHint', () {
    final types = buildAppProviders().map((p) => p.runtimeType.toString()).join(' ');
    expect(types, contains('ConnectivityHint'));
  });

  group('the banner on Home, Search and Cart', () {
    late ConnectivityHint hint;
    late ProductProvider products;
    late CartProvider cart;
    var productCalls = 0;

    setUp(() {
      FlutterSecureStorage.setMockInitialValues({});
      hint = ConnectivityHint();
      cart = CartProvider();
      productCalls = 0;
      products = ProductProvider(request: (url, query) async {
        if (url == '/catalog/categories') return _categories();
        if (url == '/promotions') return {'data': {'promotions': []}};
        productCalls++;
        return _productsPage();
      });
    });

    tearDown(() => hint.dispose());

    Widget host(WidgetTester tester, Widget home, {bool withHint = true, ProductProvider? catalog}) {
      tester.view.physicalSize = const Size(430, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      return MultiProvider(
        providers: [
          if (withHint) ChangeNotifierProvider<ConnectivityHint>.value(value: hint),
          ChangeNotifierProvider<ProductProvider>.value(value: catalog ?? products),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<AddressProvider>(create: (_) => AddressProvider()),
          ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
          ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
        ],
        child: MaterialApp(theme: AppTheme.appTHeme, home: home),
      );
    }

    testWidgets('Home shows the banner while offline with saved content, and clears it on the next success', (tester) async {
      await tester.pumpWidget(host(tester, const HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner), findsNothing);

      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner arrives over one motion beat (M9); its sliver is offstage until it has height.
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.text(_bannerText), findsOneWidget);

      hint.record(null);
      await tester.pump();
      // The banner leaves over one motion beat (M9), not in the same frame.
      // Two beats: the crossfade, then the AnimatedSize collapse that follows
      // its own extra layout frame - and the switcher drops the outgoing banner.
      await tester.pump(BlynkMotion.base);
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
    });

    testWidgets('Home never shows it for a server error', (tester) async {
      await tester.pumpWidget(host(tester, const HomeScreen()));
      await tester.pumpAndSettle();
      hint.record(ApiException(500, 'x'));
      await tester.pump();
      // The banner leaves over one motion beat (M9), not in the same frame.
      // Two beats: the crossfade, then the AnimatedSize collapse that follows
      // its own extra layout frame - and the switcher drops the outgoing banner.
      await tester.pump(BlynkMotion.base);
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
    });

    testWidgets('Home shows it only when saved content is on screen (otherwise the offline state speaks)', (tester) async {
      final empty = ProductProvider(request: (url, query) async {
        if (url == '/promotions') return {'data': {'promotions': []}};
        throw ApiException(503, 'x', code: 'NETWORK_ERROR');
      });
      await tester.pumpWidget(host(tester, const HomeScreen(), catalog: empty));
      await tester.pumpAndSettle();
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner arrives over one motion beat (M9); its sliver is offstage until it has height.
      await tester.pump(BlynkMotion.base);
      await tester.pump();

      expect(find.byType(OfflineBanner), findsNothing);
      expect(find.text("You're offline"), findsOneWidget);
    });

    testWidgets('the Home banner retry refreshes the catalog', (tester) async {
      await tester.pumpWidget(host(tester, const HomeScreen()));
      await tester.pumpAndSettle();
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner arrives over one motion beat (M9); its sliver is offstage until it has height.
      await tester.pump(BlynkMotion.base);
      await tester.pump();

      final before = productCalls;
      await tester.tap(find.descendant(of: find.byType(OfflineBanner), matching: find.text('Try again')));
      await tester.pumpAndSettle();
      expect(productCalls, greaterThan(before));
    });

    testWidgets('Search shows it over results that are on screen', (tester) async {
      await tester.pumpWidget(host(tester, const SearchScreen()));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'milk');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.byType(OfflineBanner), findsNothing);

      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner arrives over one motion beat (M9); its sliver is offstage until it has height.
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.text(_bannerText), findsOneWidget);

      hint.record(null);
      await tester.pump();
      // The banner leaves over one motion beat (M9), not in the same frame.
      // Two beats: the crossfade, then the AnimatedSize collapse that follows
      // its own extra layout frame - and the switcher drops the outgoing banner.
      await tester.pump(BlynkMotion.base);
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
    });

    testWidgets('Search shows no banner with nothing to show', (tester) async {
      await tester.pumpWidget(host(tester, const SearchScreen()));
      await tester.pumpAndSettle();
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner leaves over one motion beat (M9), not in the same frame.
      // Two beats: the crossfade, then the AnimatedSize collapse that follows
      // its own extra layout frame - and the switcher drops the outgoing banner.
      await tester.pump(BlynkMotion.base);
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
    });

    testWidgets('Cart shows it while offline with items in the cart', (tester) async {
      cart.add(ProductModel.fromJson(_product()));
      await tester.pumpWidget(host(tester, const CartScreen()));
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner), findsNothing);

      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner arrives over one motion beat (M9); its sliver is offstage until it has height.
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.text(_bannerText), findsOneWidget);

      hint.record(null);
      await tester.pump();
      // The banner leaves over one motion beat (M9), not in the same frame.
      // Two beats: the crossfade, then the AnimatedSize collapse that follows
      // its own extra layout frame - and the switcher drops the outgoing banner.
      await tester.pump(BlynkMotion.base);
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
    });

    testWidgets('an empty Cart shows no banner', (tester) async {
      await tester.pumpWidget(host(tester, const CartScreen()));
      await tester.pumpAndSettle();
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner leaves over one motion beat (M9), not in the same frame.
      // Two beats: the crossfade, then the AnimatedSize collapse that follows
      // its own extra layout frame - and the switcher drops the outgoing banner.
      await tester.pump(BlynkMotion.base);
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
    });

    testWidgets('a host with no ConnectivityHint shows no banner and does not crash', (tester) async {
      cart.add(ProductModel.fromJson(_product()));
      await tester.pumpWidget(host(tester, const CartScreen(), withHint: false));
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the banner is a live region', (tester) async {
      cart.add(ProductModel.fromJson(_product()));
      await tester.pumpWidget(host(tester, const CartScreen()));
      await tester.pumpAndSettle();
      hint.record(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      await tester.pump();
      // The banner arrives over one motion beat (M9); its sliver is offstage until it has height.
      await tester.pump(BlynkMotion.base);
      await tester.pump();

      final node = tester.getSemantics(find.text(_bannerText));
      expect(node.getSemanticsData().flagsCollection.isLiveRegion, isTrue);
    });
  });
}
