/// Website tracking for Google Tag Manager (owner, 2026-10-10): GA4, Google
/// Ads and the Meta Pixel are set up inside GTM; the shop only describes what
/// happened, as `window.dataLayer` events with GA4's recommended ecommerce
/// names and shapes (docs/06-deployment/google-tag-manager-and-ads-setup.md
/// lists every event and parameter).
///
/// - Web only. On Android, iOS and in tests every call is a no-op (see
///   data_layer_stub.dart), and on the web too when the site was built
///   without a GTM container ID (no dataLayer, nothing is pushed).
/// - No personal data, ever: no phone number, name, address, email or
///   location. The signed-in customer is a one-way hash of their customer id
///   ([hashCustomerId]). Every payload also goes through [sanitize], which
///   drops personal-looking keys and blanks phone-number / email-looking
///   values (a phone number typed into search, say).
/// - Never throws: tracking must not break the shop.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

import 'package:ecom/Models/combo_model.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/promotion_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';

import 'data_layer_stub.dart' if (dart.library.js_interop) 'data_layer_web.dart' as data_layer;

/// Receives each finished dataLayer payload. The real one pushes to
/// `window.dataLayer`; a test records them.
typedef AnalyticsSink = void Function(Map<String, Object?> payload);

/// Every amount is in Sri Lankan rupees.
const String kAnalyticsCurrency = 'LKR';

/// GA4 keeps at most 200 items per event; a listing sends its first few,
/// which is what the customer actually saw.
const int kAnalyticsListItemsMax = 20;

class Analytics {
  Analytics._();

  static final Analytics instance = Analytics._();

  AnalyticsSink _sink = data_layer.pushToDataLayer;
  String? _userId;
  String? _lastShippingAttempt;

  /// Swaps where payloads go (a test records them); null puts the real
  /// dataLayer back. Also forgets the signed-in customer.
  @visibleForTesting
  void debugUseSink(AnalyticsSink? sink) {
    _sink = sink ?? data_layer.pushToDataLayer;
    _userId = null;
    _lastShippingAttempt = null;
  }

  /// The hashed id sent as `user_id`, or null when signed out.
  @visibleForTesting
  String? get debugUserId => _userId;

  // ---------------------------------------------------------------- identity

  /// One-way SHA-256 of the customer id (never their phone or name), so GA4
  /// and Google Ads can join one customer's visits without learning who they
  /// are.
  static String hashCustomerId(String customerId) =>
      sha256.convert(utf8.encode('blynk-customer:$customerId')).toString();

  /// The signed-in customer's id, or null after sign-out.
  void setCustomerId(String? customerId) {
    final id = customerId?.trim() ?? '';
    _userId = id.isEmpty ? null : hashCustomerId(id);
  }

  /// Keeps `user_id` in step with [source] (the AuthProvider) for the app's
  /// lifetime. Returns [source] so it can wrap a provider's `create`.
  T followCustomer<T extends Listenable>(T source, String? Function(T) customerId) {
    void sync() => setCustomerId(customerId(source));
    source.addListener(sync);
    sync();
    return source;
  }

  // ------------------------------------------------------------ the events

  /// A screen change in the web app (hash routes such as `#/home`), sent by
  /// AnalyticsRouteObserver because GTM's history trigger does not reliably
  /// see hash changes.
  void pageView(String routeName) {
    final path = routeName.startsWith('/') ? routeName : '/$routeName';
    event('page_view', {
      'page_path': path,
      'page_title': 'Blynk $path',
      if (kIsWeb) 'page_location': _pageLocation(path),
    });
  }

  /// A returning customer signed in with the SMS code.
  void login() => event('login', {'method': 'phone_otp'});

  /// A new customer finished signing up (SMS code, then their name).
  void signUp() => event('sign_up', {'method': 'phone_otp'});

  /// After the SMS code: a customer who already has a name is logging in; a
  /// new one is only signed up once they give their name ([signUp]).
  void signedIn({required bool newCustomer}) {
    if (!newCustomer) login();
  }

  void viewItemList({required String listId, required String listName, required List<ProductModel> products}) {
    if (products.isEmpty) return;
    final shown = products.take(kAnalyticsListItemsMax).toList();
    _ecommerce('view_item_list', {
      'item_list_id': listId,
      'item_list_name': listName,
      'items': [
        for (var i = 0; i < shown.length; i++)
          productItem(shown[i], 1, index: i, listId: listId, listName: listName),
      ],
    });
  }

  void viewItem(ProductModel product) => _ecommerce('view_item', {
        'currency': kAnalyticsCurrency,
        'value': _money(product.effectivePrice),
        'items': [productItem(product, 1)],
      });

  void addToCart(ProductModel product, {int quantity = 1}) {
    if (quantity <= 0) return;
    _ecommerce('add_to_cart', {
      'currency': kAnalyticsCurrency,
      'value': _money(product.effectivePrice * quantity),
      'items': [productItem(product, quantity)],
    });
  }

  void removeFromCart(ProductModel product, {int quantity = 1}) {
    if (quantity <= 0) return;
    _ecommerce('remove_from_cart', {
      'currency': kAnalyticsCurrency,
      'value': _money(product.effectivePrice * quantity),
      'items': [productItem(product, quantity)],
    });
  }

  void addComboToCart(ComboModel combo, {int quantity = 1}) {
    if (quantity <= 0) return;
    _ecommerce('add_to_cart', {
      'currency': kAnalyticsCurrency,
      'value': _money(combo.price * quantity),
      'items': [comboItem(combo, quantity)],
    });
  }

  void removeComboFromCart(ComboModel combo, {int quantity = 1}) {
    if (quantity <= 0) return;
    _ecommerce('remove_from_cart', {
      'currency': kAnalyticsCurrency,
      'value': _money(combo.price * quantity),
      'items': [comboItem(combo, quantity)],
    });
  }

  void viewCart(CartProvider cart) => _ecommerce('view_cart', _cartContents(cart));

  void beginCheckout(CartProvider cart) {
    if (cart.isEmpty) return;
    _ecommerce('begin_checkout', _cartContents(cart));
  }

  /// The delivery address is chosen and the order is being sent. Once per
  /// checkout attempt ([attemptKey], the order's idempotency key): a retry
  /// of the same checkout is not a second one.
  void addShippingInfo(CartProvider cart, {required String attemptKey, String? coupon, bool scheduled = false}) {
    if (cart.isEmpty || _lastShippingAttempt == attemptKey) return;
    _lastShippingAttempt = attemptKey;
    _ecommerce('add_shipping_info', {
      ..._cartContents(cart),
      if (coupon != null && coupon.isNotEmpty) 'coupon': coupon,
      'shipping_tier': scheduled ? 'scheduled' : 'asap',
    });
  }

  /// The order the server created. [lines] and [combos] are the cart as it
  /// was ordered (read before the cart is cleared); the amounts are the
  /// server's. Cash on delivery: the purchase is counted when ordered.
  void purchase(OrderModel order, {required List<CartLine> lines, List<CartComboLine> combos = const []}) {
    final coupon = order.couponCode;
    _ecommerce('purchase', {
      'transaction_id': order.orderNumber.isNotEmpty ? order.orderNumber : order.id,
      'currency': kAnalyticsCurrency,
      'value': _money(order.totalAmount),
      'shipping': _money(order.deliveryFee),
      if (coupon != null && coupon.isNotEmpty) 'coupon': coupon,
      'payment_type': order.paymentMethod,
      'items': [
        for (final l in lines) productItem(l.product, l.quantity),
        for (final c in combos) comboItem(c.combo, c.quantity),
      ],
    });
  }

  void search(String term) {
    final t = term.trim();
    if (t.isEmpty) return;
    event('search', {'search_term': t});
  }

  /// A Home carousel promotion was tapped.
  void selectPromotion(PromotionModel promotion) => _ecommerce('select_promotion', {
        'promotion_id': promotion.id,
        'promotion_name': promotion.title,
        'creative_slot': 'home_carousel_${promotion.displayOrder}',
      });

  /// The share sheet was opened (Refer a friend, a product). The referral
  /// code itself is never sent.
  void share({required String contentType, String? itemId}) => event('share', {
        'method': 'share_sheet',
        'content_type': contentType,
        if (itemId != null && itemId.isNotEmpty) 'item_id': itemId,
      });

  // -------------------------------------------------------------- plumbing

  static Map<String, Object?> productItem(ProductModel p, int quantity,
          {int? index, String? listId, String? listName}) =>
      {
        'item_id': p.id,
        'item_name': p.name,
        if (p.categoryName.isNotEmpty) 'item_category': p.categoryName,
        'price': _money(p.effectivePrice),
        'quantity': quantity,
        if (index != null) 'index': index,
        if (listId != null) 'item_list_id': listId,
        if (listName != null) 'item_list_name': listName,
      };

  static Map<String, Object?> comboItem(ComboModel c, int quantity) => {
        'item_id': c.id,
        'item_name': c.name,
        'item_category': 'Combo packs',
        'price': _money(c.price),
        'quantity': quantity,
      };

  Map<String, Object?> _cartContents(CartProvider cart) => {
        'currency': kAnalyticsCurrency,
        'value': _money(cart.subtotal),
        'items': [
          for (final l in cart.lines) productItem(l.product, l.quantity),
          for (final c in cart.comboLines) comboItem(c.combo, c.quantity),
        ],
      };

  static double _money(double v) => double.parse(v.toStringAsFixed(2));

  /// The page address GA4 shows: this page, keeping only campaign
  /// parameters (utm_*, click ids, a friend's ?ref code), plus the route.
  static String _pageLocation(String path) {
    final here = Uri.base;
    final kept = <String, String>{
      for (final e in here.queryParameters.entries)
        if (e.key.startsWith('utm_') || const {'gclid', 'gbraid', 'wbraid', 'fbclid', 'ref'}.contains(e.key))
          e.key: e.value,
    };
    return Uri(
      scheme: here.scheme,
      host: here.host,
      port: here.hasPort ? here.port : null,
      path: here.path,
      queryParameters: kept.isEmpty ? null : kept,
      fragment: path,
    ).toString();
  }

  static final RegExp _eventName = RegExp(r'^[a-z][a-z0-9_]{0,39}$');

  static const Set<String> _ecommerceEvents = {
    'view_item_list', 'view_item', 'add_to_cart', 'remove_from_cart', 'view_cart',
    'begin_checkout', 'add_shipping_info', 'purchase', 'select_promotion',
  };

  void _ecommerce(String name, Map<String, Object?> ecommerce) {
    assert(_ecommerceEvents.contains(name), name);
    // GA4's GTM guide: clear the previous ecommerce object first, so one
    // event's items never leak into the next.
    _push({'ecommerce': null});
    _push({'event': name, 'user_id': _userId, 'ecommerce': ecommerce});
  }

  /// A plain (non-ecommerce) event with flat parameters.
  void event(String name, [Map<String, Object?> params = const {}]) {
    if (!_eventName.hasMatch(name)) return;
    _push({'event': name, 'user_id': _userId, ...params});
  }

  void _push(Map<String, Object?> payload) {
    try {
      _sink(sanitize(payload));
    } catch (_) {
      // Tracking must never break the shop.
    }
  }

  // ------------------------------------------------------------ PII guard

  /// Keys that hold personal data. Dropped wherever they appear.
  static final RegExp piiKey = RegExp(
    r'^(name|full_?name|first_?name|last_?name|.*phone.*|.*mobile.*|.*e_?mail.*|.*address.*|recipient.*|'
    r'street|city|lat|lng|lon|latitude|longitude|location|otp|.*token.*|password|.*birth.*|dob)$',
    caseSensitive: false,
  );

  static final RegExp _emailValue = RegExp(r'[^@\s]+@[^@\s]+\.[^@\s]+');

  /// Nine or more digits in a row (spaces, dashes, a leading + allowed): a
  /// phone number in any Sri Lankan or international format.
  static final RegExp _phoneValue = RegExp(r'\+?(?:\d[\s\-]?){9,}');

  /// Server-made identifiers (ids, order numbers, the hashed user id) and
  /// the page address are long digit runs by nature, not phone numbers.
  static const Set<String> _idKeys = {
    'user_id', 'item_id', 'transaction_id', 'item_list_id', 'promotion_id',
    'creative_slot', 'page_location', 'page_path',
  };

  static const String redacted = '[redacted]';

  /// [payload] with personal-data keys removed and phone / email shaped
  /// values replaced by [redacted], at any depth.
  static Map<String, Object?> sanitize(Map<String, Object?> payload) => {
        for (final e in payload.entries)
          if (!piiKey.hasMatch(e.key)) e.key: _clean(e.key, e.value),
      };

  static Object? _clean(String key, Object? value) {
    if (value is Map) {
      return sanitize({for (final e in value.entries) e.key.toString(): e.value});
    }
    if (value is List) return [for (final v in value) _clean(key, v)];
    if (value is String) {
      if (_emailValue.hasMatch(value)) return redacted;
      if (!_idKeys.contains(key) && _phoneValue.hasMatch(value)) return redacted;
    }
    return value;
  }
}
