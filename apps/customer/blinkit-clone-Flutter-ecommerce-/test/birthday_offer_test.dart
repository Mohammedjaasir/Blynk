import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/birthday_offer_model.dart';
import 'package:ecom/Models/coupon_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/profile.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/birthday_offer_banner.dart';
import 'package:ecom/UI/Widgets/Organisms/card_cart_prices_detail.dart';
import 'package:ecom/UI/Widgets/Organisms/order_bill_card.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/session_fakes.dart';

/// The birthday gift (owner, 2026-10-09): % off ONE order in the birthday
/// week, applied by the server at checkout. These pin the app's half - the
/// parsing, the wording, the estimate and where it shows. The server side is
/// backend/api's own tests.

Map<String, dynamic> _offer({
  bool enabled = true,
  num percent = 10,
  bool eligible = true,
  bool used = false,
}) =>
    {
      'enabled': enabled,
      'percent': percent,
      'has_birthday': true,
      'in_window': true,
      'used': used,
      'eligible': eligible,
      'birthday': '2026-10-10',
      'window_start': '2026-10-07',
      'window_end': '2026-10-13',
    };

const _milk =
    '{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c1","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","unit":"1 L","image_url":null,"selling_price":540,"is_available":true}';

ProductModel _product() => ProductModel.fromJson((jsonDecode(_milk) as Map).cast<String, dynamic>());

StoreInfoProvider _store(Map<String, dynamic>? birthday) => StoreInfoProvider(
      request: (url) async => {
        'success': true,
        'data': {
          if (url == '/store') 'delivery_fee_lkr': 100,
          if (url == '/orders/checkout-info' && birthday != null) 'birthday_offer': birthday,
        },
      },
      readCache: () async => null,
      writeCache: (_) async {},
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('BirthdayOffer', () {
    test('parses the server block, words it, and estimates the gift', () {
      final o = BirthdayOffer.tryParse(_offer())!;
      expect(o.eligible, isTrue);
      expect(o.percent, 10);
      expect(o.percentLabel, '10%');
      expect(o.bannerText, 'Happy birthday! 10% off one order this week');
      expect(o.birthday, DateTime(2026, 10, 10));
      expect(o.windowEnd, DateTime(2026, 10, 13));
      expect(o.estimateOn(540), 54);
      expect(o.estimateOn(333.33), 33.33);
      expect(BirthdayOffer.tryParse(_offer(percent: 12.5))!.percentLabel, '12.5%');
    });

    test('no gift is ever invented: malformed, not eligible, or a percent it cannot word', () {
      expect(BirthdayOffer.tryParse(null), isNull);
      expect(BirthdayOffer.tryParse({'enabled': true}), isNull);
      final notNow = BirthdayOffer.tryParse(_offer(eligible: false))!;
      expect(notNow.eligible, isFalse);
      expect(notNow.estimateOn(540), 0);
      expect(BirthdayOffer.tryParse(_offer(percent: 0))!.eligible, isFalse);
      expect(BirthdayOffer.tryParse(_offer(percent: 150))!.eligible, isFalse);
      // The string form a Postgres numeric can arrive as.
      expect(BirthdayOffer.tryParse({..._offer(), 'percent': '15'})!.percent, 15);
    });

    test('markedUsed stops the gift', () {
      final used = BirthdayOffer.tryParse(_offer())!.markedUsed();
      expect(used.used, isTrue);
      expect(used.eligible, isFalse);
    });
  });

  group('dates', () {
    test('parseIsoDate takes calendar days only', () {
      expect(parseIsoDate('1995-03-14'), DateTime(1995, 3, 14));
      expect(parseIsoDate('1995-03-14T00:00:00.000Z'), DateTime(1995, 3, 14));
      expect(parseIsoDate('2023-02-30'), isNull);
      expect(parseIsoDate('14/03/1995'), isNull);
      expect(parseIsoDate(null), isNull);
      expect(formatIsoDate(DateTime(1995, 3, 4)), '1995-03-04');
      expect(formatBirthday(DateTime(1995, 3, 14)), '14 March 1995');
    });

    test('the allowed range is an age of 5 to 120, leap days included', () {
      final r = dateOfBirthRange(DateTime(2026, 10, 10));
      expect(r.latest, DateTime(2021, 10, 10));
      expect(r.earliest, DateTime(1906, 10, 10));
      final leap = dateOfBirthRange(DateTime(2024, 2, 29));
      expect(leap.latest, DateTime(2019, 2, 28));
    });
  });

  group('UserModel profile fields', () {
    test('reads GET /me, and an older payload has none', () {
      final u = UserModel.fromJson({
        'id': 'u1',
        'phone': '+94771234567',
        'role': 'CUSTOMER',
        'date_of_birth': '1995-03-14',
        'favourite_category_ids': ['c1', 'c2'],
        'favourite_categories': [
          {'id': 'c1', 'name': 'Snacks'},
          {'id': 'c2', 'name': 'Dairy & Eggs'},
        ],
        'favourites_note': '  Spicy murukku  ',
        'birthday_offer': _offer(),
      });
      expect(u.dateOfBirth, DateTime(1995, 3, 14));
      expect(u.favouriteCategoryIds, ['c1', 'c2']);
      expect(u.favouriteCategories.map((c) => c.name), ['Snacks', 'Dairy & Eggs']);
      expect(u.favouritesNote, 'Spicy murukku');
      expect(u.birthdayOffer!.eligible, isTrue);

      // The cache round trip keeps the details but never the gift status.
      final again = UserModel.fromJsonString(u.toJsonString());
      expect(again.dateOfBirth, DateTime(1995, 3, 14));
      expect(again.favouriteCategoryIds, ['c1', 'c2']);
      expect(again.birthdayOffer, isNull);
      // ...and the name/SMS copies keep them.
      expect(u.copyWithName('Nimal').dateOfBirth, DateTime(1995, 3, 14));
      expect(u.copyWithSms(smsOffers: false).favouritesNote, 'Spicy murukku');

      final old = UserModel.fromJson({'id': 'u1', 'phone': 'p', 'favourites_note': ''});
      expect(old.dateOfBirth, isNull);
      expect(old.favouriteCategoryIds, isEmpty);
      expect(old.favouritesNote, isNull);
      expect(old.birthdayOffer, isNull);
    });
  });

  group('ProfileProvider.aboutYouChanges sends only what changed', () {
    final before = UserModel.fromJson({
      'id': 'u1',
      'phone': 'p',
      'full_name': 'Nimal Perera',
      'date_of_birth': '1995-03-14',
      'favourite_category_ids': ['c1'],
      'favourites_note': 'Milo',
    });

    test('an untouched form sends nothing', () {
      expect(
        ProfileProvider.aboutYouChanges(
          before: before,
          name: ' Nimal Perera ',
          dateOfBirth: DateTime(1995, 3, 14),
          favouriteCategoryIds: ['c1'],
          note: 'Milo ',
        ),
        isEmpty,
      );
    });

    test('changes, a cleared date and an emptied note are sent; an empty name is not', () {
      expect(
        ProfileProvider.aboutYouChanges(
          before: before,
          name: '',
          dateOfBirth: null,
          favouriteCategoryIds: ['c2', 'c1'],
          note: '  ',
        ),
        {
          'date_of_birth': null,
          'favourite_category_ids': ['c2', 'c1'],
          'favourites_note': null,
        },
      );
      expect(
        ProfileProvider.aboutYouChanges(before: before, name: 'Nimal P', dateOfBirth: DateTime(1990, 1, 2)),
        {'full_name': 'Nimal P', 'date_of_birth': '1990-01-02'},
      );
    });

    test('the sign-up prompt (no profile loaded) sends just the date', () {
      expect(ProfileProvider.aboutYouChanges(dateOfBirth: DateTime(2000, 12, 31)), {'date_of_birth': '2000-12-31'});
      expect(ProfileProvider.aboutYouChanges(), isEmpty);
    });

    test('saveAboutYou PATCHes /me and keeps the server copy; a refusal is mapped', () async {
      final calls = <String>[];
      final ok = ProfileProvider(request: ({methodType, url, body}) async {
        calls.add('$methodType $url ${jsonEncode(body)}');
        return {
          'success': true,
          'data': {
            'profile': {
              'id': 'u1',
              'phone': 'p',
              'role': 'CUSTOMER',
              'created_at': '2026-01-01',
              'date_of_birth': '1995-03-14',
              'birthday_offer': _offer(),
            },
          },
        };
      });
      expect(await ok.saveAboutYou({'date_of_birth': '1995-03-14'}), isTrue);
      expect(calls, ['PATCH /me {"date_of_birth":"1995-03-14"}']);
      expect(ok.profile!.dateOfBirth, DateTime(1995, 3, 14));
      expect(ok.profile!.birthdayOffer!.eligible, isTrue);
      expect(await ok.saveAboutYou(const {}), isTrue);
      expect(calls, hasLength(1), reason: 'nothing to change is not a request');
    });
  });

  group('validate-coupon and orders', () {
    test('the coupon preview reads which discount wins from the envelope', () {
      final data = {
        'coupon': {'code': 'SAVE20', 'discount_type': 'FIXED', 'discount_amount': 20, 'total': 620},
        'birthday_discount_amount': 54,
        'applied_discount': 'BIRTHDAY',
        'total': 586,
      };
      final p = CouponPreview.tryParse(data['coupon'], envelope: data)!;
      expect(p.birthdayWins, isTrue);
      expect(p.birthdayDiscountAmount, 54);
      expect(p.discountAmount, 20);
      expect(p.total, 586);

      // An older backend: no birthday fields, the coupon as before.
      final old = CouponPreview.tryParse(data['coupon'])!;
      expect(old.birthdayWins, isFalse);
      expect(old.total, 620);
    });

    Map<String, dynamic> order({double birthday = 0, double discount = 0, String? code}) => {
          'id': 'o1',
          'order_number': 'BLK-1',
          'order_status': 'PLACED',
          'subtotal_amount': 540,
          'delivery_fee': 100,
          'discount_amount': discount,
          'coupon_code': code,
          'birthday_discount_amount': birthday,
          'total_amount': 640 - discount,
        };

    test('an order carries its birthday gift', () {
      final o = OrderModel.fromJson(order(birthday: 54, discount: 54));
      expect(o.birthdayDiscountAmount, 54);
      expect(o.hasBirthdayGift, isTrue);
      expect(OrderModel.fromJson(order()).hasBirthdayGift, isFalse);
    });

    Future<void> pumpBill(WidgetTester tester, OrderModel m) => tester.pumpWidget(
          MaterialApp(theme: AppTheme.appTHeme, home: Scaffold(body: OrderBillCard(order: m))),
        );

    testWidgets('the bill says "Birthday gift" instead of a coupon line', (tester) async {
      await pumpBill(tester, OrderModel.fromJson(order(birthday: 54, discount: 54)));
      expect(find.text('Birthday gift'), findsOneWidget);
      expect(find.text('−LKR 54'), findsOneWidget);
      expect(find.textContaining('Discount'), findsNothing);
      expect(find.text('LKR 586'), findsOneWidget);
    });

    testWidgets('a coupon order still says Discount (CODE)', (tester) async {
      await pumpBill(tester, OrderModel.fromJson(order(discount: 20, code: 'SAVE20')));
      expect(find.text('Discount (SAVE20)'), findsOneWidget);
      expect(find.text('Birthday gift'), findsNothing);
    });
  });

  group('StoreInfoProvider birthday status', () {
    test('reads checkout-info, forgets it on sign-out, and marks it used', () async {
      final store = _store(_offer());
      await store.loadCheckoutInfo(signedIn: true);
      expect(store.birthdayOffer!.eligible, isTrue);
      store.markBirthdayGiftUsed();
      expect(store.birthdayOffer!.eligible, isFalse);
      store.applyBirthdayOffer(BirthdayOffer.tryParse(_offer()));
      expect(store.birthdayOffer!.eligible, isTrue);
      store.applyBirthdayOffer(null);
      expect(store.birthdayOffer, isNotNull, reason: 'absent is not "no gift"');
      await store.loadCheckoutInfo(signedIn: false);
      expect(store.birthdayOffer, isNull);

      final none = _store(null);
      await none.loadCheckoutInfo(signedIn: true);
      expect(none.birthdayOffer, isNull);
    });
  });

  group('where the gift shows', () {
    Future<CartProvider> pumpSummary(
      WidgetTester tester, {
      required StoreInfoProvider store,
      AuthProvider? auth,
      OrderProvider? orders,
      bool checkout = true,
    }) async {
      final cart = CartProvider()..add(_product());
      tester.view.physicalSize = const Size(480, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider<AuthProvider>.value(value: auth ?? SignedInAuth()),
            ChangeNotifierProvider.value(value: orders ?? OrderProvider()),
            ChangeNotifierProvider.value(value: store),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: Scaffold(
              body: ListView(
                children: [
                  const BirthdayOfferBanner(),
                  CartPriceDetailWidget(showCoupon: checkout, showBirthday: checkout),
                ],
              ),
            ),
          ),
        ),
      );
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      return cart;
    }

    testWidgets('eligible: the banner, and an estimated "Birthday gift (10%)" line at checkout', (tester) async {
      await pumpSummary(tester, store: _store(_offer()));
      expect(find.byKey(BirthdayOfferBanner.bannerKey), findsOneWidget);
      expect(find.text('Happy birthday! 10% off one order this week'), findsOneWidget);
      expect(find.byKey(const Key('summary-birthday-gift')), findsOneWidget);
      expect(find.text('Birthday gift (10%)'), findsOneWidget);
      expect(find.text('−LKR 54'), findsOneWidget);
    });

    testWidgets('the cart shows the banner but no estimated line', (tester) async {
      await pumpSummary(tester, store: _store(_offer()), checkout: false);
      expect(find.byKey(BirthdayOfferBanner.bannerKey), findsOneWidget);
      expect(find.byKey(const Key('summary-birthday-gift')), findsNothing);
    });

    testWidgets('not eligible, or a guest: nothing at all', (tester) async {
      await pumpSummary(tester, store: _store(_offer(eligible: false, used: true)));
      expect(find.byKey(BirthdayOfferBanner.bannerKey), findsNothing);
      expect(find.textContaining('Birthday'), findsNothing);

      await pumpSummary(tester, store: _store(_offer()), auth: AuthProvider());
      expect(find.byKey(BirthdayOfferBanner.bannerKey), findsNothing);
      expect(find.textContaining('Birthday'), findsNothing);
    });

    testWidgets("once a coupon is previewed, the server's choice replaces the estimate", (tester) async {
      Map<String, dynamic> answer(String applied) => {
            'success': true,
            'data': {
              'coupon': {'code': 'SAVE20', 'discount_type': 'FIXED', 'discount_amount': 20, 'total': 620},
              'birthday_discount_amount': 54,
              'applied_discount': applied,
              'total': applied == 'BIRTHDAY' ? 586 : 620,
            },
          };
      var applied = 'BIRTHDAY';
      final orders = OrderProvider(request: (method, url, {body, query}) async => answer(applied));
      final cart = await pumpSummary(tester, store: _store(_offer()), orders: orders);
      await tester.runAsync(() => orders.applyCoupon('SAVE20', cart));
      await tester.pump();
      expect(find.text('Birthday gift (10%)'), findsOneWidget);
      expect(find.text('−LKR 54'), findsOneWidget);
      expect(find.byKey(const Key('summary-discount')), findsNothing);

      applied = 'COUPON';
      await tester.runAsync(() => orders.applyCoupon('SAVE20', cart));
      await tester.pump();
      expect(find.byKey(const Key('summary-birthday-gift')), findsNothing);
      expect(find.text('Discount (SAVE20)'), findsOneWidget);
    });
  });
}
