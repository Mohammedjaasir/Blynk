import '../Services/Exceptions/api_exception.dart';
import 'order_format.dart';

/// What `POST /orders/validate-coupon` says a code would take off the cart
/// (backend migration 018). A preview only: the server prices the cart
/// itself and re-checks the code, under a lock, when the order is placed.
class CouponPreview {
  const CouponPreview({
    required this.code,
    required this.discountType,
    required this.subtotal,
    required this.deliveryFee,
    required this.discountAmount,
    required this.total,
    this.description,
  });

  final String code;

  /// FIXED, PERCENT or FREE_DELIVERY.
  final String discountType;
  final String? description;
  final double subtotal;
  final double deliveryFee;
  final double discountAmount;
  final double total;

  bool get isFreeDelivery => discountType == 'FREE_DELIVERY';

  static double _num(Object? v) => double.tryParse('${v ?? 0}') ?? 0.0;

  static CouponPreview? tryParse(Object? json) {
    if (json is! Map || json['code'] == null) return null;
    return CouponPreview(
      code: json['code'].toString(),
      discountType: (json['discount_type'] ?? '').toString(),
      description: json['description']?.toString(),
      subtotal: _num(json['subtotal']),
      deliveryFee: _num(json['delivery_fee']),
      discountAmount: _num(json['discount_amount']),
      total: _num(json['total']),
    );
  }
}

/// Codes are 4-20 letters or digits; typed in any case, sent upper-case.
final RegExp couponCodePattern = RegExp(r'^[A-Z0-9]{4,20}$');

String normaliseCouponCode(String raw) => raw.trim().toUpperCase();

/// The backend's coupon refusals in plain words. Anything else (offline, a
/// timeout, a server fault) is null so the caller falls back to AppErrors.
String? couponRefusalMessage(ApiException e) {
  switch (e.code) {
    case 'COUPON_NOT_FOUND':
      return "That code doesn't exist. Check it and try again.";
    case 'COUPON_INACTIVE':
      return 'This code is no longer available.';
    case 'COUPON_NOT_STARTED':
      return "This code isn't active yet.";
    case 'COUPON_EXPIRED':
      return 'This code has expired.';
    case 'COUPON_FIRST_ORDER_ONLY':
      return 'This code is only for your first order.';
    case 'COUPON_LIMIT_REACHED':
      return e.details?['scope'] == 'CUSTOMER'
          ? "You've already used this code."
          : 'This code has been fully used.';
    case 'COUPON_MIN_SUBTOTAL':
      final min = double.tryParse('${e.details?['min_subtotal']}');
      return min != null
          ? 'Add items worth ${formatLkr(min)} or more to use this code.'
          : "Your cart is below this code's minimum.";
    case 'VALIDATION_ERROR':
      return 'Codes are 4 to 20 letters or numbers.';
    default:
      return null;
  }
}
