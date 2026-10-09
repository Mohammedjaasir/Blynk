import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/category_group_model.dart';
import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/promotion_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/app_errors.dart';

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

/// POST or DELETE against the catalog API ("Notify me when it's back").
/// Injectable so tests never reach a server.
typedef CatalogMutation = Future<dynamic> Function(String method, String url);

Future<dynamic> _apiMutate(String method, String url) {
  return ApiService.requestMethods(methodType: method, url: url);
}

enum ProductDetailFailure { notFound, network }

class ProductProvider extends ChangeNotifier {
  ProductProvider({CatalogRequest? request, CatalogMutation? mutate, DateTime Function()? clock})
      : _request = request ?? _apiGet,
        _mutate = mutate ?? _apiMutate,
        _clock = clock ?? DateTime.now;

  final CatalogRequest _request;
  final CatalogMutation _mutate;
  final DateTime Function() _clock;

  /// An unforced [refreshCatalog] within this long of the previous one is
  /// skipped, so a window regaining focus twice in a row doesn't refetch.
  static const Duration refreshMinInterval = Duration(seconds: 10);

  /// While the app is in the foreground the catalog is re-read this often,
  /// so a change made in Blynk Ops (a price, a photo, a product switched
  /// off, a new category) reaches a customer who simply keeps the app open.
  /// The fast path is the pushed event (`CatalogLiveUpdates`, about a
  /// second); this is the safety net for when that stream cannot be held.
  static const Duration liveRefreshEvery = Duration(seconds: 30);

  static const int searchPageSize = 40;

  List<CategoryModel> _categories = [];
  bool _isLoadingCategories = false;
  CustomerError? _categoriesFailure;

  // Products are cached per category slug (or '' for "all") so switching
  // between an already-loaded category/tab doesn't refetch every time.
  final Map<String, List<ProductModel>> _productsByCategory = {};
  final Set<String> _loadingKeys = {};
  // Keyed like _productsByCategory, so a failure in one category can never
  // show over another category's data. Set only by a load that had nothing
  // to show (a failed refresh keeps the last good list) and cleared by the
  // next successful load of that same key.
  final Map<String, CustomerError> _productsFailures = {};

  List<ProductModel> _searchResults = [];
  bool _isSearching = false;
  bool _isLoadingMoreSearch = false;
  CustomerError? _searchFailure;
  String _lastQuery = '';
  String? _searchCategorySlug;
  int _searchTotal = 0;
  int _searchPage = 1;
  int _searchTotalPages = 1;
  // Bumped on every new search so a slow response for a superseded query
  // (or the same query under a different category filter) is discarded.
  int _searchGeneration = 0;

  List<CategoryModel> get categories => _categories;

  /// Migration 026: the categories that are not inside another one - what
  /// Home's fallback and the Categories screen list.
  List<CategoryModel> get topLevelCategories => CategoryModel.topLevelOf(_categories);
  bool get isLoadingCategories => _isLoadingCategories;
  String? get categoriesError => _categoriesFailure?.message;
  CustomerError? get categoriesFailure => _categoriesFailure;

  /// The customer-facing failure of the last empty-handed load of one
  /// category ('' is "all products"), or null.
  CustomerError? productsFailureFor(String categorySlug) =>
      _productsFailures[categorySlug];
  String? productsErrorFor(String categorySlug) =>
      _productsFailures[categorySlug]?.message;
  List<ProductModel> get searchResults => _searchResults;
  bool get isSearching => _isSearching;
  bool get isLoadingMoreSearch => _isLoadingMoreSearch;
  String? get searchError => _searchFailure?.message;
  CustomerError? get searchFailure => _searchFailure;
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
  final Map<String, CustomerError> _detailErrors = {};

  // "Notify me when it's back" (phase 6): the signed-in customer's pending
  // alert per product, as product detail last reported it.
  final Map<String, bool> _notifyMe = {};
  final Set<String> _notifyMeBusy = {};

  bool isNotifyMeSubscribed(String id) => _notifyMe[id] ?? false;
  bool isNotifyMeBusy(String id) => _notifyMeBusy.contains(id);

  /// Turns the back-in-stock alert for product [id] on or off. Throws the
  /// request's error (the caller says so); a product that is back already
  /// (409 PRODUCT_AVAILABLE) is simply re-read, so the page shows it on sale.
  Future<void> setNotifyMe(String id, bool on) async {
    if (id.isEmpty || _notifyMeBusy.contains(id)) return;
    _notifyMeBusy.add(id);
    notifyListeners();
    try {
      await _mutate(on ? 'POST' : 'DELETE', '/catalog/products/$id/notify-me');
      _notifyMe[id] = on;
    } on ApiException catch (e) {
      if (e.statusCode == 409) {
        _notifyMe[id] = false;
        _notifyMeBusy.remove(id);
        await loadProductDetail(id);
        return;
      }
      rethrow;
    } finally {
      _notifyMeBusy.remove(id);
      notifyListeners();
    }
  }

  ProductModel? productDetail(String id) => _productDetails[id];
  bool isLoadingProductDetail(String id) => _loadingDetailIds.contains(id);
  ProductDetailFailure? productDetailFailure(String id) => _detailFailures[id];
  CustomerError? productDetailError(String id) => _detailErrors[id];

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
      _categoriesFailure = null;
      notifyListeners();
    }

    try {
      final response = await _request('/catalog/categories', const {});

      final data = (response is Map ? response['data'] : null) as Map?;
      final rawCategories = (data?['categories'] as List?) ?? const [];
      _categories = rawCategories
          .map((c) => CategoryModel.fromJson(c as Map<String, dynamic>))
          .toList();
      _categoriesFailure = null;
    } catch (e) {
      // A failed refresh keeps the last good list rather than replacing it
      // with an error; only a first load has nothing better to show.
      if (isFirstLoad) _categoriesFailure = AppErrors.from(e);
    } finally {
      _isLoadingCategories = false;
      notifyListeners();
    }
  }

  // Home's shop front (2026-10-05): named groups of category tiles, from
  // GET /catalog/home-groups, in the backend's own order.
  List<CategoryGroupModel> _homeGroups = [];
  bool _isLoadingHomeGroups = false;
  bool _homeGroupsRequested = false;
  // Set when the backend has no /catalog/home-groups yet (404): Home then
  // shows every category under one heading rather than nothing at all.
  bool _homeGroupsFallback = false;
  CustomerError? _homeGroupsFailure;

  /// The heading used when the backend predates category groups.
  static const String fallbackGroupName = 'Shop by category';

  List<CategoryGroupModel> get homeGroups => _homeGroupsFallback
      ? [
          if (_categories.isNotEmpty)
            CategoryGroupModel(id: null, name: fallbackGroupName, categories: topLevelCategories),
        ]
      : _homeGroups;
  bool get isLoadingHomeGroups => _isLoadingHomeGroups;
  CustomerError? get homeGroupsFailure => _homeGroupsFailure;

  /// GET /catalog/home-groups. Same rules as [loadCategories]: only a first
  /// load shows the skeleton, and a failed refresh keeps the groups already
  /// on screen instead of replacing them with an error.
  Future<void> loadHomeGroups({bool force = false}) async {
    if (_homeGroupsRequested && !force) return;
    if (_isLoadingHomeGroups) return;
    _homeGroupsRequested = true;

    final isFirstLoad = homeGroups.isEmpty;
    if (isFirstLoad) {
      _isLoadingHomeGroups = true;
      _homeGroupsFailure = null;
      notifyListeners();
    }

    try {
      final response = await _request('/catalog/home-groups', const {});
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['groups'] as List?) ?? const [];
      _homeGroups = [
        for (final g in raw)
          if (g is Map) CategoryGroupModel.fromJson(g.cast<String, dynamic>()),
      ].where((g) => g.categories.isNotEmpty).toList();
      _homeGroupsFallback = false;
      _homeGroupsFailure = null;
    } catch (e) {
      if (e is ApiException && e.statusCode == 404) {
        // An older backend: fall back to the flat category list.
        _homeGroupsFallback = true;
        _homeGroups = [];
        await loadCategories(force: !isFirstLoad);
        _homeGroupsFailure = isFirstLoad ? _categoriesFailure : null;
      } else if (isFirstLoad) {
        _homeGroupsFailure = AppErrors.from(e);
      }
    } finally {
      _isLoadingHomeGroups = false;
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
      _productsFailures.remove(key);
      notifyListeners();
    }

    try {
      // Every page, not just the first: Home lists the whole catalogue, so
      // a 101st product must not silently fall off the end.
      final all = <ProductModel>[];
      var pageNo = 1;
      var totalPages = 1;
      do {
        final response = await _request('/catalog/products', {
          if (categorySlug != null && categorySlug.isNotEmpty)
            'category_slug': categorySlug,
          'limit': 100,
          'page': pageNo,
        });
        final data = (response is Map ? response['data'] : null) as Map?;
        final page = ProductPage.fromJson(
          (data ?? const {}).cast<String, dynamic>(),
        );
        all.addAll(page.products);
        totalPages = page.totalPages;
        pageNo++;
      } while (pageNo <= totalPages && pageNo <= 20);
      _productsByCategory[key] = all;
      _productsFailures.remove(key);
    } catch (e) {
      if (!hasData) _productsFailures[key] = AppErrors.from(e);
    } finally {
      _loadingKeys.remove(key);
      notifyListeners();
    }
  }

  // Home's "Offers" rail (owner, 2026-10-09): products with an active offer,
  // from GET /products?on_offer=true. Kept apart from the per-category lists
  // so the offer request never counts as, or replaces, a category load.
  List<ProductModel> _offerProducts = [];
  bool _offersRequested = false;
  bool _isLoadingOffers = false;

  /// The most offers Home's rail asks for.
  static const int offersLimit = 24;

  /// Products on offer right now, in the backend's order. Empty until loaded,
  /// on any failure and when nothing is on offer - Home then has no rail.
  /// Filtered on [ProductModel.isOnOffer] too, so a backend that ignores
  /// `on_offer` (it predates offers) yields nothing rather than everything.
  List<ProductModel> get offerProducts =>
      _offerProducts.where((p) => p.isOnOffer).toList();

  /// GET /products?on_offer=true. Same rules as [loadPromotions]: once unless
  /// [force], and a failure empties the list (no error is shown - the rail
  /// simply is not there). A failed refresh keeps the offers already on
  /// screen, like every other list here.
  Future<void> loadOffers({bool force = false}) async {
    if (_isLoadingOffers) return;
    if (_offersRequested && !force) return;
    final hadOffers = _offerProducts.isNotEmpty;
    _offersRequested = true;
    _isLoadingOffers = true;
    try {
      final response = await _request('/products', const {
        'on_offer': 'true',
        'limit': offersLimit,
        'page': 1,
      });
      final data = (response is Map ? response['data'] : null) as Map?;
      _offerProducts = ProductPage.fromJson(
        (data ?? const {}).cast<String, dynamic>(),
      ).products;
    } catch (_) {
      if (!hadOffers) _offerProducts = [];
    } finally {
      _isLoadingOffers = false;
      notifyListeners();
    }
  }

  Future<void>? _refreshInFlight;
  DateTime? _lastRefreshAt;

  /// Re-fetches everything the customer is currently looking at - categories,
  /// Home's category groups, promotions and every product list already
  /// loaded - from the backend.
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
      if (_homeGroupsRequested) loadHomeGroups(force: true),
      loadPromotions(force: true),
      if (_offersRequested) loadOffers(force: true),
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
    _offerProducts = sync(_offerProducts);
  }

  /// Fetches one product (GET /catalog/products/:id) so the details page
  /// shows the backend's current price and availability, not whatever the
  /// grid it was opened from loaded earlier.
  Future<void> loadProductDetail(String id) async {
    if (id.isEmpty || _loadingDetailIds.contains(id)) return;

    _loadingDetailIds.add(id);
    _detailFailures.remove(id);
    _detailErrors.remove(id);
    notifyListeners();

    try {
      final response = await _request('/catalog/products/$id', const {});
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = data?['product'];
      if (raw is! Map) throw ApiException(500, 'Malformed product response');
      final product = ProductModel.fromJson(raw.cast<String, dynamic>());
      _productDetails[id] = product;
      _notifyMe[id] = raw['notify_me_subscribed'] == true;
      _syncListsWith(id, product);
    } catch (e) {
      // The backend answers 404 for deleted/deactivated products; that is a
      // different message to the customer than a dropped connection.
      final notFound = e is ApiException && e.statusCode == 404;
      _detailErrors[id] = AppErrors.from(e);
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
    _searchFailure = null;
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
      _searchFailure = AppErrors.from(e);
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
    _searchFailure = null;
    _searchTotal = 0;
    _searchPage = 1;
    _searchTotalPages = 1;
    _isSearching = false;
    _isLoadingMoreSearch = false;
    notifyListeners();
  }
}
