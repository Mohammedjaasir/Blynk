import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/UI/Widgets/Organisms/home_product_feed.dart';

/// Home's product feed (owner, 2026-10-07): which categories get a rail.
/// The screen itself is covered in home_composition_test.dart.
CategoryModel _category(String id, int order) =>
    CategoryModel.fromJson({'id': id, 'name': 'Category $id', 'slug': 'cat-$id', 'display_order': order});

ProductModel _product(String id, String categoryId) => ProductModel.fromJson({
      'id': id,
      'category_id': categoryId,
      'category_name': 'Category $categoryId',
      'name': 'Product $id',
      'slug': id,
      'sku': 'SKU-$id',
      'unit': '1 pc',
      'selling_price': 100,
      'is_available': true,
    });

void main() {
  test('a rail only for categories with at least three products, in category order', () {
    final categories = [_category('b', 2), _category('a', 1), _category('c', 3)];
    final products = [
      for (var i = 0; i < 3; i++) _product('b$i', 'b'),
      for (var i = 0; i < 2; i++) _product('c$i', 'c'),
      for (var i = 0; i < 4; i++) _product('a$i', 'a'),
    ];
    final rails = HomeProductFeed.railsFor(categories, products);
    expect(rails.map((r) => r.category.id), ['a', 'b'], reason: 'c has only two products; order follows display_order');
    expect(rails.first.products.map((p) => p.id), ['a0', 'a1', 'a2', 'a3']);
  });

  test('a rail carries at most twelve products ("See all" has the rest)', () {
    final rails = HomeProductFeed.railsFor(
      [_category('a', 1)],
      [for (var i = 0; i < 30; i++) _product('a$i', 'a')],
    );
    expect(rails.single.products, hasLength(HomeProductFeed.railMaximum));
    expect(HomeProductFeed.railMaximum, 12);
  });

  test('no categories or no products: no rails', () {
    expect(HomeProductFeed.railsFor(const [], [_product('x', 'a')]), isEmpty);
    expect(HomeProductFeed.railsFor([_category('a', 1)], const []), isEmpty);
  });

  // Arrange (owner, 2026-10-10): staff set the category order in Ops/Admin.
  test('rails follow the arranged order: parents by display_order, each followed by its own sub-categories', () {
    CategoryModel cat(String id, int order, {String? parent, String? name}) => CategoryModel.fromJson({
          'id': id,
          'name': name ?? 'Category $id',
          'slug': 'cat-$id',
          'display_order': order,
          if (parent != null) 'parent_id': parent,
        });
    // Sub-categories are numbered within their parent (10, 20...), so a flat
    // sort would put Milk (10) before Grocery (20).
    final categories = [
      cat('grocery', 20),
      cat('eggs', 20, parent: 'dairy'),
      cat('dairy', 10),
      cat('milk', 10, parent: 'dairy'),
      cat('snacks', 30),
      cat('orphan', 5, parent: 'gone'),
    ];
    expect(HomeProductFeed.arrangedOrder(categories).map((c) => c.id),
        ['orphan', 'dairy', 'milk', 'eggs', 'grocery', 'snacks']);

    final products = [
      for (final c in ['grocery', 'eggs', 'dairy', 'milk', 'snacks'])
        for (var i = 0; i < 3; i++) _product('$c$i', c),
    ];
    final rails = HomeProductFeed.railsFor(categories, products);
    expect(rails.map((r) => r.category.id), ['dairy', 'milk', 'eggs', 'grocery', 'snacks']);
    // Products keep the API's (arranged) order inside a rail - no re-sort.
    expect(rails.first.products.map((p) => p.id), ['dairy0', 'dairy1', 'dairy2']);
  });

  test('equal display_order falls back to name, like the API', () {
    final categories = [
      CategoryModel.fromJson({'id': 'z', 'name': 'Zebra', 'slug': 'z', 'display_order': 0}),
      CategoryModel.fromJson({'id': 'a', 'name': 'apple', 'slug': 'a', 'display_order': 0}),
    ];
    expect(HomeProductFeed.arrangedOrder(categories).map((c) => c.id), ['a', 'z']);
  });
}
