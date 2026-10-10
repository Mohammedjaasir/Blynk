import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:ecom/Infrastructure/LocalStorage/referral_storage.dart';
import 'package:ecom/Models/referral_model.dart';

/// Reads a friend's code from a shared link (owner, 2026-10-10).
///
/// A shared referral link is `<SHARE_BASE_URL>/app/?ref=CODE` (see
/// `ShareLinks.referralUrl`). On the web build that query string is still on
/// the page address at startup, so it is kept on the device until the
/// customer signs in, then applied once (`PendingReferralSync`). The Android
/// app has no page address, so nothing happens there.
class ReferralLink {
  const ReferralLink._();

  /// The `ref` code in [uri] (normalised), or null when absent or malformed.
  static String? codeFrom(Uri uri) {
    final raw = uri.queryParameters['ref'];
    if (raw == null) return null;
    final code = normaliseReferralCode(raw);
    return referralCodePattern.hasMatch(code) ? code : null;
  }

  /// Startup hook: keeps the page's `?ref=` code for later. Never throws.
  static Future<void> captureFromPageAddress({Uri? pageUri, bool? isWeb}) async {
    if (!(isWeb ?? kIsWeb)) return;
    try {
      final code = codeFrom(pageUri ?? Uri.base);
      if (code != null) await ReferralStorage.writePending(code);
    } catch (_) {}
  }
}
