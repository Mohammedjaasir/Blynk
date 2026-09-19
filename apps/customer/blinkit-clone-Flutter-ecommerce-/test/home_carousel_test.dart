import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_carousel.dart';
import 'package:ecom/app_theme.dart';

/// Captured from the running backend (GET /api/v1/promotions) after
/// creating promotions in the Blynk Ops app. The endpoint returns active
/// promotions only, already in display order.
const _twoPromotions = '''
{"success":true,"data":{"promotions":[
 {"id":"p1","title":"Everyday Essentials","subtitle":"Milk, eggs and daily staples","image_url":"http://localhost:4000/uploads/promotions/a.png","background_type":"SOLID","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":"Explore","cta_destination_type":"CATEGORY","cta_destination_value":"dairy-eggs","display_order":1},
 {"id":"p2","title":"Snack Time","subtitle":"Biscuits and tea-time picks","image_url":null,"background_type":"GRADIENT","background_color":"#0C831F","background_color_end":"#5FBF6E","background_image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":2}
]}}''';

const _reordered = '''
{"success":true,"data":{"promotions":[
 {"id":"p2","title":"Snack Time","subtitle":"Biscuits and tea-time picks","image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1},
 {"id":"p1","title":"Everyday Essentials","subtitle":"Milk, eggs and daily staples","image_url":"http://localhost:4000/uploads/promotions/a.png","background_type":"SOLID","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":"Explore","cta_destination_type":"CATEGORY","cta_destination_value":"dairy-eggs","display_order":2}
]}}''';

const _catalogPromotion = '''
{"success":true,"data":{"promotions":[
 {"id":"p3","title":"Shop the whole store","subtitle":null,"image_url":null,"cta_label":"Browse all","cta_destination_type":"CATALOG","cta_destination_value":null,"display_order":1}
]}}''';


const _imageBackground = '''
{"success":true,"data":{"promotions":[
 {"id":"p4","title":"Weekend Market","subtitle":"Straight from the market","image_url":null,"background_type":"IMAGE","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/bg.png","cta_label":"Shop now","cta_destination_type":"CATALOG","cta_destination_value":null,"display_order":1}
]}}''';

const _brokenBackground = '''
{"success":true,"data":{"promotions":[
 {"id":"p5","title":"Broken colours","subtitle":null,"image_url":null,"background_type":"SOLID","background_color":"not-a-colour","background_color_end":null,"background_image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1}
]}}''';

const _noPromotions = '{"success":true,"data":{"promotions":[]}}';

class _FakeApi {
  String promotionsJson = _twoPromotions;
  bool failPromotions = false;
  int promotionCalls = 0;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/promotions') {
      promotionCalls++;
      if (failPromotions) throw ApiException(503, 'promotions unavailable');
      return jsonDecode(promotionsJson);
    }
    return jsonDecode('{"success":true,"data":{}}');
  }
}

void main() {
  late _FakeApi api;
  late ProductProvider products;
  RouteSettings? lastRoute;

  Future<void> pumpCarousel(
    WidgetTester tester, {
    Size size = const Size(430, 900),
  }) async {
    lastRoute = null;
    products = ProductProvider(request: api.call);

    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: products),
          ChangeNotifierProvider(create: (_) => CartProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: const Scaffold(
            body: CustomScrollView(slivers: [HomeScreenCarousel()]),
          ),
          onGenerateRoute: (settings) {
            lastRoute = settings;
            return MaterialPageRoute(
              builder: (_) => Scaffold(body: Text('route:${settings.name}')),
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  setUp(() => api = _FakeApi());

  group('backend-driven content', () {
    testWidgets('renders the promotions the API returned', (tester) async {
      await pumpCarousel(tester);

      expect(api.promotionCalls, 1);
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.text('Milk, eggs and daily staples'), findsOneWidget);
      expect(find.text('Explore'), findsOneWidget);
      expect(find.byType(PageView), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
    });

    testWidgets('carries no campaign content of its own', (tester) async {
      api.promotionsJson = _noPromotions;
      await pumpCarousel(tester);

      // The old hardcoded campaigns must not survive anywhere.
      for (final old in [
        'Everyday Essentials',
        'Fresh Picks',
        'Daily Grocery Run',
        'Shop Fresh',
      ]) {
        expect(find.textContaining(old), findsNothing, reason: old);
      }
    });

    testWidgets('shows promotions in the order the API returned them',
        (tester) async {
      await pumpCarousel(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);

      // Admin reorders; the customer app reflects the new order on refresh.
      api.promotionsJson = _reordered;
      await products.loadPromotions(force: true);
      await settle(tester);

      expect(products.promotions.first.title, 'Snack Time');
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('a promotion without a foreground image still composes',
        (tester) async {
      await pumpCarousel(tester);

      // Page two of the fixture has no foreground image and no CTA: the
      // background carries the card rather than an empty placeholder box.
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.text('Biscuits and tea-time picks'), findsOneWidget);
      expect(products.promotions[1].hasGradient, isTrue);
      expect(tester.takeException(), isNull);
    });
  });


  group('admin-controlled background', () {
    testWidgets('renders a solid background from the API', (tester) async {
      await pumpCarousel(tester);

      final promotion = products.promotions.first;
      expect(promotion.backgroundType, 'SOLID');
      expect(promotion.backgroundStart, const Color(0xFFFFE141));
      // The card paints that colour, not a palette the app chose.
      expect(
        find.byWidgetPredicate(
          (w) => w is ColoredBox && w.color == const Color(0xFFFFE141),
        ),
        findsWidgets,
      );
    });

    testWidgets('renders a gradient background from the API', (tester) async {
      await pumpCarousel(tester);
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      final gradient = products.promotions[1];
      expect(gradient.hasGradient, isTrue);
      expect(
        find.byWidgetPredicate((w) {
          if (w is! DecoratedBox) return false;
          final decoration = w.decoration;
          if (decoration is! BoxDecoration) return false;
          final fill = decoration.gradient;
          return fill is LinearGradient &&
              fill.colors.first == const Color(0xFF0C831F) &&
              fill.colors.last == const Color(0xFF5FBF6E);
        }),
        findsOneWidget,
      );
    });

    testWidgets('renders an image background with a legibility scrim',
        (tester) async {
      api.promotionsJson = _imageBackground;
      await pumpCarousel(tester);

      expect(products.promotions.single.hasBackgroundImage, isTrue);
      expect(find.byType(Image), findsWidgets);
      expect(find.text('Weekend Market'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unparseable colour falls back to the neutral surface',
        (tester) async {
      api.promotionsJson = _brokenBackground;
      await pumpCarousel(tester);

      expect(products.promotions.single.backgroundStart, isNull);
      expect(find.text('Broken colours'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('carries no palette of its own', (tester) async {
      // Two promotions, both SOLID with the same colour: if the widget were
      // still rotating its own palette they would differ.
      api.promotionsJson = _twoPromotions.replaceAll(
        '"background_type":"GRADIENT","background_color":"#0C831F","background_color_end":"#5FBF6E"',
        '"background_type":"SOLID","background_color":"#FFE141","background_color_end":null',
      );
      await pumpCarousel(tester);

      expect(
        products.promotions.every((p) => p.backgroundColor == '#FFE141'),
        isTrue,
      );
    });
  });

  group('graceful states', () {
    testWidgets('no active promotions hides the carousel entirely',
        (tester) async {
      api.promotionsJson = _noPromotions;
      await pumpCarousel(tester);

      expect(find.byType(PageView), findsNothing);
      expect(tester.takeException(), isNull);
      expect(products.promotionsLoaded, isTrue);
    });

    testWidgets('a failed promotions call hides it without crashing Home',
        (tester) async {
      api.failPromotions = true;
      await pumpCarousel(tester);

      expect(find.byType(PageView), findsNothing);
      expect(tester.takeException(), isNull);
      expect(products.promotions, isEmpty);
    });

    testWidgets('a single promotion shows no pagination track',
        (tester) async {
      api.promotionsJson = _catalogPromotion;
      await pumpCarousel(tester);

      expect(find.text('Shop the whole store'), findsOneWidget);
      // The pagination track only appears with more than one promotion.
      expect(find.bySemanticsLabel(RegExp(r'Promotion \d+ of')), findsNothing);
    });
  });

  group('behaviour', () {
    testWidgets('auto-advances between promotions', (tester) async {
      await pumpCarousel(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);

      await tester.pump(const Duration(seconds: 5));
      await settle(tester);
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('swipe moves to the next promotion', (tester) async {
      await pumpCarousel(tester);

      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('CTA opens the destination the admin chose', (tester) async {
      await pumpCarousel(tester);

      await tester.tap(find.text('Explore'));
      await settle(tester);

      expect(lastRoute?.name, '/products');
      expect(lastRoute?.arguments, 'dairy-eggs');
    });

    testWidgets('a CATALOG promotion opens the full catalog', (tester) async {
      api.promotionsJson = _catalogPromotion;
      await pumpCarousel(tester);

      await tester.tap(find.text('Browse all'));
      await settle(tester);

      expect(lastRoute?.name, '/products');
      expect(lastRoute?.arguments, '');
    });

    testWidgets('an informational promotion has no button', (tester) async {
      await pumpCarousel(tester);
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.byType(ElevatedButton), findsNothing);
    });
  });

  group('layout', () {
    for (final size in const [
      Size(320, 640),
      Size(375, 812),
      Size(414, 896),
      Size(768, 1024),
      Size(1280, 720),
      Size(1920, 1080),
    ]) {
      testWidgets('no overflow at ${size.width}x${size.height}',
          (tester) async {
        await pumpCarousel(tester, size: size);

        expect(tester.takeException(), isNull);
        expect(find.text('Everyday Essentials'), findsOneWidget);

        final width = size.width;
        await tester.drag(find.byType(PageView), Offset(-width * 0.8, 0));
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(find.text('Snack Time'), findsOneWidget);
      });
    }
  });
}
