import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/LocalStorage/store_info_storage.dart';
import 'package:ecom/Services/store_info.dart';

/// GET against the public store endpoint. Defaults to the app's ApiService;
/// injectable so tests can answer without a network.
typedef StoreRequest = Future<dynamic> Function(String url);

Future<dynamic> _apiGet(String url) =>
    ApiService.requestMethods(methodType: 'GET', url: url);

/// The live store facts from the public `GET /store`. Today only the
/// delivery fee is read from it; the other facts stay in [StoreInfo].
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
