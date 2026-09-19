import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const int kMaxRecentSearches = 8;

/// Returns [current] with [query] moved to the front: trimmed, never empty,
/// de-duplicated case-insensitively, capped at [max].
List<String> addRecentSearch(
  List<String> current,
  String query, {
  int max = kMaxRecentSearches,
}) {
  final trimmed = query.trim();
  if (trimmed.isEmpty) return List.of(current);
  final lower = trimmed.toLowerCase();
  return [
    trimmed,
    ...current.where((q) => q.toLowerCase() != lower),
  ].take(max).toList();
}

/// Device-local search history. Uses the same flutter_secure_storage
/// instance configuration as TokenStorage - the app's only persistence
/// mechanism - rather than adding a second one.
class RecentSearchesStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const String _key = 'blynk_recent_searches';

  static Future<List<String>> load() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null || raw.isEmpty) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .whereType<String>()
          .map((q) => q.trim())
          .where((q) => q.isNotEmpty)
          .take(kMaxRecentSearches)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  static Future<void> save(List<String> searches) async {
    try {
      await _storage.write(key: _key, value: jsonEncode(searches));
    } catch (_) {}
  }

  static Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}
