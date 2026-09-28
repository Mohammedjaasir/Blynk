import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderParagraph;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/store_info.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_logo.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Atoms/circular_icon_button.dart';
import 'package:ecom/UI/Widgets/Organisms/home_brand_tagline.dart';
import 'package:ecom/UI/Widgets/Organisms/home_product_sections.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_app_bar.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_carousel.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_search_bar.dart';
import 'package:ecom/UI/Widgets/Atoms/section_header.dart';
import 'package:ecom/app_responsive.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/session_fakes.dart';

/// Home after the reference-composition rebuild: brand header, tagline,
/// promotional hero, category chips, the dental entry, then one honest
/// section header over a grid of real products.
///
/// Everything asserted here is either backend data or the brand's own words.
/// The last group is the guard against the reference mock's fabrications -
/// its heart, its stars, its "41% OFF" pill and its struck prices have no
/// backend field behind them and must never appear.

const _categoriesJson = {
  'success': true,
  'data': {
    'categories': [
      {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'image_url': null, 'display_order': 1},
      {'id': 'c2', 'name': 'Biscuits & Snacks', 'slug': 'biscuits-snacks', 'image_url': null, 'display_order': 2},
    ],
  },
};

Map<String, dynamic> _product(String id, String name, String unit, num price) => {
      'id': id,
      'category_id': 'c1',
      'category_name': 'Dairy & Eggs',
      'name': name,
      'slug': id,
      'sku': 'SKU-$id',
      'unit': unit,
      'selling_price': price,
      'is_available': true,
    };

/// One live promotion, in the shape GET /promotions really returns.
const _onePromotion = '''
{"success":true,"data":{"promotions":[
 {"id":"p1","title":"Everyday Essentials","subtitle":"Milk, eggs and daily staples","image_url":null,"background_type":"SOLID","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":"Explore","cta_destination_type":"CATEGORY","cta_destination_value":"dairy-eggs","display_order":1}
]}}''';

const _noPromotions = '{"success":true,"data":{"promotions":[]}}';

/// A customer who is signed in. `AuthProvider` only reports authenticated
/// once a real token pair exists, so the flag is overridden rather than a
/// fake token being planted in secure storage.
class _SignedIn extends AuthProvider {
  @override
  bool get isAuthenticated => true;
}

/// An `OrderProvider` whose `/orders` page is whatever the test says it is.
/// The shape is the one the real list endpoint returns, items included.
OrderProvider _ordersContaining(List<List<String>> ordersNewestFirst) {
  return OrderProvider(
    request: (method, url, {body, query}) async => {
      'success': true,
      'data': {
        'orders': [
          for (var o = 0; o < ordersNewestFirst.length; o++)
            {
              'id': 'o$o',
              'order_number': 'BLK-$o',
              'status': 'DELIVERED',
              'items': [
                for (var i = 0; i < ordersNewestFirst[o].length; i++)
                  {
                    'id': 'o$o-line-$i',
                    'product_id': ordersNewestFirst[o][i],
                    'product_name_snapshot': 'x',
                    'quantity': 1,
                  },
              ],
            },
        ],
        'pagination': {'page': 1, 'limit': 20, 'total': 1, 'total_pages': 1},
      },
    },
  );
}

class _Backend {
  _Backend({this.promotionsJson = _noPromotions});

  String promotionsJson;
  final List<Map<String, dynamic>> queries = [];

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/categories') return _categoriesJson;
    if (url == '/promotions') return jsonDecode(promotionsJson);
    if (url == '/catalog/products') {
      queries.add(query);
      final all = <Map<String, dynamic>>[
        _product('p1', 'Kotmale Fresh Milk 1L', '1 L', 540),
        _product('p2', 'Highland Yoghurt 80g', '80 g', 90),
        _product('p3', 'Maliban Lemon Puff', '200 g', 210),
      ];
      final slug = query['category_slug'];
      final products = slug == 'biscuits-snacks' ? [all[2]] : all;
      return {
        'success': true,
        'data': {
          'products': products,
          'pagination': {
            'page': 1,
            'limit': 100,
            'total': products.length,
            'total_pages': 1,
          },
        },
      };
    }
    throw StateError('unexpected $url');
  }
}

/// Ten categories: more than the grid's 8 tiles, so "More" appears.
class _ManyCategoriesBackend extends _Backend {
  @override
  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/categories') {
      return {
        'success': true,
        'data': {
          'categories': [
            for (var i = 1; i <= 10; i++)
              {'id': 'c$i', 'name': 'Category $i', 'slug': 'category-$i', 'image_url': null, 'display_order': i},
          ],
        },
      };
    }
    return super.call(url, query);
  }
}

/// A realistic long Sri Lankan address, in the shape GET /me/addresses
/// returns. Long on purpose: the destination line must not elide it.
const _longAddressJson = {
  'id': 'a1',
  'label': 'Home',
  'recipient_name': 'Nimal Perera',
  'recipient_phone': '+94771234567',
  'address_line1': '142/1A Sri Sumangala Mawatha',
  'address_line2': 'Opposite the Grand Mosque',
  'city': 'Dharga Town',
  'latitude': 6.5,
  'longitude': 80.0,
  'is_default': true,
};

/// What the destination line reads with [_longAddressJson] as the default
/// address: the label in emphasis, then the real summary.
const _longDestination =
    'Home · 142/1A Sri Sumangala Mawatha, Opposite the Grand Mosque, Dharga Town';

Future<CartProvider> _pumpHome(
  WidgetTester tester, {
  _Backend? backend,
  Size size = const Size(400, 860),
  List<String>? routeLog,
  List<Object?>? argsLog,
  AuthProvider? auth,
  OrderProvider? orders,
  List<Map<String, dynamic>> addresses = const [],
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final cart = CartProvider();
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ProductProvider>(
          create: (_) => ProductProvider(request: (backend ?? _Backend()).call),
        ),
        ChangeNotifierProvider<CartProvider>.value(value: cart),
        ChangeNotifierProvider<AddressProvider>(
          create: (_) => AddressProvider(
            request: ({methodType, url, body}) async => {
              'data': {'addresses': addresses},
            },
          ),
        ),
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => auth ?? AuthProvider(),
        ),
        ChangeNotifierProvider<OrderProvider>(create: (_) => orders ?? OrderProvider()),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: const HomeScreen(),
        onGenerateRoute: (settings) {
          routeLog?.add(settings.name ?? '');
          argsLog?.add(settings.arguments);
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => Scaffold(body: Text('route:${settings.name}')),
          );
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  return cart;
}

/// A Home shelf's section header (not the category tile of the same name).
Finder _shelf(String title) =>
    find.widgetWithText(BlynkSectionHeader, title, skipOffstage: false);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('brand header', () {
    testWidgets('leads with the Blynk lockup and the circular cart / account controls', (tester) async {
      await _pumpHome(tester);

      expect(find.byType(BlynkLogo), findsOneWidget);
      expect(tester.widget<BlynkLogo>(find.byType(BlynkLogo)).showWordmark, isTrue,
          reason: 'the reference header is the wordmark, not the mark alone');

      // 2026-09-24: two circular chrome controls, not three. The search icon
      // left the brand row when Home's full-width search FIELD came back -
      // two taps into the same screen a finger apart is duplicate chrome, and
      // the field is the larger, more discoverable of the two.
      final buttons = tester.widgetList<CircularIconButton>(find.byType(CircularIconButton)).toList();
      expect(buttons.map((b) => b.icon).toList(), [BlynkIcons.cart, BlynkIcons.profile]);
    });

    testWidgets('the cart badge is the real line count, and there is no badge on an empty cart', (tester) async {
      final cart = await _pumpHome(tester);

      final cartButton = find.byWidgetPredicate(
        (w) => w is CircularIconButton && w.icon == BlynkIcons.cart,
      );
      expect(tester.widget<CircularIconButton>(cartButton).badgeCount, 0);
      expect(find.descendant(of: cartButton, matching: find.text('2')), findsNothing);

      const milk = ProductModel(
        id: 'p1',
        categoryId: 'c1',
        categoryName: 'Dairy & Eggs',
        name: 'Kotmale Fresh Milk 1L',
        slug: 'p1',
        sku: 'SKU-p1',
        unit: '1 L',
        sellingPrice: 540,
        isAvailable: true,
      );
      cart.add(milk);
      cart.add(milk);
      await tester.pump();

      expect(tester.widget<CircularIconButton>(cartButton).badgeCount, 2);
      expect(find.descendant(of: cartButton, matching: find.text('2')), findsOneWidget);
    });

  });

  /// The reference gives the address its own row with real vertical space: a
  /// small caption above, the destination below, a chevron at the end. Ours
  /// carries the same hierarchy with **truthful** content - the reference's
  /// caption slot holds a delivery ETA and a distance, and Blynk has neither
  /// field, so it holds the real service window instead.
  group('address block', () {
    Finder caption() =>
        find.text('${StoreInfo.hubName} · ${StoreInfo.deliveryHoursLabel}');

    testWidgets('signed in with an address: the caption sits above the label + summary, with a chevron', (tester) async {
      await _pumpHome(
        tester,
        auth: SignedInAuth(),
        addresses: const [_longAddressJson],
      );

      // The service caption: the hub and the REAL window, never an ETA.
      expect(caption(), findsOneWidget);
      // The destination: the real AddressModel.label, then its real summary.
      final destination = find.text(_longDestination);
      expect(destination, findsOneWidget);

      // Caption above destination, both below the brand row: the reference's
      // stacked hierarchy, not a cramped strip beside a link.
      expect(tester.getTopLeft(caption()).dy,
          greaterThan(tester.getTopLeft(find.byType(BlynkLogo)).dy));
      expect(tester.getTopLeft(destination).dy,
          greaterThan(tester.getTopLeft(caption()).dy));

      // The label leads: same size, heavier weight than the street that
      // follows it.
      final spans = (tester.widget<Text>(destination).textSpan! as TextSpan)
          .children!
          .cast<TextSpan>();
      // The label as the customer stored it - Blynk sets no label in ALL
      // CAPS, so the emphasis is weight, not shouting (the reference shouts).
      expect(spans.first.text, 'Home');
      expect(spans.first.style!.fontWeight, FontWeight.w700);
      expect(spans.last.style!.fontWeight, FontWeight.w500);
      expect(spans.last.style!.fontSize, spans.first.style!.fontSize);

      // The affordance that says this opens the address list.
      expect(
        find.descendant(
          of: find.byType(HomeScreenAppBar),
          matching: find.byIcon(BlynkIcons.chevron),
        ),
        findsOneWidget,
      );
    });

    testWidgets('signed in with an address: the block opens the address book', (tester) async {
      final routes = <String>[];
      await _pumpHome(
        tester,
        auth: SignedInAuth(),
        addresses: const [_longAddressJson],
        routeLog: routes,
      );

      await tester.tap(find.text(_longDestination));
      await tester.pumpAndSettle();
      expect(routes.last, '/user/address');
    });

    testWidgets('signed in with no address: the destination slot is the action that fills it', (tester) async {
      final routes = <String>[];
      await _pumpHome(tester, auth: SignedInAuth(), routeLog: routes);

      expect(caption(), findsOneWidget);
      expect(find.text('Add a delivery address'), findsOneWidget);
      expect(find.text('Log in to set your delivery address'), findsNothing);

      await tester.tap(find.text('Add a delivery address'));
      await tester.pumpAndSettle();
      expect(routes.last, '/user/address');
    });

    testWidgets('signed out: the hub caption stays and the block is the log-in action', (tester) async {
      final routes = <String>[];
      await _pumpHome(tester, routeLog: routes);

      expect(caption(), findsOneWidget);
      expect(find.text('Log in to set your delivery address'), findsOneWidget);
      expect(find.text('Add a delivery address'), findsNothing);

      await tester.tap(find.text('Log in to set your delivery address'));
      await tester.pumpAndSettle();
      expect(routes.last, '/login');
    });

    testWidgets('the block is one >=48 dp target and speaks one sentence', (tester) async {
      final handle = tester.ensureSemantics();
      await _pumpHome(
        tester,
        auth: SignedInAuth(),
        addresses: const [_longAddressJson],
      );

      final target = find
          .ancestor(of: find.text(_longDestination), matching: find.byType(InkWell))
          .first;
      final size = tester.getSize(target);
      expect(size.height, greaterThanOrEqualTo(48));
      expect(size.width, greaterThanOrEqualTo(48));

      final node = tester.getSemantics(find.text(_longDestination));
      expect(node.label, contains('142/1A Sri Sumangala Mawatha'));
      expect(node.label, contains('Change delivery address'));
      handle.dispose();
    });

    // The whole reason the block grew a second line: a real address used to
    // truncate to "…" the moment one existed.
    for (final scale in const <double>[1.0, 1.3, 2.0]) {
      testWidgets('a realistic long address is never elided at ${scale}x', (tester) async {
        await _pumpHome(
          tester,
          auth: SignedInAuth(),
          addresses: const [_longAddressJson],
          size: const Size(320, 900),
          textScale: scale,
        );

        expect(tester.takeException(), isNull);
        final destination = find.text(_longDestination);
        expect(destination, findsOneWidget);

        // No line cap at all, so no `…` is reachable however long the
        // address is or however far the customer has scaled their type.
        expect(tester.widget<Text>(destination).maxLines, isNull);

        final paragraph = tester.renderObject<RenderParagraph>(
          find.descendant(of: destination, matching: find.byType(RichText)),
        );
        expect(paragraph.didExceedMaxLines, isFalse,
            reason: 'the destination wraps; it is never cut');
        // Non-vacuity: this address really does need more than one line at
        // 320 dp, so the assertions above are holding a line rather than
        // passing because nothing was ever at risk.
        final oneLine =
            BlynkText.heading.fontSize! * BlynkText.heading.height! * scale;
        expect(paragraph.size.height, greaterThan(oneLine * 1.5),
            reason: 'the long address wraps to at least two lines here');
      });
    }

    testWidgets('no ETA and no distance: the reference fabrications stay out', (tester) async {
      await _pumpHome(
        tester,
        auth: SignedInAuth(),
        addresses: const [_longAddressJson],
      );

      for (final text in tester.widgetList<Text>(find.byType(Text))) {
        final data = text.data ?? (text.textSpan?.toPlainText() ?? '');
        expect(RegExp(r'\d+\s*(minutes|mins|min\b)').hasMatch(data), isFalse,
            reason: 'there is no ETA field in the backend: "$data"');
        expect(RegExp(r'\d+\s*(m|km)\s+away').hasMatch(data), isFalse,
            reason: 'there is no distance field in the backend: "$data"');
      }
      expect(find.textContaining('away'), findsNothing);
    });
  });

  /// The customer asked for the reference's search bar back. It is a field,
  /// full width, directly under the address block - not a circular icon
  /// sharing the brand row, and not a mic that does nothing.
  group('search field', () {
    testWidgets('renders a full-width field under the address block', (tester) async {
      await _pumpHome(tester);

      final bar = find.byType(HomeScreenSearchBar);
      expect(bar, findsOneWidget);
      expect(find.text(HomeScreenSearchBar.placeholder), findsOneWidget);
      expect(find.byIcon(BlynkIcons.search), findsOneWidget,
          reason: 'one search affordance on the screen, not two');

      // Under the address block, above the tagline.
      final field = find
          .descendant(of: bar, matching: find.byType(InkWell))
          .first;
      expect(tester.getTopLeft(field).dy,
          greaterThan(tester.getTopLeft(find.text('Log in to set your delivery address')).dy));
      expect(
        tester.getTopLeft(field).dy,
        lessThan(tester
            .getTopLeft(find.descendant(
              of: find.byType(HomeBrandTagline),
              matching: find.byType(Text),
            ))
            .dy),
      );

      // A real field, not a strip: >= 48 dp and the full content width.
      final size = tester.getSize(field);
      expect(size.height, greaterThanOrEqualTo(48));
      expect(size.width, greaterThan(300));
    });

    testWidgets('wears the pinned field recipe: well fill, lineStrong boundary, ink2 placeholder', (tester) async {
      await _pumpHome(tester);

      final material = tester.widget<Material>(
        find
            .descendant(
                of: find.byType(HomeScreenSearchBar), matching: find.byType(Material))
            .first,
      );
      expect(material.color, BlynkColors.well);
      final shape = material.shape! as RoundedRectangleBorder;
      expect(shape.borderRadius, BlynkRadius.mdAll);
      expect(shape.side.color, BlynkColors.lineStrong);

      expect(
        tester.widget<Text>(find.text(HomeScreenSearchBar.placeholder)).style?.color,
        BlynkColors.ink2,
      );
    });

    testWidgets('tapping it opens the search screen', (tester) async {
      final routes = <String>[];
      await _pumpHome(tester, routeLog: routes);

      await tester.tap(find.text(HomeScreenSearchBar.placeholder));
      await tester.pumpAndSettle();
      expect(routes.last, '/search');
    });

    testWidgets('there is no microphone: the app has no voice search', (tester) async {
      await _pumpHome(tester, backend: _Backend(promotionsJson: _onePromotion));

      for (final glyph in const <IconData>[
        Icons.mic,
        Icons.mic_none,
        Icons.mic_none_outlined,
        Icons.mic_outlined,
        Icons.keyboard_voice,
        Icons.keyboard_voice_outlined,
        Icons.settings_voice,
      ]) {
        expect(find.byIcon(glyph), findsNothing,
            reason: '$glyph would be a dead control');
      }
    });
  });

  group('tagline', () {
    testWidgets('renders both lines, with the payoff word in Blynk green', (tester) async {
      await _pumpHome(tester);

      expect(find.byType(HomeBrandTagline), findsOneWidget);
      final text = tester.widget<Text>(
        find.descendant(of: find.byType(HomeBrandTagline), matching: find.byType(Text)),
      );
      final spans = (text.textSpan! as TextSpan).children!.cast<TextSpan>();
      expect(spans.first.text, '${HomeBrandTagline.promise}\n');
      expect(spans.first.style?.color, BlynkColors.ink);
      expect(spans.last.text, HomeBrandTagline.payoff);
      expect(spans.last.style?.color, BlynkColors.positive);
      // The payoff reads heavier: a step up the type scale, both at the
      // family's heaviest weight.
      expect(spans.last.style!.fontSize!, greaterThan(spans.first.style!.fontSize!));
      expect(spans.last.style?.fontWeight, FontWeight.w800);
    });

    testWidgets('it sits between the header and the hero', (tester) async {
      await _pumpHome(
        tester,
        backend: _Backend(promotionsJson: _onePromotion),
        size: const Size(430, 900),
      );

      final tagline = tester
          .getTopLeft(find.descendant(
            of: find.byType(HomeBrandTagline),
            matching: find.byType(Text),
          ))
          .dy;
      expect(tagline, greaterThan(tester.getTopLeft(find.byType(BlynkLogo)).dy));
      expect(tagline, lessThan(tester.getTopLeft(find.text('Everyday Essentials')).dy));
    });
  });

  group('promotional hero', () {
    testWidgets('renders the backend promotion, with its real headline and CTA', (tester) async {
      final routes = <String>[];
      await _pumpHome(
        tester,
        backend: _Backend(promotionsJson: _onePromotion),
        routeLog: routes,
        // The hero shows its subtitle from 420 dp up; below that the headline
        // carries the slide on its own.
        size: const Size(430, 900),
      );

      expect(find.byType(HomeScreenCarousel), findsOneWidget);
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.text('Milk, eggs and daily staples'), findsOneWidget);

      await tester.tap(find.text('Explore'));
      await tester.pumpAndSettle();
      expect(routes.last, '/products');
    });

    testWidgets('a single promotion draws no carousel dots', (tester) async {
      await _pumpHome(tester, backend: _Backend(promotionsJson: _onePromotion));
      expect(find.byKey(const ValueKey('promo-pager')), findsNothing);
    });

    testWidgets('with no live promotion there is no hero at all, and no placeholder', (tester) async {
      await _pumpHome(tester);

      expect(find.byType(HomeScreenCarousel, skipOffstage: false), findsOneWidget);
      // The slot collapses: no headline, no subtitle, no CTA, no dots.
      expect(find.text('Everyday Essentials'), findsNothing);
      expect(find.byKey(const ValueKey('promo-pager')), findsNothing);
    });
  });

  // 2026-09-24: these three used to assert that a category tile FILTERED
  // Home in place — selected itself, re-titled the section below and re-ran
  // the query without leaving the screen. Tapping a category now opens the
  // products screen for it, and Home's section is always the catalogue-wide
  // "Browse all". The tests are rewritten to that contract, and the two most
  // important assertions here are the negative ones: Home must not re-query,
  // and Home must not hold a selection.
  group('category tiles', () {
    // 2026-09-28: a 4-across grid of rounded tiles (owner's reference) in
    // place of the scrolling row of circles with an "All" tile.
    testWidgets('are the real backend categories, as rounded tiles, with no "All"', (tester) async {
      await _pumpHome(tester);

      final tiles = tester.widgetList<CategoryWidget>(find.byType(CategoryWidget)).toList();
      expect(tiles.map((t) => t.category.name).toList(), ['Dairy & Eggs', 'Biscuits & Snacks']);
      expect(tiles.every((t) => t.rounded), isTrue);
      expect(find.byKey(const Key('categories-more')), findsNothing, reason: 'only 2 categories: nothing more to show');
    });

    testWidgets('with more than 8 categories: two rows of 7 plus "More", which opens every category',
        (tester) async {
      final routes = <String>[];
      await _pumpHome(tester, backend: _ManyCategoriesBackend(), routeLog: routes);

      final tiles = tester.widgetList<CategoryWidget>(find.byType(CategoryWidget)).toList();
      expect(tiles.map((t) => t.category.name).toList(), [
        for (var i = 1; i <= 7; i++) 'Category $i',
        'More',
      ]);
      // Four across: the 5th tile starts the second row.
      double rowOf(String name) => tester
          .getTopLeft(find.descendant(of: find.byType(CategoryWidget), matching: find.text(name)))
          .dy;
      expect(rowOf('Category 5'), greaterThan(rowOf('Category 4')));
      expect(rowOf('Category 4'), rowOf('Category 1'));

      await tester.tap(find.byKey(const Key('categories-more')));
      await tester.pumpAndSettle();
      expect(routes.last, '/categories');
    });

    testWidgets('none of them is ever drawn selected: Home holds no filter',
        (tester) async {
      await _pumpHome(tester);

      BoxDecoration decorationOf(CategoryWidget tile) =>
          tester.widget<AnimatedContainer>(
            find.descendant(of: find.byWidget(tile), matching: find.byType(AnimatedContainer)),
          ).decoration! as BoxDecoration;

      final tiles = tester.widgetList<CategoryWidget>(find.byType(CategoryWidget)).toList();
      expect(tiles, isNotEmpty);
      for (final tile in tiles) {
        expect(tile.isActive, isFalse);
        final d = decorationOf(tile);
        expect(d.color, BlynkCategory.surface);
        expect(d.border, isNull,
            reason: 'a ring here would claim Home is filtered when it is not');
      }
    });

    testWidgets('tapping one opens its products page, carrying the slug', (tester) async {
      final routes = <String>[];
      final args = <Object?>[];
      final backend = _Backend();
      await _pumpHome(tester, backend: backend, routeLog: routes, argsLog: args);

      await tester.tap(find.text('Biscuits & Snacks'));
      await tester.pumpAndSettle();

      expect(routes, contains('/products'));
      expect(args.last, 'biscuits-snacks');
      expect(find.text('route:/products'), findsOneWidget);
    });

    testWidgets('Home never re-queries a category in place', (tester) async {
      // The behaviour this replaced: the tap re-ran the catalogue query with
      // a category_slug and swapped the section underneath. Home is the shop
      // front; browsing one category is its own page.
      final backend = _Backend();
      await _pumpHome(tester, backend: backend);

      expect(_shelf('Dairy & Eggs'), findsOneWidget);
      await tester.tap(find.text('Biscuits & Snacks'));
      await tester.pumpAndSettle();

      expect(backend.queries.any((q) => q['category_slug'] == 'biscuits-snacks'), isFalse,
          reason: 'the products screen runs that query, not Home');
    });

    testWidgets('coming back leaves Home on its shelves', (tester) async {
      await _pumpHome(tester);
      expect(_shelf('Dairy & Eggs'), findsOneWidget);

      await tester.tap(find.text('Biscuits & Snacks'));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(_shelf('Dairy & Eggs'), findsOneWidget);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    });
  });

  group('search hint', () {
    // 2026-09-26: the hint rotates through the store's real categories,
    // each word sliding in - and only real ones.
    testWidgets('rotates to real category names, and back', (tester) async {
      await _pumpHome(tester);
      expect(find.text(HomeScreenSearchBar.placeholder), findsOneWidget);

      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Search "dairy & eggs"'), findsOneWidget);
      expect(find.text(HomeScreenSearchBar.placeholder), findsNothing);

      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Search "biscuits & snacks"'), findsOneWidget);

      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text(HomeScreenSearchBar.placeholder), findsOneWidget,
          reason: 'the cycle returns to the plain placeholder');
      // The field still announces its fixed purpose, not the rotating word.
      expect(find.bySemanticsLabel('Search groceries and essentials'), findsOneWidget);
    });

    testWidgets('reduced motion: the plain placeholder, never rotating', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await _pumpHome(tester);
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(find.text(HomeScreenSearchBar.placeholder), findsOneWidget);
      expect(find.textContaining('Search "'), findsNothing);
    });
  });

  group('product grid', () {
    // 2026-09-26: Home is shelves by category (the reference app's layout),
    // in the store's category order, each shelf a way into its category.
    testWidgets('each product sits on its own category shelf, in category order',
        (tester) async {
      final backend = _Backend();
      Future<dynamic> request(String url, Map<String, dynamic> query) async {
        if (url != '/catalog/products') return backend.call(url, query);
        Map<String, dynamic> p(String id, String name, String cat) =>
            {..._product(id, name, '1 pc', 100), 'category_id': cat};
        return {
          'success': true,
          'data': {
            'products': [
              p('s1', 'Maliban Lemon Puff', 'c2'),
              p('d1', 'Kotmale Fresh Milk 1L', 'c1'),
              p('s2', 'Munchee Cream Cracker', 'c2'),
            ],
            'pagination': {'page': 1, 'limit': 100, 'total': 3, 'total_pages': 1},
          },
        };
      }

      final routes = <String>[];
      final args = <Object?>[];
      tester.view.physicalSize = const Size(400, 1600);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<ProductProvider>(create: (_) => ProductProvider(request: request)),
          ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
          ChangeNotifierProvider<AddressProvider>(
            create: (_) => AddressProvider(
              request: ({methodType, url, body}) async => {'data': {'addresses': []}},
            ),
          ),
          ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
          ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: const HomeScreen(),
          onGenerateRoute: (settings) {
            routes.add(settings.name ?? '');
            args.add(settings.arguments);
            return MaterialPageRoute(builder: (_) => const Scaffold());
          },
        ),
      ));
      await tester.pumpAndSettle();

      final dairy = tester.getTopLeft(_shelf('Dairy & Eggs')).dy;
      final snacks = tester.getTopLeft(_shelf('Biscuits & Snacks')).dy;
      expect(dairy, lessThan(snacks), reason: 'category display_order, not product order');

      // Milk is under Dairy; both snacks are under Biscuits & Snacks.
      final milk = tester.getTopLeft(find.text('Kotmale Fresh Milk 1L')).dy;
      final puff = tester.getTopLeft(find.text('Maliban Lemon Puff')).dy;
      final cracker = tester.getTopLeft(find.text('Munchee Cream Cracker')).dy;
      expect(milk, inInclusiveRange(dairy, snacks));
      expect(puff, greaterThan(snacks));
      expect(cracker, greaterThan(snacks));

      await tester.tap(find.descendant(of: _shelf('Biscuits & Snacks'), matching: find.text('See all')));
      await tester.pumpAndSettle();
      expect(routes.last, '/products');
      expect(args.last, 'biscuits-snacks');
    });

    // 2026-09-26: Home lists every available product, fetched across every
    // page - not a 6-row preview behind "See all".
    testWidgets('lists every available product, across pages',
        (tester) async {
      final pages = <int>[];
      final backend = _Backend();
      final catalogue = [
        for (var i = 1; i <= 45; i++)
          {..._product('q$i', 'Item $i', '1 pc', 100 + i), if (i == 7) 'is_available': false},
      ];
      Future<dynamic> request(String url, Map<String, dynamic> query) async {
        if (url != '/catalog/products') return backend.call(url, query);
        final page = (query['page'] as int?) ?? 1;
        pages.add(page);
        final slice = page == 1 ? catalogue.sublist(0, 30) : catalogue.sublist(30);
        return {
          'success': true,
          'data': {
            'products': slice,
            'pagination': {'page': page, 'limit': 30, 'total': 45, 'total_pages': 2},
          },
        };
      }

      tester.view.physicalSize = const Size(400, 860);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<ProductProvider>(create: (_) => ProductProvider(request: request)),
          ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
          ChangeNotifierProvider<AddressProvider>(
            create: (_) => AddressProvider(
              request: ({methodType, url, body}) async => {'data': {'addresses': []}},
            ),
          ),
          ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
          ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
        ],
        child: MaterialApp(theme: AppTheme.appTHeme, home: const HomeScreen()),
      ));
      await tester.pumpAndSettle();

      expect(pages, containsAllInOrder([1, 2]), reason: 'the second page must be fetched');
      await tester.scrollUntilVisible(find.text('Item 45'), 400,
          scrollable: find.byType(Scrollable).first);
      expect(find.text('Item 45'), findsOneWidget);
      await tester.pumpAndSettle();
      final provider = tester.element(find.byType(HomeScreen)).read<ProductProvider>();
      expect(provider.productsFor('').length, 45);
      // Walk back up: the unavailable product is never on Home.
      await tester.scrollUntilVisible(find.text('Item 1'), -400,
          scrollable: find.byType(Scrollable).first);
      expect(find.text('Item 7'), findsNothing);
    });

    testWidgets('renders the real products on shelves named for their real categories', (tester) async {
      await _pumpHome(tester);

      // Every fixture product is in Dairy & Eggs; Biscuits & Snacks has
      // none, so it gets no empty shelf. A signed-out visitor has nothing to
      // rank against, so there is no personalised shelf either.
      expect(_shelf('Dairy & Eggs'), findsOneWidget);
      expect(_shelf('Biscuits & Snacks'), findsNothing, reason: 'no empty shelves');
      expect(find.text(HomeProductSections.allTitle), findsNothing);
      expect(find.text(HomeProductSections.personalisedTitle), findsNothing,
          reason: 'no orders, no claim to be based on them');

      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.text('1 L'), findsOneWidget);
      expect(find.textContaining('LKR 540'), findsWidgets);
    });

    // 2026-09-24: Home may now reorder "Browse all" against the customer's
    // OWN past orders, and say so. What it still may not do is claim a
    // signal this backend does not have. There is no recommendations
    // endpoint, no popularity or sales data on the catalogue, and no
    // cross-customer data reaches this app at all, so every one of these
    // phrases would be invented.
    testWidgets('never claims a signal the backend does not have', (tester) async {
      await _pumpHome(tester);

      for (final invented in [
        'Recommended for You',
        'Recommended',
        'Popular right now',
        'Popular',
        'Trending',
        'Just for you',
        'Best seller',
        'Bestsellers',
        'Customers also bought',
        'Top picks',
        'Most ordered',
      ]) {
        expect(find.textContaining(invented, skipOffstage: false), findsNothing,
            reason: '"$invented" has no data behind it in this backend');
      }
    });

    test('the personalised title names its source, and only its source', () {
      // The title is a factual statement the Orders screen can corroborate
      // line for line, not the name of an engine.
      expect(HomeProductSections.personalisedTitle, 'Based on your orders');
      expect(HomeProductSections.personalisedTitle.toLowerCase(),
          isNot(contains('recommend')));
      expect(HomeProductSections.personalisedTitle.toLowerCase(),
          isNot(contains('popular')));
    });

    testWidgets('a returning customer sees what they buy first, and is told why',
        (tester) async {
      // The catalogue comes back milk, yoghurt, lemon puff. This customer's
      // most recent order was lemon puff, so that is what they see first.
      await _pumpHome(
        tester,
        auth: _SignedIn(),
        orders: _ordersContaining([
          ['p3'],
        ]),
      );
      await tester.pumpAndSettle();

      expect(find.text(HomeProductSections.personalisedTitle), findsOneWidget);
      expect(find.text(HomeProductSections.allTitle), findsNothing);

      final names = tester
          .widgetList<ProductCard>(find.byType(ProductCard))
          .map((c) => c.product.name)
          .toList();
      expect(names.first, 'Maliban Lemon Puff');
      // The personalised shelf adds to the shop, it does not replace it:
      // the full category shelf follows, milk included.
      await tester.scrollUntilVisible(find.text('Kotmale Fresh Milk 1L'), 300,
          scrollable: find.byType(Scrollable).first);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(_shelf('Dairy & Eggs'), findsOneWidget);
    });

    testWidgets('a signed-in customer with no orders yet is not personalised',
        (tester) async {
      // Signed in is not the same as known. With nothing bought there is no
      // signal, so the grid must stay in the backend order and say so.
      await _pumpHome(tester, auth: _SignedIn(), orders: _ordersContaining(const []));
      await tester.pumpAndSettle();

      expect(_shelf('Dairy & Eggs'), findsOneWidget);
      expect(find.text(HomeProductSections.personalisedTitle), findsNothing);

      final names = tester
          .widgetList<ProductCard>(find.byType(ProductCard))
          .map((c) => c.product.name)
          .toList();
      expect(names.first, 'Kotmale Fresh Milk 1L', reason: 'untouched backend order');
    });

    testWidgets('a signed-out visitor has no history fetched on their behalf',
        (tester) async {
      // Requesting /orders for someone with no session can only 401, and
      // there is nothing to rank with anyway.
      var ordersRequested = false;
      await _pumpHome(
        tester,
        orders: OrderProvider(request: (method, url, {body, query}) async {
          ordersRequested = true;
          return {'success': true, 'data': {'orders': []}};
        }),
      );
      await tester.pumpAndSettle();

      expect(ordersRequested, isFalse);
      expect(find.text(HomeProductSections.personalisedTitle), findsNothing);
    });

    testWidgets('is three cards across on this phone, from the shared grid rule', (tester) async {
      await _pumpHome(tester);

      // Home asks no question of its own: it renders whatever the one grid
      // rule says for the width it was given. 400 dp is over
      // BlynkProductGrid.threeColumn, so that is three.
      final columns = BlynkProductGrid.columnsFor(400);
      expect(columns, 3);

      final cards = find.byType(ProductCard);
      expect(cards, findsWidgets);
      final first = tester.getRect(cards.at(0));
      for (var i = 1; i < columns; i++) {
        final next = tester.getRect(cards.at(i));
        expect(next.top, first.top, reason: 'the first $columns cards share a row');
        expect(next.left, greaterThan(tester.getRect(cards.at(i - 1)).left),
            reason: 'card $i sits to the right of card ${i - 1}');
      }
    });

    testWidgets('the section is absent, not placeheld, when the catalogue answers empty', (tester) async {
      final products = ProductProvider(request: (url, query) async {
        if (url == '/catalog/categories') return _categoriesJson;
        if (url == '/promotions') return jsonDecode(_noPromotions);
        return {
          'success': true,
          'data': {
            'products': <Map<String, dynamic>>[],
            'pagination': {'page': 1, 'limit': 100, 'total': 0, 'total_pages': 1},
          },
        };
      });
      tester.view.physicalSize = const Size(400, 860);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<ProductProvider>.value(value: products),
          ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
          ChangeNotifierProvider<AddressProvider>(
            create: (_) => AddressProvider(
              request: ({methodType, url, body}) async => {
                'data': {'addresses': []},
              },
            ),
          ),
          ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
          ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
        ],
        child: const MaterialApp(home: HomeScreen()),
      ));
      await tester.pumpAndSettle();

      expect(find.text(HomeProductSections.allTitle), findsNothing);
      expect(find.byType(ProductCard), findsNothing);
      expect(find.textContaining('coming soon'), findsNothing);
    });
  });

  group('text scale', () {
    for (final scale in const <double>[1.0, 1.3, 2.0]) {
      for (final width in const <double>[320.0, 412.0]) {
        testWidgets('the header, the tagline and the chips grow instead of overflowing at ${scale}x on $width dp', (tester) async {
          tester.view.physicalSize = Size(width, 900);
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.reset);

          await tester.pumpWidget(MultiProvider(
            providers: [
              ChangeNotifierProvider<ProductProvider>(
                create: (_) => ProductProvider(
                  request: _Backend(promotionsJson: _onePromotion).call,
                ),
              ),
              ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
              ChangeNotifierProvider<AddressProvider>(
                create: (_) => AddressProvider(
                  request: ({methodType, url, body}) async => {
                    'data': {'addresses': []},
                  },
                ),
              ),
              ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
              ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
            ],
            child: MaterialApp(
              theme: AppTheme.appTHeme,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
              home: const HomeScreen(),
            ),
          ));
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          expect(find.byType(HomeBrandTagline, skipOffstage: false), findsOneWidget);
          // The destination line (now the hub name alone — see the brand-header
          // group) must survive every scale/width without overflowing.
          expect(
              find.text(
                  '${StoreInfo.hubName} · ${StoreInfo.deliveryHoursLabel}'),
              findsOneWidget);
        });
      }
    }
  });

  group('nothing fabricated', () {
    testWidgets('no favourite, rating, discount or struck price anywhere on Home', (tester) async {
      await _pumpHome(tester, backend: _Backend(promotionsJson: _onePromotion));

      const bannedGlyphs = <IconData>[
        Icons.favorite,
        Icons.favorite_border,
        Icons.favorite_outline,
        Icons.star,
        Icons.star_border,
        Icons.star_half,
        Icons.star_outline,
        Icons.local_offer,
        Icons.local_offer_outlined,
        Icons.discount,
        Icons.discount_outlined,
        Icons.thumb_up_outlined,
      ];
      for (final glyph in bannedGlyphs) {
        expect(find.byIcon(glyph), findsNothing, reason: '$glyph has no backend field behind it');
      }

      for (final text in tester.widgetList<Text>(find.byType(Text))) {
        final data = text.data ?? (text.textSpan?.toPlainText() ?? '');
        expect(data.contains(r'$'), isFalse, reason: 'prices are LKR: "$data"');
        expect(data.contains('%'), isFalse, reason: 'there is no discount source: "$data"');
        expect(data.contains('/kg'), isFalse, reason: 'there is no per-unit pricing: "$data"');
        expect(text.style?.decoration, isNot(TextDecoration.lineThrough),
            reason: 'there is no original price to strike: "$data"');
      }
    });

    testWidgets('Home paints no yellow action of its own beyond the cards and the chip', (tester) async {
      await _pumpHome(tester, backend: _Backend(promotionsJson: _onePromotion));

      // The promo pill on a yellow slide is ink, never a second yellow.
      final pill = find.widgetWithText(ElevatedButton, 'Explore');
      if (pill.evaluate().isNotEmpty) {
        final style = tester.widget<ElevatedButton>(pill).style;
        expect(style?.backgroundColor?.resolve({}), isNot(BlynkColors.signal));
      }
    });
  });
}
