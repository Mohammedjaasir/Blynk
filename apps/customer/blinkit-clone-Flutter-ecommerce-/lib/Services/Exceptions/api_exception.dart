class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? code;
  final StackTrace? stackTrace;

  ApiException(
    this.statusCode,
    this.message, {
    this.code,
    this.stackTrace,
  });

  @override
  String toString() => message;
}
