import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:ecom/Infrastructure/HttpMethods/auth_response_parsing.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';

String getApiBaseUrl() {
  final envUrl = dotenv.env['API_BASE_URL'];
  if (envUrl != null && envUrl.trim().isNotEmpty) {
    return envUrl.trim();
  }
  return 'http://localhost:4000/api/v1';
}

var kdioBaseOptions = BaseOptions(
  baseUrl: getApiBaseUrl(),
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 15),
  sendTimeout: const Duration(seconds: 15),
  contentType: Headers.jsonContentType,
  responseType: ResponseType.json,
);

class ApiService {
  static Dio? _instance;

  static Dio get dio {
    _instance ??= _createDio();
    return _instance!;
  }

  static void resetDio() {
    _instance = null;
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

          // Handle 401 Unauthorized by attempting token refresh once
          if (error.response?.statusCode == 401 &&
              !isAuthEndpoint &&
              requestOptions.extra['_retry'] != true) {
            requestOptions.extra['_retry'] = true;

            try {
              final refreshToken = await TokenStorage.getRefreshToken();
              if (refreshToken != null && refreshToken.isNotEmpty) {
                final refreshDio = Dio(
                  BaseOptions(
                    baseUrl: baseUrl,
                    connectTimeout: const Duration(seconds: 15),
                    receiveTimeout: const Duration(seconds: 15),
                    contentType: Headers.jsonContentType,
                    responseType: ResponseType.json,
                  ),
                );

                final refreshResponse = await refreshDio.post(
                  '/auth/refresh',
                  data: {'refresh_token': refreshToken},
                );

                if (refreshResponse.statusCode == 200 &&
                    refreshResponse.data != null) {
                  final data = refreshResponse.data['data']
                      as Map<String, dynamic>?;
                  final pair = extractAuthTokens(data ?? const {});

                  if (pair.isComplete) {
                    await TokenStorage.saveTokens(
                      accessToken: pair.accessToken!,
                      refreshToken: pair.refreshToken!,
                    );

                    // Update headers and retry the original request
                    requestOptions.headers['Authorization'] =
                        'Bearer ${pair.accessToken}';

                    final retryResponse = await dio.fetch(requestOptions);
                    return handler.resolve(retryResponse);
                  }
                }
              }
            } catch (refreshError) {
              // Token refresh failed -> clear local tokens to force fresh login
              await TokenStorage.clearAll();
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

      String message = 'An unexpected error occurred. Please try again.';
      String? code;

      if (responseData is Map) {
        if (responseData['error'] is Map) {
          final errObj = responseData['error'] as Map;
          message = (errObj['message'] ?? errObj['msg'] ?? message).toString();
          code = errObj['code']?.toString();
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
            'Connection timed out. Please check your internet connection.',
            code: 'TIMEOUT',
          );
        case DioExceptionType.connectionError:
          return ApiException(
            503,
            'Unable to connect to the server. Please verify the server is running.',
            code: 'NETWORK_ERROR',
          );
        case DioExceptionType.badResponse:
          if (statusCode == 401) {
            return ApiException(
              401,
              message.isNotEmpty && message != 'An unexpected error occurred. Please try again.'
                  ? message
                  : 'Session expired or unauthorized. Please log in again.',
              code: code ?? 'UNAUTHORIZED',
            );
          } else if (statusCode == 403) {
            return ApiException(
              403,
              message.isNotEmpty && message != 'An unexpected error occurred. Please try again.'
                  ? message
                  : 'Access forbidden.',
              code: code ?? 'FORBIDDEN',
            );
          } else if (statusCode == 404) {
            return ApiException(
              404,
              message.isNotEmpty && message != 'An unexpected error occurred. Please try again.'
                  ? message
                  : 'Resource not found.',
              code: code ?? 'NOT_FOUND',
            );
          } else if (statusCode == 429) {
            return ApiException(
              429,
              'Too many attempts. Please wait a moment before trying again.',
              code: code ?? 'RATE_LIMITED',
            );
          }
          return ApiException(statusCode, message, code: code);
        case DioExceptionType.cancel:
          return ApiException(499, 'Request was cancelled', code: 'CANCELLED');
        default:
          return ApiException(statusCode, message, code: code);
      }
    }

    return ApiException(500, error.toString());
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

      return response.data;
    } catch (e) {
      throw handleError(e);
    }
  }
}
