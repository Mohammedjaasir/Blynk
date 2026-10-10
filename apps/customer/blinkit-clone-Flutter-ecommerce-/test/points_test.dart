import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/points_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/points_history_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/rewards.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/card_cart_prices_detail.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_rewards_lines.dart';
import 'package:ecom/UI/Widgets/Organisms/profile_rewards_tiles.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';
import 'fixtures/session_fakes.dart';

/// Blynk Points (owner, 2026-10-10): the balance and history, the cart's
/// "You'll earn" estimate, checkout's "Use points" switch and `use_points`.

const _program = {
  'earn_points': 1,
  'earn_per_lkr': 100,
  'lkr_per_point': 1,
  'min_redeem_points': 50,
  'max_redeem_percent': 20,
  'expiry_months': 12,
};

Map<String, dynamic> _checkoutPoints({int balance = 120}) => {
      'enabled': true,
      'balance': balance,
      'value_lkr': balance,
      'earn_points': 1,
      'earn_per_lkr': 100,
      'lkr_per_point': 1,
      'min_redeem_points': 50,
      'max_redeem_percent': 20,
    };

Map<String, dynamic> _me({bool enabled = true}) => {
      'enabled': enabled,
      'balance': 120,
      'value_lkr': 120,
      'program': _program,
      'history': [
        {
          'id': 'h1',
          'kind': 'EARN',
          'points': 40,
          'order_number': 'BL-1001',
          'expires_at': '2027-10-01T00:00:00.000Z',
          'created_at': '2026-10-01T10:00:00.000Z',
        },
        {'id': 'h2', 'kind': 'REDEEM', 'points': -20, 'order_number': 'BL-1002', 'expires_at': null, 'created_at': '2026-10-05T10:00:00.000Z'},
        {'id': 'h3', 'kind': 'REFUND', 'points': 20, 'order_number': 'BL-1002', 'created_at': '2026-10-06T10:00:00.000Z'},
        {'id': 'h4', 'kind': 'EXPIRE', 'points': -5, 'created_at': '2026-10-07T10:00:00.000Z'},
        {'id': 'h5', 'kind': 'ADJUST', 'points': 85, 'created_at': '2026-10-08T10:00:00.000Z'},
        {'id': 'h6', 'kind': 'SOMETHING_NEW', 'points': 1},
      ],
    };

const _milk = ProductModel(
  id: 'p1',
  categoryId: 'c1',
  categoryName: 'Dairy & Eggs',
  name: 'Kotmale Fresh Milk 1L',
  slug: 'milk',
  sku: 'SKU-1',
  unit: '1 L',
  sellingPrice: 540,
  isAvailable: true,
);

StoreInfoProvider _store({Map<String, dynamic>? points}) => StoreInfoProvider(
      request: (url) async => {
        'success': true,
        'data': {
          if (url == '/store') 'delivery_fee_lkr': 100,
          if (url == '/orders/checkout-info' && points != null) 'points': points,
        },
      },
      readCache: () async => null,
      writeCache: (_) async {},
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('models', () {
    test('GET /me/points parses, labels each kind and skips unknown ones', () {
      final p = PointsInfo.tryParse(_me())!;
      expect(p.balanceText, '120 Blynk Points = LKR 120');
      expect(p.history.map((e) => e.label), [
        'Earned on order BL-1001',
        'Used on order BL-1002',
        'Returned (order cancelled)',
        'Expired',
        'Adjusted by Blynk',
      ]);
      expect(p.history.map((e) => e.pointsLabel), ['+40', '-20', '+20', '-5', '+85']);
      expect(p.history.first.expiresAt, isNotNull);
      expect(pointsBalanceText(1, 1), '1 Blynk Point = LKR 1');
      expect(PointsInfo.tryParse(null), isNull);
    });

    test('"how it works" comes from the programme numbers', () {
      final how = PointsInfo.tryParse(_me())!.program!.howItWorks;
      expect(how, contains('Earn 1 point for every LKR 100 you spend on items, once your order is delivered.'));
      expect(how, contains('Use points once you have 50 or more.'));
      expect(how, contains('Points can pay up to 20% of an order.'));
      expect(how, contains('Points expire 12 months after you earn them.'));
    });

    test('earn and redeem estimates follow the formulas', () {
      final program = PointsProgram.fromMap(_program);
      expect(program.earnEstimate(540), 5);
      expect(program.earnEstimate(99), 0);
      // due 640: 20% = 128 LKR = 128 points, but only 120 held.
      expect(program.usablePoints(balance: 120, due: 640), 120);
      // due 300: 20% = 60 points.
      expect(program.usablePoints(balance: 120, due: 300), 60);
      expect(program.usablePoints(balance: 40, due: 640), 0, reason: 'below the minimum');
      final half = PointsProgram.fromMap({..._program, 'lkr_per_point': 0.5});
      expect(half.usablePoints(balance: 500, due: 640), 256);
      expect(half.valueOf(256), 128);
      expect(half.valueOf(3), 1.5);
    });

    test('checkout-info points: offered only at or above the minimum', () async {
      final store = _store(points: _checkoutPoints());
      await store.loadCheckoutInfo(signedIn: true);
      expect(store.checkoutPoints!.canRedeem, isTrue);
      expect(store.checkoutPoints!.program.earnPerLkr, 100);
      expect(CheckoutPoints.tryParse(_checkoutPoints(balance: 40))!.canRedeem, isFalse);
      await store.loadCheckoutInfo(signedIn: false);
      expect(store.checkoutPoints, isNull);
    });
  });

  group('use_points', () {
    test('is sent only while the switch is on, and resets after the order', () async {
      final bodies = <Map>[];
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        bodies.add(body as Map);
        return {'success': true, 'data': {'order': orderJson(id: 'o1')}};
      });
      await orders.placeOrder(cart: CartProvider()..add(_milk), addressId: 'a1');
      expect(bodies.last.containsKey('use_points'), isFalse);
      orders.setUsePoints(true);
      await orders.placeOrder(cart: CartProvider()..add(_milk), addressId: 'a1');
      expect(bodies.last['use_points'], isTrue);
      expect(orders.usePoints, isFalse);
    });

    test('a failed order keeps the switch for the retry', () async {
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        throw ApiException(500, 'x');
      });
      orders.setUsePoints(true);
      await expectLater(orders.placeOrder(cart: CartProvider()..add(_milk), addressId: 'a1'), throwsA(isA<ApiException>()));
      expect(orders.usePoints, isTrue);
    });
  });

  group('widgets', () {
    Future<OrderProvider> pumpCheckout(WidgetTester tester, StoreInfoProvider store, {bool redeem = true}) async {
      final orders = OrderProvider(request: (m, u, {body, query}) async => {});
      tester.view.physicalSize = const Size(480, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
            ChangeNotifierProvider.value(value: store),
            ChangeNotifierProvider.value(value: orders),
            ChangeNotifierProvider(create: (_) => CartProvider()..add(_milk)),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: Scaffold(
              body: ListView(
                children: [
                  CartRewardsLines(allowRedeem: redeem),
                  const CartPriceDetailWidget(showBirthday: true),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      return orders;
    }

    testWidgets('the cart says what the order will earn, with no switch', (tester) async {
      final store = _store(points: _checkoutPoints());
      await store.loadCheckoutInfo(signedIn: true);
      await pumpCheckout(tester, store, redeem: false);
      expect(find.byKey(CartRewardsLines.earnKey), findsOneWidget);
      expect(find.text("You'll earn about 5 Blynk Points when this order is delivered"), findsOneWidget);
      expect(find.byKey(CartRewardsLines.usePointsKey), findsNothing);
    });

    testWidgets('checkout: "Use points" is off by default; on, it estimates the discount', (tester) async {
      final store = _store(points: _checkoutPoints());
      await store.loadCheckoutInfo(signedIn: true);
      final orders = await pumpCheckout(tester, store);
      expect(find.text('You have 120 points = LKR 120'), findsOneWidget);
      expect(orders.usePoints, isFalse);
      expect(find.byKey(const Key('summary-points')), findsNothing);
      expect(find.text('LKR 640'), findsOneWidget);

      await tester.tap(find.byKey(CartRewardsLines.usePointsKey));
      await tester.pump();
      expect(orders.usePoints, isTrue);
      // due 640, 20% cap = 128 points; 120 held -> LKR 120 off.
      expect(find.byKey(CartRewardsLines.pointsValueKey), findsOneWidget);
      expect(find.textContaining('About 120 points (LKR 120) off this order'), findsOneWidget);
      expect(find.byKey(const Key('summary-points')), findsOneWidget);
      expect(find.text('LKR 520'), findsOneWidget);
    });

    testWidgets('below the minimum there is no switch', (tester) async {
      final store = _store(points: _checkoutPoints(balance: 40));
      await store.loadCheckoutInfo(signedIn: true);
      await pumpCheckout(tester, store);
      expect(find.byKey(CartRewardsLines.usePointsKey), findsNothing);
      expect(find.byKey(CartRewardsLines.earnKey), findsOneWidget);
    });

    testWidgets('points off: nothing shows', (tester) async {
      final store = _store();
      await store.loadCheckoutInfo(signedIn: true);
      await pumpCheckout(tester, store);
      expect(find.byKey(CartRewardsLines.earnKey), findsNothing);
      expect(find.byKey(CartRewardsLines.usePointsKey), findsNothing);
    });

    Future<void> pumpRewards(WidgetTester tester, Widget home, Map<String, dynamic> me) async {
      final rewards = RewardsProvider(
        request: (method, url, {body}) async {
          if (url == '/me/points') return {'success': true, 'data': me};
          throw ApiException(404, 'x');
        },
        readPendingReferral: () async => null,
        clearPendingReferral: () async {},
      );
      tester.view.physicalSize = const Size(480, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
            ChangeNotifierProvider.value(value: rewards),
          ],
          child: MaterialApp(theme: AppTheme.appTHeme, home: home),
        ),
      );
      await tester.pump();
      await tester.pump();
    }

    testWidgets('Profile shows the balance tile while points are on', (tester) async {
      await pumpRewards(tester, const Scaffold(body: ProfileRewardsTiles()), _me());
      expect(find.byKey(ProfileRewardsTiles.pointsKey), findsOneWidget);
      expect(find.text('120 Blynk Points = LKR 120'), findsOneWidget);
    });

    testWidgets('the history screen lists every entry with expiry dates', (tester) async {
      await pumpRewards(tester, const PointsHistoryScreen(), _me());
      expect(find.byKey(PointsHistoryScreen.balanceKey), findsOneWidget);
      expect(find.text('How it works'), findsOneWidget);
      expect(find.text('Earned on order BL-1001'), findsOneWidget);
      expect(find.textContaining('Expires 1 October 2027'), findsOneWidget);
      expect(find.text('Used on order BL-1002'), findsOneWidget);
      expect(find.text('Returned (order cancelled)'), findsOneWidget);
      expect(find.text('Expired'), findsOneWidget);
      expect(find.text('Adjusted by Blynk'), findsOneWidget);
      expect(find.text('-20'), findsOneWidget);
    });

    testWidgets('points off: the history screen says so', (tester) async {
      await pumpRewards(tester, const PointsHistoryScreen(), _me(enabled: false));
      expect(find.text('Not available right now'), findsOneWidget);
    });
  });
}
