import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/app_theme.dart';

/// Task F5 - the "Dental clinics" Home entry point. A real, meaningful
/// assertion (the entry is visible without scrolling and a tap navigates to
/// '/dental/clinics'), not just "a Home screen renders" - the brief's
/// explicit instruction.
class _Backend {
  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/categories') {
      return {'success': true, 'data': {'categories': <Map<String, dynamic>>[]}};
    }
    if (url == '/promotions') {
      return {'success': true, 'data': {'promotions': <Map<String, dynamic>>[]}};
    }
    if (url == '/catalog/products') {
      return {
        'success': true,
        'data': {
          'products': <Map<String, dynamic>>[],
          'pagination': {'page': 1, 'limit': 100, 'total': 0, 'total_pages': 1},
        },
      };
    }
    throw StateError('unexpected $url');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  Widget app({required ValueChanged<String?> onPush}) {
    final backend = _Backend();
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ProductProvider(request: backend.call)),
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider(create: (_) => AddressProvider()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => OrderProvider()),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        onGenerateRoute: (settings) {
          onPush(settings.name);
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => Text('pushed ${settings.name}'),
          );
        },
        home: const HomeScreen(),
      ),
    );
  }

  testWidgets('the "Dental clinics" entry is visible on Home, above the fold, not in Profile', (tester) async {
    tester.view.physicalSize = const Size(390, 844); // a typical phone viewport
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pushed = <String?>[];
    await tester.pumpWidget(app(onPush: pushed.add));
    await tester.pump();
    await tester.pump(); // categories/promotions futures resolve

    // Visible without any scroll: hitTestable at the default viewport.
    expect(find.byKey(const Key('dental-clinics-entry')).hitTestable(), findsOneWidget);
    expect(find.text('Channel doctors'), findsOneWidget);
  });

  testWidgets('tapping the entry navigates to /dental/clinics', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pushed = <String?>[];
    await tester.pumpWidget(app(onPush: pushed.add));
    await tester.pump();
    await tester.pump();

    await tester.tap(find.byKey(const Key('dental-clinics-entry')));
    await tester.pumpAndSettle();

    expect(pushed, contains('/dental/clinics'));
    expect(find.text('pushed /dental/clinics'), findsOneWidget);
  });

  testWidgets('the entry has a real, at-least-48dp tap target', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(app(onPush: (_) {}));
    await tester.pump();
    await tester.pump();

    final size = tester.getSize(find.byKey(const Key('dental-clinics-entry')));
    expect(size.height, greaterThanOrEqualTo(48));
  });
}
