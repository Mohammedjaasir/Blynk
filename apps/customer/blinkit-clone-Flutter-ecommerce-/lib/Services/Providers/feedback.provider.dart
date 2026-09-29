import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Services/app_errors.dart';

/// A request against the feedback API. Defaults to the app's ApiService;
/// injectable so tests can answer without a network.
typedef FeedbackRequest = Future<dynamic> Function({
  String? methodType,
  String? url,
  dynamic body,
});

/// What the feedback is about. The wire values are the backend's
/// (migration 013); the labels are what the chips say.
enum FeedbackCategory {
  app('APP', 'App'),
  delivery('DELIVERY', 'Delivery'),
  products('PRODUCTS', 'Products'),
  other('OTHER', 'Other');

  const FeedbackCategory(this.wire, this.label);
  final String wire;
  final String label;
}

/// Sends customer feedback (POST /api/v1/feedback). Owned by the feedback
/// screen rather than registered app-wide: nothing else reads it, and it
/// holds no state worth keeping once the screen closes.
class FeedbackProvider extends ChangeNotifier {
  FeedbackProvider({FeedbackRequest? request})
      : _request = request ?? ApiService.requestMethods;

  /// Mirrors the backend limit and the table's CHECK constraint.
  static const int maxMessageLength = 2000;

  final FeedbackRequest _request;

  bool _isSending = false;
  CustomerError? _failure;

  bool get isSending => _isSending;

  /// The customer-facing reason the last send failed, or null.
  CustomerError? get failure => _failure;

  /// Sends one message. Returns true once the backend has stored it; on
  /// failure returns false and leaves the reason in [failure]. The message
  /// is trimmed here too, so what is counted is what is sent.
  Future<bool> send({
    required FeedbackCategory category,
    required String message,
    int? rating,
  }) async {
    if (_isSending) return false;
    _isSending = true;
    _failure = null;
    notifyListeners();

    try {
      await _request(
        methodType: 'POST',
        url: '/feedback',
        body: {
          'category': category.wire,
          'message': message.trim(),
          if (rating != null) 'rating': rating,
        },
      );
      return true;
    } catch (e) {
      _failure = AppErrors.from(e);
      return false;
    } finally {
      _isSending = false;
      notifyListeners();
    }
  }
}
