import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Atoms/product_hero.dart';
import 'package:ecom/app_theme.dart';

/// The card end of the product image's flight. The detail end is pinned in
/// `product_details_screen_test` against the same [ProductHero.tagFor], so the
/// two can never drift apart.
ProductModel _p(String id) => ProductModel(
      id: id,
      categoryId: 'c1',
      categoryName: 'Dairy & Eggs',
      name: 'Kotmale Fresh Milk 1L',
      slug: id,
      sku: 'SKU-$id',
      unit: '1 L',
      sellingPrice: 540,
      isAvailable: true,
    );

Widget _host(Widget child, {bool reduceMotion = false}) =>
    ChangeNotifierProvider<CartProvider>(
      create: (_) => CartProvider(),
      child: MediaQuery(
        data: MediaQueryData(size: const Size(400, 860), disableAnimations: reduceMotion),
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: Scaffold(body: Center(child: SizedBox(width: 180, height: 300, child: child))),
        ),
      ),
    );

void main() {
  group('ProductHero', () {
    test('the tag is one per product, and stable', () {
      expect(ProductHero.tagFor('p1'), ProductHero.tagFor('p1'));
      expect(ProductHero.tagFor('p1'), isNot(ProductHero.tagFor('p2')));
    });

    testWidgets('the card wraps only its image in a Hero tagged by product id', (tester) async {
      await tester.pumpWidget(_host(ProductCard(product: _p('p1'))));
      await tester.pump();

      final heroes = tester.widgetList<Hero>(find.byType(Hero)).toList();
      expect(heroes, hasLength(1), reason: 'one flight per card, the image');
      expect(heroes.single.tag, ProductHero.tagFor('p1'));
      // The hero is the image well, not the whole card: the name, price and
      // ADD control stay on the card and do not fly.
      expect(
        find.descendant(of: find.byType(Hero), matching: find.byType(ProductImageWell)),
        findsOneWidget,
      );
      expect(find.descendant(of: find.byType(Hero), matching: find.text('ADD')), findsNothing);
    });

    testWidgets('reduced motion: the flight is switched off, the route still works', (tester) async {
      await tester.pumpWidget(_host(ProductCard(product: _p('p1')), reduceMotion: true));
      await tester.pump();
      final mode = tester.widget<HeroMode>(find.byType(HeroMode));
      expect(mode.enabled, isFalse);
      // The Hero is still in the tree, so nothing about layout changed.
      expect(find.byType(Hero), findsOneWidget);
    });

    testWidgets('with motion on, the flight is enabled', (tester) async {
      await tester.pumpWidget(_host(ProductCard(product: _p('p1'))));
      await tester.pump();
      expect(tester.widget<HeroMode>(find.byType(HeroMode)).enabled, isTrue);
    });
  });
}
