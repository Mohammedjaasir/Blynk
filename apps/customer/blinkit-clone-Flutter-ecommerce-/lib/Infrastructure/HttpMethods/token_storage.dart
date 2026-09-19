import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
  );

  static const String _accessTokenKey = 'blynk_access_token';
  static const String _refreshTokenKey = 'blynk_refresh_token';
  static const String _userCacheKey = 'blynk_user_profile';

  static Future<String?> getAccessToken() async {
    try {
      return await _storage.read(key: _accessTokenKey);
    } catch (_) {
      return null;
    }
  }

  static Future<String?> getRefreshToken() async {
    try {
      return await _storage.read(key: _refreshTokenKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  static Future<String?> getUserCache() async {
    try {
      return await _storage.read(key: _userCacheKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveUserCache(String userJson) async {
    await _storage.write(key: _userCacheKey, value: userJson);
  }

  static Future<void> clearAll() async {
    try {
      await _storage.delete(key: _accessTokenKey);
      await _storage.delete(key: _refreshTokenKey);
      await _storage.delete(key: _userCacheKey);
    } catch (_) {}
  }
}
