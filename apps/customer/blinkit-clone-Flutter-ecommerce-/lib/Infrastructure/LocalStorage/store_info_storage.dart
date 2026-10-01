import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Device-local copy of the last good delivery fee from `GET /store`, so a
/// cold start without a network still shows the fee the store last quoted.
/// Uses the same flutter_secure_storage configuration as TokenStorage and
/// RecentSearchesStorage - the app's only persistence mechanism.
class StoreInfoStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const String _feeKey = 'blynk_store_delivery_fee';

  /// The stored fee as written, or null when there is none or it can't be read.
  static Future<String?> readDeliveryFee() async {
    try {
      return await _storage.read(key: _feeKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> writeDeliveryFee(String value) async {
    try {
      await _storage.write(key: _feeKey, value: value);
    } catch (_) {}
  }
}
