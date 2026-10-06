import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/Infrastructure/HttpMethods/auth_response_parsing.dart';
import 'package:ecom/constants.dart';

export 'package:ecom/Infrastructure/HttpMethods/auth_response_parsing.dart'
    show AuthTokenPair, extractAuthTokens, extractUserJson;

/// A request against the auth API. Defaults to the app's ApiService;
/// injectable so tests can replay offline / rejected / accepted answers.
typedef AuthRequest = Future<dynamic> Function({
  String? methodType,
  String? url,
  dynamic body,
});

/// Why a signed-in session ended without the customer asking for it.
enum SessionEndReason { rejected }

class AuthProvider extends ChangeNotifier {
  AuthProvider({AuthRequest? request})
      : _request = request ?? ApiService.requestMethods;

  final AuthRequest _request;

  final StreamController<SessionEndReason> _sessionEnded =
      StreamController<SessionEndReason>.broadcast();
  Future<bool>? _restoreFuture;
  bool _hasRestored = false;

  String? _accessToken;
  String? _refreshToken;
  UserModel? _currentUser;
  bool _isLoading = false;
  bool _isRequestingOtp = false;
  bool _isVerifyingOtp = false;
  String? _errorMessage;
  String? _lastDevOtp;

  // Getters
  String? get authToken => _accessToken;
  String? get accessToken => _accessToken;
  String? get rawRefreshToken => _refreshToken;
  String? get lastDevOtp => _lastDevOtp;
  UserModel? get currentUser => _currentUser;

  /// Signed in = holds a credential. A restored session may have only the
  /// refresh token (the HTTP interceptor renews the access token on first use).
  bool get isAuthenticated => _has(_accessToken) || _has(_refreshToken);

  /// True once the local session decision has been made (no network needed).
  bool get hasRestored => _hasRestored;

  /// Fires when a session ends without the customer asking (the server
  /// rejected the refresh token). Wired once, at the app root.
  Stream<SessionEndReason> get onSessionEnded => _sessionEnded.stream;

  bool get isLoading => _isLoading;
  bool get isRequestingOtp => _isRequestingOtp;
  bool get isVerifyingOtp => _isVerifyingOtp;
  String? get errorMessage => _errorMessage;

  static bool _has(String? token) => token != null && token.isNotEmpty;

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  /// Request OTP for a given Sri Lankan phone number
  Future<bool> requestOtp(String phone) async {
    _isRequestingOtp = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final formattedPhone = formatToE164(phone);
      final response = await _request(
        methodType: 'POST',
        url: '/auth/otp/request',
        body: {'phone': formattedPhone},
      );

      if (response is Map && response['data'] is Map) {
        // The dev code is a debug-build aid only; a release build ignores it.
        _lastDevOtp = kDebugMode ? response['data']['dev_otp']?.toString() : null;
      }

      final success = response is Map &&
          (response['success'] == true || response['message'] != null);
      _isRequestingOtp = false;
      notifyListeners();
      return success;
    } catch (e) {
      _isRequestingOtp = false;
      _errorMessage = e is ApiException ? e.message : e.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// Verify OTP and store tokens securely
  Future<bool> verifyOtp(String phone, String otp) async {
    _isVerifyingOtp = true;
    _errorMessage = null;
    notifyListeners();

    // A session end while this request is on the wire (or any other change of
    // session) discards the answer instead of signing anyone in with it.
    final epoch = ApiService.sessionEpoch;
    bool stale() => epoch != ApiService.sessionEpoch;
    final interrupted = ApiException(409, 'Your login was interrupted. Please try again.');

    try {
      final formattedPhone = formatToE164(phone);
      final response = await _request(
        methodType: 'POST',
        url: '/auth/otp/verify',
        body: {
          'phone': formattedPhone,
          'otp': otp.trim(),
        },
      );

      if (response is Map && response['data'] != null) {
        final data = response['data'] as Map<String, dynamic>;
        final pair = extractAuthTokens(data);

        if (pair.isComplete) {
          final wrote = await TokenStorage.saveTokensIf(
            stillValid: () => !stale(),
            accessToken: pair.accessToken!,
            refreshToken: pair.refreshToken!,
          );
          // Checked again with no await before memory is touched.
          if (!wrote || stale()) throw interrupted;
          _accessToken = pair.accessToken;
          _refreshToken = pair.refreshToken;

          if (data['user'] != null) {
            final user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
            final cached = await TokenStorage.saveUserCacheIf(
              stillValid: () => !stale(),
              userJson: user.toJsonString(),
            );
            if (cached && !stale()) _currentUser = user;
          } else {
            await loadCurrentUser();
          }
          if (stale()) throw interrupted;

          _isVerifyingOtp = false;
          _errorMessage = null;
          notifyListeners();
          return true;
        }
      }

      throw ApiException(400, 'Invalid response from authentication server');
    } catch (e) {
      _isVerifyingOtp = false;
      _errorMessage = e is ApiException ? e.message : e.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// Refresh the access token using the stored refresh token. Only a token the
  /// server rejects ends the session; being offline or a server error just
  /// returns false and leaves the customer signed in.
  Future<bool> refreshToken() async {
    // Storage first: the HTTP interceptor rotates the pair there.
    final epoch = ApiService.sessionEpoch;
    final current = await TokenStorage.getRefreshToken() ?? _refreshToken;
    // The read can straddle a logout + login: never refresh with the new
    // customer's rotating token on the old customer's behalf.
    if (epoch != ApiService.sessionEpoch) return false;
    if (!_has(current)) {
      await endSession();
      return false;
    }

    try {
      final response = await _request(
        methodType: 'POST',
        url: '/auth/refresh',
        body: {'refresh_token': current},
      );

      if (response is Map && response['data'] != null) {
        final data = response['data'] as Map<String, dynamic>;
        final pair = extractAuthTokens(data);

        if (pair.isComplete) {
          // A logout / session end while this was in flight discards it.
          final wrote = await TokenStorage.saveTokensIf(
            stillValid: () => epoch == ApiService.sessionEpoch,
            accessToken: pair.accessToken!,
            refreshToken: pair.refreshToken!,
          );
          if (!wrote) return false;
          _accessToken = pair.accessToken;
          _refreshToken = pair.refreshToken;

          notifyListeners();
          return true;
        }
      }
      return false;
    } catch (e) {
      if (e is ApiException &&
          (e.statusCode == 401 || e.statusCode == 403) &&
          epoch == ApiService.sessionEpoch) {
        await endSession();
      }
      return false;
    }
  }

  /// Fetch authenticated user profile
  Future<UserModel?> loadCurrentUser() async {
    if (!isAuthenticated) return null;
    try {
      await _fetchAndCacheUser();
    } catch (_) {}
    return _currentUser;
  }

  /// Logout: local state and stored credentials are cleared first (so the
  /// customer is signed out at once, even offline); revoking the refresh
  /// token on the server is best effort.
  Future<void> logout() async {
    // Bump first, synchronously: any refresh still in flight now discards its
    // result instead of writing tokens back after the clear below.
    ApiService.invalidateSession();
    final memoryToken = _refreshToken;
    _clearSession();
    notifyListeners();
    // Reads the token that is current in storage (the interceptor may have
    // rotated it) and clears in one step.
    final stored = await TokenStorage.takeRefreshTokenAndClearAll();
    _restoreFuture = null;
    notifyListeners();

    final tokenToRevoke = _has(stored) ? stored : memoryToken;
    if (_has(tokenToRevoke)) {
      unawaited(
        _request(
          methodType: 'POST',
          url: '/auth/logout',
          body: {'refresh_token': tokenToRevoke},
        ).then<void>((_) {}, onError: (_) {}),
      );
    }
  }

  /// DELETE /me: deletes (anonymises) the customer's account. Returns null
  /// once the server has done it, and then signs out on this device exactly
  /// like [logout] does locally - there is no server logout to make, the
  /// account and its sessions are gone. On a refusal (409
  /// ACTIVE_ORDERS_EXIST: an order is still open) or a network failure the
  /// customer stays signed in and the mapped reason is returned.
  Future<CustomerError?> deleteAccount() async {
    try {
      await _request(methodType: 'DELETE', url: '/me');
    } catch (e) {
      return AppErrors.from(e);
    }
    ApiService.invalidateSession();
    _clearSession();
    notifyListeners();
    // Signed out in memory already; a stuck secure storage must not keep
    // the customer waiting on a deleted account (the clear carries on).
    await TokenStorage.clearAll().timeout(const Duration(seconds: 3), onTimeout: () {});
    _restoreFuture = null;
    notifyListeners();
    return null;
  }

  /// The server no longer accepts this login. Clears everything locally with
  /// no server call (the token is already dead) and tells the app root.
  /// A no-op when nothing was signed in, so racing detectors end it once.
  Future<void> endSession() async {
    final wasSignedIn = isAuthenticated;
    ApiService.invalidateSession();
    _clearSession();
    notifyListeners();
    // Local-first: the app root signs the customer out of the UI now; the
    // storage clear below must not delay that.
    if (wasSignedIn && !_sessionEnded.isClosed) {
      _sessionEnded.add(SessionEndReason.rejected);
    }
    await TokenStorage.clearAll();
    _restoreFuture = null;
    notifyListeners();
  }

  void _clearSession() {
    _accessToken = null;
    _refreshToken = null;
    _currentUser = null;
    _errorMessage = null;
    _lastDevOtp = null;
  }

  /// Local-first restore for app start: reads storage only. A stored refresh
  /// token means signed in, at once, whether or not the network is up; the
  /// answer is `true` and the session is re-checked in the background (see
  /// [_revalidate]). Safe to call more than once.
  Future<bool> restoreSession() => _restoreFuture ??= _restoreLocally();

  Future<bool> _restoreLocally() async {
    _isLoading = true;
    final epoch = ApiService.sessionEpoch;
    try {
      final savedAccessToken = await TokenStorage.getAccessToken();
      final savedRefreshToken = await TokenStorage.getRefreshToken();
      final cachedUserJson = await TokenStorage.getUserCache();

      // A logout / session end while storage was being read: what was read
      // belongs to a session that no longer exists. Apply none of it.
      if (epoch != ApiService.sessionEpoch) {
        _isLoading = false;
        _hasRestored = true;
        notifyListeners();
        return false;
      }

      if (_has(savedRefreshToken)) {
        _accessToken = savedAccessToken;
        _refreshToken = savedRefreshToken;
        if (_has(cachedUserJson)) {
          try {
            _currentUser = UserModel.fromJsonString(cachedUserJson!);
          } catch (_) {}
        }
        _isLoading = false;
        _hasRestored = true;
        notifyListeners();
        unawaited(_revalidate());
        return true;
      }

      // An access token without a refresh token cannot be renewed: not a session.
      ApiService.invalidateSession();
      _clearSession();
      await TokenStorage.clearAll();
    } catch (_) {
      _clearSession();
      await TokenStorage.clearAll();
    }
    _isLoading = false;
    _hasRestored = true;
    notifyListeners();
    return false;
  }

  /// Background check after a local restore. Never blocks the UI and never
  /// signs the customer out for being offline: only a refresh the server
  /// rejects does (via [refreshToken] here, or the HTTP interceptor).
  Future<void> _revalidate() async {
    try {
      await _fetchAndCacheUser();
    } on ApiException catch (e) {
      if (e.statusCode == 401 && await refreshToken()) {
        try {
          await _fetchAndCacheUser();
        } catch (_) {}
      }
    } catch (_) {}
  }

  /// GET /auth/me, applied only to the session it was asked for: if the
  /// session changed while the request was on the wire (logout, forced end,
  /// another login) the answer is dropped - no state, no cache write - so one
  /// customer's profile can never land in the next customer's session.
  Future<void> _fetchAndCacheUser() async {
    final epoch = ApiService.sessionEpoch;
    final response = await _request(methodType: 'GET', url: '/auth/me');
    if (epoch != ApiService.sessionEpoch) return;
    if (response is Map && response['data'] != null) {
      final userJson =
          extractUserJson(response['data'] as Map<String, dynamic>);
      if (userJson != null) {
        final user = UserModel.fromJson(userJson);
        final wrote = await TokenStorage.saveUserCacheIf(
          stillValid: () => epoch == ApiService.sessionEpoch,
          userJson: user.toJsonString(),
        );
        if (!wrote || epoch != ApiService.sessionEpoch) return;
        _currentUser = user;
        notifyListeners();
      }
    }
  }

  /// Backward compatible token reader
  Future<void> getAuthToken() async {
    final epoch = ApiService.sessionEpoch;
    final access = await TokenStorage.getAccessToken();
    final refresh = await TokenStorage.getRefreshToken();
    if (epoch != ApiService.sessionEpoch) return;
    _accessToken = access;
    _refreshToken = refresh;
    notifyListeners();
  }

  @override
  void dispose() {
    _sessionEnded.close();
    super.dispose();
  }

  static AuthProvider of(BuildContext context) =>
      Provider.of<AuthProvider>(context, listen: false);
}
