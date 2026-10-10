// Shareable product links (2026-09-29, owner's request).
//
// A shared product is `https://<site>/p/<productId>`. On Android that link
// opens the app itself (a verified App Link, see AndroidManifest.xml and the
// website's /.well-known/assetlinks.json); anywhere else the website sends it
// on to the web shop at /app/#/p/<productId>. Either way the route name
// `/p/<productId>` reaches Flutter, and [productIdFromRoute] reads it.
//
// The site address is a build value: `--dart-define=SHARE_BASE_URL=https://...`.
// Without it the app shares the product's name only, as before - it never
// invents an address.

const String _kShareBaseUrl = String.fromEnvironment('SHARE_BASE_URL');

class ShareLinks {
  const ShareLinks._();

  /// Product ids are the API's ids: letters, digits, '-' and '_' only.
  static final RegExp _route = RegExp(r'^/p/([A-Za-z0-9_-]{1,64})/?$');

  /// The product id in a `/p/<id>` route name (query string ignored), or null.
  static String? productIdFromRoute(String? routeName) {
    if (routeName == null) return null;
    final path = Uri.tryParse(routeName)?.path ?? routeName;
    return _route.firstMatch(path)?.group(1);
  }

  /// The public link for a product, or null when no https site address is
  /// configured.
  static String? productUrl(String productId, {String baseUrl = _kShareBaseUrl}) {
    final base = Uri.tryParse(baseUrl.trim());
    if (base == null || base.scheme != 'https' || base.host.isEmpty) return null;
    if (_route.firstMatch('/p/$productId') == null) return null;
    return base.replace(path: '/p/$productId', query: null, fragment: null).toString();
  }

  /// What the share sheet sends: the name, then the link when there is one.
  static String productShareText(String name, String productId, {String baseUrl = _kShareBaseUrl}) {
    final url = productUrl(productId, baseUrl: baseUrl);
    return url == null ? '$name on Blynk' : '$name on Blynk\n$url';
  }

  /// Refer a friend (owner, 2026-10-10): `<site>/app/?ref=CODE`, or null
  /// when no https site address is configured (never an invented address)
  /// or the code is not plain letters and digits.
  static String? referralUrl(String code, {String baseUrl = _kShareBaseUrl}) {
    final base = Uri.tryParse(baseUrl.trim());
    if (base == null || base.scheme != 'https' || base.host.isEmpty) return null;
    if (!RegExp(r'^[A-Za-z0-9]{1,32}$').hasMatch(code)) return null;
    return base.replace(path: '/app/', queryParameters: {'ref': code}, fragment: null).toString();
  }

  /// What the referral share sheet sends: the code, then the link when there
  /// is one (owner, 2026-10-10).
  static String referralShareText(String code, {String baseUrl = _kShareBaseUrl}) {
    final url = referralUrl(code, baseUrl: baseUrl);
    final text = 'Join me on Blynk and get a reward on your first order. Use my code $code';
    return url == null ? '$text when you sign up.' : '$text or this link:\n$url';
  }
}
