class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? code;
  final StackTrace? stackTrace;

  /// The backend's `error.details` for a 4xx refusal, when it sent one (e.g.
  /// `min_subtotal` on COUPON_MIN_SUBTOTAL). Data for the app to word its own
  /// message with - never shown as-is.
  final Map<String, dynamic>? details;

  ApiException(
    this.statusCode,
    this.message, {
    this.code,
    this.stackTrace,
    this.details,
  });

  @override
  String toString() => message;
}
