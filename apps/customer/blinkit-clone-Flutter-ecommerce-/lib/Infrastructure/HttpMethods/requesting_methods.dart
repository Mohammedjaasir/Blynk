import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;

import 'package:ecom/Infrastructure/HttpMethods/auth_response_parsing.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/app_config.dart';

String getApiBaseUrl() => AppConfig.current().apiBaseUrl;

var kdioBaseOptions = BaseOptions(
  baseUrl: getApiBaseUrl(),
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 15),
  sendTimeout: const Duration(seconds: 15),
  contentType: Headers.jsonContentType,
  responseType: ResponseType.json,
);

class _RefreshOutcome {
  const _RefreshOutcome({this.accessToken});
  final String? accessToken;
}

class ApiService {
  static Dio? _instance;

  static Dio get dio {
    _instance ??= _createDio();
    return _instance!;
  }

  static void resetDio() {
    _instance = null;
  }

  static final StreamController<void> _sessionRejected =
      StreamController<void>.broadcast();

  /// Fires when the server definitively rejected the stored refresh token
  /// (the login is over, not just unreachable). The app root listens once and
  /// signs the customer out; nothing else should.
  static Stream<void> get sessionRejected => _sessionRejected.stream;

  @visibleForTesting
  static void reportSessionRejected() => _sessionRejected.add(null);

  static int _sessionEpoch = 0;

  /// Bumped every time a session ends (logout, forced end, a rejected refresh
  /// token). A token refresh remembers the epoch it started in and throws its
  /// result away if the epoch moved, so a slow refresh can never bring a
  /// finished session back to life.
  static int get sessionEpoch => _sessionEpoch;

  static void invalidateSession() => _sessionEpoch++;

  static Future<_RefreshOutcome>? _refreshInFlight;
  static int _refreshInFlightEpoch = -1;

  /// One refresh at a time per session: refresh tokens rotate, so two parallel
  /// 401s refreshing with the same token would make the second one look
  /// rejected. A refresh left over from an ended session is never joined.
  static Future<_RefreshOutcome> _refreshTokens(String baseUrl) {
    final epoch = _sessionEpoch;
    if (_refreshInFlight != null && _refreshInFlightEpoch == epoch) {
      return _refreshInFlight!;
    }
    late final Future<_RefreshOutcome> flight;
    flight = _refreshOnce(baseUrl, epoch).whenComplete(() {
      if (identical(_refreshInFlight, flight)) _refreshInFlight = null;
    });
    _refreshInFlight = flight;
    _refreshInFlightEpoch = epoch;
    return flight;
  }

  /// Renews the access token for a request made outside Dio (the web
  /// build's fetch()-based location stream), through the same shared,
  /// one-at-a-time refresh the interceptor uses, so the rotating refresh
  /// token is never spent twice. Null when there is no session, the refresh
  /// failed, or the session ended meanwhile.
  static Future<String?> refreshAccessToken() async {
    final epoch = _sessionEpoch;
    final outcome = await _refreshTokens(getApiBaseUrl());
    return epoch == _sessionEpoch ? outcome.accessToken : null;
  }

  static Dio _plainDio(String baseUrl) => Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
          contentType: Headers.jsonContentType,
          responseType: ResponseType.json,
        ),
      );

  static Future<_RefreshOutcome> _refreshOnce(String baseUrl, int epoch) async {
    final refreshToken = await TokenStorage.getRefreshToken();
    // No refresh token = a guest's request: nothing to end, nothing to renew.
    if (refreshToken == null || refreshToken.isEmpty) {
      return const _RefreshOutcome();
    }
    // The read can straddle a logout + login: never spend the new customer's
    // rotating token on the old customer's refresh.
    if (epoch != _sessionEpoch) return const _RefreshOutcome();
    try {
      final response = await _plainDio(baseUrl)
          .post('/auth/refresh', data: {'refresh_token': refreshToken});

      final data = response.data is Map ? response.data['data'] : null;
      final pair =
          extractAuthTokens(data is Map<String, dynamic> ? data : const {});
      if (response.statusCode == 200 && pair.isComplete) {
        final wrote = await TokenStorage.saveTokensIf(
          stillValid: () => epoch == _sessionEpoch,
          accessToken: pair.accessToken!,
          refreshToken: pair.refreshToken!,
        );
        if (wrote) return _RefreshOutcome(accessToken: pair.accessToken);
        // The customer logged out while this was in flight. The server has
        // already rotated the token, so revoke the new one; nothing is kept.
        unawaited(_revokeQuietly(baseUrl, pair.refreshToken!));
      }
      return const _RefreshOutcome();
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if ((status == 401 || status == 403) && epoch == _sessionEpoch) {
        _sessionEpoch++;
        await TokenStorage.clearAll();
        _sessionRejected.add(null);
      }
      // Offline, timeout or a 5xx: the session is unchanged.
      return const _RefreshOutcome();
    } catch (_) {
      return const _RefreshOutcome();
    }
  }

  static Future<void> _revokeQuietly(String baseUrl, String refreshToken) async {
    try {
      await _plainDio(baseUrl)
          .post('/auth/logout', data: {'refresh_token': refreshToken});
    } catch (_) {}
  }

  static Dio _createDio() {
    final baseUrl = getApiBaseUrl();
    final dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        sendTimeout: const Duration(seconds: 15),
        contentType: Headers.jsonContentType,
        responseType: ResponseType.json,
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // If already has authorization header, preserve it
          if (!options.headers.containsKey('Authorization')) {
            final token = await TokenStorage.getAccessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          return handler.next(options);
        },
        onError: (DioException error, handler) async {
          final requestOptions = error.requestOptions;
          final path = requestOptions.path;

          final isAuthEndpoint = path.contains('/auth/otp/') ||
              path.contains('/auth/refresh') ||
              path.contains('/auth/logout');

          // A 401 on a normal request: refresh once and retry. Refreshes are
          // shared (see _refreshTokens) and only a rejected refresh token ends
          // the session - an offline or failing refresh keeps it.
          if (error.response?.statusCode == 401 &&
              !isAuthEndpoint &&
              requestOptions.extra['_retry'] != true) {
            requestOptions.extra['_retry'] = true;

            final epoch = _sessionEpoch;
            final outcome = await _refreshTokens(baseUrl);
            // A session that ended while waiting must not retry with anyone's
            // token: the request just fails as unauthorised.
            if (outcome.accessToken != null && epoch == _sessionEpoch) {
              requestOptions.headers['Authorization'] =
                  'Bearer ${outcome.accessToken}';
              try {
                return handler.resolve(await dio.fetch(requestOptions));
              } on DioException catch (retryError) {
                return handler.next(retryError);
              }
            }
          }

          return handler.next(error);
        },
      ),
    );

    return dio;
  }

  static ApiException handleError(dynamic error) {
    if (error is ApiException) {
      return error;
    }

    if (error is DioException) {
      final statusCode = error.response?.statusCode ?? 500;
      final responseData = error.response?.data;

      String message = _genericMessage;
      String? code;
      Map<String, dynamic>? details;

      if (responseData is Map) {
        if (responseData['error'] is Map) {
          final errObj = responseData['error'] as Map;
          message = (errObj['message'] ?? errObj['msg'] ?? message).toString();
          code = errObj['code']?.toString();
          final rawDetails = errObj['details'];
          if (rawDetails is Map) details = rawDetails.cast<String, dynamic>();
        } else if (responseData['message'] != null) {
          message = responseData['message'].toString();
        } else if (responseData['error'] is String) {
          message = responseData['error'].toString();
        }
      }

      switch (error.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return ApiException(
            408,
            'That took too long. Try again.',
            code: 'TIMEOUT',
          );
        case DioExceptionType.connectionError:
          return ApiException(
            503,
            "We couldn't reach Blynk. Check your connection and try again.",
            code: 'NETWORK_ERROR',
          );
        case DioExceptionType.badResponse:
          if (statusCode == 401) {
            return ApiException(
              401,
              message.isNotEmpty && message != _genericMessage
                  ? message
                  : 'Log in to continue.',
              code: code ?? 'UNAUTHORIZED',
            );
          } else if (statusCode == 403) {
            return ApiException(
              403,
              message.isNotEmpty && message != _genericMessage
                  ? message
                  : "This account can't do that.",
              code: code ?? 'FORBIDDEN',
            );
          } else if (statusCode == 404) {
            return ApiException(
              404,
              message.isNotEmpty && message != _genericMessage
                  ? message
                  : "We couldn't find that.",
              code: code ?? 'NOT_FOUND',
            );
          } else if (statusCode == 429) {
            return ApiException(
              429,
              'Too many tries. Wait a moment, then try again.',
              code: code ?? 'RATE_LIMITED',
            );
          }
          return ApiException(statusCode, _safeMessage(statusCode, message), code: code, details: details);
        case DioExceptionType.cancel:
          return ApiException(499, 'The request was cancelled.', code: 'CANCELLED');
        default:
          return ApiException(statusCode, _safeMessage(statusCode, message), code: code);
      }
    }

    // Whatever this was, its text is for developers: never carried in a message.
    return ApiException(500, _genericMessage);
  }

  static const String _genericMessage = 'Something went wrong. Try again.';

  /// A backend failure (5xx) says nothing a customer can act on, so its body
  /// text is replaced; a 4xx refusal keeps the backend's own message.
  static String _safeMessage(int statusCode, String message) => statusCode >= 500
      ? 'Something went wrong on our side. Try again in a moment.'
      : message;

  /// Told about every finished request: null on a response, the mapped
  /// [ApiException] on a failure. The app's connectivity hint listens here, so
  /// nothing about the connection is guessed from anything else.
  static void Function(ApiException? error)? networkObserver;

  static void _observe(ApiException? error) {
    try {
      networkObserver?.call(error);
    } catch (_) {}
  }

  static Future<dynamic> requestMethods({
    String? methodType,
    String? url,
    dynamic body,
    Map<String, dynamic>? queryParameters,
    Map<String, dynamic>? headers,
  }) async {
    if (url == null || url.trim().isEmpty) {
      throw ApiException(400, 'URL is required', code: 'INVALID_URL');
    }

    final upperMethod = (methodType ?? 'GET').toUpperCase();

    try {
      Response response;
      final options = Options(
        method: upperMethod,
        headers: headers,
      );

      switch (upperMethod) {
        case 'GET':
          response = await dio.get(
            url,
            queryParameters: queryParameters,
            options: options,
          );
          break;
        case 'POST':
          response = await dio.post(
            url,
            data: body,
            queryParameters: queryParameters,
            options: options,
          );
          break;
        case 'PUT':
          response = await dio.put(
            url,
            data: body,
            queryParameters: queryParameters,
            options: options,
          );
          break;
        case 'PATCH':
          response = await dio.patch(
            url,
            data: body,
            queryParameters: queryParameters,
            options: options,
          );
          break;
        case 'DELETE':
          response = await dio.delete(
            url,
            data: body,
            queryParameters: queryParameters,
            options: options,
          );
          break;
        default:
          throw ApiException(
            400,
            'Invalid HTTP method type: $methodType',
            code: 'INVALID_METHOD',
          );
      }

      _observe(null);
      return response.data;
    } catch (e) {
      final mapped = handleError(e);
      _observe(mapped);
      throw mapped;
    }
  }
}
