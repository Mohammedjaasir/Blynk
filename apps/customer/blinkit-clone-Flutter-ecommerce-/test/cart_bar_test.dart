import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/bottom_cart_container.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_bar.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

ProductModel _product(String id, double price) => ProductModel(
      id: id,
      categoryId: 'c',
      categoryName: 'Dairy',
      name: 'Item $id',
      slug: 'item-$id',
      sku: 'SKU-$id',
      unit: '1 pc',
      sellingPrice: price,
      isAvailable: true,
    );

void main() {
  late CartProvider cart;
  late List<String> pushed;

  setUp(() {
    cart = CartProvider();
    pushed = [];
  });

  Future<void> pumpBar(
    WidgetTester tester, {
    Widget bar = const CartBar(),
    double width = 400,
    double textScale = 1,
    bool disableAnimations = false,
  }) async {
    tester.view.physicalSize = Size(width, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: AppTheme.theme,
          builder: (context, app) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(textScale),
              disableAnimations: disableAnimations,
            ),
            child: app!,
          ),
          onGenerateRoute: (settings) {
            pushed.add(settings.name ?? '');
            return MaterialPageRoute(
              settings: settings,
              builder: (_) => Scaffold(body: Text('route:${settings.name}')),
            );
          },
          home: Scaffold(
            body: Stack(children: [Align(alignment: Alignment.bottomCenter, child: bar)]),
          ),
        ),
      ),
    );
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    // The bar rises over emphasized and the total counts over entrance.
    await tester.pump(BlynkMotion.entrance);
    await tester.pump();
  }

  group('visibility', () {
    testWidgets('renders nothing while the cart is empty', (tester) async {
      await pumpBar(tester);
      expect(find.text('View cart'), findsNothing);
      expect(find.textContaining('item'), findsNothing);
      expect(tester.getSize(find.byType(CartBar)).height, 0);
    });

    testWidgets('appears when the first item is added and goes when it empties', (tester) async {
      await pumpBar(tester);

      cart.add(_product('milk', 540));
      await settle(tester);
      expect(find.text('1 item'), findsOneWidget);
      expect(find.text('View cart'), findsOneWidget);

      cart.remove('milk');
      await settle(tester);
      expect(find.text('View cart'), findsNothing);
      expect(find.textContaining('item'), findsNothing);
    });

    testWidgets('slides over BlynkMotion.emphasized', (tester) async {
      await pumpBar(tester);
      final tween = tester.widget<TweenAnimationBuilder<double>>(
        find.byType(TweenAnimationBuilder<double>),
      );
      expect(tween.duration, BlynkMotion.emphasized);

      cart.add(_product('milk', 540));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      // Half way: on screen but not fully revealed.
      final mid = tester.getSize(find.byType(CartBar)).height;
      await tester.pump(const Duration(milliseconds: 200));
      final full = tester.getSize(find.byType(CartBar)).height;
      expect(mid, greaterThan(0));
      expect(mid, lessThan(full));
    });

    testWidgets('its animation duration is zero under reduced motion', (tester) async {
      await pumpBar(tester, disableAnimations: true);
      final tween = tester.widget<TweenAnimationBuilder<double>>(
        find.byType(TweenAnimationBuilder<double>),
      );
      expect(tween.duration, Duration.zero);

      cart.add(_product('milk', 540));
      await tester.pump();
      await tester.pump();
      expect(find.text('1 item'), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
    });
  });

  group('content', () {
    testWidgets('count and items total come from the real CartProvider', (tester) async {
      cart
        ..add(_product('a', 540))
        ..add(_product('a', 540))
        ..add(_product('b', 805.5));
      await pumpBar(tester);
      await settle(tester);

      expect(cart.itemCount, 3);
      expect(find.text('3 items'), findsOneWidget);
      expect(find.text('Rs. 1,885.50'), findsOneWidget);
      expect(find.text('View cart'), findsOneWidget);

      cart.decrement(_product('a', 540));
      await settle(tester);
      expect(find.text('2 items'), findsOneWidget);
      expect(find.text('Rs. 1,345.50'), findsOneWidget);
    });

    testWidgets('one item is singular', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      expect(find.text('1 item'), findsOneWidget);
      expect(find.text('1 items'), findsNothing);
    });

    testWidgets('makes no delivery-fee claim', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' ');
      for (final word in ['elivery', 'ee', 'ree', 'otal']) {
        expect(texts.contains(word), isFalse, reason: word);
      }
    });

    testWidgets('the total outranks the count: bigger, bolder, brighter, below it',
        (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      final countStyle = tester.widget<Text>(find.text('1 item')).style!;
      final totalStyle = tester.widget<Text>(find.text('Rs. 540')).style!;

      // Hierarchy is three ramps at once, not one. If any of them collapses
      // the bar goes back to reading as one flat run of text, which is the
      // defect this replaced a separator-dot assertion to catch.
      expect(totalStyle.fontSize!, greaterThan(countStyle.fontSize!));
      expect(totalStyle.fontWeight!.value, greaterThan(countStyle.fontWeight!.value));
      expect(
        contrastRatio(totalStyle.color!, BlynkColors.ink),
        greaterThan(contrastRatio(countStyle.color!, BlynkColors.ink)),
      );

      // ...and the quiet line is still legible on its own: muted by ramp,
      // never by dropping under the 4.5:1 floor.
      expect(contrastRatio(countStyle.color!, BlynkColors.ink),
          greaterThanOrEqualTo(4.5));

      // Count above, total below.
      expect(
        tester.getTopLeft(find.text('1 item')).dy,
        lessThan(tester.getTopLeft(find.text('Rs. 540')).dy),
      );
    });

    testWidgets('the View cart pill carries a forward arrow, not a "→" character',
        (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      expect(
        find.descendant(of: find.byType(BlynkButton), matching: find.byIcon(Icons.arrow_forward)),
        findsOneWidget,
      );
      final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '');
      expect(texts.any((t) => t.contains('→')), isFalse);
    });
  });

  group('look', () {
    testWidgets('ink fill, md radius, raised shadow, >= 56 dp, 12 dp side margins', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      final box = tester.widget<DecoratedBox>(
        find.descendant(of: find.byType(CartBar), matching: find.byType(DecoratedBox)).first,
      );
      final deco = box.decoration as BoxDecoration;
      expect(deco.color, BlynkColors.ink);
      expect(deco.borderRadius, BlynkRadius.mdAll);
      expect(deco.boxShadow, BlynkElevation.raised);

      final rect = tester.getRect(find.byWidget(box));
      expect(rect.left, 12);
      expect(rect.right, 400 - 12);
      expect(rect.height, greaterThanOrEqualTo(56));
    });

    testWidgets('the View cart pill is a compact primary: 44 dp visual, 48 dp target', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      final button = find.byType(BlynkButton);
      expect(button, findsOneWidget);
      // The painted pill (the button's Material) is 44 dp; the ElevatedButton
      // around it is the padded 48 dp tap target.
      final pill = tester.getRect(
        find.descendant(of: find.byType(ElevatedButton), matching: find.byType(Material)).first,
      );
      expect(pill.height, 44);
      expect(tester.getSize(find.byType(ElevatedButton)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('meets tap-target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('does not overflow at text scale $scale on a 320 dp screen', (tester) async {
        for (var i = 0; i < 12; i++) {
          cart.add(_product('p$i', 1234.5));
        }
        await pumpBar(tester, width: 320, textScale: scale);
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(find.text('View cart'), findsOneWidget);
      });
    }
  });

  group('semantics and navigation', () {
    testWidgets('one node: "Cart, N items, Rs. X. View cart"', (tester) async {
      final handle = tester.ensureSemantics();
      cart
        ..add(_product('a', 540))
        ..add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      final node = tester.getSemantics(
        find.bySemanticsLabel('Cart, 2 items, Rs. 1,080. View cart'),
      );
      expect(node.flagsCollection.isButton, isTrue);
      expect(find.bySemanticsLabel('View cart'), findsNothing, reason: 'the pill is not a second node');
      handle.dispose();
    });

    testWidgets('singular label', (tester) async {
      final handle = tester.ensureSemantics();
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      expect(find.bySemanticsLabel('Cart, 1 item, Rs. 540. View cart'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('tapping the View cart pill opens /cart', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      await tester.tap(find.text('View cart'));
      await tester.pumpAndSettle();
      expect(pushed, contains('/cart'));
      expect(find.text('route:/cart'), findsOneWidget);
    });

    testWidgets('tapping anywhere else on the bar opens /cart too', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      await tester.tap(find.text('1 item'));
      await tester.pumpAndSettle();
      expect(pushed.where((r) => r == '/cart'), hasLength(1));
    });
  });

  group('BottomStickyContainer (pushed routes)', () {
    testWidgets('still works with its existing API and renders the same bar', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester, bar: const BottomStickyContainer());
      await settle(tester);
      expect(find.byType(CartBar), findsOneWidget);
      expect(find.text('1 item'), findsOneWidget);
      await tester.tap(find.text('View cart'));
      await tester.pumpAndSettle();
      expect(pushed, contains('/cart'));
    });

    testWidgets('is empty and inert for an empty cart', (tester) async {
      await pumpBar(tester, bar: const BottomStickyContainer());
      expect(find.text('View cart'), findsNothing);
    });
  });

  group('keyboard focus', () {
    BoxDecoration ring(WidgetTester tester) =>
        tester.widget<DecoratedBox>(find.byKey(const ValueKey('cart-bar-focus'))).decoration
            as BoxDecoration;

    // Focusable nodes that live inside the cart bar.
    List<FocusNode> stops(WidgetTester tester) => FocusManager.instance.rootScope.traversalDescendants
        .where((n) => n.canRequestFocus && n.context != null)
        .where((n) => n.context!.findAncestorWidgetOfExactType<CartBar>() != null)
        .toList();

    testWidgets('no ring until the bar is focused', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      expect(ring(tester).border, isNull);
    });

    testWidgets('Tab shows a 2 dp paper ring that has >= 3:1 against the ink bar', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      final border = ring(tester).border! as Border;
      expect(border.top.width, 2);
      expect(border.top.color, BlynkColors.paper, reason: 'yellow stays reserved for the action fill');
      expect(contrastRatio(border.top.color, BlynkColors.ink), greaterThanOrEqualTo(3));
      // The ring is inside the ink bar, so it is drawn on ink, not on the page.
      final barRect = tester.getRect(find.byKey(const ValueKey('cart-bar-focus')));
      expect(barRect.width, 400 - 24);
    });

    testWidgets('the bar is one tab stop: the pill is not a second one', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      expect(stops(tester), hasLength(1));

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(ring(tester).border, isNotNull);
      // Next Tab leaves the bar; it does not land on the pill first.
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<BlynkButton>(), isNull);
    });

    testWidgets('Enter and Space on the focused bar open the cart', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(pushed.where((r) => r == '/cart'), hasLength(1));
    });

    testWidgets('Space activates too', (tester) async {
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();
      expect(pushed.where((r) => r == '/cart'), hasLength(1));
    });

    testWidgets('the pill is still a pointer target with the same semantics', (tester) async {
      final handle = tester.ensureSemantics();
      cart.add(_product('a', 540));
      await pumpBar(tester);
      await settle(tester);
      expect(find.bySemanticsLabel('Cart, 1 item, Rs. 540. View cart'), findsOneWidget);
      await tester.tap(find.text('View cart'));
      await tester.pumpAndSettle();
      expect(pushed, contains('/cart'));
      handle.dispose();
    });
  });
}
