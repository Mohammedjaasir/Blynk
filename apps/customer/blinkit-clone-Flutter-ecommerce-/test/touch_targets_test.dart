import 'dart:io';
import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/Auth/otp_verification_screen.dart';
import 'package:ecom/Screens/dental_my_appointments_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product_cart_screen.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_screen_address_container.dart';
import 'package:ecom/UI/Widgets/Organisms/login_screen_otp_sheet.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/component_host.dart';

class _FakeAddresses extends AddressProvider {
  AddressModel? current;

  @override
  AddressModel? get defaultAddress => current;

  @override
  List<AddressModel> get addresses => current == null ? const [] : [current!];

  @override
  Future<void> loadAddresses() async {}
}

const _home = AddressModel(
  id: 'a1',
  label: 'Home',
  recipientName: 'Nimal',
  recipientPhone: '+94771234567',
  addressLine1: '12 Galle Road',
  city: 'Dharga Town',
  latitude: 6.9,
  longitude: 79.9,
  isDefault: true,
);

const ProductModel _milk = ProductModel(
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

void _expect48(WidgetTester tester, Finder finder, {String? reason}) {
  final size = tester.getSize(finder);
  expect(size.width, greaterThanOrEqualTo(48), reason: reason);
  expect(size.height, greaterThanOrEqualTo(48), reason: reason);
}

Future<void> _guidelines(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('cart line (CartProductCard)', () {
    Widget line(WidgetTester tester, CartProvider cart, {double width = 400, double textScale = 1}) {
      return ChangeNotifierProvider<CartProvider>.value(
        value: cart,
        child: componentHost(
          tester,
          const Padding(
            padding: EdgeInsets.all(8),
            child: CartProductCard(line: CartLine(product: _milk, quantity: 2)),
          ),
          width: width,
          textScale: textScale,
          center: false,
        ),
      );
    }

    testWidgets('remove is a 48 x 48 button with a tooltip and a spoken name', (tester) async {
      final handle = tester.ensureSemantics();
      final cart = CartProvider()
        ..add(_milk)
        ..add(_milk);
      await tester.pumpWidget(line(tester, cart));

      final remove = find.byTooltip('Remove Kotmale Fresh Milk 1L');
      expect(remove, findsOneWidget);
      _expect48(tester, find.byType(IconButton), reason: 'trash');

      final node = tester.getSemantics(remove);
      expect(node.flagsCollection.isButton, isTrue);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

      await tester.tap(remove);
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 0);
      handle.dispose();
    });

    testWidgets('the stepper in the line is 48 dp tall with 48 dp buttons', (tester) async {
      final cart = CartProvider()..add(_milk);
      await tester.pumpWidget(line(tester, cart));
      for (final icon in [Icons.remove, Icons.add]) {
        _expect48(tester, find.ancestor(of: find.byIcon(icon), matching: find.byType(InkResponse)));
      }
    });

    for (final width in [320.0, 400.0, 800.0]) {
      testWidgets('meets the Android, iOS and labelled tap-target guidelines at ${width.toInt()} dp', (tester) async {
        final handle = tester.ensureSemantics();
        final cart = CartProvider()
          ..add(_milk)
          ..add(_milk);
        await tester.pumpWidget(line(tester, cart, width: width));
        await _guidelines(tester);
        handle.dispose();
      });
    }

    for (final scale in kTextScales) {
      testWidgets('no overflow on a 320 dp phone at ${scale}x, price and stepper both visible', (tester) async {
        final cart = CartProvider()
          ..add(_milk)
          ..add(_milk);
        await tester.pumpWidget(line(tester, cart, width: 320, textScale: scale));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byIcon(Icons.add), findsOneWidget);
        expect(find.textContaining('LKR'), findsWidgets);
        // The stepper never leaves the card.
        final card = tester.getRect(find.byType(CartProductCard));
        expect(tester.getRect(find.byIcon(Icons.add)).right, lessThanOrEqualTo(card.right));
      });
    }

    testWidgets('the frozen copy that animates out offers no controls', (tester) async {
      final cart = CartProvider();
      await tester.pumpWidget(ChangeNotifierProvider<CartProvider>.value(
        value: cart,
        child: componentHost(
          tester,
          const CartProductCard(line: CartLine(product: _milk, quantity: 1), interactive: false),
          center: false,
        ),
      ));
      expect(find.byType(IconButton), findsOneWidget);
      expect(tester.widget<IconButton>(find.byType(IconButton)).onPressed, isNull);
      expect(find.byIcon(Icons.add), findsNothing);
    });
  });

  group('Skip buttons', () {
    setUp(() => FlutterSecureStorage.setMockInitialValues({}));

    Future<void> pumpLogin(WidgetTester tester, {double textScale = 1}) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: MaterialApp(
            theme: AppTheme.theme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!,
            ),
            home: const LoginScreen(),
            onGenerateRoute: (settings) => MaterialPageRoute(
              settings: settings,
              builder: (_) => Scaffold(body: Text('route:${settings.name}')),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('login Skip is a 48 x 48 button at 1.0x and 2.0x, and still skips', (tester) async {
      for (final scale in [1.0, 2.0]) {
        await pumpLogin(tester, textScale: scale);
        _expect48(tester, find.widgetWithText(TextButton, 'Skip'), reason: 'login Skip at ${scale}x');
      }
      await tester.tap(find.text('Skip'));
      await tester.pumpAndSettle();
      expect(find.text('route:/home'), findsOneWidget);
    });

    testWidgets('login Skip is not shrink-wrapped in the source', (tester) async {
      final source = File('lib/Screens/Auth/login_screen.dart').readAsStringSync();
      expect(source, isNot(contains('Size.zero')));
      expect(source, isNot(contains('MaterialTapTargetSize.shrinkWrap')));
    });

    testWidgets('OTP screen: app bar Skip and "Skip & explore store" are >= 48 x 48', (tester) async {
      tester.view.physicalSize = const Size(400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: MaterialApp(
            theme: AppTheme.theme,
            home: const OTPVerificationScreen(data: '0771234567'),
          ),
        ),
      );
      await tester.pump();
      _expect48(tester, find.widgetWithText(TextButton, 'Skip'), reason: 'app bar Skip');
      _expect48(tester, find.widgetWithText(TextButton, 'Skip & explore store'), reason: 'Skip & explore store');
      // Dispose the screen so its resend timer is cancelled.
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('login sheet: "Skip for now" is >= 48 x 48', (tester) async {
      tester.view.physicalSize = const Size(400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: MaterialApp(
            theme: AppTheme.theme,
            home: const Scaffold(body: SingleChildScrollView(child: LoginwithMobileWidget())),
          ),
        ),
      );
      await tester.pump();
      _expect48(tester, find.widgetWithText(TextButton, 'Skip for now'));
    });
  });

  group('"Change" / "Add" delivery address', () {
    Widget host(WidgetTester tester, _FakeAddresses addresses, {double textScale = 1, double width = 400}) {
      return ChangeNotifierProvider<AddressProvider>.value(
        value: addresses,
        child: componentHost(
          tester,
          const CartScreenAddressContainer(),
          textScale: textScale,
          width: width,
          center: false,
        ),
      );
    }

    testWidgets('is a real 48 x 48 button with its own name and a tap action', (tester) async {
      final handle = tester.ensureSemantics();
      final addresses = _FakeAddresses()..current = _home;
      await tester.pumpWidget(host(tester, addresses));

      final button = find.widgetWithText(TextButton, 'Change');
      expect(button, findsOneWidget);
      _expect48(tester, button);
      expect(
        File('lib/UI/Widgets/Organisms/cart_screen_address_container.dart').readAsStringSync(),
        isNot(contains('GestureDetector')),
        reason: 'bare text in a GestureDetector was the bug',
      );

      final node = tester.getSemantics(find.bySemanticsLabel('Change delivery address'));
      expect(node.flagsCollection.isButton, isTrue);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      handle.dispose();
    });

    testWidgets('with no address it says Add and is named "Add delivery address"', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(host(tester, _FakeAddresses()));
      final button = find.widgetWithText(TextButton, 'Add');
      _expect48(tester, button);
      expect(find.bySemanticsLabel('Add delivery address'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('opens the address book', (tester) async {
      String? pushed;
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ChangeNotifierProvider<AddressProvider>.value(
        value: _FakeAddresses()..current = _home,
        child: MaterialApp(
          theme: AppTheme.theme,
          home: const Scaffold(body: CartScreenAddressContainer()),
          onGenerateRoute: (settings) {
            pushed = settings.name;
            return MaterialPageRoute(settings: settings, builder: (_) => const Scaffold(body: Text('address book')));
          },
        ),
      ));
      await tester.tap(find.text('Change'));
      await tester.pumpAndSettle();
      expect(pushed, '/user/address');
    });

    testWidgets('meets the tap-target guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(host(tester, _FakeAddresses()..current = _home));
      await _guidelines(tester);
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('grows instead of overflowing at ${scale}x on 320 dp', (tester) async {
        await tester.pumpWidget(host(tester, _FakeAddresses()..current = _home, textScale: scale, width: 320));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(tester.getSize(find.byType(CartScreenAddressContainer)).height, greaterThanOrEqualTo(70));
        _expect48(tester, find.widgetWithText(TextButton, 'Change'));
      });
    }
  });

  group('Dental My Appointments Upcoming/Past toggle', () {
    // Empty list is enough - this group only cares about the toggle's own
    // tap-target size, not the rows below it.
    Future<dynamic> emptyAppointments(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
      return {
        'success': true,
        'data': {'appointments': <Object>[], 'pagination': {}},
      };
    }

    Future<void> pumpScreen(WidgetTester tester) async {
      await tester.pumpWidget(
        ChangeNotifierProvider<DentalProvider>(
          create: (_) => DentalProvider(request: emptyAppointments),
          child: const MaterialApp(home: DentalMyAppointmentsScreen()),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('Upcoming and Past segments are each >= 48 x 48 (review-F4 fix round 1)', (tester) async {
      await pumpScreen(tester);
      _expect48(tester, find.byKey(const Key('appt-tab-upcoming')), reason: 'Upcoming toggle segment');
      _expect48(tester, find.byKey(const Key('appt-tab-past')), reason: 'Past toggle segment');
    });

    testWidgets('meets the Android, iOS and labelled tap-target guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpScreen(tester);
      await _guidelines(tester);
      handle.dispose();
    });
  });
}
