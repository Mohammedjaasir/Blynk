import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/delete_account_dialog.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/tracking_fakes.dart';

/// Account deletion (2026-10-06): Profile > Delete account, a clear
/// confirmation, DELETE /me, then a local sign-out to the login screen. An
/// open order (409 ACTIVE_ORDERS_EXIST) keeps the customer signed in and
/// says why.

ProductModel _product() => const ProductModel(
      id: 'p1',
      categoryId: 'c',
      categoryName: 'Dairy',
      name: 'Milk',
      slug: 'milk',
      sku: 'SKU-1',
      unit: '1 L',
      sellingPrice: 100,
      isAvailable: true,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AuthProvider auth;
  late CartProvider cart;
  late SpyLocationProvider location;
  late List<String> requests;
  late List<String> routes;
  late FutureOr<dynamic> Function() deleteAnswer;

  setUp(() async {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({
      'blynk_access_token': 'a',
      'blynk_refresh_token': 'r',
    });
    requests = [];
    routes = [];
    deleteAnswer = () => {
          'success': true,
          'data': {'deleted': true},
        };
    auth = AuthProvider(request: ({methodType, url, body}) async {
      requests.add('$methodType $url');
      if (methodType == 'DELETE' && url == '/me') return deleteAnswer();
      return {'success': true};
    });
    await auth.restoreSession();
    cart = CartProvider()..add(_product());
    location = SpyLocationProvider();
  });

  tearDown(() {
    TokenStorage.resetSerialQueueForTest();
    auth.dispose();
    location.dispose();
  });

  group('AuthProvider.deleteAccount', () {
    test('DELETE /me, then signed out on this device with the stored login gone', () async {
      expect(auth.isAuthenticated, isTrue);

      final failure = await auth.deleteAccount();

      expect(failure, isNull);
      expect(requests, contains('DELETE /me'));
      expect(auth.isAuthenticated, isFalse);
      expect(await TokenStorage.getRefreshToken(), isNull);
      // No server logout: the account and its sessions are already gone.
      expect(requests, isNot(contains('POST /auth/logout')));
    });

    test('409 ACTIVE_ORDERS_EXIST keeps the customer signed in and says why', () async {
      deleteAnswer = () => throw ApiException(409, 'Finish or cancel your open orders first.',
          code: 'ACTIVE_ORDERS_EXIST');

      final failure = await auth.deleteAccount();

      expect(failure!.message, 'Finish or cancel your open orders first.');
      expect(auth.isAuthenticated, isTrue);
      expect(await TokenStorage.getRefreshToken(), 'r');
    });

    test('no connection keeps the customer signed in', () async {
      deleteAnswer = () => throw ApiException(503, 'x', code: 'NETWORK_ERROR');

      final failure = await auth.deleteAccount();

      expect(failure!.isOffline, isTrue);
      expect(auth.isAuthenticated, isTrue);
    });
  });

  Future<void> pumpProfile(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider(create: (_) => AddressProvider(request: ({methodType, url, body}) async => {})),
          ChangeNotifierProvider(create: (_) => OrderProvider(request: (m, u, {body, query}) async => {})),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<LocationProvider>.value(value: location),
        ],
        child: MaterialApp(
          theme: AppTheme.theme,
          onGenerateRoute: (settings) {
            routes.add(settings.name ?? '');
            return MaterialPageRoute(
              settings: settings,
              builder: (_) => settings.name == '/login'
                  ? const Scaffold(body: Center(child: Text('login screen')))
                  : const ProfileScreen(),
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> openSheet(WidgetTester tester) async {
    final button = find.byKey(const Key('profile-delete-account'));
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  Finder confirm() => find.descendant(
        of: find.byType(DeleteAccountSheet),
        matching: find.widgetWithText(BlynkButton, DeleteAccountSheet.confirmLabel),
      );

  testWidgets('Profile ends with a destructive "Delete account", signed in only', (tester) async {
    await pumpProfile(tester);

    final button = find.byKey(const Key('profile-delete-account'));
    expect(button, findsOneWidget);
    final outlined = tester.widget<OutlinedButton>(find.descendant(of: button, matching: find.byType(OutlinedButton)));
    expect(outlined.style!.foregroundColor!.resolve({}), BlynkColors.problem);
    // Below every other row, Log out included.
    expect(tester.getTopLeft(button).dy, greaterThan(tester.getTopLeft(find.text('Log out')).dy));

    await auth.logout();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('profile-delete-account')), findsNothing);
  });

  testWidgets('the confirmation says what is deleted, what is kept, and that it is final', (tester) async {
    await pumpProfile(tester);
    await openSheet(tester);

    expect(find.text(DeleteAccountSheet.title), findsOneWidget);
    expect(find.textContaining('saved addresses'), findsOneWidget);
    expect(find.text("Your past orders are kept for the store's records."), findsOneWidget);
    expect(find.text("This can't be undone."), findsOneWidget);
    expect(find.widgetWithText(BlynkButton, 'Cancel'), findsOneWidget);
    expect(confirm(), findsOneWidget);
  });

  testWidgets('Cancel deletes nothing', (tester) async {
    await pumpProfile(tester);
    await openSheet(tester);

    await tester.tap(find.widgetWithText(BlynkButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.byType(DeleteAccountSheet), findsNothing);
    expect(requests, isNot(contains('DELETE /me')));
    expect(auth.isAuthenticated, isTrue);
  });

  testWidgets('confirming deletes, clears the user state and goes to /login', (tester) async {
    await pumpProfile(tester);
    location.watch('order-1');
    await openSheet(tester);

    await tester.tap(confirm());
    await tester.pumpAndSettle();

    expect(requests, contains('DELETE /me'));
    expect(auth.isAuthenticated, isFalse);
    expect(cart.isEmpty, isTrue);
    expect(location.stopCount, greaterThan(0));
    expect(find.text('login screen'), findsOneWidget);
    expect(routes.last, '/login');
  });

  testWidgets('an open order keeps the customer here, with the reason in the sheet', (tester) async {
    deleteAnswer = () => throw ApiException(409, 'raw backend text', code: 'ACTIVE_ORDERS_EXIST');
    await pumpProfile(tester);
    await openSheet(tester);

    await tester.tap(confirm());
    await tester.pumpAndSettle();

    expect(find.byType(DeleteAccountSheet), findsOneWidget);
    expect(find.byKey(const Key('delete-account-error')), findsOneWidget);
    expect(find.text('Finish or cancel your open orders first.'), findsOneWidget);
    expect(find.text('raw backend text'), findsNothing);
    expect(auth.isAuthenticated, isTrue);
    expect(cart.isEmpty, isFalse);
    expect(find.text('login screen'), findsNothing);
  });

  testWidgets('a second tap while deleting sends one request', (tester) async {
    final pending = Completer<dynamic>();
    deleteAnswer = () => pending.future;
    await pumpProfile(tester);
    await openSheet(tester);

    await tester.tap(confirm());
    await tester.pump();
    await tester.tap(confirm(), warnIfMissed: false);
    await tester.pump();

    expect(requests.where((r) => r == 'DELETE /me'), hasLength(1));
    pending.complete({'success': true});
    await tester.pumpAndSettle();
    expect(find.text('login screen'), findsOneWidget);
  });
}
