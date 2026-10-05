import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Atoms/entrance_fade.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/motion.dart';

/// Home's entrance is one timeline, not seven animations. These tests pin
/// what that buys: the sections arrive in order and are done quickly, the
/// category tiles start when their section appears (not invisibly before it), and
/// nothing - not a scroll back, not a pull to refresh - ever replays it.
const _categories = {
  'success': true,
  'data': {
    'categories': [
      {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'image_url': null, 'display_order': 1},
      {'id': 'c2', 'name': 'Biscuits & Snacks', 'slug': 'biscuits-snacks', 'image_url': null, 'display_order': 2},
    ],
  },
};

Map<String, dynamic> _product(String id, String name, num price) => {
      'id': id,
      'category_id': 'c1',
      'category_name': 'Dairy & Eggs',
      'name': name,
      'slug': id,
      'sku': 'SKU-$id',
      'unit': '1 L',
      'selling_price': price,
      'is_available': true,
    };

/// Enough groups that Home is several screens tall, so tiles really leave
/// the sliver cache when the page is scrolled away.
final _groups = {
  'success': true,
  'data': {
    'groups': [
      for (var g = 1; g <= 6; g++)
        {
          'id': 'g$g',
          'name': 'Group $g',
          'sort_order': g,
          'categories': [
            for (var i = 1; i <= 8; i++)
              {'id': 'c$g-$i', 'name': 'Category $g.$i', 'slug': 'category-$g-$i', 'image_url': null, 'display_order': i},
          ],
        },
    ],
  },
};

Future<dynamic> _backend(String url, Map<String, dynamic> query) async {
  if (url == '/catalog/categories') return _categories;
  if (url == '/catalog/home-groups') return _groups;
  if (url == '/promotions') return jsonDecode('{"success":true,"data":{"promotions":[]}}');
  if (url == '/catalog/products') {
    final products = [
      _product('p1', 'Kotmale Fresh Milk 1L', 540),
      _product('p2', 'Highland Yoghurt 80g', 90),
      _product('p3', 'Maliban Lemon Puff', 210),
      _product('p4', 'Anchor Butter 200g', 936),
    ];
    return {
      'success': true,
      'data': {
        'products': products,
        'pagination': {'page': 1, 'limit': 100, 'total': products.length, 'total_pages': 1},
      },
    };
  }
  throw StateError('unexpected $url');
}

Future<void> _pumpHome(WidgetTester tester, {bool reduceMotion = false}) async {
  tester.view.physicalSize = const Size(400, 860);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ProductProvider>(create: (_) => ProductProvider(request: _backend)),
        ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
        ChangeNotifierProvider<AddressProvider>(
          create: (_) => AddressProvider(
            request: ({methodType, url, body}) async => {'data': {'addresses': <Map<String, dynamic>>[]}},
          ),
        ),
        ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
        ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
          child: child!,
        ),
        home: const HomeScreen(),
      ),
    ),
  );
}

/// Every section's opacity, in the order the sections sit on the screen.
List<double> _sectionOpacities(WidgetTester tester) => tester
    .widgetList<SliverFadeTransition>(find.byType(SliverFadeTransition, skipOffstage: false))
    .map((s) => s.opacity.value)
    .toList();

/// The first category tile's OWN entrance opacity: the FadeTransition inside
/// its EntranceFade. Not "the first FadeTransition above the tile" - since M8
/// the route transition is one of those too, and it is always 1 once the
/// route has settled. Under reduced motion EntranceFade builds no
/// FadeTransition at all, which is the same as being at rest.
double _firstCardOpacity(WidgetTester tester) {
  final card = find.byType(CategoryWidget, skipOffstage: false).first;
  final entrance = find.ancestor(of: card, matching: find.byType(EntranceFade)).first;
  final fade = find.descendant(of: entrance, matching: find.byType(FadeTransition));
  if (fade.evaluate().isEmpty) return 1.0;
  return tester.widget<FadeTransition>(fade.first).opacity.value;
}

void main() {
  group('Home entrance', () {
    test('the whole timeline is 810 ms: long enough to see, short enough not to wait', () {
      // Five beats an entranceStep apart, the last lasting one entrance.
      // 2026-09-26: the first pass was 360 ms and a screen recording showed
      // it finishing under the route fade - present, but not perceivable.
      final total = BlynkMotion.entranceStep * 4 + BlynkMotion.entrance;
      expect(total.inMilliseconds, 810);
      expect(total.inMilliseconds, lessThanOrEqualTo(900));
    });

    testWidgets('sections arrive top to bottom, as one composition', (tester) async {
      await _pumpHome(tester);
      await tester.pump(); // frame 0
      expect(_sectionOpacities(tester), isNotEmpty);
      expect(_sectionOpacities(tester).first, 0, reason: 'nothing has arrived at frame 0');

      await tester.pump(const Duration(milliseconds: 60));
      final mid = _sectionOpacities(tester);
      // Strictly ordered: a lower section is never ahead of the one above it.
      for (var i = 1; i < mid.length; i++) {
        expect(mid[i], lessThanOrEqualTo(mid[i - 1]), reason: 'section $i ahead of $i-1 at 60 ms');
      }
      expect(mid.first, greaterThan(0), reason: 'the header has started');
      expect(mid.last, 0, reason: 'the category groups have not started yet');

      // ...and all of it has landed by the end of the 810 ms timeline.
      await tester.pump(const Duration(milliseconds: 800));
      expect(_sectionOpacities(tester), everyElement(1.0));
    });

    testWidgets('tiles start rising as their section appears, not before it', (tester) async {
      await _pumpHome(tester);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      // The groups beat starts at 360 ms; at 100 ms its first tile is
      // still fully transparent rather than already half-way in.
      expect(_firstCardOpacity(tester), 0);

      await tester.pump(const Duration(milliseconds: 400)); // t = 500 ms, mid-rise
      final o = _firstCardOpacity(tester);
      expect(o, greaterThan(0));
      expect(o, lessThan(1));
    });

    testWidgets('scrolling away and back does not replay it', (tester) async {
      await _pumpHome(tester);
      await tester.pumpAndSettle();
      expect(_sectionOpacities(tester), everyElement(1.0));

      final scrollable = find.byType(Scrollable).first;
      await tester.drag(scrollable, const Offset(0, -2000));
      await tester.pumpAndSettle();
      await tester.drag(scrollable, const Offset(0, 2000));
      await tester.pumpAndSettle();

      expect(_sectionOpacities(tester), everyElement(1.0),
          reason: 'sections rebuilt after scrolling are at rest, never mid-entrance');
    });

    testWidgets('a tile scrolled off and back is rebuilt at rest, not replayed', (tester) async {
      await _pumpHome(tester);
      await tester.pumpAndSettle();
      expect(_firstCardOpacity(tester), 1.0);

      // Far enough that the first rows leave the cache extent and are
      // disposed; on the way back they are built again from scratch.
      final scrollable = find.byType(Scrollable).first;
      await tester.drag(scrollable, const Offset(0, -4000));
      await tester.pumpAndSettle();
      await tester.drag(scrollable, const Offset(0, 4000));
      await tester.pump(); // the very first frame after the rebuild

      // Without EntranceScope this frame would be the start of a second
      // entrance: every rebuilt card at opacity 0, rising again.
      final fades = find.ancestor(
        of: find.byType(CategoryWidget, skipOffstage: false),
        matching: find.byType(FadeTransition),
      );
      for (final f in tester.widgetList<FadeTransition>(fades)) {
        expect(f.opacity.value, 1.0, reason: 'a rebuilt tile must be at rest');
      }
    });

    testWidgets('pull to refresh does not replay it', (tester) async {
      await _pumpHome(tester);
      await tester.pumpAndSettle();

      await tester.fling(find.byType(Scrollable).first, const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(_sectionOpacities(tester), everyElement(1.0));
      await tester.pumpAndSettle();
      expect(_sectionOpacities(tester), everyElement(1.0));
    });

    testWidgets('reduced motion: everything is at rest on the first frame', (tester) async {
      await _pumpHome(tester, reduceMotion: true);
      await tester.pump();
      expect(_sectionOpacities(tester), everyElement(1.0));
      // The tiles' own entrance is skipped too, so nothing on Home is mid-fade.
      expect(find.byType(EntranceFade, skipOffstage: false), findsWidgets);
      await tester.pump();
      expect(_firstCardOpacity(tester), 1.0);
    });
  });
}
