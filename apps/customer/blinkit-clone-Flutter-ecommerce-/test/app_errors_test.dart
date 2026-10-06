import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/app_errors.dart';

const _forbidden = ['server', 'api', 'localhost', 'exception', 'stack', 'dioexception', 'null'];

void _expectCustomerSafe(CustomerError e, {String? reason}) {
  for (final text in [e.title, e.message]) {
    final lower = text.toLowerCase();
    for (final word in _forbidden) {
      expect(lower.contains(word), isFalse, reason: '"$text" contains "$word" ${reason ?? ''}');
    }
    expect(text.contains('!'), isFalse, reason: '"$text" has an exclamation mark');
    expect(text.trim(), isNotEmpty);
    expect(RegExp(r'\d{3}').hasMatch(text), isFalse, reason: '"$text" shows a status code');
    expect(text.toLowerCase().contains('sorry'), isFalse, reason: '"$text" apologises');
    expect(text.toLowerCase().contains('oops'), isFalse);
  }
}

DioException _dio(DioExceptionType type, {int? status, Object? data}) {
  final options = RequestOptions(path: '/x');
  return DioException(
    requestOptions: options,
    type: type,
    response: status == null ? null : Response(requestOptions: options, statusCode: status, data: data),
  );
}

void main() {
  group('AppErrors.from: every kind', () {
    test('offline: a connection error', () {
      final e = AppErrors.from(ApiException(503, 'x', code: 'NETWORK_ERROR'));
      expect(e.kind, CustomerErrorKind.offline);
      expect(e.message, "We couldn't reach Blynk. Check your connection and try again.");
      expect(e.retryable, isTrue);
      expect(e.isOffline, isTrue);
    });

    test('timeout', () {
      final e = AppErrors.from(ApiException(408, 'x', code: 'TIMEOUT'));
      expect(e.kind, CustomerErrorKind.timeout);
      expect(e.message, 'That took too long. Try again.');
      expect(e.retryable, isTrue);
    });

    test('unauthorized', () {
      final e = AppErrors.from(ApiException(401, 'jwt malformed', code: 'UNAUTHORIZED'));
      expect(e.kind, CustomerErrorKind.unauthorized);
      expect(e.message, 'Log in to continue.');
      expect(e.retryable, isFalse);
      expect(e.needsLogin, isTrue);
    });

    test('forbidden is unauthorized without a log-in prompt', () {
      final e = AppErrors.from(ApiException(403, 'nope'));
      expect(e.kind, CustomerErrorKind.unauthorized);
      expect(e.needsLogin, isFalse);
    });

    test('not found', () {
      final e = AppErrors.from(ApiException(404, 'Order not found.', code: 'ORDER_NOT_FOUND'));
      expect(e.kind, CustomerErrorKind.notFound);
      expect(e.message, "We couldn't find that.");
      expect(e.retryable, isFalse);
    });

    test('validation: an unlisted 400 or 422 gets generic copy', () {
      for (final status in [400, 422]) {
        final e = AppErrors.from(ApiException(status, 'body.phone must match pattern', code: 'VALIDATION_ERROR'));
        expect(e.kind, CustomerErrorKind.validation);
        expect(e.message, 'Check the details you entered and try again.');
        expect(e.retryable, isFalse);
      }
    });

    test('server: any 5xx', () {
      for (final status in [500, 502, 503, 504]) {
        final e = AppErrors.from(ApiException(status, 'relation "products" does not exist'));
        expect(e.kind, CustomerErrorKind.server, reason: '$status');
        expect(e.message, 'Something went wrong on our side. Try again in a moment.');
        expect(e.retryable, isTrue);
      }
    });

    test('unknown: anything else', () {
      for (final thing in <Object?>[
        StateError('boom'),
        const FormatException('bad'),
        'a string',
        null,
        ApiException(499, 'x', code: 'CANCELLED'),
        ApiException(409, 'x'),
      ]) {
        final e = AppErrors.from(thing);
        expect(e.kind, CustomerErrorKind.unknown, reason: '$thing');
        expect(e.message, 'Something went wrong. Try again.');
      }
    });

    test('the raw exception text never appears in the copy', () {
      const secret = 'ECONNREFUSED 127.0.0.1:5432 secret-stack-frame';
      for (final e in <Object>[
        ApiException(500, secret),
        ApiException(400, secret),
        ApiException(401, secret),
        StateError(secret),
        Exception(secret),
      ]) {
        final mapped = AppErrors.from(e);
        expect(mapped.title, isNot(contains('ECONN')));
        expect(mapped.message, isNot(contains('ECONN')));
        expect(mapped.message, isNot(contains('secret')));
      }
    });
  });

  group('AppErrors.from: transport errors', () {
    test('Dio connection error is offline; timeouts are timeouts', () {
      expect(AppErrors.from(_dio(DioExceptionType.connectionError)).kind, CustomerErrorKind.offline);
      for (final t in [
        DioExceptionType.connectionTimeout,
        DioExceptionType.sendTimeout,
        DioExceptionType.receiveTimeout,
      ]) {
        expect(AppErrors.from(_dio(t)).kind, CustomerErrorKind.timeout, reason: '$t');
      }
    });

    test('Dio bad responses map by status', () {
      expect(AppErrors.from(_dio(DioExceptionType.badResponse, status: 500)).kind, CustomerErrorKind.server);
      expect(AppErrors.from(_dio(DioExceptionType.badResponse, status: 404)).kind, CustomerErrorKind.notFound);
      expect(AppErrors.from(_dio(DioExceptionType.badResponse, status: 401)).kind, CustomerErrorKind.unauthorized);
    });

    test('a Dio 5xx is never classified as offline', () {
      final e = AppErrors.from(_dio(DioExceptionType.badResponse, status: 503));
      expect(e.kind, CustomerErrorKind.server);
      expect(e.isOffline, isFalse);
    });

    test('dart:async TimeoutException and SocketException', () {
      expect(AppErrors.from(TimeoutException('x')).kind, CustomerErrorKind.timeout);
      expect(AppErrors.from(const SocketException('x')).kind, CustomerErrorKind.offline);
    });

    test('a CustomerError maps to itself', () {
      expect(identical(AppErrors.from(AppErrors.offline), AppErrors.offline), isTrue);
    });
  });

  group('the code allow-list (backend refusals a customer can act on)', () {
    const expectations = {
      'INVALID_OTP': "That code isn't right. Check it and try again.",
      'OTP_EXPIRED': 'That code has expired. Request a new one.',
      'OTP_MAX_ATTEMPTS_EXCEEDED': 'Too many wrong codes. Request a new one.',
      'DELIVERY_OUTSIDE_RADIUS': "We don't deliver to this address yet. Choose another address.",
      'STORE_CLOSED': 'We take orders 8 AM – 9 PM. Please order again after 8 AM.',
      'ADDRESS_NOT_FOUND': "We couldn't find that address. Choose another one.",
      'PRODUCT_UNAVAILABLE': "An item in your cart isn't available right now. Remove it and try again.",
      'TOO_MANY_REQUESTS': 'Too many tries. Wait a moment, then try again.',
    };

    for (final entry in expectations.entries) {
      test('${entry.key} shows this app\'s copy, not the backend text', () {
        final e = AppErrors.from(ApiException(401, 'Invalid OTP code. 2 attempt(s) remaining.', code: entry.key));
        expect(e.message, entry.value);
      });
    }

    test('an invalid OTP is a validation error even though the backend sends 401', () {
      final e = AppErrors.from(ApiException(401, 'Invalid OTP code', code: 'INVALID_OTP'));
      expect(e.kind, CustomerErrorKind.validation);
      expect(e.needsLogin, isFalse);
    });

    test('an unlisted code falls back to its status, never to its text', () {
      final e = AppErrors.from(ApiException(400, 'Some developer sentence', code: 'SOMETHING_NEW'));
      expect(e.message, 'Check the details you entered and try again.');
    });
  });

  group('every string is customer-safe', () {
    final all = <String, CustomerError>{
      'offline': AppErrors.offline,
      'timeout': AppErrors.timeout,
      'unauthorized': AppErrors.unauthorized,
      'forbidden': AppErrors.forbidden,
      'notFound': AppErrors.notFound,
      'validation': AppErrors.validation,
      'server': AppErrors.server,
      'tooManyTries': AppErrors.tooManyTries,
      'unknown': AppErrors.unknown,
      for (final code in [
        'INVALID_OTP',
        'OTP_EXPIRED',
        'OTP_MAX_ATTEMPTS_EXCEEDED',
        'ACCOUNT_DEACTIVATED',
        'DELIVERY_OUTSIDE_RADIUS',
        'STORE_CLOSED',
        'ADDRESS_NOT_FOUND',
        'PRODUCT_UNAVAILABLE',
        'PRODUCT_NOT_FOUND',
        'TOO_MANY_REQUESTS',
        'RATE_LIMITED',
      ])
        code: AppErrors.from(ApiException(400, 'x', code: code)),
    };

    for (final entry in all.entries) {
      test(entry.key, () => _expectCustomerSafe(entry.value));
    }

    test('all seven kinds are covered by the constants above', () {
      expect(all.values.map((e) => e.kind).toSet(), CustomerErrorKind.values.toSet());
    });
  });

  group('ApiService.handleError messages are customer-safe too', () {
    test('no developer wording remains in the client-generated messages', () {
      final messages = <String>[
        ApiService.handleError(_dio(DioExceptionType.connectionTimeout)).message,
        ApiService.handleError(_dio(DioExceptionType.connectionError)).message,
        ApiService.handleError(_dio(DioExceptionType.cancel)).message,
        ApiService.handleError(_dio(DioExceptionType.badResponse, status: 401)).message,
        ApiService.handleError(_dio(DioExceptionType.badResponse, status: 403)).message,
        ApiService.handleError(_dio(DioExceptionType.badResponse, status: 404)).message,
        ApiService.handleError(_dio(DioExceptionType.badResponse, status: 429)).message,
        ApiService.handleError(_dio(DioExceptionType.badResponse, status: 500, data: {'message': 'ECONNREFUSED 5432'})).message,
        ApiService.handleError(StateError('secret internals')).message,
      ];
      for (final m in messages) {
        final lower = m.toLowerCase();
        expect(lower.contains('server is running'), isFalse, reason: m);
        expect(lower.contains('econn'), isFalse, reason: m);
        expect(lower.contains('secret'), isFalse, reason: m);
        expect(lower.contains('verify'), isFalse, reason: m);
        expect(lower.contains('localhost'), isFalse, reason: m);
      }
    });

    test('a 5xx keeps its status and code but not its body text', () {
      final e = ApiService.handleError(
        _dio(DioExceptionType.badResponse, status: 500, data: {
          'error': {'message': 'relation "users" does not exist', 'code': 'INTERNAL_SERVER_ERROR'},
        }),
      );
      expect(e.statusCode, 500);
      expect(e.code, 'INTERNAL_SERVER_ERROR');
      expect(e.message, isNot(contains('relation')));
    });

    test('a 4xx refusal keeps the backend code the allow-list needs', () {
      final e = ApiService.handleError(
        _dio(DioExceptionType.badResponse, status: 401, data: {
          'error': {'message': 'Invalid OTP code. 2 attempt(s) remaining.', 'code': 'INVALID_OTP'},
        }),
      );
      expect(e.code, 'INVALID_OTP');
      expect(AppErrors.from(e).message, "That code isn't right. Check it and try again.");
    });
  });

  test('no file in lib/ still says "verify the server"', () {
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      expect(f.readAsStringSync().toLowerCase().contains('verify the server'), isFalse, reason: f.path);
    }
  });
}
