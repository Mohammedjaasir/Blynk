import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';

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
  OrderProvider({OrderRequest? request}) : _request = request ?? _apiRequest;

  final OrderRequest _request;

  static const int _pageSize = 20;

  List<OrderModel> _orders = [];
  bool _isLoadingOrders = false;
  String? _ordersError;

  bool _hasLoadedFirstPage = false;
  int _page = 1;
  int _totalPages = 1;
  bool _isLoadingMore = false;
  String? _loadMoreError;

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
  String? _placeOrderError;
  OrderModel? _lastPlacedOrder;

  List<OrderModel> get orders => _orders;
  bool get isLoadingOrders => _isLoadingOrders;
  String? get ordersError => _ordersError;

  bool get hasMoreOrders => _page < _totalPages;
  bool get isLoadingMore => _isLoadingMore;
  String? get loadMoreError => _loadMoreError;

  bool get isPlacingOrder => _isPlacingOrder;
  String? get placeOrderError => _placeOrderError;
  OrderModel? get lastPlacedOrder => _lastPlacedOrder;

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
    final gen = ++_listGeneration;
    _isLoadingOrders = true;
    _isLoadingMore = false;
    _ordersError = null;
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
      _ordersError = _toApiException(e).message;
    } finally {
      if (gen == _listGeneration) {
        _isLoadingOrders = false;
        notifyListeners();
      }
    }
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
    _loadMoreError = null;
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
      _loadMoreError = _toApiException(e).message;
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
    _placeOrderError = null;
    notifyListeners();

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
        },
      );

      final data = (response is Map ? response['data'] : null) as Map?;
      final placed = OrderModel.tryParse(data?['order']);
      if (placed == null) {
        throw ApiException(500, 'Order was not returned by the server.');
      }

      _lastPlacedOrder = placed;
      cart.clear();
      _isPlacingOrder = false;
      notifyListeners();
      return placed;
    } catch (e) {
      final apiError = _toApiException(e);
      _placeOrderError = apiError.message;
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
