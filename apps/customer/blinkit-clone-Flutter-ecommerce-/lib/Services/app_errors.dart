import 'dart:async';
import 'dart:io' show SocketException;

import 'package:dio/dio.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';

/// What went wrong, in the words a customer needs. Never the exception text.
enum CustomerErrorKind {
  offline,
  timeout,
  unauthorized,
  notFound,
  validation,
  server,
  unknown,
}

/// A failure translated for display: a short [title], one sentence saying
/// what happened and what to do ([message]), and whether asking again can
/// help ([retryable]).
class CustomerError {
  const CustomerError({
    required this.kind,
    required this.title,
    required this.message,
    required this.retryable,
    this.needsLogin = false,
  });

  final CustomerErrorKind kind;
  final String title;
  final String message;
  final bool retryable;

  /// True when logging in (again) is the way forward.
  final bool needsLogin;

  bool get isOffline => kind == CustomerErrorKind.offline;
  bool get isTimeout => kind == CustomerErrorKind.timeout;
  bool get isNotFound => kind == CustomerErrorKind.notFound;

  @override
  String toString() => 'CustomerError(${kind.name})';
}

/// Pure mapper from anything thrown to a [CustomerError].
///
/// The exception's own message, status code and body are never shown: they
/// are for developers. The one exception is [_codeCopy], an allow-list keyed
/// on the backend's error `code` for refusals a customer can act on (a wrong
/// or expired OTP, an address outside the delivery zone); the words shown are
/// this file's, not the backend's.
class AppErrors {
  const AppErrors._();

  static const CustomerError offline = CustomerError(
    kind: CustomerErrorKind.offline,
    title: 'No connection',
    message: "We couldn't reach Blynk. Check your connection and try again.",
    retryable: true,
  );

  static const CustomerError timeout = CustomerError(
    kind: CustomerErrorKind.timeout,
    title: 'Taking too long',
    message: 'That took too long. Try again.',
    retryable: true,
  );

  static const CustomerError unauthorized = CustomerError(
    kind: CustomerErrorKind.unauthorized,
    title: 'Log in needed',
    message: 'Log in to continue.',
    retryable: false,
    needsLogin: true,
  );

  static const CustomerError forbidden = CustomerError(
    kind: CustomerErrorKind.unauthorized,
    title: 'Not allowed',
    message: "This account can't do that.",
    retryable: false,
  );

  static const CustomerError notFound = CustomerError(
    kind: CustomerErrorKind.notFound,
    title: 'Not found',
    message: "We couldn't find that.",
    retryable: false,
  );

  static const CustomerError validation = CustomerError(
    kind: CustomerErrorKind.validation,
    title: 'Check your details',
    message: 'Check the details you entered and try again.',
    retryable: false,
  );

  static const CustomerError server = CustomerError(
    kind: CustomerErrorKind.server,
    title: 'Something went wrong',
    message: 'Something went wrong on our side. Try again in a moment.',
    retryable: true,
  );

  static const CustomerError tooManyTries = CustomerError(
    kind: CustomerErrorKind.server,
    title: 'Too many tries',
    message: 'Too many tries. Wait a moment, then try again.',
    retryable: true,
  );

  static const CustomerError unknown = CustomerError(
    kind: CustomerErrorKind.unknown,
    title: 'Something went wrong',
    message: 'Something went wrong. Try again.',
    retryable: true,
  );

  /// The backend's customer-facing refusals, by `error.code`. Only codes the
  /// backend really sends to the customer app are listed.
  static const Map<String, CustomerError> _codeCopy = {
    'INVALID_OTP': CustomerError(
      kind: CustomerErrorKind.validation,
      title: "That code isn't right",
      message: "That code isn't right. Check it and try again.",
      retryable: false,
    ),
    'OTP_EXPIRED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'That code has expired',
      message: 'That code has expired. Request a new one.',
      retryable: false,
    ),
    'OTP_MAX_ATTEMPTS_EXCEEDED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Too many wrong codes',
      message: 'Too many wrong codes. Request a new one.',
      retryable: false,
    ),
    'ACCOUNT_DEACTIVATED': CustomerError(
      kind: CustomerErrorKind.unauthorized,
      title: "This account can't log in",
      message: "This account can't log in right now. Contact support.",
      retryable: false,
    ),
    'DELIVERY_OUTSIDE_RADIUS': CustomerError(
      kind: CustomerErrorKind.validation,
      title: "We don't deliver there yet",
      message: "We don't deliver to this address yet. Choose another address.",
      retryable: false,
    ),
    'ADDRESS_NOT_FOUND': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Address not found',
      message: "We couldn't find that address. Choose another one.",
      retryable: false,
    ),
    'PRODUCT_UNAVAILABLE': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Item unavailable',
      message: "An item in your cart isn't available right now. Remove it and try again.",
      retryable: false,
    ),
    'PRODUCT_NOT_FOUND': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Item unavailable',
      message: "An item in your cart isn't available anymore. Remove it and try again.",
      retryable: false,
    ),
    'TOO_MANY_REQUESTS': tooManyTries,
    'RATE_LIMITED': tooManyTries,
    // POST /feedback allows 5 messages an hour per customer (migration 013).
    'FEEDBACK_RATE_LIMITED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Feedback limit reached',
      message: "You've sent 5 messages in the last hour. Please try again later.",
      retryable: false,
    ),
  };

  /// Maps a caught error (an [ApiException], a [DioException], a timeout, a
  /// socket failure or anything else) to what the customer should read.
  static CustomerError from(Object? error) {
    if (error is CustomerError) return error;
    if (error is DioException) return from(ApiService.handleError(error));
    if (error is TimeoutException) return timeout;
    if (error is SocketException) return offline;
    if (error is ApiException) return _fromApi(error);
    return unknown;
  }

  static CustomerError _fromApi(ApiException e) {
    final code = e.code;
    if (code != null) {
      final mapped = _codeCopy[code];
      if (mapped != null) return mapped;
      // Client-generated codes: the request never reached, or never came back
      // from, the backend. This - never a status code - is what "offline" means,
      // so a backend 5xx can not be mistaken for a lost connection.
      if (code == 'NETWORK_ERROR') return offline;
      if (code == 'TIMEOUT') return timeout;
    }

    final status = e.statusCode;
    if (status == 401) return unauthorized;
    if (status == 403) return forbidden;
    if (status == 404) return notFound;
    if (status == 408) return timeout;
    if (status == 429) return tooManyTries;
    if (status == 400 || status == 422) return validation;
    if (status >= 500) return server;
    return unknown;
  }
}
