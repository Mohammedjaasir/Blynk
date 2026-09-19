import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/product.provider.dart';

/// Regression tests for the Admin → Customer sync bug.
///
/// The bug: ProductProvider cached categories, per-category product lists
/// and promotions for the whole app session, and the Home shell (an
/// IndexedStack) never asked again - so a product edited in the Admin app
/// kept its old price/name/image/visibility in the customer app until a
/// restart. These tests drive a fake backend whose data changes between
/// calls, exactly as it does when an operator saves in Admin.
///
/// JSON shapes are the real API's (GET /catalog/products, /catalog/categories,
/// /promotions, /catalog/products/:id, captured 2026-09-18).

Map<String, dynamic> _product({
  String id = 'b0000001-0000-0000-0000-000000000001',
  String name = 'Kotmale Fresh Milk 1L',
  double price = 540,
  String? imageUrl,
  bool available = true,
}) =>
    {
      'id': id,
      'category_id': 'c0000001-0000-0000-0000-000000000001',
      'category_name': 'Dairy & Eggs',
      'name': name,
      'slug': 'kotmale-fresh-milk-1l',
      'description': null,
      'sku': 'SKU-DAI-001',
      'barcode': '4792024001011',
      'unit': '1 L',
      'pack_size': 'Tetra Pack',
      'image_url': imageUrl,
      'selling_price': price,
      'is_available': available,
    };

Map<String, dynamic> _promotion(String id, String title, int order,
        {String type = 'SOLID', String? color = '#FFE141'}) =>
    {
      'id': id,
      'title': title,
      'subtitle': null,
      'image_url': null,
      'background_type': type,
      'background_color': color,
      'background_color_end': null,
      'background_image_url': null,
      'cta_label': null,
      'cta_destination_type': null,
      'cta_destination_value': null,
      'display_order': order,
    };

/// The catalog as the backend currently holds it. Tests mutate it the way
/// an Admin save would, then check what the customer provider ends up with.
class _Backend {
  List<Map<String, dynamic>> dairy = [_product()];
  List<Map<String, dynamic>> promotions = [_promotion('p1', 'Fresh Dairy', 1)];
  List<Map<String, dynamic>> categories = [
    {
      'id': 'c0000001-0000-0000-0000-000000000001',
      'name': 'Dairy & Eggs',
      'slug': 'dairy-eggs',
      'description': null,
      'image_url': null,
      'display_order': 1,
    },
  ];
  bool fail = false;
  final Map<String, int> calls = {};

  /// When set, product-list requests wait on it - lets a test look at the
  /// provider while a refresh is in flight.
  Completer<void>? gate;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    final key = query['category_slug'] == null ? url : '$url?${query['category_slug']}';
    calls[key] = (calls[key] ?? 0) + 1;
    if (url == '/catalog/products' && gate != null) await gate!.future;
    if (fail) throw ApiException(503, 'Service unavailable');

    if (url == '/catalog/categories') {
      return {'success': true, 'data': {'categories': categories}};
    }
    if (url == '/promotions') {
      return {'success': true, 'data': {'promotions': promotions}};
    }
    if (url == '/catalog/products') {
      return {
        'success': true,
        'data': {
          'products': dairy,
          'pagination': {'page': 1, 'limit': 100, 'total': dairy.length, 'total_pages': 1},
        },
      };
    }
    if (url.startsWith('/catalog/products/')) {
      final id = url.split('/').last;
      final match = dairy.where((p) => p['id'] == id);
      if (match.isEmpty) throw ApiException(404, 'Product not found');
      return {'success': true, 'data': {'product': match.first}};
    }
    throw StateError('unexpected $url');
  }

  int callsTo(String key) => calls[key] ?? 0;
}

void main() {
  late _Backend backend;
  late ProductProvider products;
  late DateTime now;

  setUp(() {
    backend = _Backend();
    now = DateTime(2026, 9, 18, 16);
    products = ProductProvider(request: backend.call, clock: () => now);
  });

  Future<void> loadHome() async {
    await products.loadCategories();
    await products.loadPromotions();
    await products.loadProducts(categorySlug: 'dairy-eggs');
  }

  group('the stale-cache bug (reproduction)', () {
    test('a plain reload after an Admin edit still returns the cached copy', () async {
      await loadHome();
      backend.dairy = [_product(price: 750)];

      // This is what Home did before the fix: the same cached call again.
      await products.loadProducts(categorySlug: 'dairy-eggs');

      expect(products.productsFor('dairy-eggs').single.sellingPrice, 540,
          reason: 'documents why a refresh path is needed at all');
    });
  });

  group('refreshCatalog', () {
    test('an Admin price change replaces the stale product', () async {
      await loadHome();
      backend.dairy = [_product(price: 750)];

      await products.refreshCatalog(force: true);

      expect(products.productsFor('dairy-eggs').single.sellingPrice, 750);
    });

    test('an Admin name change replaces the stale product', () async {
      await loadHome();
      backend.dairy = [_product(name: 'Kotmale Fresh Milk 1L (New Pack)')];

      await products.refreshCatalog(force: true);

      expect(products.productsFor('dairy-eggs').single.name,
          'Kotmale Fresh Milk 1L (New Pack)');
    });

    test('ACTIVE → INACTIVE → ACTIVE follows the backend', () async {
      await loadHome();

      backend.dairy = []; // deactivated: the customer catalog omits it
      await products.refreshCatalog(force: true);
      expect(products.productsFor('dairy-eggs'), isEmpty);

      backend.dairy = [_product()]; // re-activated
      await products.refreshCatalog(force: true);
      expect(products.productsFor('dairy-eggs').single.name, 'Kotmale Fresh Milk 1L');
    });

    test('image added, replaced and removed', () async {
      await loadHome();
      expect(products.productsFor('dairy-eggs').single.imageUrl, isNull);

      backend.dairy = [_product(imageUrl: 'http://localhost:4000/uploads/products/a.webp')];
      await products.refreshCatalog(force: true);
      expect(products.productsFor('dairy-eggs').single.imageUrl, endsWith('/a.webp'));

      backend.dairy = [_product(imageUrl: 'http://localhost:4000/uploads/products/b.webp')];
      await products.refreshCatalog(force: true);
      expect(products.productsFor('dairy-eggs').single.imageUrl, endsWith('/b.webp'));

      backend.dairy = [_product()];
      await products.refreshCatalog(force: true);
      expect(products.productsFor('dairy-eggs').single.imageUrl, isNull);
    });

    test('promotion title, background, order and deactivation follow the backend', () async {
      await loadHome();

      backend.promotions = [
        _promotion('p2', 'Snack Time', 1, type: 'GRADIENT', color: '#0C831F'),
        _promotion('p1', 'Fresh Dairy, Every Morning', 2),
      ];
      await products.refreshCatalog(force: true);
      expect(products.promotions.map((p) => p.title),
          ['Snack Time', 'Fresh Dairy, Every Morning']);
      expect(products.promotions.first.backgroundType, 'GRADIENT');

      backend.promotions = [];
      await products.refreshCatalog(force: true);
      expect(products.promotions, isEmpty);
    });

    test('categories are refreshed too', () async {
      await loadHome();
      backend.categories = [
        ...backend.categories,
        {'id': 'c2', 'name': 'Bakery', 'slug': 'bakery', 'description': null, 'image_url': null, 'display_order': 2},
      ];

      await products.refreshCatalog(force: true);

      expect(products.categories.map((c) => c.slug), ['dairy-eggs', 'bakery']);
    });

    test('keeps the current products on screen while the refresh is in flight', () async {
      await loadHome();
      backend.dairy = [_product(price: 750)];
      backend.gate = Completer<void>();

      final refresh = products.refreshCatalog(force: true);
      await Future<void>.delayed(Duration.zero);

      // No skeleton flash: the rail is not "loading" and still has its data.
      expect(products.isLoadingProducts('dairy-eggs'), isFalse);
      expect(products.productsFor('dairy-eggs').single.sellingPrice, 540);

      backend.gate!.complete();
      await refresh;
      expect(products.productsFor('dairy-eggs').single.sellingPrice, 750);
    });

    test('a failed refresh keeps the last good data and raises no error', () async {
      await loadHome();
      backend.fail = true;

      await products.refreshCatalog(force: true);

      expect(products.productsFor('dairy-eggs').single.sellingPrice, 540);
      expect(products.productsError, isNull);
      expect(products.categoriesError, isNull);
      expect(products.categories, isNotEmpty);
    });

    test('concurrent refreshes share one set of requests', () async {
      await loadHome();
      final before = backend.callsTo('/catalog/products?dairy-eggs');

      await Future.wait([
        products.refreshCatalog(force: true),
        products.refreshCatalog(force: true),
        products.refreshCatalog(),
      ]);

      expect(backend.callsTo('/catalog/products?dairy-eggs'), before + 1);
    });

    test('an unforced refresh right after another is skipped; later it runs', () async {
      await loadHome();
      await products.refreshCatalog(force: true);
      final before = backend.callsTo('/catalog/products?dairy-eggs');

      now = now.add(const Duration(seconds: 3));
      await products.refreshCatalog();
      expect(backend.callsTo('/catalog/products?dairy-eggs'), before,
          reason: 'focus flicker must not refetch');

      now = now.add(ProductProvider.refreshMinInterval);
      await products.refreshCatalog();
      expect(backend.callsTo('/catalog/products?dairy-eggs'), before + 1);
    });
  });

  group('product details keep the grids coherent', () {
    test('a fresh detail fetch updates the same product in the loaded lists', () async {
      await loadHome();
      backend.dairy = [_product(price: 750)];

      await products.loadProductDetail('b0000001-0000-0000-0000-000000000001');

      expect(products.productDetail('b0000001-0000-0000-0000-000000000001')!.sellingPrice, 750);
      expect(products.productsFor('dairy-eggs').single.sellingPrice, 750);
    });

    test('a product the backend no longer serves (404) leaves the lists', () async {
      await loadHome();
      backend.dairy = [];

      await products.loadProductDetail('b0000001-0000-0000-0000-000000000001');

      expect(products.productDetailFailure('b0000001-0000-0000-0000-000000000001'),
          ProductDetailFailure.notFound);
      expect(products.productsFor('dairy-eggs'), isEmpty);
    });
  });
}
