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
    this.birthdayDiscountAmount = 0,
    this.appliedDiscount = 'COUPON',
    this.referralDiscountAmount = 0,
  });

  final String code;

  /// FIXED, PERCENT or FREE_DELIVERY.
  final String discountType;
  final String? description;
  final double subtotal;
  final double deliveryFee;
  final double discountAmount;
  final double total;

  /// What the birthday gift would take off this cart instead (owner,
  /// 2026-10-09); 0 when the customer has no gift this week.
  final double birthdayDiscountAmount;

  /// Which discount the order would actually get: 'COUPON' or 'BIRTHDAY'.
  /// They never stack - the larger wins, and a tie keeps the coupon (the gift
  /// stays for another order that week).
  final String appliedDiscount;

  /// What a referral reward would take off this cart instead (owner,
  /// 2026-10-10); 0 when the customer has none. Like the birthday gift it
  /// never stacks: the server uses the larger single discount, and then
  /// [appliedDiscount] is 'REFERRAL'.
  final double referralDiscountAmount;

  bool get isFreeDelivery => discountType == 'FREE_DELIVERY';

  /// The birthday gift beats this code on this cart, so the code is not used.
  bool get birthdayWins => appliedDiscount == 'BIRTHDAY' && birthdayDiscountAmount > 0;

  /// A referral reward beats this code on this cart (owner, 2026-10-10).
  bool get referralWins => appliedDiscount == 'REFERRAL' && referralDiscountAmount > 0;

  static double _num(Object? v) => double.tryParse('${v ?? 0}') ?? 0.0;

  /// [json] is `data.coupon`; [envelope] is the whole `data`, which (since
  /// the birthday gift) carries `birthday_discount_amount`,
  /// `applied_discount` and the `total` that will really be charged.
  static CouponPreview? tryParse(Object? json, {Object? envelope}) {
    if (json is! Map || json['code'] == null) return null;
    final outer = envelope is Map ? envelope : const {};
    Object? field(String key) => outer.containsKey(key) ? outer[key] : json[key];
    final applied = field('applied_discount')?.toString().toUpperCase();
    return CouponPreview(
      code: json['code'].toString(),
      discountType: (json['discount_type'] ?? '').toString(),
      description: json['description']?.toString(),
      subtotal: _num(json['subtotal']),
      deliveryFee: _num(json['delivery_fee']),
      discountAmount: _num(json['discount_amount']),
      total: _num(field('total')),
      birthdayDiscountAmount: _num(field('birthday_discount_amount')),
      appliedDiscount: applied == 'BIRTHDAY' || applied == 'REFERRAL' ? applied! : 'COUPON',
      referralDiscountAmount: _num(field('referral_discount_amount')),
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
