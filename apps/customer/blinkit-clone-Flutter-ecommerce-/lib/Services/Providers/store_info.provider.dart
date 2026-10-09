import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/LocalStorage/store_info_storage.dart';
import 'package:ecom/Models/birthday_offer_model.dart';
import 'package:ecom/Services/store_info.dart';

/// GET against the public store endpoint. Defaults to the app's ApiService;
/// injectable so tests can answer without a network.
typedef StoreRequest = Future<dynamic> Function(String url);

Future<dynamic> _apiGet(String url) =>
    ApiService.requestMethods(methodType: 'GET', url: url);

/// The live store facts from the public `GET /store`: the delivery fee and,
/// since the checkout switches (owner, 2026-10-08), whether checkout offers a
/// coupon field. The other facts stay in [StoreInfo]. This customer's own
/// free-delivery offer and birthday gift come from the signed-in
/// `GET /orders/checkout-info` ([loadCheckoutInfo]).
///
/// Order of truth for [deliveryFee]: the server's answer this session, else
/// the last good answer cached on the device, else
/// [StoreInfo.defaultDeliveryFee]. Every failure is silent: the fee simply
/// stays where it was.
class StoreInfoProvider extends ChangeNotifier {
  StoreInfoProvider({
    StoreRequest? request,
    Future<String?> Function()? readCache,
    Future<void> Function(String value)? writeCache,
  })  : _request = request ?? _apiGet,
        _readCache = readCache ?? StoreInfoStorage.readDeliveryFee,
        _writeCache = writeCache ?? StoreInfoStorage.writeDeliveryFee;

  final StoreRequest _request;
  final Future<String?> Function() _readCache;
  final Future<void> Function(String value) _writeCache;

  /// The highest fee accepted from the server or the cache. Anything outside
  /// 0..[maxDeliveryFee] is treated as a bad answer and ignored.
  static const double maxDeliveryFee = 1000;

  /// Secure storage has been seen to hang; the cache must never hold up the
  /// network answer.
  static const Duration cacheReadTimeout = Duration(seconds: 2);

  double _deliveryFee = StoreInfo.defaultDeliveryFee;
  bool _hasServerFee = false;
  bool _disposed = false;
  Future<void>? _loading;

  /// The fee the cart estimate and Help quote. Never null, never invalid.
  double get deliveryFee => _deliveryFee;

  bool _couponsEnabled = false;

  /// Whether checkout shows the coupon field (`coupons_enabled` on
  /// `GET /store`). Hidden until the server says yes: the owner switched
  /// coupons off (2026-10-08), and a code the server would ignore must not
  /// look like it worked.
  bool get couponsEnabled => _couponsEnabled;

  bool _showOfferSavings = false;

  /// Whether product and combo cards show "Save LKR X" on an offer
  /// (`show_offer_savings` on `GET /store`; owner, 2026-10-10). Hidden until
  /// the server sends a real `true`: a missing or non-bool value means off.
  bool get showOfferSavings => _showOfferSavings;

  FreeDeliveryOffer? _freeDelivery;
  Future<void>? _loadingCheckoutInfo;

  /// This customer's free deliveries, or null when unknown
  /// (signed out, not loaded yet, or the request failed).
  FreeDeliveryOffer? get freeDelivery => _freeDelivery;

  BirthdayOffer? _birthdayOffer;

  /// This customer's birthday gift (owner, 2026-10-09), from
  /// `birthday_offer` on `GET /orders/checkout-info` (or a fresher GET/PATCH
  /// /me via [applyBirthdayOffer]); null when unknown or signed out.
  BirthdayOffer? get birthdayOffer => _birthdayOffer;

  /// Takes a fresher birthday status (Profile > About you saved a date of
  /// birth, which may open the gift at once). Null is ignored: "not in this
  /// answer" is not "no gift".
  void applyBirthdayOffer(BirthdayOffer? offer) {
    if (offer != null) _setBirthdayOffer(offer);
  }

  /// An order just used the birthday gift: stop offering it at once, without
  /// waiting for the next checkout-info.
  void markBirthdayGiftUsed() {
    final offer = _birthdayOffer;
    if (offer != null && offer.eligible) _setBirthdayOffer(offer.markedUsed());
  }

  void _setBirthdayOffer(BirthdayOffer? offer) {
    if (_disposed || offer == _birthdayOffer) return;
    _birthdayOffer = offer;
    notifyListeners();
  }

  /// The fee this customer's next order is estimated at: nothing while a
  /// free delivery applies, else the store's [deliveryFee]. Advisory only;
  /// the server decides again when the order is placed.
  double get checkoutDeliveryFee =>
      (_freeDelivery?.applies ?? false) ? 0 : _deliveryFee;

  /// Asks `GET /orders/checkout-info` where this customer stands. Pass
  /// [signedIn] false to forget a previous customer's offer without asking.
  /// Never throws; a failure leaves the offer unknown (the full fee shows).
  Future<void> loadCheckoutInfo({required bool signedIn}) {
    if (!signedIn) {
      _setFreeDelivery(null);
      _setBirthdayOffer(null);
      return Future.value();
    }
    return _loadingCheckoutInfo ??=
        _fetchCheckoutInfo().whenComplete(() => _loadingCheckoutInfo = null);
  }

  Future<void> _fetchCheckoutInfo() async {
    try {
      final response = await _request('/orders/checkout-info');
      final data = response is Map ? response['data'] : null;
      _setFreeDelivery(
          FreeDeliveryOffer.tryParse(data is Map ? data['free_delivery'] : null));
      if (data is Map && data['coupons_enabled'] is bool) {
        _setCouponsEnabled(data['coupons_enabled'] as bool);
      }
      _setBirthdayOffer(BirthdayOffer.tryParse(data is Map ? data['birthday_offer'] : null));
    } catch (_) {
      _setFreeDelivery(null);
      _setBirthdayOffer(null);
    }
  }

  void _setFreeDelivery(FreeDeliveryOffer? offer) {
    if (_disposed || offer == _freeDelivery) return;
    _freeDelivery = offer;
    notifyListeners();
  }

  void _setShowOfferSavings(bool show) {
    if (_disposed || show == _showOfferSavings) return;
    _showOfferSavings = show;
    notifyListeners();
  }

  void _setCouponsEnabled(bool enabled) {
    if (_disposed || enabled == _couponsEnabled) return;
    _couponsEnabled = enabled;
    notifyListeners();
  }

  /// A fee value the app may show: a finite number in 0..[maxDeliveryFee].
  /// A numeric string is accepted too (a Postgres numeric can arrive as one).
  static double? parseFee(Object? raw) {
    final double? value = switch (raw) {
      num n => n.toDouble(),
      String s => double.tryParse(s.trim()),
      _ => null,
    };
    if (value == null || !value.isFinite) return null;
    if (value < 0 || value > maxDeliveryFee) return null;
    return value;
  }

  /// Restores the cached fee, then asks the server. Safe to call more than
  /// once; a call while one is running joins it. Never throws.
  Future<void> load() => _loading ??= _load().whenComplete(() => _loading = null);

  Future<void> _load() async {
    await _restoreCached();
    await _fetch();
  }

  Future<void> _restoreCached() async {
    try {
      // then<String?> first: a Future<Never> would reject the null fallback.
      final raw = await _readCache()
          .then<String?>((v) => v)
          .timeout(cacheReadTimeout, onTimeout: () => null);
      final fee = parseFee(raw);
      // A server answer that arrived first always wins over the cache.
      if (fee != null && !_hasServerFee) _set(fee);
    } catch (_) {}
  }

  Future<void> _fetch() async {
    try {
      final response = await _request('/store');
      final data = response is Map ? response['data'] : null;
      if (data is Map) {
        _setCouponsEnabled(data['coupons_enabled'] == true);
        // The "Save LKR X" switch (owner, 2026-10-10): only a real bool true.
        _setShowOfferSavings(data['show_offer_savings'] == true);
      }
      final fee = parseFee(data is Map ? data['delivery_fee_lkr'] : null);
      if (fee == null) return;
      _hasServerFee = true;
      _set(fee);
      await _writeCache(fee.toString());
    } catch (_) {
      // Offline, server error, bad JSON: keep the fee we already have.
    }
  }

  void _set(double fee) {
    if (_disposed || fee == _deliveryFee) return;
    _deliveryFee = fee;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// The live delivery fee for a widget, rebuilding it when the fee changes.
/// Falls back to [StoreInfo.defaultDeliveryFee] where no [StoreInfoProvider]
/// is in the tree (a widget test that doesn't need one).
double watchDeliveryFee(BuildContext context) =>
    context.watch<StoreInfoProvider?>()?.deliveryFee ??
    StoreInfo.defaultDeliveryFee;

/// The fee this customer's next order is estimated at (free while one of
/// their free deliveries applies), rebuilding when it changes. Falls back
/// to [StoreInfo.defaultDeliveryFee] where no [StoreInfoProvider] is in the
/// tree.
double watchCheckoutDeliveryFee(BuildContext context) =>
    context.watch<StoreInfoProvider?>()?.checkoutDeliveryFee ??
    StoreInfo.defaultDeliveryFee;

/// Whether checkout shows the coupon field; false where no
/// [StoreInfoProvider] is in the tree (unknown means hidden).
bool watchCouponsEnabled(BuildContext context) =>
    context.watch<StoreInfoProvider?>()?.couponsEnabled ?? false;

/// Whether offers show "Save LKR X" (owner, 2026-10-10), rebuilding when the
/// switch changes; false where no [StoreInfoProvider] is in the tree (unknown
/// means hidden).
bool watchShowOfferSavings(BuildContext context) =>
    context.watch<StoreInfoProvider?>()?.showOfferSavings ?? false;

/// One customer's free deliveries (owner, 2026-10-08), from `free_delivery`
/// on `GET /orders/checkout-info`. Since 2026-10-09 (owner) every customer,
/// existing ones too, gets the first [count] deliveries free, counted from
/// [since].
@immutable
class FreeDeliveryOffer {
  const FreeDeliveryOffer({
    required this.count,
    required this.remaining,
    required this.applies,
    this.since,
  });

  /// Free deliveries every customer gets.
  final int count;

  /// How many this customer still has, the next order included.
  final int remaining;

  /// Whether the next order goes out with no delivery fee.
  final bool applies;

  /// When the free deliveries started counting; null when the server omits
  /// it (an older backend) or sends something unparseable.
  final DateTime? since;

  /// Null for anything that is not a well-formed offer.
  static FreeDeliveryOffer? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final count = raw['count'];
    final remaining = raw['remaining'];
    final applies = raw['applies'];
    if (count is! int || remaining is! int || applies is! bool) return null;
    if (count < 0 || remaining < 0) return null;
    final since = raw['since'];
    return FreeDeliveryOffer(
      count: count,
      remaining: remaining,
      applies: applies && remaining > 0,
      since: since is String ? DateTime.tryParse(since) : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is FreeDeliveryOffer &&
      other.count == count &&
      other.remaining == remaining &&
      other.applies == applies &&
      other.since == since;

  @override
  int get hashCode => Object.hash(count, remaining, applies, since);
}

/// This customer's birthday gift while it applies to their next order
/// (owner, 2026-10-09), rebuilding when it changes; null otherwise, signed
/// out, or where no [StoreInfoProvider] is in the tree.
BirthdayOffer? watchEligibleBirthdayOffer(BuildContext context) {
  final offer = context.watch<StoreInfoProvider?>()?.birthdayOffer;
  return offer != null && offer.eligible ? offer : null;
}
