import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Remembers that this device chose "Skip for now" on the login screen
/// (2026-10-05, owner: a customer who skipped once is not asked again on the
/// next launch - the app opens straight on the shop). Logging in stays one
/// tap away from Profile, and anything that needs an account still asks.
/// Same flutter_secure_storage setup as the app's other device storage.
class GuestChoiceStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const String _skippedKey = 'blynk_login_skipped';

  /// True when the customer skipped login before. Unreadable storage counts
  /// as "no", which only means the login screen shows once more.
  static Future<bool> hasSkippedLogin() async {
    try {
      return await _storage.read(key: _skippedKey) == '1';
    } catch (_) {
      return false;
    }
  }

  static Future<void> rememberSkippedLogin() async {
    try {
      await _storage.write(key: _skippedKey, value: '1');
    } catch (_) {}
  }
}
