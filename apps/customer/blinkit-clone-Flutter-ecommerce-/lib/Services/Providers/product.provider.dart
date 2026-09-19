import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/promotion_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';

/// GET against the catalog API. Defaults to the app's single ApiService;
/// injectable only so tests can replay captured real backend JSON.
typedef CatalogRequest = Future<dynamic> Function(
  String url,
  Map<String, dynamic> queryParameters,
);

Future<dynamic> _apiGet(String url, Map<String, dynamic> queryParameters) {
  return ApiService.requestMethods(
    methodType: 'GET',
    url: url,
    queryParameters: queryParameters,
  );
}

enum ProductDetailFailure { notFound, network }

class ProductProvider extends ChangeNotifier {
  ProductProvider({CatalogRequest? request, DateTime Function()? clock})
      : _request = request ?? _apiGet,
        _clock = clock ?? DateTime.now;

  final CatalogRequest _request;
  final DateTime Function() _clock;

  /// An unforced [refreshCatalog] within this long of the previous one is
  /// skipped, so a window regaining focus twice in a row doesn't refetch.
  static const Duration refreshMinInterval = Duration(seconds: 10);

  static const int searchPageSize = 40;

  List<CategoryModel> _categories = [];
  bool _isLoadingCategories = false;
  String? _categoriesError;

  // Products are cached per category slug (or '' for "all") so switching
  // between an already-loaded category/tab doesn't refetch every time.
  final Map<String, List<ProductModel>> _productsByCategory = {};
  final Set<String> _loadingKeys = {};
  String? _productsError;

  List<ProductModel> _searchResults = [];
  bool _isSearching = false;
  bool _isLoadingMoreSearch = false;
  String? _searchError;
  String _lastQuery = '';
  String? _searchCategorySlug;
  int _searchTotal = 0;
  int _searchPage = 1;
  int _searchTotalPages = 1;
  // Bumped on every new search so a slow response for a superseded query
  // (or the same query under a different category filter) is discarded.
  int _searchGeneration = 0;

  List<CategoryModel> get categories => _categories;
  bool get isLoadingCategories => _isLoadingCategories;
  String? get categoriesError => _categoriesError;

  String? get productsError => _productsError;
  List<ProductModel> get searchResults => _searchResults;
  bool get isSearching => _isSearching;
  bool get isLoadingMoreSearch => _isLoadingMoreSearch;
  String? get searchError => _searchError;
  String get lastQuery => _lastQuery;
  String? get searchCategorySlug => _searchCategorySlug;

  /// Total matches reported by the backend's pagination, which can exceed
  /// the number of results loaded so far.
  int get searchTotal => _searchTotal;
  bool get hasMoreSearchResults => _searchPage < _searchTotalPages;

  // Home promotions, straight from the backend. The carousel has no
  // content of its own: an empty list means Home hides it.
  List<PromotionModel> _promotions = [];
  bool _isLoadingPromotions = false;
  bool _promotionsLoaded = false;

  List<PromotionModel> get promotions => _promotions;
  bool get isLoadingPromotions => _isLoadingPromotions;

  /// True once a load attempt has finished, whether it succeeded or not -
  /// the carousel waits for this before deciding to hide itself.
  bool get promotionsLoaded => _promotionsLoaded;

  /// GET /promotions returns active promotions in display order. A failure
  /// leaves the list empty on purpose: Home drops the carousel rather than
  /// showing stale or invented campaigns.
  Future<void> loadPromotions({bool force = false}) async {
    if (_isLoadingPromotions) return;
    if (_promotionsLoaded && !force) return;

    _isLoadingPromotions = true;
    notifyListeners();

    try {
      final response = await _request('/promotions', const {});
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['promotions'] as List?) ?? const [];
      _promotions = raw
          .map((p) => PromotionModel.fromJson(p as Map<String, dynamic>))
          .toList();
    } catch (_) {
      _promotions = [];
    } finally {
      _isLoadingPromotions = false;
      _promotionsLoaded = true;
      notifyListeners();
    }
  }

  // Product details, keyed by product id. Kept separate from the listing
  // caches so a details refresh never reorders or replaces a grid.
  final Map<String, ProductModel> _productDetails = {};
  final Set<String> _loadingDetailIds = {};
  final Map<String, ProductDetailFailure> _detailFailures = {};

  ProductModel? productDetail(String id) => _productDetails[id];
  bool isLoadingProductDetail(String id) => _loadingDetailIds.contains(id);
  ProductDetailFailure? productDetailFailure(String id) => _detailFailures[id];

  List<ProductModel> productsFor(String categorySlug) =>
      _productsByCategory[categorySlug] ?? const [];

  bool isLoadingProducts(String categorySlug) =>
      _loadingKeys.contains(categorySlug);

  Future<void> loadCategories({bool force = false}) async {
    if (_categories.isNotEmpty && !force) return;

    // Re-validating categories already on screen happens quietly: showing
    // the loading skeleton again would blank Home on every refresh.
    final isFirstLoad = _categories.isEmpty;
    if (isFirstLoad) {
      _isLoadingCategories = true;
      _categoriesError = null;
      notifyListeners();
    }

    try {
      final response = await _request('/catalog/categories', const {});

      final data = (response is Map ? response['data'] : null) as Map?;
      final rawCategories = (data?['categories'] as List?) ?? const [];
      _categories = rawCategories
          .map((c) => CategoryModel.fromJson(c as Map<String, dynamic>))
          .toList();
      _categoriesError = null;
    } catch (e) {
      // A failed refresh keeps the last good list rather than replacing it
      // with an error; only a first load has nothing better to show.
      if (isFirstLoad) {
        _categoriesError = e is ApiException ? e.message : e.toString();
      }
    } finally {
      _isLoadingCategories = false;
      notifyListeners();
    }
  }

  /// Loads products for a category (by slug) or all products when
  /// [categorySlug] is null/empty.
  Future<void> loadProducts({String? categorySlug, bool force = false}) async {
    final key = categorySlug ?? '';
    final hasData = _productsByCategory.containsKey(key);
    if (hasData && !force) return;

    // Same rule as categories: only a first load shows the skeleton rail.
    if (!hasData) {
      _loadingKeys.add(key);
      _productsError = null;
      notifyListeners();
    }

    try {
      final response = await _request('/catalog/products', {
        if (categorySlug != null && categorySlug.isNotEmpty)
          'category_slug': categorySlug,
        'limit': 100,
      });

      final data = (response is Map ? response['data'] : null) as Map?;
      final page = ProductPage.fromJson(
        (data ?? const {}).cast<String, dynamic>(),
      );
      _productsByCategory[key] = page.products;
    } catch (e) {
      if (!hasData) {
        _productsError = e is ApiException ? e.message : e.toString();
      }
    } finally {
      _loadingKeys.remove(key);
      notifyListeners();
    }
  }

  Future<void>? _refreshInFlight;
  DateTime? _lastRefreshAt;

  /// Re-fetches everything the customer is currently looking at - categories,
  /// promotions and every product list already loaded - from the backend.
  ///
  /// The catalog above is loaded once and kept, and Home lives in an
  /// IndexedStack that is never rebuilt, so without this an Admin change
  /// (price, name, image, active/inactive, promotion) never reached a
  /// running app. Called on pull-to-refresh, on returning to the Shop tab
  /// and when the app comes back to the foreground.
  ///
  /// Current data stays on screen until the new data arrives. Concurrent
  /// calls share one refresh; unless [force], a call within
  /// [refreshMinInterval] of the last refresh is skipped.
  Future<void> refreshCatalog({bool force = false}) {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight;

    final last = _lastRefreshAt;
    if (!force &&
        last != null &&
        _clock().difference(last) < refreshMinInterval) {
      return Future<void>.value();
    }
    _lastRefreshAt = _clock();

    final refresh = Future.wait([
      loadCategories(force: true),
      loadPromotions(force: true),
      for (final key in _productsByCategory.keys.toList())
        loadProducts(categorySlug: key.isEmpty ? null : key, force: true),
    ]).whenComplete(() => _refreshInFlight = null);
    _refreshInFlight = refresh;
    return refresh;
  }

  /// Keeps list copies in step with a product fetched on its own: a fresh
  /// details load replaces the grid's copy, and a product the backend no
  /// longer serves ([product] null) is dropped from every list.
  void _syncListsWith(String id, ProductModel? product) {
    List<ProductModel> sync(List<ProductModel> list) => product == null
        ? list.where((p) => p.id != id).toList()
        : [for (final p in list) p.id == id ? product : p];

    for (final key in _productsByCategory.keys.toList()) {
      _productsByCategory[key] = sync(_productsByCategory[key]!);
    }
    _searchResults = sync(_searchResults);
  }

  /// Fetches one product (GET /catalog/products/:id) so the details page
  /// shows the backend's current price and availability, not whatever the
  /// grid it was opened from loaded earlier.
  Future<void> loadProductDetail(String id) async {
    if (id.isEmpty || _loadingDetailIds.contains(id)) return;

    _loadingDetailIds.add(id);
    _detailFailures.remove(id);
    notifyListeners();

    try {
      final response = await _request('/catalog/products/$id', const {});
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = data?['product'];
      if (raw is! Map) throw ApiException(500, 'Malformed product response');
      final product = ProductModel.fromJson(raw.cast<String, dynamic>());
      _productDetails[id] = product;
      _syncListsWith(id, product);
    } catch (e) {
      // The backend answers 404 for deleted/deactivated products; that is a
      // different message to the customer than a dropped connection.
      final notFound = e is ApiException && e.statusCode == 404;
      _detailFailures[id] =
          notFound ? ProductDetailFailure.notFound : ProductDetailFailure.network;
      if (notFound) _syncListsWith(id, null);
    } finally {
      _loadingDetailIds.remove(id);
      notifyListeners();
    }
  }

  Future<ProductPage> _fetchSearchPage(
    String query,
    String? categorySlug,
    int page,
  ) async {
    final response = await _request('/catalog/products', {
      'search': query,
      if (categorySlug != null && categorySlug.isNotEmpty)
        'category_slug': categorySlug,
      'page': page,
      'limit': searchPageSize,
    });
    final data = (response is Map ? response['data'] : null) as Map?;
    return ProductPage.fromJson((data ?? const {}).cast<String, dynamic>());
  }

  /// Server-side catalog search (the backend matches name, description,
  /// SKU and barcode). Optionally narrowed to one category.
  Future<void> search(String query, {String? categorySlug}) async {
    final trimmed = query.trim();
    final generation = ++_searchGeneration;
    _lastQuery = trimmed;
    _searchCategorySlug = categorySlug;
    _searchResults = [];
    _searchError = null;
    _searchTotal = 0;
    _searchPage = 1;
    _searchTotalPages = 1;
    _isLoadingMoreSearch = false;

    if (trimmed.isEmpty) {
      _isSearching = false;
      notifyListeners();
      return;
    }

    _isSearching = true;
    notifyListeners();

    try {
      final page = await _fetchSearchPage(trimmed, categorySlug, 1);
      if (generation != _searchGeneration) return;
      _searchResults = page.products;
      _searchTotal = page.total;
      _searchPage = page.page;
      _searchTotalPages = page.totalPages;
    } catch (e) {
      if (generation != _searchGeneration) return;
      _searchError = e is ApiException ? e.message : e.toString();
    } finally {
      if (generation == _searchGeneration) {
        _isSearching = false;
        notifyListeners();
      }
    }
  }

  Future<void> retrySearch() =>
      search(_lastQuery, categorySlug: _searchCategorySlug);

  Future<void> loadMoreSearchResults() async {
    if (_isSearching ||
        _isLoadingMoreSearch ||
        !hasMoreSearchResults ||
        _lastQuery.isEmpty) {
      return;
    }

    final generation = _searchGeneration;
    _isLoadingMoreSearch = true;
    notifyListeners();

    try {
      final page = await _fetchSearchPage(
        _lastQuery,
        _searchCategorySlug,
        _searchPage + 1,
      );
      if (generation != _searchGeneration) return;
      _searchResults = [..._searchResults, ...page.products];
      _searchPage = page.page;
      _searchTotalPages = page.totalPages;
    } catch (_) {
      // Already-loaded results stay on screen; scrolling again retries.
    } finally {
      if (generation == _searchGeneration) {
        _isLoadingMoreSearch = false;
        notifyListeners();
      }
    }
  }

  void clearSearch() {
    _searchGeneration++;
    _lastQuery = '';
    _searchCategorySlug = null;
    _searchResults = [];
    _searchError = null;
    _searchTotal = 0;
    _searchPage = 1;
    _searchTotalPages = 1;
    _isSearching = false;
    _isLoadingMoreSearch = false;
    notifyListeners();
  }
}
