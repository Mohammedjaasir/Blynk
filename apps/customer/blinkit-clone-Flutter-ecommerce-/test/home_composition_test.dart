import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderParagraph;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/UI/Widgets/Atoms/product_hero.dart';
import 'package:ecom/UI/Widgets/Organisms/home_product_feed.dart';
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
import 'package:ecom/UI/Widgets/Organisms/dental_home_entry.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_app_bar.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_carousel.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_search_bar.dart';
import 'package:ecom/UI/Widgets/Atoms/section_header.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/session_fakes.dart';

/// Home after the reference-composition rebuild: brand header, tagline,
/// promotional hero, the dental entry, then groups of category tiles.
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

/// GET /catalog/home-groups: the same two categories under one heading.
const _groupsJson = {
  'success': true,
  'data': {
    'groups': [
      {
        'id': 'g1',
        'name': 'Grocery & Kitchen',
        'sort_order': 0,
        'categories': [
          {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'image_url': null, 'display_order': 1},
          {'id': 'c2', 'name': 'Biscuits & Snacks', 'slug': 'biscuits-snacks', 'image_url': null, 'display_order': 2},
        ],
      },
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

class _Backend {
  _Backend({this.promotionsJson = _noPromotions});

  String promotionsJson;
  final List<Map<String, dynamic>> queries = [];

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/categories') return _categoriesJson;
    if (url == '/catalog/home-groups') return _groupsJson;
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

/// Ten categories in one group: Home shows every one of them.
class _ManyCategoriesBackend extends _Backend {
  @override
  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/home-groups') {
      return {
        'success': true,
        'data': {
          'groups': [
            {
              'id': 'g1',
              'name': 'Grocery & Kitchen',
              'sort_order': 0,
              'categories': [
                for (var i = 1; i <= 10; i++)
                  {'id': 'c$i', 'name': 'Category $i', 'slug': 'category-$i', 'image_url': null, 'display_order': i},
              ],
            },
          ],
        },
      };
    }
    return super.call(url, query);
  }
}

/// A backend with categories but no home groups to show.
class _NoGroupsBackend extends _Backend {
  @override
  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/home-groups') return {'success': true, 'data': {'groups': []}};
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

/// A Home group's heading (not a category tile of the same name).
Finder _heading(String title) =>
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

  // 2026-10-05: Home's categories are GROUPS of tiles (owner's Blinkit
  // reference) - a heading per group over a 4-across grid - in place of the
  // "Categories" preview grid and the per-category product shelves. A tile is
  // still a link into the category's products page, never an in-place filter.
  group('category groups', () {
    testWidgets('are the backend groups, each a heading over rounded tiles, with no "All" and no "More" cap',
        (tester) async {
      await _pumpHome(tester);

      expect(_heading('Grocery & Kitchen'), findsOneWidget);
      final tiles = tester.widgetList<CategoryWidget>(find.byType(CategoryWidget)).toList();
      expect(tiles.map((t) => t.category.name).toList(), ['Dairy & Eggs', 'Biscuits & Snacks']);
      expect(tiles.every((t) => t.rounded), isTrue);
      expect(find.text('Categories'), findsNothing, reason: 'the duplicate preview grid is gone');
    });

    testWidgets('a group with ten categories shows all ten, four across', (tester) async {
      await _pumpHome(tester, backend: _ManyCategoriesBackend(), size: const Size(400, 1400));

      final tiles = tester.widgetList<CategoryWidget>(find.byType(CategoryWidget)).toList();
      expect(tiles.map((t) => t.category.name).toList(), [
        for (var i = 1; i <= 10; i++) 'Category $i',
      ]);
      double rowOf(String name) => tester
          .getTopLeft(find.descendant(of: find.byType(CategoryWidget), matching: find.text(name)))
          .dy;
      expect(rowOf('Category 5'), greaterThan(rowOf('Category 4')));
      expect(rowOf('Category 4'), rowOf('Category 1'));
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

    testWidgets('Home loads the whole catalogue once and never filters it in place', (tester) async {
      // Home's product feed (2026-10-07) asks for every product, unfiltered;
      // the products screen runs the category query.
      final backend = _Backend();
      await _pumpHome(tester, backend: backend);
      expect(backend.queries.where((q) => q.containsKey('category_slug')), isEmpty);
      expect(backend.queries, isNotEmpty, reason: 'Home lists products under the tiles');

      // Opening a category never filters Home in place.
      final before = backend.queries.length;
      await tester.tap(find.text('Biscuits & Snacks'));
      await tester.pumpAndSettle();
      expect(backend.queries.skip(before).where((q) => !q.containsKey('category_slug')), isEmpty);
    });

    testWidgets('coming back leaves Home on its groups', (tester) async {
      await _pumpHome(tester);
      expect(_heading('Grocery & Kitchen'), findsOneWidget);

      await tester.tap(find.text('Biscuits & Snacks'));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(_heading('Grocery & Kitchen'), findsOneWidget);
      expect(find.text('Dairy & Eggs'), findsWidgets);
    });

    testWidgets('under the groups: a rail per category and every product, one image hero each', (tester) async {
      await _pumpHome(tester, size: const Size(400, 4000));
      // Three Dairy & Eggs products: enough for a rail, with "See all".
      expect(find.text('See all'), findsWidgets);
      expect(find.text(HomeProductFeed.allProductsTitle), findsOneWidget);
      // Each product appears twice (rail + grid) but flies from one place.
      for (final id in ['p1', 'p2', 'p3']) {
        expect(find.text(
          {'p1': 'Kotmale Fresh Milk 1L', 'p2': 'Highland Yoghurt 80g', 'p3': 'Maliban Lemon Puff'}[id]!,
        ), findsNWidgets(2));
        expect(
          find.byWidgetPredicate((w) => w is Hero && w.tag == ProductHero.tagFor(id)),
          findsOneWidget,
        );
      }
    });

    testWidgets('the groups sit under the dental entry', (tester) async {
      await _pumpHome(tester, size: const Size(400, 1400));
      final dental = tester.getTopLeft(find.byType(DentalHomeEntry)).dy;
      expect(tester.getTopLeft(_heading('Grocery & Kitchen')).dy, greaterThan(dental));
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

  group('no invented signals', () {
    // Home may never claim a signal this backend does not have. There is no
    // recommendations endpoint, no popularity or sales data on the
    // catalogue, and no cross-customer data reaches this app at all, so every
    // one of these phrases would be invented.
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

    testWidgets('no order history is fetched for Home, signed in or out', (tester) async {
      var ordersRequested = false;
      await _pumpHome(
        tester,
        auth: _SignedIn(),
        orders: OrderProvider(request: (method, url, {body, query}) async {
          ordersRequested = true;
          return {'success': true, 'data': {'orders': []}};
        }),
      );
      await tester.pumpAndSettle();
      expect(ordersRequested, isFalse);
    });

    testWidgets('the groups are absent, not placeheld, when the backend answers none', (tester) async {
      await _pumpHome(tester, backend: _NoGroupsBackend());

      expect(find.byType(CategoryWidget), findsNothing);
      // The products still show: they come from the catalogue, not the groups.
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
