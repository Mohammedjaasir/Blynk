import 'package:flutter/foundation.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/rider_route_model.dart';

/// Asks the backend for the road route of one order. Returns null when the
/// backend has no route to give (no rider point yet); throws on any failure
/// (OSRM down -> 503, order no longer on the road -> 409, offline...).
typedef RiderRouteFetcher = Future<RiderRoute?> Function(String orderId);

/// `GET /orders/:id/route` through the app's single ApiService (auth header,
/// token refresh and base URL included).
Future<RiderRoute?> fetchRiderRoute(String orderId) async {
  final response = await ApiService.requestMethods(
    methodType: 'GET',
    url: '/orders/${Uri.encodeComponent(orderId)}/route',
  );
  final data = response is Map ? response['data'] : null;
  return RiderRoute.tryParse(data is Map ? data['route'] : null);
}

/// The road route + driving time shown on the customer's tracking map
/// (owner, 2026-10-10; reverses plan rule D.13 "no route, no ETA").
///
/// Rules:
///  - it fetches only while an order is watched AND the rider's position is
///    live ([refreshIfDue] is called on every location update);
///  - at most once every [refreshEvery] (the server also caches per order, so
///    a burst of customers cannot hammer the routing engine), and after a
///    failure not again for [retryAfterFailure];
///  - any failure (routing engine down, order no longer on the road, offline,
///    a malformed answer) clears the route, so the map hides the line and the
///    "Arriving in" time - it never keeps or invents a time.
///
/// Mirrors LocationProvider's generation discipline: a late answer for an
/// earlier watch is discarded.
class RiderRouteProvider extends ChangeNotifier {
  RiderRouteProvider({
    RiderRouteFetcher? fetcher,
    DateTime Function()? now,
    this.refreshEvery = const Duration(seconds: 25),
    this.retryAfterFailure = const Duration(seconds: 60),
  })  : _fetcher = fetcher ?? fetchRiderRoute,
        _now = now ?? DateTime.now;

  final RiderRouteFetcher _fetcher;
  final DateTime Function() _now;
  final Duration refreshEvery;
  final Duration retryAfterFailure;

  String? _orderId;
  RiderRoute? _route;
  DateTime? _lastAttempt;
  bool _lastFailed = false;
  bool _inFlight = false;
  bool _disposed = false;
  int _generation = 0;

  /// The latest route from the backend, or null (none yet, or the last
  /// request failed).
  RiderRoute? get route => _route;

  /// The order being watched, or null.
  String? get orderId => _orderId;

  /// Starts watching [orderId]. Watching the order already watched keeps its
  /// route (a screen rebuild must not drop the line).
  ///
  /// Silent (no notification): the map calls it while mounting / updating /
  /// unmounting, when notifying listeners would mark widgets dirty mid-build.
  /// The caller builds afterwards anyway and reads [route] then.
  void watch(String orderId) {
    if (_disposed || _orderId == orderId) return;
    _reset();
    _orderId = orderId;
  }

  /// Stops watching. With [orderId], only if that order is the one watched,
  /// so a stale caller cannot stop a newer watch. Silent, like [watch].
  void stopWatching([String? orderId]) {
    if (_disposed || _orderId == null) return;
    if (orderId != null && orderId != _orderId) return;
    _reset();
  }

  /// Fetches when due. [riderLive]: the rider's latest point is LIVE (a time
  /// computed from an old position would be made up, so nothing is fetched
  /// for a stale or missing rider).
  void refreshIfDue({required bool riderLive}) {
    final orderId = _orderId;
    if (_disposed || orderId == null || !riderLive || _inFlight) return;
    final last = _lastAttempt;
    if (last != null && _now().difference(last) < (_lastFailed ? retryAfterFailure : refreshEvery)) return;
    _fetch(orderId, _generation);
  }

  Future<void> _fetch(String orderId, int gen) async {
    _inFlight = true;
    _lastAttempt = _now();
    RiderRoute? next;
    var failed = false;
    try {
      next = await _fetcher(orderId);
    } catch (_) {
      failed = true;
    }
    if (_disposed || gen != _generation) return;
    _inFlight = false;
    _lastFailed = failed;
    _route = failed ? null : next;
    _notify();
  }

  void _reset() {
    _generation++;
    _orderId = null;
    _route = null;
    _lastAttempt = null;
    _lastFailed = false;
    _inFlight = false;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
