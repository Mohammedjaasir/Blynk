import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Organisms/products_screen_sub_category_list.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

/// Sub-categories (backend migration 026): tapping
/// "Bakery" opens a Products screen whose rail is Bakery's own - "All" (Bakery
/// itself, whose listing includes its children's products) and then Bread and
/// Cakes - instead of every other top-level category. The flat Categories
/// screen and Home's fallback list top-level categories only.

Map<String, dynamic> _cat(String id, String name, String slug, {String? parent, int order = 0}) => {
      'id': id,
      'name': name,
      'slug': slug,
      'description': null,
      'image_url': null,
      'display_order': order,
      'parent_id': parent,
    };

final _categories = [
  _cat('c1', 'Bakery', 'bakery', order: 1),
  _cat('c2', 'Bread', 'bread', parent: 'c1', order: 2),
  _cat('c3', 'Dairy & Eggs', 'dairy-eggs', order: 3),
  _cat('c4', 'Cakes', 'cakes', parent: 'c1', order: 4),
];

Map<String, dynamic> _product(String id, String name, String categoryId) => {
      'id': id,
      'category_id': categoryId,
      'category_name': name,
      'name': name,
      'slug': id,
      'sku': 'SKU-$id',
      'unit': '1 pc',
      'selling_price': 250,
      'is_available': true,
    };

/// Products per category slug, the way the backend answers: a parent's slug
/// includes its children's products.
const _productsBySlug = {
  'bakery': [('p1', 'Sandwich Bread', 'c2'), ('p2', 'Chocolate Cake', 'c4')],
  'bread': [('p1', 'Sandwich Bread', 'c2')],
  'cakes': [('p2', 'Chocolate Cake', 'c4')],
  'dairy-eggs': [('p3', 'Fresh Milk', 'c3')],
  '': [('p1', 'Sandwich Bread', 'c2'), ('p2', 'Chocolate Cake', 'c4'), ('p3', 'Fresh Milk', 'c3')],
};

class _Catalog {
  final List<String?> productSlugs = [];
  bool homeGroupsMissing = false;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/categories') {
      return {
        'success': true,
        'data': {'categories': _categories},
      };
    }
    if (url == '/catalog/home-groups' && homeGroupsMissing) throw ApiException(404, 'Not found');
    if (url == '/catalog/products') {
      final slug = query['category_slug']?.toString();
      productSlugs.add(slug);
      final rows = _productsBySlug[slug ?? ''] ?? const [];
      return {
        'success': true,
        'data': {
          'products': [for (final r in rows) _product(r.$1, r.$2, r.$3)],
          'pagination': {'page': 1, 'limit': 100, 'total': rows.length, 'total_pages': 1},
        },
      };
    }
    throw StateError('unexpected $url');
  }
}

Future<dynamic> _noAddresses({String? methodType, String? url, dynamic body}) async => {
      'data': {'addresses': []},
    };

Future<void> _pump(WidgetTester tester, Widget home, ProductProvider products) async {
  tester.view.physicalSize = const Size(400, 860);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<ProductProvider>.value(value: products),
      ChangeNotifierProvider<CartProvider>(create: (_) => CartProvider()),
      ChangeNotifierProvider<AddressProvider>(create: (_) => AddressProvider(request: _noAddresses)),
      ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
      ChangeNotifierProvider<OrderProvider>(create: (_) => OrderProvider()),
    ],
    child: MaterialApp(theme: AppTheme.appTHeme, home: home),
  ));
  await tester.pumpAndSettle();
}

/// The rail's row labels, top to bottom.
List<String> _railLabels(WidgetTester tester) => [
      for (final t in tester.widgetList<CategoryWidget>(
        find.descendant(of: find.byType(CategorySidebar), matching: find.byType(CategoryWidget)),
      ))
        t.category.name,
    ];

String? _activeRow(WidgetTester tester) {
  final active = tester
      .widgetList<CategoryWidget>(
        find.descendant(of: find.byType(CategorySidebar), matching: find.byType(CategoryWidget)),
      )
      .where((t) => t.isActive)
      .toList();
  return active.length == 1 ? active.single.category.name : null;
}

String _title(WidgetTester tester) =>
    tester.widget<Text>(find.descendant(of: find.byType(AppBar), matching: find.byType(Text)).first).data!;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('CategoryModel', () {
    test('reads parent_id; empty or missing is top level', () {
      expect(CategoryModel.fromJson(_cat('c2', 'Bread', 'bread', parent: 'c1')).parentId, 'c1');
      expect(CategoryModel.fromJson(_cat('c1', 'Bakery', 'bakery')).isTopLevel, isTrue);
      expect(CategoryModel.fromJson({'id': 'x', 'name': 'X', 'slug': 'x', 'parent_id': ''}).parentId, isNull);
      expect(CategoryModel.fromJson({'id': 'x', 'name': 'X', 'slug': 'x'}).parentId, isNull);
    });

    test('topLevelOf keeps order and treats an orphaned child as top level', () {
      final all = [for (final c in _categories) CategoryModel.fromJson(c)];
      expect(CategoryModel.topLevelOf(all).map((c) => c.name), ['Bakery', 'Dairy & Eggs']);
      final orphan = all.where((c) => c.id != 'c1').toList();
      expect(CategoryModel.topLevelOf(orphan).map((c) => c.name), ['Bread', 'Dairy & Eggs', 'Cakes']);
    });
  });

  group('CategorySidebar.railFor', () {
    final all = [for (final c in _categories) CategoryModel.fromJson(c)];

    test('a parent: "All" (the parent itself) then its children, in order', () {
      final rail = CategorySidebar.railFor(all, 'bakery');
      expect(rail.map((c) => c.name), ['All', 'Bread', 'Cakes']);
      expect(rail.first.slug, 'bakery');
      expect(rail.first.id, 'c1');
    });

    test('a category without children: just its own "All" row', () {
      expect(CategorySidebar.railFor(all, 'dairy-eggs').map((c) => (c.name, c.slug)), [('All', 'dairy-eggs')]);
      expect(CategorySidebar.railFor(all, 'bread').map((c) => (c.name, c.slug)), [('All', 'bread')]);
    });

    test('"All products" (empty root): the top-level categories; unknown root: nothing', () {
      expect(CategorySidebar.railFor(all, '').map((c) => c.name), ['Bakery', 'Dairy & Eggs']);
      expect(CategorySidebar.railFor(all, 'gone'), isEmpty);
    });
  });

  group('Products screen', () {
    testWidgets("opened on Bakery: the rail is Bakery's own, and a child filters under Bakery's title", (tester) async {
      final catalog = _Catalog();
      final products = ProductProvider(request: catalog.call);
      await _pump(tester, const ProductsScreen(categorySlug: 'bakery'), products);

      expect(_railLabels(tester), ['All', 'Bread', 'Cakes']);
      expect(find.text('Dairy & Eggs'), findsNothing, reason: 'unrelated top-level categories are gone');
      expect(_activeRow(tester), 'All');
      expect(_title(tester), 'Bakery');
      // "All" loads Bakery by its slug, which the backend widens to its children.
      expect(catalog.productSlugs.last, 'bakery');
      expect(find.text('Sandwich Bread'), findsOneWidget);
      expect(find.text('Chocolate Cake'), findsOneWidget);

      await tester.tap(find.text('Cakes'));
      await tester.pumpAndSettle();
      expect(catalog.productSlugs.last, 'cakes');
      expect(_activeRow(tester), 'Cakes');
      expect(_title(tester), 'Bakery', reason: "the title stays the opened category's");
      expect(find.text('Chocolate Cake'), findsOneWidget);
      expect(find.text('Sandwich Bread'), findsNothing);

      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(catalog.productSlugs.last, 'bakery');
      expect(_activeRow(tester), 'All');
      expect(find.text('Sandwich Bread'), findsOneWidget);
    });

    testWidgets('the "All" row keeps the look: circle tile, signal ring when active, the parent glyph', (tester) async {
      final handle = tester.ensureSemantics();
      final products = ProductProvider(request: _Catalog().call);
      await _pump(tester, const ProductsScreen(categorySlug: 'bakery'), products);

      final all = tester
          .widgetList<CategoryWidget>(find.byType(CategoryWidget))
          .firstWhere((t) => t.category.name == 'All');
      expect(all.diameter, CategorySidebar.tileSize);
      expect(all.rounded, isFalse);
      expect(all.glyph, fallbackGlyphFor('Bakery'));
      final disc = tester.widget<AnimatedContainer>(
        find.descendant(of: find.byWidget(all), matching: find.byType(AnimatedContainer)).first,
      );
      final decoration = disc.decoration! as BoxDecoration;
      expect((decoration.border! as Border).top.color, BlynkCategory.selectedRing);
      expect(BlynkCategory.selectedRing, BlynkColors.signal);
      expect(find.bySemanticsLabel('All Bakery'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('opened on a category without children: only its own "All" row', (tester) async {
      final products = ProductProvider(request: _Catalog().call);
      await _pump(tester, const ProductsScreen(categorySlug: 'dairy-eggs'), products);
      expect(_railLabels(tester), ['All']);
      expect(_title(tester), 'Dairy & Eggs');
      expect(find.text('Bakery'), findsNothing);
      expect(find.text('Fresh Milk'), findsOneWidget);
    });

    testWidgets('"All products" keeps the top-level categories as the rail', (tester) async {
      final products = ProductProvider(request: _Catalog().call);
      await _pump(tester, const ProductsScreen(categorySlug: ''), products);
      expect(_railLabels(tester), ['Bakery', 'Dairy & Eggs']);
      expect(_title(tester), 'All Products');

      await tester.tap(find.text('Dairy & Eggs'));
      await tester.pumpAndSettle();
      expect(_title(tester), 'Dairy & Eggs');
      expect(_activeRow(tester), 'Dairy & Eggs');
    });
  });

  group('Top-level lists', () {
    testWidgets('the Categories screen lists top-level categories only', (tester) async {
      final products = ProductProvider(request: _Catalog().call);
      await _pump(tester, const CategoriesScreen(), products);
      expect(find.text('Bakery'), findsOneWidget);
      expect(find.text('Dairy & Eggs'), findsOneWidget);
      expect(find.text('Bread'), findsNothing);
      expect(find.text('Cakes'), findsNothing);
    });

    test("Home's fallback (no /catalog/home-groups) lists top-level categories only", () async {
      final products = ProductProvider(request: (_Catalog()..homeGroupsMissing = true).call);
      await products.loadHomeGroups();
      expect(products.homeGroups, hasLength(1));
      expect(products.homeGroups.single.categories.map((c) => c.name), ['Bakery', 'Dairy & Eggs']);
      expect(products.categories, hasLength(4), reason: 'the full list still carries the children');
    });
  });
}
