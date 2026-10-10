import 'package:flutter/foundation.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/LocalStorage/referral_storage.dart';
import 'package:ecom/Models/points_model.dart';
import 'package:ecom/Models/referral_model.dart';
import 'package:ecom/Models/usuals_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/app_errors.dart';

/// A request against the customer's own endpoints. Defaults to the app's
/// ApiService; injectable so tests can answer without a network.
typedef RewardsRequest = Future<dynamic> Function(String method, String url, {Object? body});

Future<dynamic> _apiRequest(String method, String url, {Object? body}) =>
    ApiService.requestMethods(methodType: method, url: url, body: body);

/// What applying a friend's code did.
class ReferralApplyOutcome {
  const ReferralApplyOutcome({
    this.ok = false,
    this.inviterFirstName,
    this.error,
    this.statusCode,
    this.invalidCode = false,
  });

  final bool ok;
  final String? inviterFirstName;

  /// The customer's words for a refusal (null on success).
  final String? error;
  final int? statusCode;

  /// The code was never sent: it is not a code at all.
  final bool invalidCode;

  /// "Code applied. Nimal invited you: your first order gets the reward."
  String get successText => inviterFirstName == null
      ? 'Referral code applied. Your first order gets the reward.'
      : "Referral code applied. $inviterFirstName invited you, and your first order gets the reward.";
}

/// The signed-in customer's rewards (owner, 2026-10-10): "Your usuals" on
/// Home (`GET /me/usuals`), Refer a friend (`GET /me/referral`,
/// `POST /me/referral/apply`) and Blynk Points (`GET /me/points`).
///
/// Every load is quiet: a failure leaves that part unknown and the UI hides
/// it, so a reward is never shown that the server did not confirm.
class RewardsProvider extends ChangeNotifier {
  RewardsProvider({
    RewardsRequest? request,
    Future<String?> Function()? readPendingReferral,
    Future<void> Function()? clearPendingReferral,
  })  : _request = request ?? _apiRequest,
        _readPending = readPendingReferral ?? ReferralStorage.readPending,
        _clearPending = clearPendingReferral ?? ReferralStorage.clearPending;

  final RewardsRequest _request;
  final Future<String?> Function() _readPending;
  final Future<void> Function() _clearPending;
  bool _disposed = false;

  // Bumped by [clear] so an answer for the previous customer is dropped.
  int _session = 0;

  UsualsData? _usuals;
  bool _loadingUsuals = false;
  ReferralInfo? _referral;
  bool _loadingReferral = false;
  PointsInfo? _points;
  bool _loadingPoints = false;
  bool _pointsFailed = false;
  bool _applyingReferral = false;

  /// "Your usuals"; null when unknown, signed out or failed.
  UsualsData? get usuals => _usuals;
  bool get isLoadingUsuals => _loadingUsuals;

  /// GET /me/referral's answer; null when unknown or signed out.
  ReferralInfo? get referral => _referral;
  bool get isLoadingReferral => _loadingReferral;

  /// GET /me/points's answer; null when unknown or signed out.
  PointsInfo? get points => _points;
  bool get isLoadingPoints => _loadingPoints;

  /// The last points load failed (the history screen offers a retry).
  bool get pointsFailed => _pointsFailed;
  bool get isApplyingReferral => _applyingReferral;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Forgets everything (sign-out).
  void clear() {
    _session++;
    _usuals = null;
    _referral = null;
    _points = null;
    _pointsFailed = false;
    _loadingUsuals = false;
    _loadingReferral = false;
    _loadingPoints = false;
    _applyingReferral = false;
    _notify();
  }

  static Map? _data(Object? response) {
    final data = response is Map ? response['data'] : null;
    return data is Map ? data : null;
  }

  /// GET /me/usuals. [signedIn] false forgets them without asking.
  Future<void> loadUsuals({required bool signedIn}) async {
    if (!signedIn) {
      if (_usuals != null) {
        _usuals = null;
        _notify();
      }
      return;
    }
    if (_loadingUsuals) return;
    final session = _session;
    _loadingUsuals = true;
    try {
      final response = await _request('GET', '/me/usuals');
      if (session != _session) return;
      _usuals = UsualsData.tryParse(_data(response));
    } catch (_) {
      if (session != _session) return;
      _usuals = null;
    } finally {
      if (session == _session) {
        _loadingUsuals = false;
        _notify();
      }
    }
  }

  /// GET /me/referral. [signedIn] false forgets it without asking.
  Future<void> loadReferral({required bool signedIn}) async {
    if (!signedIn) {
      if (_referral != null) {
        _referral = null;
        _notify();
      }
      return;
    }
    if (_loadingReferral) return;
    final session = _session;
    _loadingReferral = true;
    _notify();
    try {
      final response = await _request('GET', '/me/referral');
      if (session != _session) return;
      _referral = ReferralInfo.tryParse(_data(response));
    } catch (_) {
      if (session != _session) return;
      // Keep what we had: a blip should not hide the code on screen.
    } finally {
      if (session == _session) {
        _loadingReferral = false;
        _notify();
      }
    }
  }

  /// GET /me/points. [signedIn] false forgets it without asking.
  Future<void> loadPoints({required bool signedIn}) async {
    if (!signedIn) {
      if (_points != null) {
        _points = null;
        _notify();
      }
      return;
    }
    if (_loadingPoints) return;
    final session = _session;
    _loadingPoints = true;
    _pointsFailed = false;
    _notify();
    try {
      final response = await _request('GET', '/me/points');
      if (session != _session) return;
      final parsed = PointsInfo.tryParse(_data(response));
      if (parsed == null) throw ApiException(500, 'Points were not returned by the server.');
      _points = parsed;
    } catch (_) {
      if (session != _session) return;
      _pointsFailed = true;
    } finally {
      if (session == _session) {
        _loadingPoints = false;
        _notify();
      }
    }
  }

  /// The customer's words for a refused code.
  static String referralRefusalMessage(Object error) {
    if (error is ApiException && error.code == 'VALIDATION_ERROR') {
      return "That doesn't look like a referral code. Check it and try again.";
    }
    return AppErrors.from(error).message;
  }

  /// POST /me/referral/apply. Never throws.
  Future<ReferralApplyOutcome> applyReferralCode(String rawCode) async {
    final code = normaliseReferralCode(rawCode);
    if (!referralCodePattern.hasMatch(code)) {
      return ReferralApplyOutcome(
        invalidCode: true,
        error: code.isEmpty ? 'Enter a code.' : "That doesn't look like a referral code. Check it and try again.",
      );
    }
    final session = _session;
    _applyingReferral = true;
    _notify();
    try {
      final response = await _request('POST', '/me/referral/apply', body: {'code': code});
      final data = _data(response);
      final name = data?['inviter_first_name']?.toString().trim();
      if (session == _session) {
        // The code is used up for this account: stop offering the field.
        final r = _referral;
        if (r != null) {
          _referral = ReferralInfo(
            enabled: r.enabled,
            code: r.code,
            reward: r.reward,
            invitedCount: r.invitedCount,
            rewardedCount: r.rewardedCount,
            credits: r.credits,
            referredBy: ReferredBy(firstName: name == null || name.isEmpty ? null : name, status: 'PENDING'),
            canApplyCode: false,
          );
        }
      }
      return ReferralApplyOutcome(ok: true, inviterFirstName: name == null || name.isEmpty ? null : name);
    } catch (e) {
      final status = e is ApiException ? e.statusCode : null;
      return ReferralApplyOutcome(error: referralRefusalMessage(e), statusCode: status);
    } finally {
      if (session == _session) {
        _applyingReferral = false;
        _notify();
      }
    }
  }

  bool _syncingPending = false;

  /// Applies a code kept from a shared link, once, after sign-in. Returns the
  /// success text to show, or null. A refusal (4xx) forgets the code
  /// quietly; a network failure keeps it for the next sign-in.
  Future<String?> applyPendingReferral() async {
    if (_syncingPending) return null;
    _syncingPending = true;
    try {
      final code = await _readPending();
      if (code == null) return null;
      final outcome = await applyReferralCode(code);
      if (outcome.ok || outcome.invalidCode || _isRefusal(outcome.statusCode)) {
        await _clearPending();
      }
      return outcome.ok ? outcome.successText : null;
    } catch (_) {
      return null;
    } finally {
      _syncingPending = false;
    }
  }

  // A real "no" from the server (the code is unknown, the customer's own,
  // already applied, not a new customer...). A timeout, a rate limit, an
  // expired login or a server fault might work next time.
  static bool _isRefusal(int? status) =>
      status != null && status >= 400 && status < 500 && !const {401, 408, 429, 499}.contains(status);

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
