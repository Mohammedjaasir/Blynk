import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/LocalStorage/store_info_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/help_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/Services/store_info.dart';
import 'package:ecom/UI/Widgets/Organisms/card_cart_prices_detail.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/main.dart' show buildAppProviders;

/// The public GET /store answer, as the backend sends it.
Map<String, dynamic> _store({Object? fee = 100}) => {
      'success': true,
      'data': {
        'delivery_fee_lkr': fee,
        'hub_name': 'Dharga Town',
        'delivery_hours': {'start': '08:00', 'end': '21:00', 'timezone': 'Asia/Colombo'},
        'radius_km': 4,
      },
    };

/// In-memory stand-in for the device cache.
class _Cache {
  _Cache([this.value]);
  String? value;
  final writes = <String>[];
  Future<String?> read() async => value;
  Future<void> write(String v) async {
    writes.add(v);
    value = v;
  }
}

const _milk =
    '{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}';

void main() {
  group('StoreInfoProvider', () {
    test('starts at the default fee', () {
      expect(StoreInfoProvider(request: (_) async => _store()).deliveryFee,
          StoreInfo.defaultDeliveryFee);
    });

    test('reads the fee from GET /store and caches it', () async {
      final urls = <String>[];
      final cache = _Cache();
      final p = StoreInfoProvider(
        request: (url) async {
          urls.add(url);
          return _store(fee: 150);
        },
        readCache: cache.read,
        writeCache: cache.write,
      );
      var notified = 0;
      p.addListener(() => notified++);

      await p.load();

      expect(urls, ['/store']);
      expect(p.deliveryFee, 150);
      expect(notified, 1);
      expect(cache.writes, ['150.0']);
    });

    test('a failed fetch falls back to the cached last good fee', () async {
      final cache = _Cache('120.0');
      final p = StoreInfoProvider(
        request: (_) async => throw ApiException(503, 'down'),
        readCache: cache.read,
        writeCache: cache.write,
      );
      await p.load();
      expect(p.deliveryFee, 120);
      expect(cache.writes, isEmpty);
    });

    test('a failed fetch with nothing cached keeps the default', () async {
      final cache = _Cache();
      final p = StoreInfoProvider(
        request: (_) async => throw ApiException(0, 'offline'),
        readCache: cache.read,
        writeCache: cache.write,
      );
      await p.load();
      expect(p.deliveryFee, StoreInfo.defaultDeliveryFee);
    });

    test('the server answer replaces the cached fee', () async {
      final cache = _Cache('120.0');
      final p = StoreInfoProvider(
        request: (_) async => _store(fee: 90),
        readCache: cache.read,
        writeCache: cache.write,
      );
      await p.load();
      expect(p.deliveryFee, 90);
      expect(cache.value, '90.0');
    });

    for (final bad in <Object?>[null, -1, 1000.01, 5000, double.nan, double.infinity, 'abc', true, <int>[]]) {
      test('ignores a bad server fee ($bad)', () async {
        final cache = _Cache('120.0');
        final p = StoreInfoProvider(
          request: (_) async => _store(fee: bad),
          readCache: cache.read,
          writeCache: cache.write,
        );
        await p.load();
        expect(p.deliveryFee, 120);
        expect(cache.writes, isEmpty);
      });
    }

    for (final shape in <Object?>[null, 'oops', <String, dynamic>{}, {'data': 'x'}, {'data': <String, dynamic>{}}]) {
      test('ignores a malformed response ($shape)', () async {
        final p = StoreInfoProvider(
          request: (_) async => shape,
          readCache: _Cache().read,
          writeCache: _Cache().write,
        );
        await p.load();
        expect(p.deliveryFee, StoreInfo.defaultDeliveryFee);
      });
    }

    test('ignores a bad cached value', () async {
      final p = StoreInfoProvider(
        request: (_) async => throw ApiException(0, 'offline'),
        readCache: _Cache('999999').read,
        writeCache: _Cache().write,
      );
      await p.load();
      expect(p.deliveryFee, StoreInfo.defaultDeliveryFee);
    });

    test('accepts the edges 0 and 1000, and a numeric string', () {
      expect(StoreInfoProvider.parseFee(0), 0);
      expect(StoreInfoProvider.parseFee(1000), 1000);
      expect(StoreInfoProvider.parseFee('100.00'), 100);
      expect(StoreInfoProvider.parseFee(-0.01), isNull);
    });

    test('a hanging cache read does not hold up the server fee', () async {
      final p = StoreInfoProvider(
        request: (_) async => _store(fee: 80),
        readCache: () => Completer<String?>().future,
        writeCache: _Cache().write,
      );
      await p.load();
      expect(p.deliveryFee, 80);
    }, timeout: const Timeout(Duration(seconds: 10)));

    test('a throwing cache is silent', () async {
      final p = StoreInfoProvider(
        request: (_) async => _store(fee: 110),
        readCache: () async => throw StateError('keystore'),
        writeCache: (_) async => throw StateError('keystore'),
      );
      await p.load();
      expect(p.deliveryFee, 110);
    });

    test('concurrent loads share one request', () async {
      var calls = 0;
      final p = StoreInfoProvider(
        request: (_) async {
          calls++;
          return _store(fee: 130);
        },
        readCache: _Cache().read,
        writeCache: _Cache().write,
      );
      await Future.wait([p.load(), p.load()]);
      expect(calls, 1);
    });

    test('the default cache persists across instances (secure storage)', () async {
      FlutterSecureStorage.setMockInitialValues({});
      await StoreInfoProvider(request: (_) async => _store(fee: 175)).load();
      expect(await StoreInfoStorage.readDeliveryFee(), '175.0');

      final offline = StoreInfoProvider(request: (_) async => throw ApiException(0, 'offline'));
      await offline.load();
      expect(offline.deliveryFee, 175);
    });

    test('the app registers it eagerly', () {
      final entries = buildAppProviders().whereType<ChangeNotifierProvider<StoreInfoProvider>>();
      expect(entries, hasLength(1));
    });
  });

  group('screens quote the live fee', () {
    late CartProvider cart;
    late Completer<dynamic> server;
    late StoreInfoProvider store;

    setUp(() => cart = CartProvider());

    // Made inside each test body, not setUp: a future created in setUp's zone
    // completes on a microtask queue the widget tester's fake clock never runs.
    void makeStore() {
      server = Completer<dynamic>();
      store = StoreInfoProvider(
        request: (_) => server.future,
        readCache: _Cache().read,
        writeCache: _Cache().write,
      );
    }

    Future<void> pump(WidgetTester tester, Widget child) async {
      makeStore();
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider.value(value: store),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: Scaffold(body: SingleChildScrollView(child: child)),
          ),
        ),
      );
      await tester.pump();
    }

    test('cartEstimateTotal adds the given fee', () {
      cart.add(ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>()));
      expect(cartEstimateTotal(cart, 250), 790);
    });

    testWidgets('the cart summary rebuilds when the fee arrives', (tester) async {
      cart.add(ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>()));
      await pump(tester, const CartPriceDetailWidget());
      unawaited(store.load());
      await tester.pump();

      // Nothing known yet: the default fee.
      expect(find.text('LKR 100'), findsOneWidget);
      expect(find.text('LKR 640'), findsOneWidget);

      server.complete(_store(fee: 150));
      await tester.pump();
      await tester.pump();

      expect(find.text('LKR 150'), findsOneWidget);
      expect(find.text('LKR 690'), findsOneWidget); // 540 + 150
      expect(find.text('LKR 100'), findsNothing);
    });

    testWidgets('Help quotes the live fee', (tester) async {
      tester.view.physicalSize = const Size(400, 1600);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      makeStore();

      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(theme: AppTheme.appTHeme, home: const HelpScreen()),
        ),
      );
      await tester.tap(find.text('How much is delivery?'));
      await tester.pumpAndSettle();
      expect(find.text('Delivery is a flat LKR 100 per order.'), findsOneWidget);

      unawaited(store.load());
      server.complete(_store(fee: 200));
      await tester.pumpAndSettle();
      expect(find.text('Delivery is a flat LKR 200 per order.'), findsOneWidget);
    });

    testWidgets('without a StoreInfoProvider the default fee is shown', (tester) async {
      cart.add(ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>()));
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: const Scaffold(body: SingleChildScrollView(child: CartPriceDetailWidget())),
          ),
        ),
      );
      expect(find.text('LKR 100'), findsOneWidget);
      expect(find.text('LKR 640'), findsOneWidget);
    });
  });
}
