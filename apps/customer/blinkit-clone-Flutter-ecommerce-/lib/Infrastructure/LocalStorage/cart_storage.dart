import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the cart is kept between launches (and, on the web, between page
/// reloads). The cart has no backend endpoint, so without this a closed app
/// lost every item the customer had picked.
///
/// The value is an opaque string written by `CartProvider`; this class only
/// stores it. Every call is best effort: storage that cannot be read or
/// written means the cart is simply not remembered, never a crash.
abstract class CartStorage {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> clear();
}

/// The production [CartStorage]: the same flutter_secure_storage setup as
/// TokenStorage, RecentSearchesStorage and the app's other device storage
/// (on the web the plugin keeps it in the browser's local storage).
class SecureCartStorage implements CartStorage {
  const SecureCartStorage();

  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const String _key = 'blynk_cart_v1';

  @override
  Future<String?> read() async {
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String value) async {
    try {
      await _storage.write(key: _key, value: value);
    } catch (_) {}
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}
