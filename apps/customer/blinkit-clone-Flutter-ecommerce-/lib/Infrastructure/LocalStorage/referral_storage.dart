import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// A friend's referral code that arrived in a link (`/app/?ref=CODE`) and
/// waits until the customer signs in, when it is applied once and forgotten
/// (owner, 2026-10-10). Same flutter_secure_storage setup as the app's other
/// device storage; unreadable storage simply means "no code".
class ReferralStorage {
  const ReferralStorage._();

  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const String _key = 'blynk_pending_referral_code';

  static Future<String?> readPending() async {
    try {
      final value = await _storage.read(key: _key);
      return value == null || value.trim().isEmpty ? null : value.trim();
    } catch (_) {
      return null;
    }
  }

  static Future<void> writePending(String code) async {
    try {
      await _storage.write(key: _key, value: code);
    } catch (_) {}
  }

  static Future<void> clearPending() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}
