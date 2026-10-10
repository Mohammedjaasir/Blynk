import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/combo_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/promotion_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/analytics/analytics.dart';
import 'package:ecom/Services/analytics/analytics_route_observer.dart';
import 'package:ecom/Services/analytics/data_layer_stub.dart' as stub;

import 'fixtures/order_fixtures.dart';

/// Website tracking for Google Tag Manager (owner, 2026-10-10): GA4
/// ecommerce event names and shapes, a hashed user id, nothing personal, and
/// nothing at all off the web.

const _milk = ProductModel(
  id: 'b0000001-0000-0000-0000-000000000001',
  categoryId: 'c1',
  categoryName: 'Dairy & Eggs',
  name: 'Kotmale Fresh Milk 1L',
  slug: 'kotmale-fresh-milk-1l',
  sku: 'SKU-DAI-001',
  unit: '1 L',
  sellingPrice: 540,
  isAvailable: true,
);

const _eggs = ProductModel(
  id: 'b0000001-0000-0000-0000-000000000003',
  categoryId: 'c1',
  categoryName: 'Dairy & Eggs',
  name: 'Farm Fresh Brown Eggs (10 Pack)',
  slug: 'farm-fresh-brown-eggs-10-pack',
  sku: 'SKU-EGG-003',
  unit: '10 pcs',
  sellingPrice: 605,
  isAvailable: true,
);

const _combo = ComboModel(id: 'combo-1', name: 'Breakfast pack', price: 1000, itemsTotal: 1145, saving: 145);

// The personal details in the order fixture and the sign-in below. None of
// them may ever reach the dataLayer.
const _pii = ['Jane Silva', '+94771234567', '771234567', '12 Galle Road', 'Blue gate', 'Nimal Perera', '762227770', 'nimal@example.com'];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late List<Map<String, Object?>> pushed;
  final analytics = Analytics.instance;

  List<Map<String, Object?>> events() => pushed.where((p) => p['event'] != null).toList();
  List<String> names() => events().map((p) => p['event'] as String).toList();
  Map<String, Object?> last(String name) => events().lastWhere((p) => p['event'] == name);
  Map<String, Object?> ecommerce(String name) => (last(name)['ecommerce'] as Map).cast<String, Object?>();
  List<Map> items(String name) => (ecommerce(name)['items'] as List).cast<Map>();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    pushed = [];
    analytics.debugUseSink(pushed.add);
  });
  tearDown(() => analytics.debugUseSink(null));

  group('off the web', () {
    test('the real sink is the no-op stub here, and calling it does nothing', () {
      expect(kIsWeb, isFalse);
      analytics.debugUseSink(null);
      // Must not throw and must not need a browser.
      analytics.addToCart(_milk);
      analytics.pageView('/home');
      analytics.search('milk');
      stub.pushToDataLayer({'event': 'x'});
    });
  });

  group('event shapes (GA4 recommended names)', () {
    test('ecommerce events clear the previous ecommerce object first', () {
      analytics.addToCart(_milk, quantity: 2);
      expect(pushed.first, {'ecommerce': null});
      expect(pushed[1]['event'], 'add_to_cart');
      final e = ecommerce('add_to_cart');
      expect(e['currency'], 'LKR');
      expect(e['value'], 1080.0);
      expect(items('add_to_cart').single, {
        'item_id': _milk.id,
        'item_name': 'Kotmale Fresh Milk 1L',
        'item_category': 'Dairy & Eggs',
        'price': 540.0,
        'quantity': 2,
      });
    });

    test('view_item, view_item_list, select_promotion, search, share, login, sign_up', () {
      analytics.viewItem(_milk);
      analytics.viewItemList(listId: 'home', listName: 'Home', products: [_milk, _eggs]);
      analytics.selectPromotion(PromotionModel.fromJson(const {
        'id': 'p1', 'title': 'Everyday Essentials', 'background_type': 'SOLID', 'display_order': 1,
      }));
      analytics.search('  milk ');
      analytics.share(contentType: 'referral');
      analytics.login();
      analytics.signUp();
      expect(names(), ['view_item', 'view_item_list', 'select_promotion', 'search', 'share', 'login', 'sign_up']);
      expect(ecommerce('view_item')['value'], 540.0);
      expect(items('view_item_list').map((i) => [i['index'], i['item_list_id']]), [[0, 'home'], [1, 'home']]);
      expect(ecommerce('select_promotion')['promotion_id'], 'p1');
      expect(ecommerce('select_promotion')['promotion_name'], 'Everyday Essentials');
      expect(last('search')['search_term'], 'milk');
      expect(last('share')['content_type'], 'referral');
      expect(last('login')['method'], 'phone_otp');
      expect(last('sign_up')['method'], 'phone_otp');
    });

    test('a long listing sends only the first 20 items', () {
      analytics.viewItemList(listId: 'home', listName: 'Home', products: List.filled(30, _milk));
      expect(items('view_item_list'), hasLength(kAnalyticsListItemsMax));
    });

    test('page_view carries the route as page_path', () {
      analytics.pageView('/cart');
      expect(last('page_view')['page_path'], '/cart');
      expect(last('page_view').containsKey('page_location'), isFalse, reason: 'web only');
    });
  });

  group('user_id', () {
    test('is a SHA-256 of the customer id: stable, 64 hex, not the id itself', () {
      final a = Analytics.hashCustomerId('u1');
      expect(a, matches(RegExp(r'^[0-9a-f]{64}$')));
      expect(a, Analytics.hashCustomerId('u1'));
      expect(a, isNot(Analytics.hashCustomerId('u2')));
      expect(a.contains('u1'), isFalse);
    });

    test('follows the signed-in customer and clears on sign-out', () {
      final who = ValueNotifier<String?>(null);
      analytics.followCustomer(who, (n) => n.value);
      analytics.search('rice');
      expect(last('search')['user_id'], isNull);
      who.value = 'u1';
      analytics.search('milk');
      expect(last('search')['user_id'], Analytics.hashCustomerId('u1'));
      who.value = null;
      analytics.search('eggs');
      expect(last('search')['user_id'], isNull);
    });
  });

  group('PII guard', () {
    test('drops personal keys at any depth', () {
      final clean = Analytics.sanitize({
        'event': 'x',
        'phone': '0771234567',
        'customer_email': 'a@b.lk',
        'full_name': 'Jane',
        'name': 'Jane',
        'delivery_address_line1': '12 Galle Road',
        'latitude': 6.4,
        'ecommerce': {
          'items': [
            {'item_id': 'p1', 'item_name': 'Milk', 'recipient_name': 'Jane', 'mobile': '0771234567'},
          ],
        },
      });
      expect(clean.keys, ['event', 'ecommerce']);
      expect(((clean['ecommerce'] as Map)['items'] as List).single, {'item_id': 'p1', 'item_name': 'Milk'});
    });

    test('blanks phone- and email-looking values, but keeps ids and order numbers', () {
      for (final typed in ['0771234567', '077 123 4567', '+94 77 123-4567', 'call 0112345678', 'me@example.com']) {
        analytics.search(typed);
        expect(last('search')['search_term'], Analytics.redacted, reason: typed);
      }
      analytics.search('rice 5kg');
      expect(last('search')['search_term'], 'rice 5kg');
      final clean = Analytics.sanitize({
        'transaction_id': 'BL-20260919-4821',
        'item_id': '550e8400-e29b-41d4-a716-446655440000',
        'user_id': Analytics.hashCustomerId('u1'),
      });
      expect(clean['transaction_id'], 'BL-20260919-4821');
      expect(clean['item_id'], '550e8400-e29b-41d4-a716-446655440000');
      expect(clean['user_id'], Analytics.hashCustomerId('u1'));
    });

    test('every event the shop sends, from a full journey, carries no personal data', () async {
      // Sign in (the server returns the phone and name)...
      final auth = AuthProvider(request: ({methodType, url, body}) async => {
            'success': true,
            'data': {
              'access_token': 'access-1',
              'refresh_token': 'refresh-1',
              'user': {'id': 'u1', 'phone': '+94762227770', 'email': 'nimal@example.com', 'role': 'CUSTOMER', 'full_name': 'Nimal Perera'},
            },
          });
      analytics.followCustomer(auth, (a) => a.currentUser?.id);
      await auth.verifyOtp('0762227770', '123456');
      // ...browse, fill the cart, search, check out and order (the order
      // fixture carries the recipient's name, phone and address).
      final cart = CartProvider();
      analytics.viewItemList(listId: 'home', listName: 'Home', products: [_milk, _eggs]);
      analytics.viewItem(_milk);
      cart.add(_milk);
      cart.add(_milk);
      cart.decrement(_milk);
      cart.addCombo(_combo);
      analytics.search('+94771234567');
      analytics.search('jane@example.com');
      analytics.viewCart(cart);
      analytics.beginCheckout(cart);
      final orders = OrderProvider(request: (m, u, {body, query}) async => {'success': true, 'data': {'order': orderJson()}});
      await orders.placeOrder(cart: cart, addressId: 'a1', customerNotes: 'Ring Jane Silva on +94771234567');
      analytics.purchase(OrderModel.tryParse(orderJson())!, lines: const []);
      analytics.share(contentType: 'product', itemId: _milk.id);
      analytics.pageView('/order/confirm');

      expect(names(), containsAll(<String>[
        'login', 'view_item_list', 'view_item', 'add_to_cart', 'remove_from_cart', 'search',
        'view_cart', 'begin_checkout', 'add_shipping_info', 'purchase', 'share', 'page_view',
      ]));
      final all = jsonEncode(pushed);
      for (final value in _pii) {
        expect(all.contains(value), isFalse, reason: '"$value" reached the dataLayer');
      }
      void keysOf(Object? v) {
        if (v is Map) {
          for (final e in v.entries) {
            expect(Analytics.piiKey.hasMatch(e.key as String), isFalse, reason: 'key ${e.key}');
            keysOf(e.value);
          }
        } else if (v is List) {
          v.forEach(keysOf);
        }
      }
      pushed.forEach(keysOf);
      expect(events().every((e) => e['user_id'] == Analytics.hashCustomerId('u1')), isTrue);
    });
  });

  group('the cart sends add_to_cart / remove_from_cart', () {
    test('add, add several, decrement, remove; combos too', () {
      final cart = CartProvider();
      cart.add(_milk);
      cart.addQuantity(_eggs, 3);
      cart.decrement(_eggs);
      cart.remove(_eggs.id);
      cart.decrement(_milk); // the last one: removes the line
      cart.addCombo(_combo);
      cart.removeCombo(_combo.id);
      expect(names(), ['add_to_cart', 'add_to_cart', 'remove_from_cart', 'remove_from_cart', 'remove_from_cart', 'add_to_cart', 'remove_from_cart']);
      final qty = events().map((e) => ((e['ecommerce'] as Map)['items'] as List).single['quantity']).toList();
      expect(qty, [1, 3, 1, 2, 1, 1, 1]);
      expect(((events()[5]['ecommerce'] as Map)['items'] as List).single['item_category'], 'Combo packs');
    });

    test('a full cart does not send add_to_cart for units it did not add', () {
      final cart = CartProvider();
      cart.addQuantity(_milk, 100);
      pushed.clear();
      cart.add(_milk);
      cart.addQuantity(_milk, 5);
      expect(names(), isEmpty);
    });
  });

  group('checkout', () {
    test('add_shipping_info once per checkout attempt, purchase with the server amounts', () async {
      var fail = true;
      final orders = OrderProvider(
        request: (m, u, {body, query}) async {
          if (fail) throw ApiException(408, 'slow', code: 'TIMEOUT');
          return {'success': true, 'data': {'order': orderJson()}};
        },
      );
      final cart = CartProvider()..add(_milk)..add(_milk)..add(_eggs);
      pushed.clear();
      await expectLater(orders.placeOrder(cart: cart, addressId: 'a1'), throwsA(isA<ApiException>()));
      fail = false;
      await orders.placeOrder(cart: cart, addressId: 'a1');

      expect(names(), ['add_shipping_info', 'purchase']);
      expect(ecommerce('add_shipping_info')['shipping_tier'], 'asap');
      final p = ecommerce('purchase');
      expect(p['transaction_id'], 'BL-20260919-4821');
      expect(p['value'], 1955.0);
      expect(p['shipping'], 70.0);
      expect(p['currency'], 'LKR');
      expect(items('purchase').map((i) => [i['item_id'], i['quantity']]), [[_milk.id, 2], [_eggs.id, 1]]);
      expect(cart.isEmpty, isTrue);
    });
  });

  group('sign-in', () {
    Map<String, dynamic> verified(String? name) => {
          'success': true,
          'data': {
            'access_token': 'access-1',
            'refresh_token': 'refresh-1',
            'user': {'id': 'u1', 'phone': '+94762227770', 'role': 'CUSTOMER', 'full_name': name},
          },
        };

    test('a returning customer (has a name) sends login', () async {
      final auth = AuthProvider(request: ({methodType, url, body}) async => verified('Nimal Perera'));
      await auth.verifyOtp('0762227770', '123456');
      expect(names(), ['login']);
    });

    test('a new customer sends sign_up once they give their name, not login', () async {
      final auth = AuthProvider(request: ({methodType, url, body}) async =>
          url == '/auth/otp/verify' ? verified(null) : {'success': true, 'data': {}});
      await auth.verifyOtp('0762227770', '123456');
      expect(names(), isEmpty);
      await auth.saveName('Nimal Perera');
      expect(names(), ['sign_up']);
    });
  });

  group('page views for hash routes', () {
    Future<NavigatorState> pumpApp(WidgetTester tester, CartProvider cart) async {
      final key = GlobalKey<NavigatorState>();
      await tester.pumpWidget(ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          navigatorKey: key,
          navigatorObservers: [AnalyticsRouteObserver()],
          onGenerateInitialRoutes: (_) => [
            MaterialPageRoute(settings: const RouteSettings(name: '/home'), builder: (_) => const Text('home')),
          ],
          onGenerateRoute: (s) => MaterialPageRoute(settings: s, builder: (_) => Text('page ${s.name}')),
        ),
      ));
      await tester.pumpAndSettle();
      return key.currentState!;
    }

    testWidgets('push, back and replace send page_view; cart and checkout their ecommerce events', (tester) async {
      final cart = CartProvider()..add(_milk);
      pushed.clear();
      final nav = await pumpApp(tester, cart);
      nav.pushNamed('/cart');
      await tester.pumpAndSettle();
      nav.pushNamed('/checkout');
      await tester.pumpAndSettle();
      nav.pop();
      await tester.pumpAndSettle();
      nav.pushReplacementNamed('/order/confirm');
      await tester.pumpAndSettle();

      final views = events().where((e) => e['event'] == 'page_view').map((e) => e['page_path']).toList();
      expect(views, ['/home', '/cart', '/checkout', '/cart', '/order/confirm']);
      expect(names(), containsAllInOrder(['page_view', 'page_view', 'view_cart', 'page_view', 'begin_checkout']));
      expect(items('view_cart').single['quantity'], 1);
      expect(ecommerce('begin_checkout')['value'], 540.0);
    });

    testWidgets('a dialog is not a page', (tester) async {
      final nav = await pumpApp(tester, CartProvider());
      pushed.clear();
      showDialog<void>(context: nav.context, builder: (_) => const Text('dialog'));
      await tester.pumpAndSettle();
      nav.pop();
      await tester.pumpAndSettle();
      expect(names(), isEmpty);
    });
  });
}
