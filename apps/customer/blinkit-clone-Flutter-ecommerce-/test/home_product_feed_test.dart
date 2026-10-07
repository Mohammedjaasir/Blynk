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
}
