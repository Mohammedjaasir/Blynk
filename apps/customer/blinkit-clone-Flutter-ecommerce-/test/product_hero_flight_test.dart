import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Atoms/product_hero.dart';
import 'package:ecom/design/tokens.dart';

/// The bending bug (2026-09-26): the card image box is landscape, the detail
/// image box is square, and a plain Hero laid the image out at every size in
/// between - with `BoxFit.cover` that re-cropped the photo every frame. These
/// tests fly a real Hero and measure the flying content in every frame: its
/// on-screen rectangle must keep the DETAIL box's aspect ratio exactly (only
/// position, uniform scale and the clip may change), whatever that ratio is.
const _contentKey = Key('content');

Widget _app({required Size card, required Size detail}) {
  Widget hero(Size size) => SizedBox.fromSize(
        size: size,
        child: ProductHero(
          productId: 'p1',
          child: Container(key: _contentKey, color: const Color(0xFFE67E22)),
        ),
      );
  return MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Align(
          alignment: Alignment.topLeft,
          child: GestureDetector(
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => Scaffold(body: Center(child: hero(detail))),
            )),
            child: hero(card),
          ),
        ),
      ),
    ),
  );
}

/// The flying content's on-screen rect (the shuttle's copy, not the hidden
/// heroes at either end).
Rect? _flyingRect(WidgetTester tester) {
  final shuttle = find.byType(ProductHeroShuttle);
  if (shuttle.evaluate().isEmpty) return null;
  return tester.getRect(find.descendant(of: shuttle, matching: find.byKey(_contentKey)));
}

Future<List<double>> _ratiosDuring(WidgetTester tester) async {
  final ratios = <double>[];
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 16));
    final r = _flyingRect(tester);
    if (r != null) ratios.add(r.width / r.height);
  }
  return ratios;
}

void main() {
  for (final c in <({String name, Size card, Size detail})>[
    (name: 'square detail', card: const Size(160, 136), detail: const Size(300, 300)),
    (name: 'portrait detail', card: const Size(160, 136), detail: const Size(200, 320)),
    (name: 'landscape detail', card: const Size(120, 160), detail: const Size(320, 200)),
  ]) {
    testWidgets('${c.name}: the flying image keeps one aspect ratio, push and pop',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final expected = c.detail.width / c.detail.height;

      await tester.pumpWidget(_app(card: c.card, detail: c.detail));
      await tester.tap(find.byKey(_contentKey));
      await tester.pump();
      final push = await _ratiosDuring(tester);
      expect(push, isNotEmpty, reason: 'a flight must actually have happened');
      for (final r in push) {
        expect(r, closeTo(expected, 0.001), reason: 'push: never re-laid-out at the flying box');
      }
      await tester.pumpAndSettle();

      tester.state<NavigatorState>(find.byType(Navigator)).pop();
      await tester.pump();
      final pop = await _ratiosDuring(tester);
      expect(pop, isNotEmpty);
      for (final r in pop) {
        expect(r, closeTo(expected, 0.001), reason: 'pop: never re-laid-out at the flying box');
      }
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('the flying content is laid out once, at the detail size', (tester) async {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_app(card: const Size(160, 136), detail: const Size(300, 300)));
    await tester.tap(find.byKey(_contentKey));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    final shuttle = find.byType(ProductHeroShuttle);
    expect(shuttle, findsOneWidget);
    // Layout size (pre-transform) is the detail's, whatever the flying box is.
    final box = tester.renderObject<RenderBox>(
        find.descendant(of: shuttle, matching: find.byKey(_contentKey)));
    expect(box.size, const Size(300, 300));
    await tester.pumpAndSettle();
  });

  // Second pass (2026-09-26): the content kept its shape, but the flying
  // WINDOW still reshaped - card box 0.85 tall, detail box square - so the
  // crop slid and it still looked bent on the emulator. With the real
  // widgets at their real sizes the window must keep one shape, every frame,
  // both ways, and its corners must stay rounded.
  testWidgets('the real card -> detail flight is a pure zoom: one window shape, rounded',
      (tester) async {
    tester.view.physicalSize = const Size(412, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    const product = ProductModel(
      id: 'p1', categoryId: 'c1', categoryName: 'Fruits', name: 'Banana',
      slug: 'banana', sku: 'SKU-1', unit: '12 pcs', sellingPrice: 384, isAvailable: true,
    );
    const cardWidth = 120.0;
    const card = Size(cardWidth, cardWidth * ProductCard.imageRatio);
    final detail = ProductHero.detailSizeFor(412 - 32, 900 * 0.48);
    expect(detail.height / detail.width, closeTo(ProductCard.imageRatio, 1e-9));

    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Align(
            alignment: Alignment.bottomLeft,
            child: GestureDetector(
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => Scaffold(
                  body: Align(
                    alignment: Alignment.topCenter,
                    child: SizedBox.fromSize(
                      size: detail,
                      child: const ProductHero(
                        productId: 'p1',
                        child: ProductImageWell(product: product, radius: BlynkRadius.lgAll),
                      ),
                    ),
                  ),
                ),
              )),
              child: SizedBox.fromSize(
                size: card,
                child: const ProductHero(
                  productId: 'p1',
                  child: ProductImageWell(product: product, semantic: false),
                ),
              ),
            ),
          ),
        ),
      ),
    ));

    Future<void> watch(String way) async {
      var frames = 0;
      for (var i = 0; i < 24; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        final clip = find.descendant(
            of: find.byType(ProductHeroShuttle), matching: find.byType(ClipRRect));
        if (clip.evaluate().isEmpty) continue;
        frames++;
        final r = tester.getRect(clip.first);
        expect(r.height / r.width, closeTo(ProductCard.imageRatio, 0.01),
            reason: '$way frame $i: the flying window reshaped ($r)');
        final radius = tester.widget<ClipRRect>(clip.first).borderRadius as BorderRadius;
        expect(radius.topLeft.x, greaterThan(0), reason: '$way: corners went square');
      }
      expect(frames, greaterThan(3), reason: '$way: a flight must actually have happened');
    }

    await tester.tap(find.byType(ProductImageWell));
    await tester.pump();
    await watch('push');
    await tester.pumpAndSettle();
    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pump();
    await watch('pop');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
