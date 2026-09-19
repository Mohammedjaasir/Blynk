import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Infrastructure/HttpMethods/auth_response_parsing.dart';
import 'package:ecom/constants.dart';

export 'package:ecom/Infrastructure/HttpMethods/auth_response_parsing.dart'
    show AuthTokenPair, extractAuthTokens, extractUserJson;

class AuthProvider extends ChangeNotifier {
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
  bool get isAuthenticated => _accessToken != null && _accessToken!.isNotEmpty;
  bool get isLoading => _isLoading;
  bool get isRequestingOtp => _isRequestingOtp;
  bool get isVerifyingOtp => _isVerifyingOtp;
  String? get errorMessage => _errorMessage;

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  /// Request OTP for a given Sri Lankan phone number
  Future<bool> requestOtp(String phone) async {
    _isRequestingOtp = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final formattedPhone = formatToE164(phone);
      final response = await ApiService.requestMethods(
        methodType: 'POST',
        url: '/auth/otp/request',
        body: {'phone': formattedPhone},
      );

      if (response is Map && response['data'] is Map) {
        _lastDevOtp = response['data']['dev_otp']?.toString();
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

    try {
      final formattedPhone = formatToE164(phone);
      final response = await ApiService.requestMethods(
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
          _accessToken = pair.accessToken;
          _refreshToken = pair.refreshToken;

          await TokenStorage.saveTokens(
            accessToken: _accessToken!,
            refreshToken: _refreshToken!,
          );

          if (data['user'] != null) {
            _currentUser =
                UserModel.fromJson(data['user'] as Map<String, dynamic>);
            await TokenStorage.saveUserCache(_currentUser!.toJsonString());
          } else {
            await loadCurrentUser();
          }

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

  /// Refresh the access token using the stored refresh token
  Future<bool> refreshToken() async {
    final currentRefreshToken =
        _refreshToken ?? await TokenStorage.getRefreshToken();
    if (currentRefreshToken == null || currentRefreshToken.isEmpty) {
      await logout();
      return false;
    }

    try {
      final response = await ApiService.requestMethods(
        methodType: 'POST',
        url: '/auth/refresh',
        body: {'refresh_token': currentRefreshToken},
      );

      if (response is Map && response['data'] != null) {
        final data = response['data'] as Map<String, dynamic>;
        final pair = extractAuthTokens(data);

        if (pair.isComplete) {
          _accessToken = pair.accessToken;
          _refreshToken = pair.refreshToken;

          await TokenStorage.saveTokens(
            accessToken: _accessToken!,
            refreshToken: _refreshToken!,
          );

          notifyListeners();
          return true;
        }
      }
      await logout();
      return false;
    } catch (e) {
      await logout();
      return false;
    }
  }

  /// Fetch authenticated user profile
  Future<UserModel?> loadCurrentUser() async {
    if (!isAuthenticated) return null;

    try {
      final response = await ApiService.requestMethods(
        methodType: 'GET',
        url: '/auth/me',
      );

      if (response is Map && response['data'] != null) {
        final data = response['data'] as Map<String, dynamic>;
        final userJson = extractUserJson(data);
        if (userJson != null) {
          _currentUser = UserModel.fromJson(userJson);
          await TokenStorage.saveUserCache(_currentUser!.toJsonString());
          notifyListeners();
          return _currentUser;
        }
      }
      return _currentUser;
    } catch (e) {
      return _currentUser;
    }
  }

  /// Logout current user and clear stored credentials
  Future<void> logout() async {
    final tokenToRevoke = _refreshToken ?? await TokenStorage.getRefreshToken();

    if (tokenToRevoke != null && tokenToRevoke.isNotEmpty) {
      try {
        await ApiService.requestMethods(
          methodType: 'POST',
          url: '/auth/logout',
          body: {'refresh_token': tokenToRevoke},
        );
      } catch (_) {}
    }

    _accessToken = null;
    _refreshToken = null;
    _currentUser = null;
    _errorMessage = null;

    await TokenStorage.clearAll();
    notifyListeners();
  }

  /// Check stored credentials and restore user session on startup
  Future<bool> restoreSession() async {
    _setLoading(true);

    try {
      final savedAccessToken = await TokenStorage.getAccessToken();
      final savedRefreshToken = await TokenStorage.getRefreshToken();
      final cachedUserJson = await TokenStorage.getUserCache();

      if (cachedUserJson != null && cachedUserJson.isNotEmpty) {
        try {
          _currentUser = UserModel.fromJsonString(cachedUserJson);
        } catch (_) {}
      }

      if (savedRefreshToken != null && savedRefreshToken.isNotEmpty) {
        _accessToken = savedAccessToken;
        _refreshToken = savedRefreshToken;

        try {
          final user = await loadCurrentUser();
          if (user != null) {
            _setLoading(false);
            return true;
          }
        } catch (_) {
          final refreshed = await refreshToken();
          if (refreshed) {
            await loadCurrentUser();
            _setLoading(false);
            return true;
          }
        }
      }

      _accessToken = null;
      _refreshToken = null;
      _currentUser = null;
      await TokenStorage.clearAll();
      _setLoading(false);
      return false;
    } catch (e) {
      _accessToken = null;
      _refreshToken = null;
      _currentUser = null;
      await TokenStorage.clearAll();
      _setLoading(false);
      return false;
    }
  }

  /// Backward compatible token reader
  Future<void> getAuthToken() async {
    _accessToken = await TokenStorage.getAccessToken();
    _refreshToken = await TokenStorage.getRefreshToken();
    notifyListeners();
  }

  static AuthProvider of(BuildContext context) =>
      Provider.of<AuthProvider>(context, listen: false);
}
