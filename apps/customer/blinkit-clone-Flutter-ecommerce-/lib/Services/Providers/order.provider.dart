import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/coupon_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/app_errors.dart';

/// A request against the orders API. Defaults to the app's single
/// ApiService; injectable only so tests can replay captured real backend
/// JSON (and errors) in the style of ProductProvider's CatalogRequest.
typedef OrderRequest = Future<dynamic> Function(
  String method,
  String url, {
  Object? body,
  Map<String, dynamic>? query,
});

Future<dynamic> _apiRequest(
  String method,
  String url, {
  Object? body,
  Map<String, dynamic>? query,
}) {
  return ApiService.requestMethods(
    methodType: method,
    url: url,
    body: body,
    queryParameters: query,
  );
}

/// The result of a cancel attempt. Distinguishes a real refusal from the
/// backend (order already out for delivery/cancelled/not cancellable, a
/// stale/missing id) - where the button should not be retried blindly -
/// from a network/timeout failure where the outcome is unknown and the
/// screen should refetch to show the truth.
class CancelOutcome {
  const CancelOutcome({this.order, this.error});

  final OrderModel? order;
  final ApiException? error;

  bool get ok => order != null;

  /// A 4xx the backend returned deliberately (not a timeout, which is also
  /// in the 4xx range at 408 but means "we don't know what happened").
  bool get isRefusal =>
      error != null && error!.statusCode >= 400 && error!.statusCode < 500 && error!.statusCode != 408;
}

class OrderProvider extends ChangeNotifier {
  OrderProvider({OrderRequest? request, DateTime Function()? clock})
      : _request = request ?? _apiRequest,
        _clock = clock ?? DateTime.now;

  final OrderRequest _request;
  final DateTime Function() _clock;

  /// A selection-triggered [refreshOrders] within this long of the previous
  /// load is skipped, so flicking between tabs is not polling.
  static const Duration refreshMinInterval = Duration(seconds: 30);

  DateTime? _lastLoadStartedAt;

  static const int _pageSize = 20;

  List<OrderModel> _orders = [];
  bool _isLoadingOrders = false;
  CustomerError? _ordersFailure;

  bool _hasLoadedFirstPage = false;
  int _page = 1;
  int _totalPages = 1;
  bool _isLoadingMore = false;
  CustomerError? _loadMoreFailure;

  // Bumped on every loadOrders() call. A refresh (loadOrders) always wins
  // over an in-flight loadMoreOrders() or a superseded loadOrders(): both
  // check their captured generation against the current one after their
  // await and discard their response - never touching _orders/_page/
  // _totalPages/loadMoreError - if a newer loadOrders() has since started.
  // Without this, a refresh racing a load-more could have the stale
  // page-2 response land after the refresh, appending onto the fresh
  // page-1 list and overwriting _page with a stale value.
  int _listGeneration = 0;

  bool _isPlacingOrder = false;
  CustomerError? _placeOrderFailure;
  OrderModel? _lastPlacedOrder;

  // Coupon at checkout (backend migration 018). The preview is tied to the
  // cart it was checked against: change the cart and it no longer applies
  // (see [couponFor]) - the server re-checks the code at placeOrder anyway.
  CouponPreview? _coupon;
  String? _couponCartKey;
  bool _isApplyingCoupon = false;
  String? _couponError;

  List<OrderModel> get orders => _orders;
  bool get isLoadingOrders => _isLoadingOrders;

  /// Whether the first page of orders has been fetched in this session.
  /// Home reads it so it asks for the customer's history exactly once
  /// instead of on every rebuild.
  bool get hasLoadedOrders => _hasLoadedFirstPage;
  String? get ordersError => _ordersFailure?.message;
  CustomerError? get ordersFailure => _ordersFailure;

  bool get hasMoreOrders => _page < _totalPages;
  bool get isLoadingMore => _isLoadingMore;
  String? get loadMoreError => _loadMoreFailure?.message;
  CustomerError? get loadMoreFailure => _loadMoreFailure;

  bool get isPlacingOrder => _isPlacingOrder;
  String? get placeOrderError => _placeOrderFailure?.message;
  CustomerError? get placeOrderFailure => _placeOrderFailure;
  OrderModel? get lastPlacedOrder => _lastPlacedOrder;

  bool get isApplyingCoupon => _isApplyingCoupon;

  /// The last coupon refusal, in plain words (null when there is none).
  String? get couponError => _couponError;

  /// The code last applied, even if the cart has since changed.
  String? get appliedCouponCode => _coupon?.code;

  /// Product ids and quantities: what a coupon preview was checked against.
  static String cartKey(CartProvider cart) =>
      (cart.lines.map((l) => '${l.product.id}x${l.quantity}').toList()..sort()).join(',');

  /// The applied coupon, if it was checked against this exact cart.
  CouponPreview? couponFor(CartProvider cart) =>
      _coupon != null && _couponCartKey == cartKey(cart) ? _coupon : null;

  /// A code was applied, but to a different cart than this one.
  bool couponIsStale(CartProvider cart) => _coupon != null && _couponCartKey != cartKey(cart);

  /// POST /orders/validate-coupon with the cart's lines. True when the code
  /// applies; otherwise [couponError] says why in plain words.
  Future<bool> applyCoupon(String rawCode, CartProvider cart) async {
    final code = normaliseCouponCode(rawCode);
    if (!couponCodePattern.hasMatch(code)) {
      _couponError = code.isEmpty ? 'Enter a code.' : 'Codes are 4 to 20 letters or numbers.';
      notifyListeners();
      return false;
    }
    if (cart.isEmpty) return false;
    _isApplyingCoupon = true;
    _couponError = null;
    notifyListeners();
    try {
      final response = await _request(
        'POST',
        '/orders/validate-coupon',
        body: {
          'code': code,
          'items': cart.lines.map((l) => {'product_id': l.product.id, 'quantity': l.quantity}).toList(),
        },
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final preview = CouponPreview.tryParse(data?['coupon']);
      if (preview == null) throw ApiException(500, 'Coupon was not returned by the server.');
      _coupon = preview;
      _couponCartKey = cartKey(cart);
      return true;
    } catch (e) {
      final apiError = _toApiException(e);
      _coupon = null;
      _couponCartKey = null;
      _couponError = couponRefusalMessage(apiError) ?? AppErrors.from(apiError).message;
      return false;
    } finally {
      _isApplyingCoupon = false;
      notifyListeners();
    }
  }

  void removeCoupon() {
    if (_coupon == null && _couponError == null) return;
    _coupon = null;
    _couponCartKey = null;
    _couponError = null;
    notifyListeners();
  }

  /// Forgets the signed-in customer's orders (logout / session end). Bumping
  /// the generation makes any in-flight list request discard its response
  /// instead of repopulating the list for the next person.
  void reset() {
    _listGeneration++;
    _orders = [];
    _isLoadingOrders = false;
    _ordersFailure = null;
    _hasLoadedFirstPage = false;
    _page = 1;
    _totalPages = 1;
    _isLoadingMore = false;
    _loadMoreFailure = null;
    _isPlacingOrder = false;
    _placeOrderFailure = null;
    _lastPlacedOrder = null;
    _lastLoadStartedAt = null;
    _coupon = null;
    _couponCartKey = null;
    _couponError = null;
    _isApplyingCoupon = false;
    notifyListeners();
  }

  ApiException _toApiException(Object e) => e is ApiException ? e : ApiService.handleError(e);

  /// Always fetches page 1 and replaces the list - used for the initial
  /// load and for pull-to-refresh, so a refresh never leaves the list
  /// stuck mid-way through whatever page loadMoreOrders had reached.
  ///
  /// Takes over from any in-flight loadMoreOrders() (or a superseded
  /// loadOrders()) immediately: `_isLoadingMore` is cleared right away, and
  /// the generation bump means that when the stale call's response does
  /// arrive, it is discarded rather than applied on top of this refresh.
  Future<void> loadOrders() async {
    _lastLoadStartedAt = _clock();
    final gen = ++_listGeneration;
    _isLoadingOrders = true;
    _isLoadingMore = false;
    _ordersFailure = null;
    notifyListeners();

    try {
      final response = await _request(
        'GET',
        '/orders',
        query: {'page': '1', 'limit': '$_pageSize'},
      );
      if (gen != _listGeneration) return;
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['orders'] as List?) ?? const [];
      final pagination = data?['pagination'] as Map?;
      _orders = raw.map(OrderModel.tryParse).whereType<OrderModel>().toList();
      _page = 1;
      _totalPages = int.tryParse('${pagination?['total_pages'] ?? 1}') ?? 1;
      _hasLoadedFirstPage = true;
    } catch (e) {
      if (gen != _listGeneration) return;
      _ordersFailure = AppErrors.from(e);
    } finally {
      if (gen == _listGeneration) {
        _isLoadingOrders = false;
        notifyListeners();
      }
    }
  }

  /// Loads page 1 unless one is already loading or, when not [force]d, the
  /// list was loaded less than [refreshMinInterval] ago. Used when the Orders
  /// tab is selected; the first mount and pull-to-refresh force it.
  Future<void> refreshOrders({bool force = false}) {
    if (!force && _isLoadingOrders) return Future<void>.value();
    final last = _lastLoadStartedAt;
    if (!force && last != null && _clock().difference(last) < refreshMinInterval) {
      return Future<void>.value();
    }
    // Stamped here as well as in loadOrders so a fake that overrides loadOrders
    // is throttled the same way.
    _lastLoadStartedAt = _clock();
    return loadOrders();
  }

  /// Fetches the next page and appends it. A no-op when there is nothing
  /// more, a load is already running, or the first page has not loaded yet
  /// - including while a loadOrders() refresh is in flight, since that
  /// refresh owns page/list state until it finishes.
  ///
  /// A failure never disturbs `_orders` or `_ordersError` - the already
  /// loaded list stays on screen, and the failure is surfaced separately
  /// through [loadMoreError] so it doesn't hide the list behind an error
  /// state the way a shared error field would.
  ///
  /// If a loadOrders() refresh starts while this call is still waiting on
  /// the network, this call's captured generation no longer matches
  /// `_listGeneration` by the time the response arrives: the response is
  /// discarded entirely (no touching `_orders`/`_page`/`_totalPages`/
  /// `_loadMoreError`) since the refresh has already replaced that state.
  Future<void> loadMoreOrders() async {
    if (!_hasLoadedFirstPage || !hasMoreOrders || _isLoadingMore || _isLoadingOrders) return;

    final gen = _listGeneration;
    _isLoadingMore = true;
    _loadMoreFailure = null;
    notifyListeners();

    final nextPage = _page + 1;
    try {
      final response = await _request(
        'GET',
        '/orders',
        query: {'page': '$nextPage', 'limit': '$_pageSize'},
      );
      if (gen != _listGeneration) return;
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['orders'] as List?) ?? const [];
      final pagination = data?['pagination'] as Map?;
      final parsed = raw.map(OrderModel.tryParse).whereType<OrderModel>().toList();
      _orders = [..._orders, ...parsed];
      _page = nextPage;
      _totalPages = int.tryParse('${pagination?['total_pages'] ?? _totalPages}') ?? _totalPages;
    } catch (e) {
      if (gen != _listGeneration) return;
      _loadMoreFailure = AppErrors.from(e);
    } finally {
      if (gen == _listGeneration) {
        _isLoadingMore = false;
        notifyListeners();
      }
    }
  }

  /// GET /orders/:id. Throws the real ApiException (404 -> ORDER_NOT_FOUND,
  /// a timeout -> code TIMEOUT, etc.) rather than swallowing it, so callers
  /// can tell "not found" from "couldn't reach the server".
  Future<OrderModel> fetchOrder(String id) async {
    try {
      final response = await _request('GET', '/orders/$id');
      final data = (response is Map ? response['data'] : null) as Map?;
      final order = OrderModel.tryParse(data?['order']);
      if (order == null) {
        throw ApiException(500, 'Order was not returned by the server.');
      }
      return order;
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// Submits the cart to the backend as a real order. The backend
  /// recalculates prices/totals/delivery fee from its own data - nothing
  /// computed client-side (CartProvider.subtotal) is sent or trusted as the
  /// final total; [placedOrder] reflects the server's authoritative amounts.
  Future<OrderModel?> placeOrder({
    required CartProvider cart,
    required String addressId,
    String? customerNotes,
  }) async {
    _isPlacingOrder = true;
    _placeOrderFailure = null;
    notifyListeners();
    final coupon = couponFor(cart);

    try {
      final response = await _request(
        'POST',
        '/orders',
        body: {
          'address_id': addressId,
          'items': cart.lines
              .map((line) => {
                    'product_id': line.product.id,
                    'quantity': line.quantity,
                  })
              .toList(),
          if (customerNotes != null && customerNotes.trim().isNotEmpty)
            'customer_notes': customerNotes.trim(),
          // Re-validated by the server inside the order transaction.
          if (coupon != null) 'coupon_code': coupon.code,
        },
      );

      final data = (response is Map ? response['data'] : null) as Map?;
      final placed = OrderModel.tryParse(data?['order']);
      if (placed == null) {
        throw ApiException(500, 'Order was not returned by the server.');
      }

      _lastPlacedOrder = placed;
      // The list on screen does not have this order yet: the next selection of
      // the Orders tab must fetch, not be throttled.
      _lastLoadStartedAt = null;
      cart.clear();
      _coupon = null;
      _couponCartKey = null;
      _couponError = null;
      _isPlacingOrder = false;
      notifyListeners();
      return placed;
    } catch (e) {
      final apiError = _toApiException(e);
      // The code stopped applying between the preview and the order (used up,
      // expired...): drop it and say why next to the field.
      final couponRefusal = (apiError.code ?? '').startsWith('COUPON_') ? couponRefusalMessage(apiError) : null;
      if (couponRefusal != null) {
        _coupon = null;
        _couponCartKey = null;
        _couponError = couponRefusal;
      }
      _placeOrderFailure = AppErrors.from(apiError);
      _isPlacingOrder = false;
      notifyListeners();
      throw apiError;
    }
  }

  /// POST /orders/:id/cancel. Never touches [ordersError] - a cancel
  /// failure (refusal or network) must not replace the whole orders list
  /// with an error. On success the matching list entry is swapped for the
  /// order the backend returned; on any failure the caller gets the
  /// [ApiException] back through [CancelOutcome.error] and decides what to
  /// show (a refusal message, or "checking your order..." + a refetch).
  Future<CancelOutcome> cancelOrder(String orderId, {String? reason}) async {
    try {
      final response = await _request(
        'POST',
        '/orders/$orderId/cancel',
        body: reason != null && reason.trim().isNotEmpty ? {'reason': reason.trim()} : null,
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final order = OrderModel.tryParse(data?['order']);
      if (order == null) {
        return CancelOutcome(error: ApiException(500, 'Order was not returned by the server.'));
      }
      _orders = [for (final o in _orders) o.id == orderId ? order : o];
      notifyListeners();
      return CancelOutcome(order: order);
    } catch (e) {
      return CancelOutcome(error: _toApiException(e));
    }
  }
}
