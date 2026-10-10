import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/points_model.dart';
import '../../../Models/referral_model.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../Services/rewards_estimates.dart';
import '../../../Models/order_format.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../../../design/tokens.dart';

/// The rewards lines in the cart and at checkout (owner, 2026-10-10), from
/// `GET /orders/checkout-info` ([StoreInfoProvider.referralReward] and
/// [StoreInfoProvider.checkoutPoints]):
///
/// * "Referral reward: LKR 150 off this order" while one is waiting, noting
///   it is used automatically when it is the biggest saving;
/// * "You'll earn about N points" while Blynk Points are on;
/// * at checkout only ([allowRedeem]), "You have 120 points = LKR 120" with a
///   "Use points" switch (default off) and the estimated points discount.
///   The switch is [OrderProvider.usePoints], which sends `use_points: true`.
///
/// Nothing at all for a guest, while unknown, or when nothing applies.
class CartRewardsLines extends StatelessWidget {
  const CartRewardsLines({super.key, this.allowRedeem = false, this.padding = EdgeInsets.zero});

  /// Checkout: offer the "Use points" switch.
  final bool allowRedeem;

  /// Space around the card when it shows.
  final EdgeInsetsGeometry padding;

  static const Key referralKey = Key('rewards-referral-line');
  static const Key earnKey = Key('rewards-earn-line');
  static const Key usePointsKey = Key('rewards-use-points');
  static const Key pointsValueKey = Key('rewards-points-value');

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false);
    final store = context.watch<StoreInfoProvider?>();
    if (!signedIn || store == null) return const SizedBox.shrink();
    final referral = store.referralReward;
    final points = store.checkoutPoints;
    final showReferral = referral != null && referral.available;
    final pointsOn = points != null && points.enabled;
    if (!showReferral && !pointsOn) return const SizedBox.shrink();

    final cart = context.watch<CartProvider>();
    final orders = context.watch<OrderProvider?>();
    final deliveryFee = store.checkoutDeliveryFee;
    final coupon = allowRedeem && store.couponsEnabled ? orders?.couponFor(cart) : null;
    final estimate = estimateDiscounts(
      subtotal: cart.subtotal,
      deliveryFee: deliveryFee,
      coupon: coupon,
      birthday: store.birthdayOffer,
      referral: referral,
    );
    final earn = pointsOn ? points.program.earnEstimate(cart.subtotal - estimate.onItems) : 0;
    final canRedeem = allowRedeem && pointsOn && points.canRedeem && orders != null;

    final rows = <Widget>[
      if (showReferral) _ReferralLine(reward: referral),
      if (canRedeem) _UsePoints(points: points, orders: orders, cart: cart, estimate: estimate, deliveryFee: deliveryFee),
      if (earn > 0)
        Row(
          key: earnKey,
          children: [
            const Icon(Icons.stars_outlined, size: BlynkIcons.md, color: BlynkColors.ink2),
            const SizedBox(width: BlynkSpace.s8),
            Expanded(
              child: Text(
                "You'll earn about $earn Blynk ${earn == 1 ? 'Point' : 'Points'} when this order is delivered",
                style: BlynkText.body.copyWith(color: BlynkColors.ink2),
              ),
            ),
          ],
        ),
    ];
    if (rows.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: padding,
      child: Container(
        decoration: appCardDecoration(),
        padding: const EdgeInsets.all(BlynkSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const SizedBox(height: BlynkSpace.s12),
              rows[i],
            ],
          ],
        ),
      ),
    );
  }
}

class _ReferralLine extends StatelessWidget {
  const _ReferralLine({required this.reward});

  final CheckoutReferralReward reward;

  @override
  Widget build(BuildContext context) {
    return Row(
      key: CartRewardsLines.referralKey,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.card_giftcard_outlined, size: BlynkIcons.md, color: BlynkColors.positiveInk),
        const SizedBox(width: BlynkSpace.s8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(reward.lineText, style: BlynkText.label.copyWith(color: BlynkColors.positiveInk)),
              Text(
                "Applied automatically when it's your biggest saving. It doesn't add to a coupon or birthday gift.",
                style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _UsePoints extends StatelessWidget {
  const _UsePoints({
    required this.points,
    required this.orders,
    required this.cart,
    required this.estimate,
    required this.deliveryFee,
  });

  final CheckoutPoints points;
  final OrderProvider orders;
  final CartProvider cart;
  final DiscountEstimate estimate;
  final double deliveryFee;

  @override
  Widget build(BuildContext context) {
    final on = orders.usePoints;
    final due = cart.subtotal + deliveryFee - estimate.total;
    final redeem = estimatePointsRedeem(points, due);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        MergeSemantics(
          child: InkWell(
            onTap: () => orders.setUsePoints(!on),
            borderRadius: BlynkRadius.mdAll,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Row(
                children: [
                  const Icon(Icons.stars_outlined, size: BlynkIcons.md, color: BlynkColors.ink),
                  const SizedBox(width: BlynkSpace.s8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'You have ${points.balance} ${points.balance == 1 ? 'point' : 'points'} = ${formatLkr(points.valueLkr)}',
                          style: BlynkText.rowLabel,
                        ),
                        Text('Use points', style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
                      ],
                    ),
                  ),
                  Switch(
                    key: CartRewardsLines.usePointsKey,
                    value: on,
                    onChanged: orders.setUsePoints,
                    // Ink for "on", like the app's other switches; yellow stays
                    // reserved for the forward action.
                    thumbColor: WidgetStateProperty.resolveWith(
                      (states) => states.contains(WidgetState.selected) ? BlynkColors.paper : BlynkColors.ink3,
                    ),
                    trackColor: WidgetStateProperty.resolveWith(
                      (states) => states.contains(WidgetState.selected) ? BlynkColors.ink : BlynkColors.well,
                    ),
                    trackOutlineColor: WidgetStateProperty.resolveWith(
                      (states) => states.contains(WidgetState.selected) ? BlynkColors.ink : BlynkColors.lineStrong,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (on)
          Padding(
            padding: const EdgeInsets.only(top: BlynkSpace.s4),
            child: Text(
              redeem.points > 0
                  ? 'About ${redeem.points} points (${formatLkr(redeem.value)}) off this order. The final amount is confirmed when you place it.'
                  : "Points can't be used on this order.",
              key: CartRewardsLines.pointsValueKey,
              style: BlynkText.caption.copyWith(color: redeem.points > 0 ? BlynkColors.positiveInk : BlynkColors.ink2),
            ),
          ),
      ],
    );
  }
}
