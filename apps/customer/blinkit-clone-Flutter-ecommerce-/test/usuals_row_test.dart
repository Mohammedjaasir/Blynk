import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/usuals_model.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/Providers/rewards.provider.dart';
import 'package:ecom/Services/reorder.dart';
import 'package:ecom/UI/Widgets/Organisms/home_usuals_row.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/session_fakes.dart';

/// "Your usuals" on Home (owner, 2026-10-10): GET /me/usuals, the row, and
/// the one-tap "Add all".

Map<String, dynamic> _product(String id, String name, {bool available = true, num price = 100}) => {
      'id': id,
      'name': name,
      'slug': id,
      'unit': '1 pc',
      'selling_price': price,
      'is_available': available,
      'category_id': 'c1',
      'category_name': 'Groceries',
    };

Map<String, dynamic> _usuals({bool empty = false}) => {
      'success': true,
      'data': {
        'order': empty ? null : {'id': 'o1', 'order_number': 'BL-1001', 'placed_at': '2026-10-09T08:00:00.000Z'},
        'items': empty
            ? []
            : [
                {'product': _product('p1', 'Kotmale Milk 1L'), 'quantity': 2},
                {'product': _product('p2', 'Butter 200g'), 'quantity': 3},
                {'product': _product('p3', 'Ceylon Tea 100g', available: false), 'quantity': 1},
              ],
        'unavailable': empty ? [] : ['Old Biscuits'],
      },
    };

class _GuestAuth extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('UsualsData', () {
    test('parses the last order, its products and the gone ones', () {
      final u = UsualsData.tryParse(_usuals()['data'])!;
      expect(u.orderNumber, 'BL-1001');
      expect(u.items.map((i) => i.product.name), ['Kotmale Milk 1L', 'Butter 200g', 'Ceylon Tea 100g']);
      expect(u.items.map((i) => i.quantity), [2, 3, 1]);
      expect(u.available.map((i) => i.product.id), ['p1', 'p2']);
      expect(u.unavailable, ['Old Biscuits']);
    });

    test('no order yet is an empty answer; junk is null', () {
      final none = UsualsData.tryParse(_usuals(empty: true)['data'])!;
      expect(none.isEmpty, isTrue);
      expect(none.orderNumber, isNull);
      expect(UsualsData.tryParse(null), isNull);
      expect(UsualsData.tryParse('x'), isNull);
    });
  });

  group('addUsualsInto', () {
    test('adds every product on sale at its last quantity and names the rest', () {
      final cart = CartProvider();
      final result = addUsualsInto(usuals: UsualsData.tryParse(_usuals()['data'])!, cart: cart);
      expect(cart.quantityOf('p1'), 2);
      expect(cart.quantityOf('p2'), 3);
      expect(cart.quantityOf('p3'), 0);
      expect(result.addedUnits, 5);
      expect(usualsAddedMessage(result), 'Added 5 items. Not available now: Ceylon Tea 100g, Old Biscuits.');
    });

    test('wording for one item, nothing missing, and nothing added', () {
      expect(usualsAddedMessage(const ReorderResult(addedUnits: 1, unavailable: [], offline: false)), 'Added 1 item.');
      expect(
        usualsAddedMessage(const ReorderResult(addedUnits: 0, unavailable: ['Tea'], offline: false)),
        'Nothing was added. Not available now: Tea.',
      );
    });
  });

  group('HomeUsualsRow', () {
    Future<(CartProvider, List<String>)> pump(
      WidgetTester tester, {
      AuthProvider? auth,
      Object? Function()? answer,
    }) async {
      final calls = <String>[];
      final rewards = RewardsProvider(request: (method, url, {body}) async {
        calls.add('$method $url');
        final a = answer == null ? _usuals() : answer();
        if (a is Exception) throw a;
        return a;
      });
      final cart = CartProvider();
      tester.view.physicalSize = const Size(480, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: auth ?? SignedInAuth()),
            ChangeNotifierProvider.value(value: cart),
            ChangeNotifierProvider.value(value: rewards),
            ChangeNotifierProvider(create: (_) => ProductProvider(request: (url, query) async => {'data': {}})),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: const Scaffold(body: SingleChildScrollView(child: HomeUsualsRow())),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      return (cart, calls);
    }

    testWidgets('a signed-in customer sees their last order as product cards', (tester) async {
      final (_, calls) = await pump(tester);
      expect(calls, ['GET /me/usuals']);
      expect(find.byKey(HomeUsualsRow.rowKey), findsOneWidget);
      expect(find.text('Your usuals'), findsOneWidget);
      expect(find.text('From your last order, BL-1001'), findsOneWidget);
      expect(find.text('Kotmale Milk 1L'), findsOneWidget);
      expect(find.text('Add all'), findsOneWidget);
    });

    testWidgets('Add all fills the cart and says what was skipped', (tester) async {
      final (cart, _) = await pump(tester);
      await tester.tap(find.byKey(HomeUsualsRow.addAllKey));
      await tester.pump();
      expect(cart.quantityOf('p1'), 2);
      expect(cart.quantityOf('p2'), 3);
      expect(cart.quantityOf('p3'), 0);
      expect(find.text('Added 5 items. Not available now: Ceylon Tea 100g, Old Biscuits.'), findsOneWidget);
    });

    testWidgets('hidden for a guest, with no request', (tester) async {
      final (_, calls) = await pump(tester, auth: _GuestAuth());
      expect(calls, isEmpty);
      expect(find.byKey(HomeUsualsRow.rowKey), findsNothing);
    });

    testWidgets('hidden with no past order', (tester) async {
      await pump(tester, answer: () => _usuals(empty: true));
      expect(find.byKey(HomeUsualsRow.rowKey), findsNothing);
    });

    testWidgets('hidden when the request fails', (tester) async {
      await pump(tester, answer: () => Exception('offline'));
      expect(find.byKey(HomeUsualsRow.rowKey), findsNothing);
    });

    testWidgets('nothing at all without a RewardsProvider', (tester) async {
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
            ChangeNotifierProvider(create: (_) => CartProvider()),
          ],
          child: const MaterialApp(home: Scaffold(body: HomeUsualsRow())),
        ),
      );
      await tester.pump();
      expect(find.byKey(HomeUsualsRow.rowKey), findsNothing);
    });
  });
}
