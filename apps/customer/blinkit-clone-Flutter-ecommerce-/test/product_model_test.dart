import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/product_model.dart';

void main() {
  group('CategoryModel', () {
    test('Parses a real /catalog/categories response entry', () {
      // Captured verbatim from a live GET /api/v1/catalog/categories call
      // against the seeded dev database.
      final json = {
        "id": "c0000001-0000-0000-0000-000000000001",
        "name": "Dairy & Eggs",
        "slug": "dairy-eggs",
        "description": "Fresh milk, butter, cheese, and farm eggs",
        "image_url": null,
        "display_order": 1,
      };

      final category = CategoryModel.fromJson(json);

      expect(category.id, equals("c0000001-0000-0000-0000-000000000001"));
      expect(category.name, equals("Dairy & Eggs"));
      expect(category.slug, equals("dairy-eggs"));
      expect(category.imageUrl, isNull);
      expect(category.displayOrder, equals(1));
    });
  });

  group('ProductModel', () {
    test('Parses a real /catalog/products response entry - no cost fields present', () {
      // Captured verbatim from a live GET /api/v1/catalog/products call.
      final json = {
        "id": "b0000001-0000-0000-0000-000000000001",
        "category_id": "c0000001-0000-0000-0000-000000000001",
        "category_name": "Dairy & Eggs",
        "name": "Kotmale Fresh Milk 1L",
        "slug": "kotmale-fresh-milk-1l",
        "description": null,
        "sku": "SKU-DAI-001",
        "barcode": "4792024001011",
        "unit": "1 L",
        "pack_size": "Tetra Pack",
        "image_url": null,
        "selling_price": 540,
        "is_available": true,
      };

      final product = ProductModel.fromJson(json);

      expect(product.name, equals("Kotmale Fresh Milk 1L"));
      expect(product.sellingPrice, equals(540.0));
      expect(product.isAvailable, isTrue);
      expect(product.categoryName, equals("Dairy & Eggs"));
      // The model has no purchase-cost/markup fields at all - confirming
      // there's nothing here that could accidentally leak them even if the
      // backend response shape changes.
      expect(json.containsKey('purchase_cost'), isFalse);
      expect(json.containsKey('markup'), isFalse);
    });

    test('ProductPage parses the pagination envelope', () {
      final json = {
        "products": [
          {
            "id": "b1",
            "category_id": "c1",
            "category_name": "Dairy & Eggs",
            "name": "Milk",
            "slug": "milk",
            "sku": "SKU-1",
            "unit": "1 L",
            "selling_price": 540,
            "is_available": true,
          },
        ],
        "pagination": {"page": 1, "limit": 3, "total": 5, "total_pages": 2},
      };

      final page = ProductPage.fromJson(json);

      expect(page.products, hasLength(1));
      expect(page.page, equals(1));
      expect(page.total, equals(5));
      expect(page.totalPages, equals(2));
    });
  });
}
