import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/add_to_cart_button.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/UI/Widgets/Atoms/quantity_stepper.dart';
import 'package:ecom/UI/Widgets/Organisms/product_rail.dart';
import 'package:ecom/UI/Widgets/Organisms/products_screen_grid.dart';
import 'package:ecom/app_responsive.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

ProductModel _p(
  int i, {
  String? name,
  bool available = true,
  double price = 605.5,
  String? imageUrl,
  String unit = '200 g',
}) =>
    ProductModel(
      id: 'p$i',
      categoryId: 'c1',
      categoryName: 'Dairy & Eggs',
      name: name ?? 'Product $i',
      slug: 'p$i',
      sku: 'SKU-$i',
      unit: unit,
      imageUrl: imageUrl,
      sellingPrice: price,
      isAvailable: available,
    );

Widget _host(
  WidgetTester tester,
  Widget child, {
  CartProvider? cart,
  double width = 420,
  double height = 900,
  double textScale = 1,
}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return ChangeNotifierProvider<CartProvider>.value(
    value: cart ?? CartProvider(),
    child: MaterialApp(
      theme: AppTheme.theme,
      builder: (context, app) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: app!,
      ),
      home: Scaffold(body: child),
    ),
  );
}

Widget _card(ProductModel product, {double width = 160}) => Builder(
      builder: (context) => Align(
        alignment: Alignment.topLeft,
        child: SizedBox(
          width: width,
          height: ProductCard.heightFor(context, width),
          child: ProductCard(product: product),
        ),
      ),
    );

void main() {
  group('the card renders only what the backend really sends', () {
    testWidgets('name, unit and an LKR price - and nothing that has no data source',
        (tester) async {
      await tester.pumpWidget(_host(tester, _card(_p(1, name: 'Kotmale Milk', unit: '1 L'))));

      expect(find.text('Kotmale Milk'), findsOneWidget);
      expect(find.text('1 L'), findsOneWidget);
      expect(find.text('LKR 605.50'), findsOneWidget);

      // NO fabricated commerce data: the backend has no rating, review count,
      // discount, original price or per-unit price, and there is no wishlist
      // backend for a favourite control.
      expect(find.byType(StruckPrice), findsNothing);
      for (final banned in <IconData>[
        Icons.star,
        Icons.star_border,
        Icons.star_half,
        Icons.star_outline,
        Icons.favorite,
        Icons.favorite_border,
        Icons.favorite_outline,
        Icons.local_offer,
        Icons.local_offer_outlined,
        Icons.discount,
        Icons.discount_outlined,
      ]) {
        expect(find.byIcon(banned), findsNothing, reason: '$banned has no data source');
      }
      for (final text in tester.widgetList<Text>(find.byType(Text))) {
        final data = text.data ?? '';
        expect(data.contains('%'), isFalse, reason: 'no discount pill: "$data"');
        expect(data.contains(r'$'), isFalse, reason: 'currency is LKR: "$data"');
        expect(data.contains('/'), isFalse, reason: 'no per-unit pricing: "$data"');
        expect(text.style?.decoration, isNot(TextDecoration.lineThrough),
            reason: 'no struck original price: "$data"');
      }
    });

    testWidgets('the image dominates: the well is the largest element in the card',
        (tester) async {
      await tester.pumpWidget(_host(tester, _card(_p(1))));
      final well = tester.getSize(find.byType(ProductImageWell));
      final card = tester.getSize(find.byType(ProductCard));
      expect(well.width, ProductCard.imageSideFor(160));
      // 2026-09-24: the well is no longer square — it follows `imageRatio`, so
      // a phone fits more products per screen. The SHAPE changed; the
      // principle did not, which is what the next assertion holds.
      expect(well.height, closeTo(well.width * ProductCard.imageRatio, 0.5),
          reason: 'the well follows imageRatio, not a square');
      expect(well.height, greaterThan(card.height / 3),
          reason: 'image-first (plan §4.1): shortening the card must not stop '
              'the photo being the dominant element');
    });

    testWidgets('paper surface, the card radius, a soft elevation and no border',
        (tester) async {
      await tester.pumpWidget(_host(tester, _card(_p(1))));
      final decoration = tester
          .widget<Container>(
            find.descendant(of: find.byType(ProductCard), matching: find.byType(Container)).first,
          )
          .decoration! as BoxDecoration;

      expect(decoration.color, BlynkCardProduct.surface);
      expect(decoration.borderRadius, BlynkCardProduct.radius);
      expect(decoration.boxShadow, BlynkCardProduct.elevation);
      expect(decoration.boxShadow, BlynkElevation.soft);
      expect(decoration.border, isNull);
      expect(decoration.gradient, isNull);
    });

    testWidgets('the name, unit and price wear the card tokens, not re-derived styles',
        (tester) async {
      await tester.pumpWidget(_host(tester, _card(_p(1, name: 'Kotmale Milk'))));
      final name = tester.widget<Text>(find.text('Kotmale Milk'));
      expect(name.style, BlynkCardProduct.name);
      expect(name.maxLines, BlynkCardProduct.nameMaxLines);
      expect(name.overflow, TextOverflow.ellipsis);
      expect(tester.widget<Text>(find.text('200 g')).style, BlynkType.productUnit);
      expect(tester.widget<MoneyText>(find.byType(MoneyText)).style, BlynkCardProduct.price);
    });
  });

  group('states', () {
    testWidgets('unavailable: the backend wash token, and the product stays readable',
        (tester) async {
      await tester.pumpWidget(_host(tester, _card(_p(3, name: 'Out Of Stock Item', available: false))));

      expect(find.text('Unavailable'), findsOneWidget);
      expect(find.text('N/A'), findsOneWidget);
      // Still legible: the name, unit and price are all still on screen.
      expect(find.text('Out Of Stock Item'), findsOneWidget);
      expect(find.text('LKR 605.50'), findsOneWidget);

      final wash = tester.widget<ColoredBox>(
        find.ancestor(of: find.text('Unavailable'), matching: find.byType(ColoredBox)).first,
      );
      expect(wash.color.a, closeTo(BlynkCardProduct.unavailableWashOpacity, 0.01));
      expect(
        wash.color.withValues(alpha: 1).toARGB32(),
        BlynkCardProduct.unavailableWashColor.toARGB32(),
      );
    });

    testWidgets('available: no wash at all', (tester) async {
      await tester.pumpWidget(_host(tester, _card(_p(1))));
      expect(find.text('Unavailable'), findsNothing);
      expect(find.text('ADD'), findsOneWidget);
    });

    testWidgets('in-cart: ADD swaps to the shared stepper and the card does not change size',
        (tester) async {
      final cart = CartProvider();
      await tester.pumpWidget(_host(tester, _card(_p(1)), cart: cart));
      final before = tester.getRect(find.byType(ProductCard));
      expect(find.text('ADD'), findsOneWidget);
      expect(find.byType(QuantityStepper), findsNothing);

      await tester.tap(find.text('ADD'));
      await tester.pumpAndSettle();

      expect(find.byType(QuantityStepper), findsOneWidget);
      expect(find.text('ADD'), findsNothing);
      expect(cart.quantityOf('p1'), 1, reason: 'the real CartProvider is still the source of truth');
      expect(tester.getRect(find.byType(ProductCard)), before);
      expect(tester.getSize(find.byType(AddToCartButton)).height, 48);
    });
  });

  group('geometry', () {
    testWidgets('heightFor is exactly what the card lays out, at every scale and width',
        (tester) async {
      for (final width in <double>[130, 152, 175, 190]) {
        for (final scale in kTextScales) {
          await tester.pumpWidget(_host(
            tester,
            _card(_p(2, name: 'A very long product name that certainly wraps onto two lines'),
                width: width),
            width: 900,
            textScale: scale,
          ));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$width dp at ${scale}x');
          expect(tester.getSize(find.byType(AddToCartButton)).height, 48);
        }
      }
    });

    testWidgets('every value is a token: padding, gap and control slot', (tester) async {
      expect(ProductCard.padding, BlynkCardProduct.padding);
      expect(ProductCard.gap, BlynkCardProduct.gap);
      expect(ProductCard.controlSlot, BlynkControl.minHeight);
      await tester.pumpWidget(_host(tester, _card(_p(1))));
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(ProductCard), matching: find.byType(Container)).first,
      );
      expect(container.padding, const EdgeInsets.all(BlynkCardProduct.padding));
    });
  });

  group('ProductRail', () {
    List<ProductModel> many() => [for (var i = 0; i < 40; i++) _p(i)];

    testWidgets('lazily builds: a 40-product rail builds only what fits', (tester) async {
      await tester.pumpWidget(_host(tester, ProductRail(products: many())));
      await tester.pumpAndSettle();
      final built = tester.widgetList(find.byType(ProductCard)).length;
      expect(built, greaterThan(0));
      expect(built, lessThan(40), reason: 'a ListView.builder must not build off-screen cards');
    });

    testWidgets('scrolls horizontally and reaches later products', (tester) async {
      await tester.pumpWidget(_host(tester, ProductRail(products: many())));
      await tester.pumpAndSettle();
      expect(find.text('Product 0'), findsOneWidget);

      await tester.drag(find.byType(ProductRail), const Offset(-1200, 0));
      await tester.pumpAndSettle();

      expect(find.text('Product 0'), findsNothing);
      expect(find.byType(ProductCard), findsWidgets);
    });

    testWidgets('the first card starts on the page gutter', (tester) async {
      const width = 420.0;
      await tester.pumpWidget(_host(tester, ProductRail(products: many()), width: width));
      await tester.pumpAndSettle();
      final rail = tester.getRect(find.byType(ProductRail));
      final first = tester.getRect(find.byType(ProductCard).first);
      expect(first.left - rail.left, BlynkProductGrid.gutterFor(width));
      expect(tester.getSize(find.byType(ProductCard).first).width,
          BlynkProductGrid.railCardWidthFor(width));
    });

    testWidgets('the rail is exactly one card tall, loading or loaded', (tester) async {
      await tester.pumpWidget(_host(tester, const ProductRail(products: [], loading: true)));
      await tester.pump();
      final loading = tester.getSize(find.byType(ProductRail)).height;

      await tester.pumpWidget(_host(tester, ProductRail(products: many())));
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(ProductRail)).height, loading,
          reason: 'the rail must not resize when the data lands');
    });

    testWidgets('an empty list renders nothing rather than a placeholder product',
        (tester) async {
      await tester.pumpWidget(_host(tester, const ProductRail(products: [])));
      await tester.pumpAndSettle();
      expect(find.byType(ProductCard), findsNothing);
    });
  });

  group('the responsive grid rule', () {
    test('2 narrow / 3 wide-phone / 3 medium / 4 expanded / 5 wide, from one place', () {
      // Three columns on a phone, but only from the width where the quantity
      // stepper's two 48 dp tap targets actually fit the card. Below that the
      // grid stays at two: the 2026-09-24 attempt that ignored this floor
      // overflowed the stepper's row by 32 px at both 360 and 412 dp.
      expect(BlynkProductGrid.threeColumn, 390);
      expect(BlynkProductGrid.columnsFor(320), 2);
      expect(BlynkProductGrid.columnsFor(360), 2);
      expect(BlynkProductGrid.columnsFor(389), 2);
      expect(BlynkProductGrid.columnsFor(390), 3);
      expect(BlynkProductGrid.columnsFor(412), 3);
      expect(BlynkProductGrid.columnsFor(599), 3);
      expect(BlynkProductGrid.columnsFor(600), 3);
      expect(BlynkProductGrid.columnsFor(1023), 3);
      expect(BlynkProductGrid.columnsFor(1024), 4);
      expect(BlynkProductGrid.columnsFor(1439), 4);
      expect(BlynkProductGrid.columnsFor(1440), 5);
      expect(BlynkProductGrid.columnsFor(1920), 5);
      // The legacy accessor is the same rule, not a second one.
      for (final w in <double>[320, 600, 1024, 1440, 1920]) {
        expect(Responsive(w).gridColumns, BlynkProductGrid.columnsFor(w));
      }
    });

    test('the gutter is the page gutter and the spacing is on the 4-pt scale', () {
      expect(BlynkProductGrid.gutterFor(400), BlynkSpace.s16);
      expect(BlynkProductGrid.gutterFor(800), BlynkSpace.s24);
      expect(BlynkProductGrid.gutterFor(1200), BlynkSpace.s32);
      // Tightened to s8 at compact on 2026-09-25: on a three-column phone
      // every dp of spacing comes out of the card's content box.
      expect(BlynkProductGrid.spacingFor(400), BlynkSpace.s8);
      expect(BlynkProductGrid.spacingFor(800), BlynkSpace.s16);
    });

    test('tileWidthFor fills the row exactly', () {
      for (final width in <double>[320, 360, 412, 800, 1200, 1600]) {
        final columns = BlynkProductGrid.columnsFor(width);
        final tile = BlynkProductGrid.tileWidthFor(width);
        final used = tile * columns +
            BlynkProductGrid.spacingFor(width) * (columns - 1) +
            BlynkProductGrid.gutterFor(width) * 2;
        expect(used, closeTo(width, 0.001), reason: '$width dp');
      }
    });

    for (final width in <double>[360, 800, 1200]) {
      testWidgets('$width dp: the grid renders that many columns and no overflow',
          (tester) async {
        await tester.pumpWidget(_host(
          tester,
          Builder(builder: (context) => buildProductsGrid(context, [for (var i = 0; i < 12; i++) _p(i)])),
          width: width,
        ));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        final expected = BlynkProductGrid.columnsFor(width);
        final top = tester.getRect(find.byType(ProductCard).first).top;
        final inFirstRow = tester
            .widgetList(find.byType(ProductCard))
            .toList()
            .asMap()
            .keys
            .where((i) => tester.getRect(find.byType(ProductCard).at(i)).top == top)
            .length;
        expect(inFirstRow, expected);
        expect(tester.getSize(find.byType(ProductCard).first).width,
            closeTo(BlynkProductGrid.tileWidthFor(width), 0.01));
      });
    }
  });
}
