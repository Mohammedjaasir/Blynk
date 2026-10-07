import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/category_group_model.dart';
import 'package:ecom/Models/image_focal.dart';
import 'package:ecom/Screens/home_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart' show fallbackGlyphFor;
import 'package:ecom/UI/Widgets/Atoms/section_header.dart';
import 'package:ecom/UI/Widgets/Organisms/home_category_groups.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

/// Home's shop front (2026-10-05): groups of category tiles from
/// `GET /catalog/home-groups`, Blinkit-style, each tile opening its category.

Map<String, dynamic> _cat(String id, String name, String slug,
        {String? image, int order = 0, int fx = 50, int fy = 50}) =>
    {
      'id': id,
      'name': name,
      'slug': slug,
      'description': null,
      'image_url': image,
      'display_order': order,
      'image_focal_x': fx,
      'image_focal_y': fy,
    };

/// The backend's response shape, verbatim from the contract.
Map<String, dynamic> _groupsResponse({String firstGroupName = 'Grocery & Kitchen'}) => {
      'success': true,
      'data': {
        'groups': [
          {
            'id': 'g1',
            'name': firstGroupName,
            'sort_order': 0,
            'categories': [
              _cat('c1', 'Vegetables & Fruits', 'vegetables-fruits', order: 0),
              _cat('c2', 'Dairy, Bread & Eggs', 'dairy-bread-eggs', order: 1),
              _cat('c3', 'Atta, Rice & Dal', 'atta-rice-dal', order: 2),
              _cat('c4', 'Oil, Ghee & Masala', 'oil-ghee-masala', order: 3),
              _cat('c5', 'Dry Fruits & Cereals', 'dry-fruits-cereals', order: 4),
            ],
          },
          {
            'id': 'g2',
            'name': 'Snacks & Drinks',
            'sort_order': 1,
            'categories': [
              _cat('c6', 'Chips & Namkeen', 'chips-namkeen'),
              _cat('c7', 'Cold Drinks & Juices', 'cold-drinks-juices'),
            ],
          },
          {
            'id': null,
            'name': 'More',
            'sort_order': 99,
            'categories': [
              _cat('c8', 'Hair', 'hair'),
            ],
          },
        ],
      },
    };

const _categoriesResponse = {
  'success': true,
  'data': {
    'categories': [
      {'id': 'c1', 'name': 'Vegetables & Fruits', 'slug': 'vegetables-fruits', 'image_url': null, 'display_order': 0},
      {'id': 'c6', 'name': 'Chips & Namkeen', 'slug': 'chips-namkeen', 'image_url': null, 'display_order': 1},
    ],
  },
};

class _Backend {
  _Backend({this.groups});

  /// Overrides the /catalog/home-groups answer; null is [_groupsResponse].
  Future<dynamic> Function()? groups;
  Object? failGroups;
  final Map<String, int> calls = {};

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    calls[url] = (calls[url] ?? 0) + 1;
    if (url == '/catalog/home-groups') {
      if (failGroups != null) throw failGroups!;
      return groups != null ? groups!() : _groupsResponse();
    }
    if (url == '/catalog/categories') return _categoriesResponse;
    if (url == '/promotions') return {'success': true, 'data': {'promotions': []}};
    throw StateError('unexpected $url');
  }
}

Future<ProductProvider> _pumpHome(
  WidgetTester tester, {
  _Backend? backend,
  Size size = const Size(400, 900),
  double textScale = 1,
  List<String>? routes,
  List<Object?>? args,
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final products = ProductProvider(request: (backend ?? _Backend()).call);
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<ProductProvider>.value(value: products),
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
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: const HomeScreen(),
      onGenerateRoute: (settings) {
        routes?.add(settings.name ?? '');
        args?.add(settings.arguments);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => Scaffold(body: Text('route:${settings.name}')),
        );
      },
    ),
  ));
  if (settle) await tester.pumpAndSettle();
  return products;
}

Finder _heading(String title) =>
    find.widgetWithText(BlynkSectionHeader, title, skipOffstage: false);

Finder _tile(String name) => find.ancestor(
      of: find.text(name, skipOffstage: false),
      matching: find.byType(CategoryWidget, skipOffstage: false),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('CategoryGroupModel', () {
    test('parses a group and its categories, in order', () {
      final groups = [
        for (final g in (_groupsResponse()['data'] as Map)['groups'] as List)
          CategoryGroupModel.fromJson((g as Map).cast<String, dynamic>()),
      ];
      expect(groups.map((g) => g.name).toList(), ['Grocery & Kitchen', 'Snacks & Drinks', 'More']);
      expect(groups.first.id, 'g1');
      expect(groups.first.sortOrder, 0);
      expect(groups.first.isUngrouped, isFalse);
      expect(groups.first.categories.map((c) => c.slug).toList(), [
        'vegetables-fruits',
        'dairy-bread-eggs',
        'atta-rice-dal',
        'oil-ghee-masala',
        'dry-fruits-cereals',
      ]);
      // The trailing catch-all group has no id.
      expect(groups.last.id, isNull);
      expect(groups.last.isUngrouped, isTrue);
      expect(groups.last.key, isNotEmpty);
    });

    test('categories carry the same fields as /catalog/categories, focal point included', () {
      final g = CategoryGroupModel.fromJson({
        'id': 'g1',
        'name': 'Personal Care',
        'sort_order': '3',
        'categories': [
          _cat('c9', 'Hair', 'hair', image: 'https://cdn.example/hair.webp', order: 2, fx: 30, fy: 10),
        ],
      });
      final c = g.categories.single;
      expect(g.sortOrder, 3);
      expect(c.id, 'c9');
      expect(c.imageUrl, 'https://cdn.example/hair.webp');
      expect(c.displayOrder, 2);
      expect(c.imageAlignment, focalAlignment(30, 10));
    });

    test('tolerates missing or malformed categories', () {
      final g = CategoryGroupModel.fromJson(const {'id': '', 'name': 'X', 'categories': 'nope'});
      expect(g.id, isNull);
      expect(g.categories, isEmpty);
    });
  });

  group('ProductProvider.loadHomeGroups', () {
    test('GETs /catalog/home-groups and keeps the backend order', () async {
      final backend = _Backend();
      final p = ProductProvider(request: backend.call);
      final load = p.loadHomeGroups();
      expect(p.isLoadingHomeGroups, isTrue);
      await load;
      expect(p.isLoadingHomeGroups, isFalse);
      expect(backend.calls['/catalog/home-groups'], 1);
      expect(p.homeGroups.map((g) => g.name).toList(), ['Grocery & Kitchen', 'Snacks & Drinks', 'More']);
      expect(p.homeGroupsFailure, isNull);

      await p.loadHomeGroups();
      expect(backend.calls['/catalog/home-groups'], 1, reason: 'loaded once unless forced');
    });

    test('a failed first load is a customer error; a failed refresh keeps the groups', () async {
      final backend = _Backend()..failGroups = ApiException(500, 'boom');
      final p = ProductProvider(request: backend.call);
      await p.loadHomeGroups();
      expect(p.homeGroups, isEmpty);
      expect(p.homeGroupsFailure, isNotNull);

      backend.failGroups = null;
      await p.loadHomeGroups(force: true);
      expect(p.homeGroups, hasLength(3));
      expect(p.homeGroupsFailure, isNull);

      backend.failGroups = ApiException(503, 'x', code: 'NETWORK_ERROR');
      await p.loadHomeGroups(force: true);
      expect(p.homeGroups, hasLength(3), reason: 'last good groups stay on screen');
      expect(p.homeGroupsFailure, isNull);
    });

    test('an older backend without the endpoint (404) falls back to every category under one heading', () async {
      final backend = _Backend()..failGroups = ApiException(404, 'Not found');
      final p = ProductProvider(request: backend.call);
      await p.loadHomeGroups();
      expect(p.homeGroupsFailure, isNull);
      expect(p.homeGroups, hasLength(1));
      expect(p.homeGroups.single.name, ProductProvider.fallbackGroupName);
      expect(p.homeGroups.single.categories.map((c) => c.name).toList(),
          ['Vegetables & Fruits', 'Chips & Namkeen']);
    });

    test('refreshCatalog re-reads the groups once Home has asked for them', () async {
      var name = 'Grocery & Kitchen';
      final backend = _Backend(groups: () async => _groupsResponse(firstGroupName: name));
      final p = ProductProvider(request: backend.call);

      await p.refreshCatalog(force: true);
      expect(backend.calls['/catalog/home-groups'], isNull,
          reason: 'nothing on screen needs the groups yet');

      await p.loadHomeGroups();
      name = 'Grocery, Kitchen & Home';
      await p.refreshCatalog(force: true);
      expect(backend.calls['/catalog/home-groups'], 2);
      expect(p.homeGroups.first.name, 'Grocery, Kitchen & Home');
    });
  });

  group('Home', () {
    testWidgets('renders each group heading over its own tiles, in the backend order', (tester) async {
      await _pumpHome(tester, size: const Size(400, 1400));

      final grocery = tester.getTopLeft(_heading('Grocery & Kitchen')).dy;
      final snacks = tester.getTopLeft(_heading('Snacks & Drinks')).dy;
      final more = tester.getTopLeft(_heading('More')).dy;
      expect(grocery, lessThan(snacks));
      expect(snacks, lessThan(more));

      final tiles = tester
          .widgetList<CategoryWidget>(find.byType(CategoryWidget, skipOffstage: false))
          .toList();
      expect(tiles.map((t) => t.category.name).toList(), [
        'Vegetables & Fruits',
        'Dairy, Bread & Eggs',
        'Atta, Rice & Dal',
        'Oil, Ghee & Masala',
        'Dry Fruits & Cereals',
        'Chips & Namkeen',
        'Cold Drinks & Juices',
        'Hair',
      ]);
      expect(tiles.every((t) => t.rounded && t.fit == BoxFit.contain), isTrue);

      // Each tile sits under its own heading.
      double top(String name) => tester.getTopLeft(_tile(name)).dy;
      expect(top('Vegetables & Fruits'), inExclusiveRange(grocery, snacks));
      expect(top('Dry Fruits & Cereals'), inExclusiveRange(grocery, snacks));
      expect(top('Chips & Namkeen'), inExclusiveRange(snacks, more));
      expect(top('Hair'), greaterThan(more));

      // The old duplicate preview grid is gone, and so is the "See all"
      // button: every category is already on Home (owner, 2026-10-05).
      expect(find.text('Categories'), findsNothing);
      expect(find.text('See all categories', skipOffstage: false), findsNothing);
    });

    testWidgets('home lists products under the groups, from one catalogue request', (tester) async {
      // Owner, 2026-10-07: "the customer should be able to scroll and see
      // lots of products" - the feed under the tiles (HomeProductFeed).
      final backend = _Backend();
      await _pumpHome(tester, backend: backend);
      expect(backend.calls['/catalog/products'], 1,
          reason: 'one unfiltered request for the whole catalogue');
    });

    testWidgets('tapping a tile opens that category\'s products, carrying its slug', (tester) async {
      final routes = <String>[];
      final args = <Object?>[];
      await _pumpHome(tester, routes: routes, args: args);

      await tester.tap(find.text('Atta, Rice & Dal'));
      await tester.pumpAndSettle();
      expect(routes.last, '/products');
      expect(args.last, 'atta-rice-dal');
      expect(find.text('route:/products'), findsOneWidget);
    });

    testWidgets('a category with no image shows its fallback glyph on the tinted well', (tester) async {
      await _pumpHome(tester);

      final tile = _tile('Vegetables & Fruits');
      expect(find.descendant(of: tile, matching: find.byType(Image)), findsNothing);
      expect(
        find.descendant(of: tile, matching: find.byIcon(fallbackGlyphFor('Vegetables & Fruits'))),
        findsOneWidget,
      );
      final well = tester.widget<AnimatedContainer>(
        find.descendant(of: tile, matching: find.byType(AnimatedContainer)),
      );
      final decoration = well.decoration! as BoxDecoration;
      expect(decoration.color, BlynkCategory.surface);
      expect(decoration.borderRadius, isNotNull, reason: 'a rounded square, not a circle');
    });

    testWidgets('an image is contained in the well and anchored at its focal point', (tester) async {
      final backend = _Backend(groups: () async => {
            'success': true,
            'data': {
              'groups': [
                {
                  'id': 'g1',
                  'name': 'Personal Care',
                  'sort_order': 0,
                  'categories': [
                    _cat('c9', 'Hair', 'hair', image: 'https://cdn.example/hair.webp', fx: 20, fy: 80),
                  ],
                },
              ],
            },
          });
      await _pumpHome(tester, backend: backend);

      final image = tester.widget<Image>(
        find.descendant(of: _tile('Hair'), matching: find.byType(Image)),
      );
      expect(image.fit, BoxFit.contain);
      expect(image.alignment, focalAlignment(20, 80));
    });

    testWidgets('loading shows rounded tile skeletons, then the tiles', (tester) async {
      final gate = Completer<dynamic>();
      final backend = _Backend(groups: () => gate.future);
      await _pumpHome(tester, backend: backend, settle: false);
      await tester.pump();
      await tester.pump();

      expect(find.byType(CategoryTileSkeleton), findsWidgets);
      expect(find.byType(CategoryWidget), findsNothing);

      gate.complete(_groupsResponse());
      await tester.pumpAndSettle();
      expect(find.byType(CategoryTileSkeleton), findsNothing);
      expect(find.text('Vegetables & Fruits'), findsOneWidget);
    });

    for (final scale in const <double>[1.0, 2.0]) {
      testWidgets('a failed load says so, and "Try again" reloads (text scale $scale)', (tester) async {
        final backend = _Backend()..failGroups = ApiException(500, 'boom');
        await _pumpHome(tester, backend: backend, textScale: scale);

        // Below the fold at 2.0x: scroll to it first.
        final retry = find.byKey(HomeCategoryGroups.retryKey);
        await tester.scrollUntilVisible(retry, 200, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        expect(find.text(HomeCategoryGroups.failureTitle), findsOneWidget);
        expect(tester.takeException(), isNull);

        backend.failGroups = null;
        await tester.tap(retry);
        await tester.pumpAndSettle();

        expect(backend.calls['/catalog/home-groups'], 2);
        expect(find.text(HomeCategoryGroups.failureTitle), findsNothing);
        expect(find.text('Vegetables & Fruits'), findsOneWidget);
      });
    }

    testWidgets('a refresh (as a live catalog event triggers) re-renders the new groups', (tester) async {
      var name = 'Grocery & Kitchen';
      final backend = _Backend(groups: () async => _groupsResponse(firstGroupName: name));
      final products = await _pumpHome(tester, backend: backend);
      expect(_heading('Grocery & Kitchen'), findsOneWidget);

      name = 'Fresh & Pantry';
      await products.refreshCatalog(force: true);
      await tester.pumpAndSettle();

      expect(_heading('Fresh & Pantry'), findsOneWidget);
      expect(_heading('Grocery & Kitchen'), findsNothing);
    });

    testWidgets('an empty answer shows no heading and no placeholder', (tester) async {
      final backend = _Backend(groups: () async => {'success': true, 'data': {'groups': []}});
      await _pumpHome(tester, backend: backend);
      expect(find.byType(CategoryWidget), findsNothing);
      expect(find.text(HomeCategoryGroups.failureTitle), findsNothing);
    });

    test('columns: 4 on a phone, more on a tablet or desktop', () {
      expect(HomeCategoryGroups.columnsFor(320), 4);
      expect(HomeCategoryGroups.columnsFor(412), 4);
      expect(HomeCategoryGroups.columnsFor(599), 4);
      expect(HomeCategoryGroups.columnsFor(700), 6);
      expect(HomeCategoryGroups.columnsFor(1000), 8);
    });

    int tilesInFirstRow(WidgetTester tester) {
      final tops = tester
          .widgetList<CategoryWidget>(find.byType(CategoryWidget))
          .map((t) => tester.getTopLeft(find.byWidget(t)).dy)
          .toList();
      return tops.where((t) => t == tops.first).length;
    }

    testWidgets('a phone shows four tiles across', (tester) async {
      await _pumpHome(tester, size: const Size(400, 900));
      expect(tilesInFirstRow(tester), 4);
    });

    testWidgets('a tablet shows more than four across', (tester) async {
      final backend = _Backend(groups: () async => {
            'success': true,
            'data': {
              'groups': [
                {
                  'id': 'g1',
                  'name': 'Grocery & Kitchen',
                  'sort_order': 0,
                  'categories': [
                    for (var i = 1; i <= 10; i++) _cat('c$i', 'Category $i', 'category-$i'),
                  ],
                },
              ],
            },
          });
      await _pumpHome(tester, backend: backend, size: const Size(800, 1200));
      expect(tilesInFirstRow(tester), 6);
    });

    for (final scale in const <double>[1.3, 2.0]) {
      for (final width in const <double>[320.0, 412.0]) {
        testWidgets('labels stay inside their tiles at ${scale}x on $width dp', (tester) async {
          await _pumpHome(tester, size: Size(width, 1600), textScale: scale);
          expect(tester.takeException(), isNull);

          for (final tile in tester.widgetList<CategoryWidget>(find.byType(CategoryWidget))) {
            final box = tester.getRect(find.byWidget(tile));
            final label = find.descendant(of: find.byWidget(tile), matching: find.byType(Text));
            final text = tester.widget<Text>(label);
            expect(text.maxLines, 2);
            expect(text.overflow, TextOverflow.ellipsis);
            final labelRect = tester.getRect(label);
            expect(labelRect.bottom, lessThanOrEqualTo(box.bottom + 0.01));
            expect(labelRect.left, greaterThanOrEqualTo(box.left - 0.01));
            expect(labelRect.right, lessThanOrEqualTo(box.right + 0.01));
          }
        });
      }
    }
  });
}
