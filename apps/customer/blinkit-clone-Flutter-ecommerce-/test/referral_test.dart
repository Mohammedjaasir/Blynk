import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/coupon_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/referral_model.dart';
import 'package:ecom/Screens/Auth/name_capture_screen.dart';
import 'package:ecom/Screens/refer_friend_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/rewards.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/Services/referral_link.dart';
import 'package:ecom/Services/share_links.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_rewards_lines.dart';
import 'package:ecom/UI/Widgets/Organisms/order_bill_card.dart';
import 'package:ecom/UI/Widgets/Organisms/profile_rewards_tiles.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/session_fakes.dart';

/// Refer a friend (owner, 2026-10-10): the app's half - parsing, wording,
/// the share text, applying a code (typed, at sign-up, or from a link) and
/// where the reward shows. The rules themselves are the backend's.

Map<String, dynamic> _referral({
  bool enabled = true,
  String mode = 'LKR_OFF',
  bool canApply = true,
  List<Map<String, dynamic>> credits = const [],
}) =>
    {
      'enabled': enabled,
      'code': 'NIMAL7K2',
      'reward': {'mode': mode, 'friend_amount_lkr': 150, 'inviter_amount_lkr': 200},
      'invited_count': 3,
      'rewarded_count': 1,
      'credits': credits,
      'referred_by': null,
      'can_apply_code': canApply,
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

/// A RewardsProvider whose server answers from [routes] ("METHOD url" ->
/// response, or an exception to throw).
RewardsProvider _rewards(
  Map<String, Object> routes, {
  List<String>? calls,
  Future<String?> Function()? readPending,
  Future<void> Function()? clearPending,
}) =>
    RewardsProvider(
      request: (method, url, {body}) async {
        calls?.add('$method $url${body == null ? '' : ' $body'}');
        final hit = routes['$method $url'];
        if (hit == null) throw ApiException(404, 'nope');
        if (hit is Exception) throw hit;
        return hit;
      },
      readPendingReferral: readPending ?? () async => null,
      clearPendingReferral: clearPending ?? () async {},
    );

class _GuestAuth extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('models', () {
    test('GET /me/referral parses, and the reward is worded from the data', () {
      final r = ReferralInfo.tryParse(_referral(credits: [
        {'mode': 'LKR_OFF', 'amount_lkr': 200},
        {'mode': 'FREE_DELIVERY', 'amount_lkr': 0},
      ]))!;
      expect(r.enabled, isTrue);
      expect(r.code, 'NIMAL7K2');
      expect(r.invitedCount, 3);
      expect(r.rewardedCount, 1);
      expect(r.canApplyCode, isTrue);
      expect(r.credits.map((c) => c.label), ['LKR 200 off', 'A free delivery']);
      expect(
        r.reward!.description,
        'Your friend gets LKR 150 off their first order. You get LKR 200 off your next order after their first order is delivered.',
      );
      expect(
        ReferralInfo.tryParse(_referral(mode: 'FREE_DELIVERY'))!.reward!.description,
        "Your friend gets a free delivery on their first order; you get a free delivery after it's delivered.",
      );
      expect(ReferralInfo.tryParse(null), isNull);
      expect(ReferralInfo.tryParse({'code': 'X'}), isNull);
    });

    test('checkout-info referral_reward: line text and estimate', () {
      final off = CheckoutReferralReward.tryParse(
          {'available': true, 'side': 'FRIEND', 'mode': 'LKR_OFF', 'amount_lkr': 150})!;
      expect(off.lineText, 'Referral reward: LKR 150 off this order');
      expect(off.estimateOn(subtotal: 540, deliveryFee: 100), 150);
      expect(off.estimateOn(subtotal: 100, deliveryFee: 100), 100);
      final free = CheckoutReferralReward.tryParse(
          {'available': true, 'side': 'INVITER', 'mode': 'FREE_DELIVERY', 'amount_lkr': 0})!;
      expect(free.lineText, 'Referral reward: free delivery on this order');
      expect(free.estimateOn(subtotal: 540, deliveryFee: 100), 100);
      final none = CheckoutReferralReward.tryParse({'available': false, 'side': null, 'mode': null, 'amount_lkr': 0})!;
      expect(none.available, isFalse);
      expect(none.estimateOn(subtotal: 540, deliveryFee: 100), 0);
    });

    test('validate-coupon can say the referral reward wins', () {
      final data = {
        'coupon': {'code': 'SAVE20', 'discount_type': 'FIXED', 'discount_amount': 20, 'total': 620},
        'birthday_discount_amount': 0,
        'referral_discount_amount': 150,
        'applied_discount': 'REFERRAL',
        'total': 490,
      };
      final p = CouponPreview.tryParse(data['coupon'], envelope: data)!;
      expect(p.referralWins, isTrue);
      expect(p.birthdayWins, isFalse);
      expect(p.referralDiscountAmount, 150);
      expect(CouponPreview.tryParse(data['coupon'])!.referralWins, isFalse);
    });

    test('a placed order carries its referral and points discounts', () {
      final o = OrderModel.fromJson({
        'id': 'o1',
        'order_number': 'BL-1',
        'order_status': 'PLACED',
        'subtotal_amount': 540,
        'delivery_fee': 100,
        'discount_amount': 270,
        'referral_discount_amount': 150,
        'points_redeemed': 120,
        'points_discount_amount': 120,
        'total_amount': 370,
      });
      expect(o.referralDiscountAmount, 150);
      expect(o.pointsRedeemed, 120);
      expect(o.pointsDiscountAmount, 120);
      expect(o.couponOrGiftDiscount, 0);
      final old = OrderModel.fromJson({'id': 'o2', 'discount_amount': 20, 'coupon_code': 'SAVE20'});
      expect(old.referralDiscountAmount, 0);
      expect(old.pointsRedeemed, 0);
      expect(old.couponOrGiftDiscount, 20);
    });

    testWidgets('the bill names the referral reward and the points', (tester) async {
      final o = OrderModel.fromJson({
        'id': 'o1',
        'order_number': 'BL-1',
        'order_status': 'PLACED',
        'subtotal_amount': 540,
        'delivery_fee': 100,
        'discount_amount': 290,
        'coupon_code': 'SAVE20',
        'referral_discount_amount': 150,
        'points_redeemed': 120,
        'points_discount_amount': 120,
        'total_amount': 350,
      });
      await tester.pumpWidget(MaterialApp(theme: AppTheme.appTHeme, home: Scaffold(body: OrderBillCard(order: o))));
      expect(find.text('Discount (SAVE20)'), findsOneWidget);
      expect(find.text('−LKR 20'), findsOneWidget);
      expect(find.text('Referral reward'), findsOneWidget);
      expect(find.text('−LKR 150'), findsOneWidget);
      expect(find.text('Blynk Points (120 used)'), findsOneWidget);
      expect(find.text('−LKR 120'), findsOneWidget);
    });
  });

  group('share text and links', () {
    test('the link is <SHARE_BASE_URL>/app/?ref=CODE, only from an https address', () {
      expect(ShareLinks.referralUrl('NIMAL7K2', baseUrl: 'https://blynk.lk'), 'https://blynk.lk/app/?ref=NIMAL7K2');
      expect(ShareLinks.referralUrl('NIMAL7K2', baseUrl: ''), isNull);
      expect(ShareLinks.referralUrl('NIMAL7K2', baseUrl: 'http://blynk.lk'), isNull);
      expect(ShareLinks.referralUrl('a b', baseUrl: 'https://blynk.lk'), isNull);
    });

    test('without an address only the code is shared', () {
      final text = ShareLinks.referralShareText('NIMAL7K2', baseUrl: '');
      expect(text, contains('NIMAL7K2'));
      expect(text, isNot(contains('http')));
      expect(ShareLinks.referralShareText('NIMAL7K2', baseUrl: 'https://blynk.lk'),
          contains('https://blynk.lk/app/?ref=NIMAL7K2'));
    });

    test('the code is read from a page address', () {
      expect(ReferralLink.codeFrom(Uri.parse('https://blynk.lk/app/?ref=nimal7k2#/home')), 'NIMAL7K2');
      expect(ReferralLink.codeFrom(Uri.parse('https://blynk.lk/app/')), isNull);
      expect(ReferralLink.codeFrom(Uri.parse('https://blynk.lk/app/?ref=%3Cscript%3E')), isNull);
    });
  });

  group('applying a code', () {
    test('the refusals read as this app\'s words', () {
      expect(AppErrors.from(ApiException(422, 'x', code: 'REFERRAL_SELF')).message,
          "That's your own code. Enter a friend's code instead.");
      expect(AppErrors.from(ApiException(404, 'x', code: 'REFERRAL_CODE_NOT_FOUND')).message,
          "We couldn't find that referral code. Check it and try again.");
      expect(AppErrors.from(ApiException(409, 'x', code: 'REFERRAL_ALREADY_APPLIED')).message,
          "You've already used a referral code.");
      expect(AppErrors.from(ApiException(422, 'x', code: 'REFERRAL_NOT_NEW_CUSTOMER')).message,
          'Referral codes are for new customers before their first order.');
      expect(AppErrors.from(ApiException(422, 'x', code: 'REFERRALS_DISABLED')).message,
          "Referral codes can't be used right now.");
    });

    test('POST /me/referral/apply: success and a refusal', () async {
      final calls = <String>[];
      final ok = _rewards({
        'POST /me/referral/apply': {
          'success': true,
          'data': {'status': 'PENDING', 'inviter_first_name': 'Nimal'},
        },
      }, calls: calls);
      final good = await ok.applyReferralCode(' nimal7k2 ');
      expect(good.ok, isTrue);
      expect(good.inviterFirstName, 'Nimal');
      expect(calls, ['POST /me/referral/apply {code: NIMAL7K2}']);

      final no = _rewards({'POST /me/referral/apply': ApiException(422, 'x', code: 'REFERRAL_SELF')});
      final bad = await no.applyReferralCode('NIMAL7K2');
      expect(bad.ok, isFalse);
      expect(bad.error, "That's your own code. Enter a friend's code instead.");
      expect((await no.applyReferralCode('')).error, 'Enter a code.');
    });

    test('a code from a link is applied once and forgotten; a refusal is forgotten quietly', () async {
      var cleared = 0;
      final ok = _rewards(
        {'POST /me/referral/apply': {'success': true, 'data': {'status': 'PENDING', 'inviter_first_name': null}}},
        readPending: () async => 'NIMAL7K2',
        clearPending: () async => cleared++,
      );
      expect(await ok.applyPendingReferral(), 'Referral code applied. Your first order gets the reward.');
      expect(cleared, 1);

      final refused = _rewards(
        {'POST /me/referral/apply': ApiException(422, 'x', code: 'REFERRAL_NOT_NEW_CUSTOMER')},
        readPending: () async => 'NIMAL7K2',
        clearPending: () async => cleared++,
      );
      expect(await refused.applyPendingReferral(), isNull);
      expect(cleared, 2);

      final offline = _rewards(
        {'POST /me/referral/apply': ApiException(503, 'x', code: 'NETWORK_ERROR')},
        readPending: () async => 'NIMAL7K2',
        clearPending: () async => cleared++,
      );
      expect(await offline.applyPendingReferral(), isNull);
      expect(cleared, 2, reason: 'kept for the next sign-in');

      final none = _rewards({}, calls: <String>[], readPending: () async => null);
      expect(await none.applyPendingReferral(), isNull);
    });
  });

  group('screens', () {
    Future<void> pumpWith(WidgetTester tester, Widget home, RewardsProvider rewards, {AuthProvider? auth}) async {
      tester.view.physicalSize = const Size(480, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: auth ?? SignedInAuth()),
            ChangeNotifierProvider.value(value: rewards),
          ],
          child: MaterialApp(theme: AppTheme.appTHeme, home: home),
        ),
      );
      await tester.pump();
      await tester.pump();
    }

    testWidgets('Refer a friend shows the code, the reward, the counts and the field', (tester) async {
      await pumpWith(
        tester,
        const ReferFriendScreen(),
        _rewards({
          'GET /me/referral': {'success': true, 'data': _referral(credits: [{'mode': 'LKR_OFF', 'amount_lkr': 200}])},
        }),
      );
      expect(find.text('NIMAL7K2'), findsOneWidget);
      expect(find.textContaining('Your friend gets LKR 150 off their first order.'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('Friends joined'), findsOneWidget);
      expect(find.text('LKR 200 off'), findsOneWidget);
      expect(find.byKey(ReferFriendScreen.shareKey), findsOneWidget);
      expect(find.text("Have a friend's code?"), findsOneWidget);
    });

    testWidgets('typing a friend\'s code applies it and hides the field', (tester) async {
      await pumpWith(
        tester,
        const ReferFriendScreen(),
        _rewards({
          'GET /me/referral': {'success': true, 'data': _referral()},
          'POST /me/referral/apply': {'success': true, 'data': {'status': 'PENDING', 'inviter_first_name': 'Kamal'}},
        }),
      );
      await tester.enterText(find.byKey(ReferFriendScreen.applyFieldKey), 'kamal123');
      await tester.tap(find.byKey(ReferFriendScreen.applyButtonKey));
      await tester.pump();
      await tester.pump();
      expect(find.text("Have a friend's code?"), findsNothing);
      expect(find.text('Kamal invited you to Blynk.'), findsOneWidget);
    });

    testWidgets('switched off: "not available right now" and no Profile row', (tester) async {
      final rewards = _rewards({
        'GET /me/referral': {'success': true, 'data': _referral(enabled: false)},
        'GET /me/points': {'success': true, 'data': {'enabled': false, 'balance': 0, 'value_lkr': 0, 'history': []}},
      });
      await pumpWith(tester, const ReferFriendScreen(), rewards);
      expect(find.text('Not available right now'), findsOneWidget);
      expect(find.text('NIMAL7K2'), findsNothing);

      await pumpWith(tester, const Scaffold(body: ProfileRewardsTiles()), rewards);
      expect(find.byKey(ProfileRewardsTiles.referKey), findsNothing);
      expect(find.byKey(ProfileRewardsTiles.pointsKey), findsNothing);
    });

    testWidgets('switched on: Profile offers "Refer a friend"', (tester) async {
      await pumpWith(
        tester,
        const Scaffold(body: ProfileRewardsTiles()),
        _rewards({'GET /me/referral': {'success': true, 'data': _referral()}}),
      );
      expect(find.byKey(ProfileRewardsTiles.referKey), findsOneWidget);
      expect(find.text('Refer a friend'), findsOneWidget);
    });

    testWidgets('a guest gets no Profile rows', (tester) async {
      final calls = <String>[];
      await pumpWith(tester, const Scaffold(body: ProfileRewardsTiles()), _rewards({}, calls: calls),
          auth: _GuestAuth());
      expect(find.byKey(ProfileRewardsTiles.referKey), findsNothing);
      expect(calls, isEmpty);
    });

    testWidgets('sign-up offers the optional code only while it can be used', (tester) async {
      await pumpWith(
        tester,
        const NameCaptureScreen(),
        _rewards({'GET /me/referral': {'success': true, 'data': _referral()}}),
      );
      expect(find.byKey(NameCaptureScreen.referralFieldKey), findsOneWidget);

      await pumpWith(
        tester,
        const NameCaptureScreen(key: ValueKey('again')),
        _rewards({'GET /me/referral': {'success': true, 'data': _referral(canApply: false)}}),
      );
      expect(find.byKey(NameCaptureScreen.referralFieldKey), findsNothing);
    });
  });

  group('cart and checkout', () {
    testWidgets('a waiting referral reward is named in the cart', (tester) async {
      final store = StoreInfoProvider(
        request: (url) async => {
          'success': true,
          'data': {
            if (url == '/store') 'delivery_fee_lkr': 100,
            if (url == '/orders/checkout-info')
              'referral_reward': {'available': true, 'side': 'FRIEND', 'mode': 'LKR_OFF', 'amount_lkr': 150},
          },
        },
        readCache: () async => null,
        writeCache: (_) async {},
      );
      await store.loadCheckoutInfo(signedIn: true);
      expect(store.referralReward!.available, isTrue);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
            ChangeNotifierProvider.value(value: store),
            ChangeNotifierProvider(create: (_) => CartProvider()..add(_milk)),
          ],
          child: MaterialApp(theme: AppTheme.appTHeme, home: const Scaffold(body: CartRewardsLines())),
        ),
      );
      expect(find.byKey(CartRewardsLines.referralKey), findsOneWidget);
      expect(find.text('Referral reward: LKR 150 off this order'), findsOneWidget);
      await store.loadCheckoutInfo(signedIn: false);
      await tester.pump();
      expect(find.byKey(CartRewardsLines.referralKey), findsNothing);
    });
  });
}
