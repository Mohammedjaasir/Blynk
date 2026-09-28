import 'dart:io' show InternetAddress, InternetAddressType;

import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

// Compile-time values from `--dart-define` / `--dart-define-from-file`. They
// must be const, so they live here and the class takes them as parameters.
const String _kDefineApiBaseUrl = String.fromEnvironment('API_BASE_URL');
const String _kDefineMapTilesUrl = String.fromEnvironment('MAP_TILES_URL');

/// LAN test switch (2026-09-27). Off unless a build passes
/// `--dart-define=ALLOW_LAN_HTTP=true`. It is deliberately NOT read from
/// `.env`, so no bundled file can turn it on. See [AppConfig.validate].
const bool _kAllowLanHttp = bool.fromEnvironment('ALLOW_LAN_HTTP');

/// Why a build is not usable. Only [code] is ever shown to a customer.
class ConfigProblem {
  const ConfigProblem._(this.code);

  final String code;

  static const apiUrlMissing = ConfigProblem._('API_URL_MISSING');
  static const apiUrlInvalid = ConfigProblem._('API_URL_INVALID');
  static const apiUrlLocal = ConfigProblem._('API_URL_LOCAL');
  static const apiUrlNotHttps = ConfigProblem._('API_URL_NOT_HTTPS');

  /// A warning, never fatal: the optional tiles address only feeds the map,
  /// which then shows "Map unavailable".
  static const tilesUrlInvalid = ConfigProblem._('TILES_URL_INVALID');

  static const all = [apiUrlMissing, apiUrlInvalid, apiUrlLocal, apiUrlNotHttps, tilesUrlInvalid];

  @override
  String toString() => 'ConfigProblem($code)';
}

/// Where the app finds its server. Resolution order for each value:
/// compile-time define, then the bundled `.env` (dev), then, in debug builds
/// only, the localhost API. A release build never falls back: a missing,
/// local or non-https API address is a [ConfigProblem] and the app does not
/// start (see main.dart).
class AppConfig {
  AppConfig({
    String defineApiBaseUrl = _kDefineApiBaseUrl,
    String defineMapTilesUrl = _kDefineMapTilesUrl,
    String? Function(String key)? dotenvLookup,
    bool isRelease = kReleaseMode,
    bool allowLanHttp = _kAllowLanHttp,
  })  : _defineApi = defineApiBaseUrl.trim(),
        _allowLanHttp = allowLanHttp,
        _defineTiles = defineMapTilesUrl.trim(),
        _dotenvLookup = dotenvLookup ?? _readDotenv,
        _isRelease = isRelease;

  /// Read fresh on every call (dotenv can be reloaded), so it is cheap and
  /// never stale.
  factory AppConfig.current() => AppConfig();

  static const String debugApiBaseUrl = 'http://localhost:4000/api/v1';

  final String _defineApi;
  final String _defineTiles;
  final String? Function(String key) _dotenvLookup;
  final bool _isRelease;

  /// True only in a build made with `--dart-define=ALLOW_LAN_HTTP=true`: a
  /// temporary way to test a release APK on a phone against a backend on the
  /// same Wi-Fi. Store builds never pass it.
  final bool _allowLanHttp;

  static String? _readDotenv(String key) {
    try {
      return dotenv.env[key];
    } catch (_) {
      return null; // dotenv was never loaded
    }
  }

  String _dotenv(String key) => _dotenvLookup(key)?.trim() ?? '';

  /// The address a developer or the build actually set (define, then dotenv),
  /// or null. Never the debug fallback: the map must not be built from a guess.
  String? get configuredApiBaseUrl {
    if (_defineApi.isNotEmpty) return _defineApi;
    final fromDotenv = _dotenv('API_BASE_URL');
    return fromDotenv.isEmpty ? null : fromDotenv;
  }

  /// Empty only in a release build with nothing configured (never localhost).
  String get apiBaseUrl =>
      configuredApiBaseUrl ?? (_isRelease ? '' : debugApiBaseUrl);

  /// Null when unset: the map then derives it from [apiBaseUrl].
  String? get mapTilesUrl {
    if (_defineTiles.isNotEmpty) return _defineTiles;
    final fromDotenv = _dotenv('MAP_TILES_URL');
    return fromDotenv.isEmpty ? null : fromDotenv;
  }

  /// Null when the build can start. Debug builds always can. Only the API
  /// address is fatal; see [mapTilesProblem] for the optional tiles address.
  ConfigProblem? validate() {
    if (!_isRelease) return null;

    final api = apiBaseUrl;
    if (api.isEmpty) return ConfigProblem.apiUrlMissing;
    final apiUri = Uri.tryParse(api);
    if (apiUri == null || apiUri.host.isEmpty) return ConfigProblem.apiUrlInvalid;
    if (isLocalHost(apiUri.host)) return ConfigProblem.apiUrlLocal;
    if (apiUri.scheme == 'https') return null;
    // The LAN test switch: plain http, but only to a private LAN IPv4
    // literal, and only in a build that explicitly asked for it. Loopback,
    // link-local and emulator aliases were already refused above; names
    // (example.com, *.local) and public addresses are refused here.
    if (_allowLanHttp && apiUri.scheme == 'http' && isPrivateLanIpv4(apiUri.host)) {
      return null;
    }
    return ConfigProblem.apiUrlNotHttps;
  }

  /// True only for a canonical dotted-decimal IPv4 address (four plain
  /// decimal numbers, no leading zeros) in a private LAN range: 10.0.0.0/8,
  /// 172.16.0.0/12 or 192.168.0.0/16. Never a name, never an exotic spelling
  /// (`10.1`, `0x0a...`, `012...`), never loopback or public.
  @visibleForTesting
  static bool isPrivateLanIpv4(String host) {
    final parts = host.split('.');
    if (parts.length != 4) return false;
    final bytes = <int>[];
    for (final part in parts) {
      if (!_canonicalOctet.hasMatch(part)) return false;
      final v = int.parse(part);
      if (v > 255) return false;
      bytes.add(v);
    }
    if (bytes[0] == 10) return true;
    if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true;
    if (bytes[0] == 192 && bytes[1] == 168) return true;
    return false;
  }

  static final _canonicalOctet = RegExp(r'^(0|[1-9][0-9]{0,2})$');

  /// Release only: a set MAP_TILES_URL that is not a public https address. The
  /// app still starts (the map just reports itself unavailable).
  ConfigProblem? get mapTilesProblem {
    if (!_isRelease) return null;
    final tiles = mapTilesUrl;
    if (tiles == null) return null;
    final uri = Uri.tryParse(tiles);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty || isLocalHost(uri.host)) {
      return ConfigProblem.tilesUrlInvalid;
    }
    return null;
  }

  /// True for any host that only means "this machine / this network segment":
  /// localhost and `*.localhost`, `*.local`, loopback, unspecified and
  /// link-local addresses (IPv4 in every numeric spelling, IPv6, and IPv4
  /// embedded in IPv6), and the emulator aliases 10.0.2.2 / 10.0.3.2. Private
  /// LAN ranges are not flagged (a private https host can be legitimate).
  /// A numeric host that is not a valid address counts as local: it is not a
  /// name anyone can have configured on purpose.
  @visibleForTesting
  static bool isLocalHost(String rawHost) {
    var host = rawHost.trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.substring(1, host.length - 1);
    final zone = host.indexOf('%');
    if (zone >= 0) host = host.substring(0, zone);
    if (host.endsWith('.')) host = host.substring(0, host.length - 1);
    if (host.isEmpty) return true;

    if (host == 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return true;
    }

    if (host.contains(':')) {
      final address = InternetAddress.tryParse(host);
      if (address == null || address.type != InternetAddressType.IPv6) return true;
      return _isLocalIpv6(address.rawAddress);
    }

    final v4 = _parseIpv4Lenient(host);
    if (v4 == null) return false; // an ordinary name
    if (v4.isEmpty) return true; // numeric but not an address
    return _isLocalIpv4(v4);
  }

  static bool _isLocalIpv4(List<int> b) {
    if (b[0] == 127 || b[0] == 0) return true; // loopback, "this network" (0.0.0.0)
    if (b[0] == 169 && b[1] == 254) return true; // link-local
    if (b[0] == 10 && b[1] == 0 && (b[2] == 2 || b[2] == 3) && b[3] == 2) return true; // emulator aliases
    return false;
  }

  static bool _isLocalIpv6(List<int> b) {
    final zeroPrefix10 = b.take(10).every((x) => x == 0);
    if (zeroPrefix10 && b[10] == 0 && b[11] == 0) {
      // :: and ::1, or an IPv4-compatible ::a.b.c.d
      final allZeroButLast = b.take(15).every((x) => x == 0);
      if (allZeroButLast && (b[15] == 0 || b[15] == 1)) return true;
      return _isLocalIpv4(b.sublist(12));
    }
    if (zeroPrefix10 && b[10] == 0xff && b[11] == 0xff) return _isLocalIpv4(b.sublist(12)); // ::ffff:a.b.c.d
    // NAT64 64:ff9b::/96 carries an IPv4 too.
    if (b[0] == 0 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b && b.sublist(4, 12).every((x) => x == 0)) {
      return _isLocalIpv4(b.sublist(12));
    }
    if (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) return true; // fe80::/10 link-local
    return false;
  }

  /// inet_aton spelling: 1 to 4 dot-separated numbers, each decimal, 0x-hex or
  /// 0-octal, the last one filling the remaining bytes (`127.1`, `0x7f.1`,
  /// `2130706433`, `0177.0.0.1`). Null when the host is not made only of such
  /// numbers (an ordinary name); an empty list when it is but is out of range.
  static List<int>? _parseIpv4Lenient(String host) {
    final parts = host.split('.');
    if (parts.length > 4) {
      return parts.every(_isNumericPart) ? const [] : null;
    }
    if (!parts.every(_isNumericPart)) return null;

    final values = <int>[];
    for (final part in parts) {
      final int? v;
      if (part.length > 1 && part.startsWith('0x')) {
        v = part.length == 2 ? 0 : int.tryParse(part.substring(2), radix: 16);
      } else if (part.length > 1 && part.startsWith('0')) {
        v = int.tryParse(part.substring(1), radix: 8);
      } else {
        v = int.tryParse(part);
      }
      if (v == null) return const [];
      values.add(v);
    }

    for (var i = 0; i < values.length - 1; i++) {
      if (values[i] > 255) return const [];
    }
    final lastBytes = 5 - parts.length;
    const maxByLength = [0, 255, 65535, 16777215, 4294967295]; // by byte count
    if (values.last > maxByLength[lastBytes]) return const [];

    // Division, not shifts: the last number can use 32 bits.
    final tail = <int>[];
    var rest = values.last;
    for (var i = 0; i < lastBytes; i++) {
      tail.insert(0, rest % 256);
      rest ~/= 256;
    }
    final bytes = [for (var i = 0; i < parts.length - 1; i++) values[i], ...tail];
    return bytes;
  }

  static final _numericPart = RegExp(r'^(0x[0-9a-f]*|[0-9]+)$');
  static bool _isNumericPart(String part) => _numericPart.hasMatch(part);
}
