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

  /// The doctors section refused a guest (401 SIGN_IN_REQUIRED, owner,
  /// 2026-10-10): shown as the "Sign in to see doctors" prompt, whose login
  /// returns to the doctors.
  bool get isDoctorsSignIn => identical(this, AppErrors.doctorsSignInRequired);

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

  /// "Doctors need sign-in" is on and this is a guest (owner, 2026-10-10:
  /// "they must add their phone number and get registered").
  static const CustomerError doctorsSignInRequired = CustomerError(
    kind: CustomerErrorKind.unauthorized,
    title: 'Sign in to see doctors',
    message: 'Use your phone number to log in or create an account.',
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

  /// The pin is outside the hub's delivery radius: at checkout, and (since
  /// the address endpoints check it too) when an address is saved.
  static const CustomerError outsideDeliveryArea = CustomerError(
    kind: CustomerErrorKind.validation,
    title: "We don't deliver there yet",
    message: "We don't deliver to this address yet. Choose another address.",
    retryable: false,
  );

  /// A 422 the backend sent with a code this app does not know yet: the
  /// request was understood but a rule refused it, so "check your details"
  /// would send the customer looking for a typo that is not there.
  static const CustomerError notPossible = CustomerError(
    kind: CustomerErrorKind.validation,
    title: "That can't be done right now",
    message: "That can't be done right now. Go back, check, and try again.",
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
    'DELIVERY_OUTSIDE_RADIUS': outsideDeliveryArea,
    // The dental discovery routes while "Doctors need sign-in" is on and no
    // one is signed in (owner, 2026-10-10).
    'SIGN_IN_REQUIRED': doctorsSignInRequired,
    // Ops/Admin decide the hours and can close the store at any time, so
    // this copy names no hours; place order shows the server's own sentence
    // (which says when it reopens) and this is only its fallback
    // (owner, 2026-10-10).
    'STORE_CLOSED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: "We're closed right now",
      message: "We're closed right now. Please order again when we open.",
      retryable: false,
    ),
    // Scheduled delivery slots: the picked slot is no longer offered, or
    // it filled up. Checkout reloads the slots (owner, 2026-10-10).
    'SLOT_UNAVAILABLE': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Delivery time unavailable',
      message: "That delivery time isn't available any more. Pick another time.",
      retryable: false,
    ),
    'SLOT_FULL': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Delivery time full',
      message: 'That delivery time is full. Pick another time.',
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
    // Combo packs (owner, 2026-10-09): a combo in the cart ended, changed or
    // sold out between adding it and placing the order. The checkout reloads
    // the combos when it sees one of these.
    'COMBO_NOT_FOUND': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Combo pack ended',
      message: "A combo pack in your cart isn't available anymore. Remove it and try again.",
      retryable: false,
    ),
    'COMBO_UNAVAILABLE': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Combo pack unavailable',
      message: "A combo pack in your cart isn't available right now. Remove it and try again.",
      retryable: false,
    ),
    'COMBO_OUT_OF_STOCK': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Combo pack sold out',
      message: 'A combo pack in your cart has sold out. Remove it or lower the quantity and try again.',
      retryable: false,
    ),
    // Coupons (backend migration 018): a code that stopped applying between
    // the checkout preview and placing the order. The field itself words
    // these with their details (coupon_model.dart couponRefusalMessage).
    'COUPON_NOT_FOUND': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Coupon not found',
      message: "That coupon code doesn't exist. Remove it and try again.",
      retryable: false,
    ),
    'COUPON_INACTIVE': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Coupon unavailable',
      message: 'That coupon is no longer available. Remove it and try again.',
      retryable: false,
    ),
    'COUPON_NOT_STARTED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Coupon not active yet',
      message: "That coupon isn't active yet. Remove it and try again.",
      retryable: false,
    ),
    'COUPON_EXPIRED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Coupon expired',
      message: 'That coupon has expired. Remove it and try again.',
      retryable: false,
    ),
    'COUPON_LIMIT_REACHED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Coupon used up',
      message: "That coupon can't be used again. Remove it and try again.",
      retryable: false,
    ),
    'COUPON_FIRST_ORDER_ONLY': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'First order only',
      message: 'That coupon is only for a first order. Remove it and try again.',
      retryable: false,
    ),
    'COUPON_MIN_SUBTOTAL': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Add more items',
      message: "Your cart is below that coupon's minimum. Add items or remove the code.",
      retryable: false,
    ),
    // DELETE /me while an order is still open (account deletion).
    'ACTIVE_ORDERS_EXIST': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'You have open orders',
      message: 'Finish or cancel your open orders first.',
      retryable: false,
    ),
    // Too many wrong passwords: the login is locked for a few minutes.
    'LOGIN_LOCKED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Login locked for now',
      message: 'Too many wrong tries. Wait a few minutes, or log in with an SMS code.',
      retryable: false,
    ),
    'ORDER_CANNOT_BE_CANCELLED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: "Can't cancel now",
      message: "This order can't be cancelled any more.",
      retryable: false,
    ),
    'ORDER_ALREADY_CANCELLED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Already cancelled',
      message: 'This order is already cancelled.',
      retryable: false,
    ),
    'STORE_UNAVAILABLE': CustomerError(
      kind: CustomerErrorKind.server,
      title: "We can't take orders right now",
      message: "We can't take orders right now. Try again in a little while.",
      retryable: true,
    ),
    'PHONE_TAKEN': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Number already used',
      message: 'That phone number is already used by another account.',
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
    // PATCH /me favourite_category_ids (owner, 2026-10-09): a favourite
    // category was switched off or deleted while the customer was choosing.
    'UNKNOWN_CATEGORY': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'A favourite is no longer in the shop',
      message: "One of your favourites isn't in the shop any more. Untick it and save again.",
      retryable: false,
    ),
    // POST /me/referral/apply (owner, 2026-10-10): a friend's code refused.
    'REFERRALS_DISABLED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Referrals are paused',
      message: "Referral codes can't be used right now.",
      retryable: false,
    ),
    'REFERRAL_CODE_NOT_FOUND': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Code not found',
      message: "We couldn't find that referral code. Check it and try again.",
      retryable: false,
    ),
    'REFERRAL_SELF': CustomerError(
      kind: CustomerErrorKind.validation,
      title: "That's your own code",
      message: "That's your own code. Enter a friend's code instead.",
      retryable: false,
    ),
    'REFERRAL_ALREADY_APPLIED': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'Already applied',
      message: "You've already used a referral code.",
      retryable: false,
    ),
    'REFERRAL_NOT_NEW_CUSTOMER': CustomerError(
      kind: CustomerErrorKind.validation,
      title: 'New customers only',
      message: 'Referral codes are for new customers before their first order.',
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
    if (status == 400) return validation;
    // A 422 is the backend understanding the request and a rule saying no.
    // Only its plain schema failure is about what the customer typed.
    if (status == 422) return code == null || code == 'VALIDATION_ERROR' ? validation : notPossible;
    if (status >= 500) return server;
    return unknown;
  }
}
