import 'package:ecom/Models/birthday_offer_model.dart';
import 'package:ecom/Models/coupon_model.dart';
import 'package:ecom/Models/points_model.dart';
import 'package:ecom/Models/referral_model.dart';

/// The cart's estimated discount before the order exists (owner,
/// 2026-10-10). A coupon, the birthday gift and a referral reward never
/// stack: the server uses the larger single one. A previewed coupon carries
/// the server's own choice; without one, the larger of the gift and the
/// referral reward is assumed. Only an estimate - the server prices the
/// order when it is placed.
class DiscountEstimate {
  const DiscountEstimate({
    this.coupon = 0,
    this.couponOnItems = 0,
    this.birthday = 0,
    this.referral = 0,
    this.referralOnItems = 0,
  });

  /// The coupon's discount (0 when the gift or the reward wins).
  final double coupon;
  final double couponOnItems;
  final double birthday;
  final double referral;
  final double referralOnItems;

  double get total => coupon + birthday + referral;

  /// The part taken off the items (a free delivery is not).
  double get onItems => couponOnItems + birthday + referralOnItems;
}

DiscountEstimate estimateDiscounts({
  required double subtotal,
  required double deliveryFee,
  CouponPreview? coupon,
  BirthdayOffer? birthday,
  CheckoutReferralReward? referral,
}) {
  final referralIsDelivery = referral?.mode == ReferralRewardMode.freeDelivery;
  if (coupon != null) {
    if (coupon.birthdayWins) return DiscountEstimate(birthday: coupon.birthdayDiscountAmount);
    if (coupon.referralWins) {
      final r = coupon.referralDiscountAmount;
      return DiscountEstimate(referral: r, referralOnItems: referralIsDelivery ? 0 : r);
    }
    return DiscountEstimate(
      coupon: coupon.discountAmount,
      couponOnItems: coupon.isFreeDelivery ? 0 : coupon.discountAmount,
    );
  }
  final gift = birthday != null && birthday.eligible ? birthday.estimateOn(subtotal) : 0.0;
  final reward = referral != null && referral.available
      ? referral.estimateOn(subtotal: subtotal, deliveryFee: deliveryFee)
      : 0.0;
  if (reward > 0 && reward > gift) {
    return DiscountEstimate(referral: reward, referralOnItems: referralIsDelivery ? 0 : reward);
  }
  return DiscountEstimate(birthday: gift);
}

/// The points "Use points" would take off an order of [due] (subtotal +
/// delivery fee - discount), and what they are worth to the cent.
({int points, double value}) estimatePointsRedeem(CheckoutPoints? points, double due) {
  if (points == null || !points.canRedeem) return (points: 0, value: 0);
  final usable = points.program.usablePoints(balance: points.balance, due: due);
  return (points: usable, value: points.program.valueOf(usable));
}
