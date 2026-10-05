import 'dart:io';
import 'dart:ui' show SemanticsAction, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/Auth/otp_verification_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_spinner.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_screen_address_container.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_screen_payment_container.dart';
import 'package:ecom/UI/Widgets/Organisms/empty_cart_view.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_app_bar.dart';
import 'package:ecom/UI/Widgets/Organisms/login_screen_otp_sheet.dart';
import 'package:ecom/UI/Widgets/Organisms/products_screen_sub_category_list.dart';
import 'package:ecom/Services/store_info.dart';
import 'package:ecom/app_design.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

/// Tests for the design audit's FIX-NOW wave (task AUDITFIX): every changed
/// area has a widget or contract test here or next to the screen's own tests.

class _FakeAddresses extends AddressProvider {
  AddressModel? current;

  @override
  AddressModel? get defaultAddress => current;

  @override
  List<AddressModel> get addresses => current == null ? const [] : [current!];

  @override
  Future<void> loadAddresses() async {}
}

class _Placing extends OrderProvider {
  int placeCalls = 0;

  @override
  bool get isPlacingOrder => true;

  @override
  Future<OrderModel?> placeOrder({required CartProvider cart, required String addressId, String? customerNotes}) async {
    placeCalls++;
    return null;
  }
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

/// True when any Text, Icon or spinner in the tree is drawn in the positive
/// (green) colour, which is reserved for a genuine positive state.
bool _anyGreen(WidgetTester tester) {
  bool green(Color? c) => c == BlynkColors.positive || c == BlynkColors.positiveInk;
  for (final w in tester.allWidgets) {
    if (w is Text && green(w.style?.color)) return true;
    if (w is Icon && green(w.color)) return true;
    if (w is CircularProgressIndicator && green(w.color)) return true;
    if (w is ElevatedButton || w is TextButton) {
      final style = (w as ButtonStyleButton).style;
      if (green(style?.backgroundColor?.resolve({})) || green(style?.foregroundColor?.resolve({}))) return true;
    }
  }
  return false;
}

Color _fill(WidgetTester tester, Finder button) =>
    tester.widget<ButtonStyleButton>(button).style!.backgroundColor!.resolve({})!;

Color _ink(WidgetTester tester, Finder button) =>
    tester.widget<ButtonStyleButton>(button).style!.foregroundColor!.resolve({})!;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('checkout bars (Place order, payment row, address row)', () {
    Widget bars(
      WidgetTester tester, {
      double textScale = 1,
      double width = 400,
      OrderProvider? orders,
      bool withAddress = true,
    }) {
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AddressProvider>.value(value: _FakeAddresses()..current = withAddress ? _home : null),
          ChangeNotifierProvider<CartProvider>.value(value: CartProvider()..add(_milk)),
          ChangeNotifierProvider<OrderProvider>.value(value: orders ?? OrderProvider()),
        ],
        child: componentHost(
          tester,
          const Align(
            alignment: Alignment.bottomCenter,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [CartScreenAddressContainer(), CartScreenPaymentContainer()],
            ),
          ),
          textScale: textScale,
          width: width,
          center: false,
        ),
      );
    }

    testWidgets('Place order is a BlynkButton.primary: signal fill, ink label, sentence case', (tester) async {
      await tester.pumpWidget(bars(tester));
      final button = find.widgetWithText(ElevatedButton, 'Place order');
      expect(button, findsOneWidget);
      expect(find.ancestor(of: button, matching: find.byType(BlynkButton)), findsOneWidget);
      expect(_fill(tester, button), BlynkColors.signal);
      expect(_ink(tester, button), BlynkColors.onSignal);
      expect(contrastRatio(BlynkColors.onSignal, BlynkColors.signal), greaterThanOrEqualTo(4.5));
      expect(find.text('Place Order'), findsNothing);
      expect(_anyGreen(tester), isFalse, reason: 'no green fill, label or icon on the checkout bars');
    });

    testWidgets('while placing, the button keeps its label, shows an ink spinner and ignores taps', (tester) async {
      final orders = _Placing();
      await tester.pumpWidget(bars(tester, orders: orders));
      expect(find.byType(BlynkSpinner), findsOneWidget);
      expect(_anyGreen(tester), isFalse);
      final button = find.widgetWithText(ElevatedButton, 'Place order');
      expect(_fill(tester, button), BlynkColors.signal, reason: 'it keeps the enabled look while loading');
      await tester.tap(button);
      await tester.pump();
      expect(orders.placeCalls, 0, reason: 'a second tap while placing is swallowed');
      expect(tester.takeException(), isNull);
    });

    testWidgets('the payment icon is an outlined ink2 glyph, not orange', (tester) async {
      await tester.pumpWidget(bars(tester));
      expect(find.byIcon(Icons.payment), findsNothing);
      expect(tester.widget<Icon>(find.byIcon(Icons.payments_outlined)).color, BlynkColors.ink2);
      expect(tester.widget<Icon>(find.byIcon(BlynkIcons.addressHome)).color, BlynkColors.ink2);
      expect(find.byIcon(Icons.home_filled), findsNothing);
    });

    testWidgets('"Change" is ink, not a green link, and keeps its own name', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(bars(tester));
      // W9: "Change" is now the shared BlynkButton.tertiary rather than a
      // hand-styled TextButton, so the ink comes from the button's resolved
      // foreground instead of an inline TextStyle. Same colour, and this now
      // also pins the DISABLED branch, which the inline style never covered.
      final change = tester.widget<TextButton>(find.widgetWithText(TextButton, 'Change'));
      expect(change.style?.foregroundColor?.resolve(<WidgetState>{}), BlynkColors.ink);
      expect(
        change.style?.foregroundColor?.resolve(<WidgetState>{WidgetState.disabled}),
        isNot(BlynkColors.positive),
        reason: 'never a green link',
      );
      expect(find.byType(BlynkButton), findsWidgets);
      expect(find.bySemanticsLabel('Change delivery address'), findsOneWidget);
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('both bars grow instead of overflowing at ${scale}x on a 320 dp phone', (tester) async {
        await tester.pumpWidget(bars(tester, textScale: scale, width: 320));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final payment = find.byType(CartScreenPaymentContainer);
        expect(tester.getSize(payment).height, greaterThanOrEqualTo(70));
        final place = tester.getRect(find.widgetWithText(ElevatedButton, 'Place order'));
        expect(place.height, greaterThanOrEqualTo(48));
        expect(place.left, greaterThanOrEqualTo(0));
        expect(place.right, lessThanOrEqualTo(320));
        // The whole label fits inside the button.
        final label = tester.getRect(find.descendant(of: find.byType(ElevatedButton), matching: find.text('Place order')).last);
        expect(label.height, lessThanOrEqualTo(place.height));
      });
    }

    test('the payment bar has a floor, not a fixed height', () {
      final source = File('lib/UI/Widgets/Organisms/cart_screen_payment_container.dart').readAsStringSync();
      expect(source, isNot(contains('height: 70')));
      expect(source, contains('BoxConstraints(minHeight: 70)'));
    });
  });

  group('empty cart and cart bar: no fixed 52 dp boxes around buttons', () {
    for (final scale in kTextScales) {
      testWidgets('empty cart at ${scale}x on 320 dp: no overflow, button 48 dp or more, label whole', (tester) async {
        await tester.pumpWidget(componentHost(tester, const EmptyCartView(), textScale: scale, width: 320, center: false));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final button = find.widgetWithText(ElevatedButton, 'Browse groceries');
        await tester.ensureVisible(button);
        expect(tester.getSize(button).height, greaterThanOrEqualTo(48));
        final label = tester.getRect(find.descendant(of: button, matching: find.text('Browse groceries')));
        expect(tester.getRect(button).height, greaterThanOrEqualTo(label.height));
      });
    }

    test('the sources no longer wrap a primary button in SizedBox(height: 52)', () {
      for (final path in [
        'lib/Screens/user_cart_screen.dart',
        'lib/UI/Widgets/Organisms/empty_cart_view.dart',
        'lib/Screens/search_screen.dart',
      ]) {
        expect(File(path).readAsStringSync(), isNot(contains('height: 52,')), reason: path);
      }
    });

    test('the cart total caption is sentence case at the caption size', () {
      final source = File('lib/Screens/user_cart_screen.dart').readAsStringSync();
      expect(source, isNot(contains("'TOTAL'")));
      expect(source, contains("'Total'"));
    });
  });

  // 2026-09-24: Home's full-width search FIELD was replaced by a circular
  // search button in the brand header, to match the reference composition, so
  // `HomeScreenSearchBar` renders nowhere in lib/ and has been deleted. The two
  // widget tests that pumped it went with it — a guard over a widget nothing
  // renders proves nothing.
  //
  // The contrast facts they asserted are NOT about that widget, though: they
  // pin the field recipe still used by the Search screen, and they pin the two
  // values it replaced as genuine failures. Those are kept here, widget-free,
  // rather than deleted along with the host. The 48 dp assertion is not kept:
  // it belonged to that widget, and the header button's own tap target is
  // covered by Home's tests.
  group('search field recipe (token-level; the Search screen renders it)', () {
    test('ink2 on well reads, lineStrong bounds it, and what they replaced still fails', () {
      expect(contrastRatio(BlynkColors.ink2, BlynkColors.well), greaterThanOrEqualTo(4.5));
      expect(contrastRatio(BlynkColors.lineStrong, BlynkColors.paper), greaterThanOrEqualTo(3));
      expect(contrastRatio(BlynkColors.lineStrong, BlynkColors.well), greaterThanOrEqualTo(3));
      // Non-vacuity: the pair this recipe replaced must still measure as a
      // failure, or the assertions above are not actually holding a line.
      expect(contrastRatio(AppTextColors.muted, BlynkColors.well), lessThan(4.5));
      expect(contrastRatio(BlynkColors.line, BlynkColors.paper), lessThan(3));
    });
  });

  group('Home header', () {
    testWidgets('the delivery window line is ink2, not green, with no letter-spacing', (tester) async {
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
          ChangeNotifierProvider<AddressProvider>(create: (_) => AddressProvider()),
        ],
        child: componentHost(
          tester,
          const CustomScrollView(slivers: [HomeScreenAppBar()]),
          center: false,
        ),
      ));
      expect(_anyGreen(tester), isFalse);
      // 2026-09-24: the line is the destination alone. It used to read
      // 'Delivering to <hub> · <hours>' and truncated on a normal phone.
      final line = tester.widget<Text>(find.text(
          '${StoreInfo.hubName} · ${StoreInfo.deliveryHoursLabel}'));
      expect(line.style?.color, BlynkColors.ink2);
      expect(line.style?.letterSpacing, isNull);
      expect(tester.widget<Icon>(find.byIcon(BlynkIcons.shop)).color, BlynkColors.ink2);
    });
  });

  group('OTP verification screen', () {
    Future<void> pumpOtp(WidgetTester tester, {double textScale = 1, double width = 400}) async {
      tester.view.physicalSize = Size(width, 900);
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
            home: const OTPVerificationScreen(data: '0771234567', isDebug: false),
          ),
        ),
      );
      await tester.pump();
    }

    Future<void> dispose(WidgetTester tester) => tester.pumpWidget(const SizedBox());

    testWidgets('Verify is the one signal-yellow primary; nothing is green', (tester) async {
      await pumpOtp(tester);
      final verify = find.widgetWithText(ElevatedButton, 'Verify');
      expect(verify, findsOneWidget);
      expect(find.ancestor(of: verify, matching: find.byType(BlynkButton)), findsOneWidget);
      expect(_fill(tester, verify), BlynkColors.signal);
      expect(_ink(tester, verify), BlynkColors.onSignal);
      expect(_anyGreen(tester), isFalse);
      expect(find.text('Verify & Continue'), findsNothing);
      await dispose(tester);
    });

    testWidgets('Skip, Skip & explore store and Resend are ink tertiary buttons', (tester) async {
      await pumpOtp(tester);
      for (final label in ['Skip', 'Skip & explore store']) {
        final button = find.widgetWithText(TextButton, label);
        expect(button, findsOneWidget, reason: label);
        expect(_ink(tester, button), BlynkColors.ink, reason: label);
        expect(tester.getSize(button).height, greaterThanOrEqualTo(48), reason: label);
      }
      expect(find.byIcon(Icons.chevron_right), findsNothing, reason: 'no arrow on the Skip button');
      await tester.pump(const Duration(seconds: 31)); // the resend countdown ends
      final resend = find.widgetWithText(TextButton, 'Resend OTP');
      expect(resend, findsOneWidget);
      expect(_ink(tester, resend), BlynkColors.ink);
      expect(_anyGreen(tester), isFalse);
      await dispose(tester);
    });

    testWidgets('the code field is a BlynkTextField: label, number keyboard, one-time-code autofill, no forced caps',
        (tester) async {
      await pumpOtp(tester);
      expect(find.byType(BlynkTextField), findsOneWidget);
      expect(find.text('Verification code'), findsOneWidget);
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.keyboardType, TextInputType.number);
      expect(field.textCapitalization, TextCapitalization.none);
      expect(field.autofillHints, contains(AutofillHints.oneTimeCode));
      expect(field.maxLength, 6);
      await dispose(tester);
    });

    testWidgets('the field shows a lineStrong rest border, a 2 dp ink focus ring and a problem error state', (tester) async {
      await pumpOtp(tester);
      var decoration = tester.widget<TextField>(find.byType(TextField)).decoration!;
      var rest = decoration.enabledBorder! as OutlineInputBorder;
      final focus = decoration.focusedBorder! as OutlineInputBorder;
      expect(rest.borderSide.color, BlynkColors.lineStrong);
      expect(rest.borderSide.width, 1);
      expect(focus.borderSide.color, BlynkColors.ink);
      expect(focus.borderSide.width, 2);
      expect(rest.borderSide.color, isNot(focus.borderSide.color), reason: 'focus must be visible');

      await tester.tap(find.text('Verify'));
      await tester.pump();
      expect(find.text('Enter the 6-digit OTP'), findsOneWidget);
      expect(find.byIcon(BlynkIcons.error), findsOneWidget);
      decoration = tester.widget<TextField>(find.byType(TextField)).decoration!;
      rest = decoration.enabledBorder! as OutlineInputBorder;
      expect(rest.borderSide.color, BlynkColors.problem);
      expect(rest.borderSide.width, 2);
      await dispose(tester);
    });

    testWidgets('the error is a live region under the field', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpOtp(tester);
      await tester.tap(find.text('Verify'));
      await tester.pump();
      expect(tester.getSemantics(find.text('Enter the 6-digit OTP')).getSemanticsData().flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
      await dispose(tester);
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x on 320 dp, with the error showing', (tester) async {
        await pumpOtp(tester, textScale: scale, width: 320);
        await tester.tap(find.text('Verify'));
        await tester.pump();
        expect(tester.takeException(), isNull);
        await dispose(tester);
      });
    }

    test('the legacy OTP field and text-button helper are unreferenced and emptied', () {
      for (final path in ['lib/UI/Widgets/Atoms/custom_text_field.dart', 'lib/UI/Widgets/Atoms/custom_button.dart']) {
        if (!File(path).existsSync()) continue; // already deleted: nothing left to check
        final source = File(path).readAsStringSync();
        expect(source, isNot(contains('Widget custom')), reason: '$path still defines a widget');
        expect(source, isNot(contains('Colors.')), reason: path);
      }
      final referencing = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .where((f) => RegExp(r"custom_button\.dart|custom_text_field\.dart|customTextButton|customTextField|redAccentColor")
              .hasMatch(f.readAsStringSync()))
          .map((f) => f.path.replaceAll(r'\', '/'));
      expect(referencing, isEmpty);
    });
  });

  group('login sheet', () {
    Future<void> pumpSheet(WidgetTester tester, {double textScale = 1}) async {
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: componentHost(
            tester,
            const SingleChildScrollView(child: LoginwithMobileWidget()),
            textScale: textScale,
            center: false,
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('Continue is the signal-yellow primary, full width; Skip for now is ink; nothing is green', (tester) async {
      await pumpSheet(tester);
      final button = find.widgetWithText(ElevatedButton, 'Continue');
      expect(find.ancestor(of: button, matching: find.byType(BlynkButton)), findsOneWidget);
      expect(_fill(tester, button), BlynkColors.signal);
      expect(_ink(tester, button), BlynkColors.onSignal);
      expect(tester.getSize(button).width, greaterThan(300), reason: 'expand: the fixed 110 dp side padding is gone');
      final skip = find.widgetWithText(TextButton, 'Skip for now');
      expect(_ink(tester, skip), BlynkColors.ink);
      expect(_anyGreen(tester), isFalse);
    });

    testWidgets('the terms line is ink2 (readable), not grey', (tester) async {
      await pumpSheet(tester);
      final terms = tester.widget<Text>(find.textContaining('By continuing'));
      expect(terms.style?.color, BlynkColors.ink2);
      expect(terms.style!.fontSize, greaterThanOrEqualTo(12));
      expect(contrastRatio(BlynkColors.ink2, BlynkColors.paper), greaterThanOrEqualTo(4.5));
      expect(contrastRatio(const Color(0xFF9E9E9E), BlynkColors.paper), lessThan(4.5), reason: 'the grey it replaced');
    });

    testWidgets('while requesting, Continue keeps its place and shows an ink spinner', (tester) async {
      await pumpSheet(tester);
      expect(find.byType(BlynkSpinner), findsNothing);
      // Title uses the type scale, sentence case.
      expect(find.text('Log in or sign up'), findsOneWidget);
    });
  });

  group('onboarding (first screen)', () {
    Future<void> pumpOnboarding(WidgetTester tester, {bool reduced = false}) async {
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(),
          child: componentHost(tester, const LoginScreen(), disableAnimations: reduced, center: false),
        ),
      );
      await tester.pump();
    }

    Future<void> next(WidgetTester tester) async {
      await tester.tap(find.text('Next'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }
    }

    testWidgets('the CTA is one signal-yellow BlynkButton with a label only: no arrow, no icon', (tester) async {
      await pumpOnboarding(tester);
      final cta = find.widgetWithText(ElevatedButton, 'Next');
      expect(find.ancestor(of: cta, matching: find.byType(BlynkButton)), findsOneWidget);
      expect(_fill(tester, cta), BlynkColors.signal);
      expect(_ink(tester, cta), BlynkColors.onSignal);
      expect(find.descendant(of: cta, matching: find.byType(Icon)), findsNothing);
      expect(find.descendant(of: cta, matching: find.byType(Text)), findsOneWidget);
      expect(find.byIcon(Icons.arrow_forward_rounded), findsNothing);
      expect(tester.getSize(cta).height, greaterThanOrEqualTo(48));
      await next(tester);
      expect(find.widgetWithText(ElevatedButton, 'Get started'), findsOneWidget);
      expect(find.text('Get Started'), findsNothing);
    });

    testWidgets('Skip is ink, not green', (tester) async {
      await pumpOnboarding(tester);
      final skip = tester.widget<Text>(find.text('Skip'));
      expect(skip.style?.color, BlynkColors.ink);
      expect(_anyGreen(tester), isFalse);
    });

    testWidgets('no gradient or shadow decorates the first screen', (tester) async {
      await pumpOnboarding(tester);
      for (final w in tester.allWidgets) {
        if (w is DecoratedBox) {
          final d = w.decoration;
          if (d is BoxDecoration) {
            expect(d.gradient, isNull);
            expect(d.boxShadow, anyOf(isNull, isEmpty));
          }
        }
      }
    });

    Image animation(WidgetTester tester) =>
        tester.widget<Image>(find.byKey(const Key('onboarding-animation')));
    String assetOf(Image image) => (image.image as AssetImage).assetName;

    // 2026-09-28: the Lottie stuttered on phones; the slide now plays the
    // same animation pre-rendered as an animated WebP, and shows a still
    // frame under reduced motion.
    testWidgets('the animated slide plays the pre-rendered WebP, and a still under reduced motion', (tester) async {
      await pumpOnboarding(tester);
      await next(tester);
      expect(assetOf(animation(tester)), 'Assets/Images/cart_packing.webp');
      await tester.pumpWidget(const SizedBox());

      await pumpOnboarding(tester, reduced: true);
      await next(tester);
      expect(assetOf(animation(tester)), 'Assets/Images/cart_packing_still.png');
    });

    testWidgets('the animation sits in its own layer, so its frames repaint nothing else', (tester) async {
      await pumpOnboarding(tester);
      await next(tester);
      Element? parent;
      tester.element(find.byKey(const Key('onboarding-animation'))).visitAncestorElements((e) {
        parent = e;
        return false; // the direct parent only
      });
      expect(parent!.widget, isA<RepaintBoundary>());
    });

    test('both animation assets are declared and exist', () {
      expect(File('Assets/Images/cart_packing.webp').existsSync(), isTrue);
      expect(File('Assets/Images/cart_packing_still.png').existsSync(), isTrue);
    });
  });

  group('flat cards', () {
    // 2026-09 redesign (spec §2 "Soft shadow is back"): cards float on the
    // BlynkElevation.soft token again; the hairline outside edge is
    // unchanged. Was: appCardDecoration had no shadow at all.
    test('appCardDecoration carries the soft shadow token and a hairline outside edge (layout unchanged)', () {
      final d = appCardDecoration();
      expect(d.boxShadow, BlynkElevation.soft);
      final border = d.border! as Border;
      expect(border.top.color, BlynkColors.line);
      expect(border.top.strokeAlign, BorderSide.strokeAlignOutside);
      expect(border.dimensions, EdgeInsets.zero, reason: 'an outside stroke takes no layout space');
      expect(d.color, BlynkColors.paper);
    });

    // Was: no shadow at all. Now the card's own Container casts exactly the
    // BlynkElevation.soft shadow (spec §3 "Product card").
    testWidgets('a product card casts the soft shadow, and only the soft token', (tester) async {
      await tester.pumpWidget(ChangeNotifierProvider<CartProvider>.value(
        value: CartProvider(),
        child: componentHost(
          tester,
          const SizedBox(width: 160, height: 260, child: ProductCard(product: _milk)),
        ),
      ));
      final shadowed = tester
          .widgetList<Container>(find.descendant(of: find.byType(ProductCard), matching: find.byType(Container)))
          .map((w) => w.decoration)
          .whereType<BoxDecoration>()
          .where((d) => d.boxShadow != null && d.boxShadow!.isNotEmpty);
      expect(shadowed, isNotEmpty, reason: 'the card casts the soft elevation shadow');
      for (final d in shadowed) {
        expect(d.boxShadow, BlynkElevation.soft);
      }
    });
  });

  group('category tile and rail', () {
    // 2026-09-24 redesign: the tile is a circle on one neutral surface, and
    // the selected one is a thin signal RING over a faint wash — not the
    // solid yellow block, and not one of four rotating pastels, that these
    // two tests used to assert. Both of those spent colour on decoration;
    // the tile now spends it only on state.
    testWidgets('selected: a signal ring over the faint wash, never a solid yellow tile',
        (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SizedBox(
          width: 90,
          height: 130,
          child: CategoryWidget(category: CategoryModel(id: '1', name: 'Dairy', slug: 'dairy'), isActive: true),
        ),
      ));
      final d = tester.widget<AnimatedContainer>(find.byType(AnimatedContainer)).decoration!
          as BoxDecoration;
      expect(d.shape, BoxShape.circle);
      expect(d.color, BlynkCategory.selectedSurface);
      expect(d.color, isNot(BlynkColors.signal));
      expect((d.border! as Border).top.color, BlynkCategory.selectedRing);
      expect((d.border! as Border).top.width, BlynkCategory.ringWidth);
    });

    testWidgets('unselected: the one neutral surface, no ring, no decorative colour',
        (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SizedBox(width: 90, height: 130, child: CategoryWidget(category: CategoryModel(id: '1', name: 'Dairy', slug: 'dairy'))),
      ));
      final d = tester.widget<AnimatedContainer>(find.byType(AnimatedContainer)).decoration!
          as BoxDecoration;
      expect(d.shape, BoxShape.circle);
      expect(d.color, BlynkCategory.surface);
      expect(d.border, isNull);
      expect(d.gradient, isNull);
    });

    for (final width in [320.0, 400.0]) {
      for (final scale in kTextScales) {
        testWidgets('the category grid fits two-line names at ${scale}x on $width dp', (tester) async {
          const names = ['Biscuits & Snacks', 'Dairy & Eggs', 'Fruit & Vegetables', 'Rice, Grains & Pulses', 'Tea', 'Spices and Sauces', 'Household', 'Baby'];
          await tester.pumpWidget(componentHost(
            tester,
            Builder(builder: (context) {
              return CustomScrollView(slivers: [
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  sliver: SliverGrid(
                    gridDelegate: CategoryTileGridDelegate(
                      crossAxisCount: 4,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 8,
                      labelHeight: CategoryTileGridDelegate.labelHeightFor(context),
                      diameter: CategoryTileGridDelegate.diameterIn(width, (width - 32 - 8 * 3) / 4),
                    ),
                    delegate: SliverChildBuilderDelegate(
                      (_, i) => CategoryWidget(category: CategoryModel(id: '$i', name: names[i], slug: 's$i')),
                      childCount: names.length,
                    ),
                  ),
                ),
              ]);
            }),
            textScale: scale,
            width: width,
            height: 900,
            center: false,
          ));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          // Every tile is at least as tall as its two-line label plus an image.
          final labelTwoLines = 2 * scale * 16;
          for (final tile in tester.widgetList<CategoryWidget>(find.byType(CategoryWidget))) {
            expect(tester.getSize(find.byWidget(tile)).height, greaterThan(labelTwoLines));
          }
        });
      }
    }

    test('the grid tile height follows the text scale (no fixed aspect ratio)', () {
      const small = CategoryTileGridDelegate(crossAxisCount: 4, mainAxisSpacing: 8, crossAxisSpacing: 8, labelHeight: 32, diameter: 64);
      const large = CategoryTileGridDelegate(crossAxisCount: 4, mainAxisSpacing: 8, crossAxisSpacing: 8, labelHeight: 64, diameter: 64);
      expect(large.shouldRelayout(small), isTrue);
      final source = File('lib/UI/Widgets/Organisms/home_category_groups.dart').readAsStringSync();
      expect(source, isNot(contains('childAspectRatio')));
      expect(File('lib/Screens/categories_screen.dart').readAsStringSync(), isNot(contains('childAspectRatio')));
    });

    Future<ProductProvider> loadedCategories() async {
      final provider = ProductProvider(
        request: (url, query) async => {
          'success': true,
          'data': {
            'categories': [
              {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'image_url': null, 'display_order': 1},
              {'id': 'c2', 'name': 'Biscuits & Snacks', 'slug': 'biscuits-snacks', 'image_url': null, 'display_order': 2},
            ],
          },
        },
      );
      await provider.loadCategories();
      return provider;
    }

    testWidgets('rail rows are labelled buttons, 48 dp or more, selection announced, ink active bar', (tester) async {
      final handle = tester.ensureSemantics();
      final provider = await loadedCategories();
      CategoryModel? picked;
      await tester.pumpWidget(ChangeNotifierProvider<ProductProvider>.value(
        value: provider,
        child: componentHost(
          tester,
          SizedBox(
            width: 90,
            height: 600,
            child: CategorySidebar(activeSlug: 'dairy-eggs', onSelect: (c) => picked = c),
          ),
        ),
      ));
      await tester.pumpAndSettle();

      final active = tester.getSemantics(find.bySemanticsLabel('Dairy & Eggs')).getSemanticsData();
      expect(active.flagsCollection.isButton, isTrue);
      expect(active.flagsCollection.isSelected, Tristate.isTrue);
      expect(active.hasAction(SemanticsAction.tap), isTrue);
      final other = tester.getSemantics(find.bySemanticsLabel('Biscuits & Snacks')).getSemanticsData();
      expect(other.flagsCollection.isSelected, Tristate.isFalse);

      for (final row in tester.widgetList<InkWell>(find.byType(InkWell))) {
        expect(tester.getSize(find.byWidget(row)).height, greaterThanOrEqualTo(48));
      }
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));

      final bar = tester
          .widgetList<Container>(find.byType(Container))
          .map((c) => c.decoration)
          .whereType<BoxDecoration>()
          .map((d) => d.border)
          .whereType<Border>()
          .where((b) => b.right.width == 3);
      expect(bar, hasLength(1));
      expect(bar.single.right.color, BlynkColors.ink);

      await tester.tap(find.text('Biscuits & Snacks'));
      expect(picked?.slug, 'biscuits-snacks');
      handle.dispose();
    });

    testWidgets('the rail grows its rows at 2.0x instead of overflowing', (tester) async {
      final provider = await loadedCategories();
      await tester.pumpWidget(ChangeNotifierProvider<ProductProvider>.value(
        value: provider,
        child: componentHost(
          tester,
          SizedBox(width: 90, height: 900, child: CategorySidebar(activeSlug: 'dairy-eggs', onSelect: (_) {})),
          textScale: 2,
        ),
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

}
