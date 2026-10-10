import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/analytics/analytics.dart';

/// Page views for the web app's hash routes (owner, 2026-10-10): GTM's
/// history trigger does not reliably see `#/home` -> `#/cart`, so every page
/// the customer lands on (pushed, replaced, or returned to with back) sends a
/// `page_view`. Opening the cart also sends `view_cart`, and opening checkout
/// `begin_checkout`, with the cart's contents. Dialogs and sheets are not
/// pages. A no-op off the web (see [Analytics]).
class AnalyticsRouteObserver extends NavigatorObserver {
  AnalyticsRouteObserver({Analytics? analytics}) : _analytics = analytics ?? Analytics.instance;

  final Analytics _analytics;
  String? _current;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (_shown(route)) _screenEvents(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    if (newRoute != null && _shown(newRoute)) _screenEvents(newRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PageRoute && previousRoute != null) _shown(previousRoute);
  }

  /// Sends the page view; false for a non-page or the page already showing.
  bool _shown(Route<dynamic> route) {
    final name = route.settings.name;
    if (route is! PageRoute || name == null || name.isEmpty || name == _current) return false;
    _current = name;
    _analytics.pageView(name);
    return true;
  }

  void _screenEvents(Route<dynamic> route) {
    final name = route.settings.name;
    if (name != '/cart' && name != '/checkout') return;
    final context = route.navigator?.context;
    if (context == null) return;
    try {
      final cart = Provider.of<CartProvider>(context, listen: false);
      if (name == '/cart') {
        _analytics.viewCart(cart);
      } else {
        _analytics.beginCheckout(cart);
      }
    } catch (_) {
      // No cart above the navigator (a test app): no ecommerce event.
    }
  }
}
