import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../app_design.dart';
import '../../../Services/store_info.dart';
import '../../../Models/order_format.dart';
import '../../../Services/rewards_estimates.dart';
import '../Atoms/money_text.dart';
import '../../../design/tokens.dart';

/// The estimate the customer is shown before the order exists: the cart's own
/// [CartProvider.subtotal] plus the store's flat delivery fee.
///
/// **This is the one place that combination is expressed.** It was written out
/// at two call sites (this card and the cart's pinned checkout bar), which is
/// how a summary and a bar end up disagreeing. Nothing else here is derived:
/// the subtotal is the provider's, the fee is the live one from `GET /store`
/// ([watchCheckoutDeliveryFee]: `system_configurations.delivery_fee`, or 0
/// while this customer has a free delivery left), and
/// once an order exists the backend's own `totalAmount` is authoritative — see
/// `OrderProvider.placeOrder`.
double cartEstimateTotal(CartProvider cart, double deliveryFee, {double discount = 0}) {
  final total = cart.subtotal + deliveryFee - discount;
  return total < 0 ? 0 : total;
}

/// Order Summary: subtotal from CartProvider plus the flat delivery fee.
///
/// These are the prices the customer saw while shopping. The backend
/// re-prices the order and computes the real total when it's placed (see
/// OrderProvider.placeOrder), so no handling or platform fee is ever invented
/// here. The one discount row is a coupon the server has previewed for this
/// exact cart (backend migration 018, [OrderProvider.couponFor]), shown on
/// checkout only ([showCoupon]); the server re-checks it at placeOrder.
///
/// Free deliveries (owner, 2026-10-08; every customer since 2026-10-09): on
/// mount it asks where this customer stands
/// ([StoreInfoProvider.loadCheckoutInfo]); while a free delivery applies the
/// Delivery fee row reads FREE with a short note of how many are left. The
/// order's own `deliveryFee` stays authoritative.
class CartPriceDetailWidget extends StatefulWidget {
  const CartPriceDetailWidget({super.key, this.footer, this.showCoupon = false, this.showBirthday = false});

  /// Optional content under the total (the desktop checkout CTA).
  final Widget? footer;

  /// Checkout: include an applied coupon's Discount line in the estimate.
  final bool showCoupon;

  /// Checkout: include the birthday gift's estimated line while this
  /// customer has one this week (owner, 2026-10-09). The server decides at
  /// placeOrder; once a coupon has been previewed, its answer (which of the
  /// two wins) is used instead of the estimate.
  final bool showBirthday;

  @override
  State<CartPriceDetailWidget> createState() => _CartPriceDetailWidgetState();
}

class _CartPriceDetailWidgetState extends State<CartPriceDetailWidget> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final store = context.read<StoreInfoProvider?>();
      final auth = context.read<AuthProvider?>();
      if (store == null || auth == null) return;
      store.loadCheckoutInfo(signedIn: auth.isAuthenticated);
    });
  }

  @override
  Widget build(BuildContext context) {
    final footer = widget.footer;
    final cart = context.watch<CartProvider>();
    final subtotal = cart.subtotal;
    final itemCount = cart.itemCount;
    final deliveryFee = watchCheckoutDeliveryFee(context);
    final offer = context.watch<StoreInfoProvider?>()?.freeDelivery;
    final freeDelivery = offer != null && offer.applies;
    final coupon = widget.showCoupon ? context.watch<OrderProvider>().couponFor(cart) : null;
    final birthday = widget.showBirthday ? watchEligibleBirthdayOffer(context) : null;
    // The gift and a coupon never stack (owner, 2026-10-09). A previewed
    // coupon carries the server's own choice; without one, the gift is
    // estimated from checkout-info's percent.
    // A referral reward never stacks either (owner, 2026-10-10): the server
    // uses the larger single discount, so the estimate takes the larger.
    final store = context.watch<StoreInfoProvider?>();
    final estimate = estimateDiscounts(
      subtotal: subtotal,
      deliveryFee: deliveryFee,
      coupon: coupon,
      birthday: birthday,
      referral: widget.showBirthday ? store?.referralReward : null,
    );
    final discount = estimate.coupon;
    final birthdayGift = estimate.birthday;
    final referralGift = estimate.referral;
    // Blynk Points (owner, 2026-10-10): checkout's "Use points" switch.
    final usePoints = widget.showBirthday && (context.watch<OrderProvider?>()?.usePoints ?? false);
    final pointsOff = usePoints
        ? estimatePointsRedeem(store?.checkoutPoints, subtotal + deliveryFee - estimate.total).value
        : 0.0;
    final total = cartEstimateTotal(cart, deliveryFee, discount: discount + birthdayGift + referralGift + pointsOff);

    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: const Text('Order Summary', style: BlynkText.sectionHeader),
          ),
          const SizedBox(height: BlynkSpace.s12),
          _SummaryRow(
            label: 'Subtotal ($itemCount ${itemCount == 1 ? 'item' : 'items'})',
            amount: subtotal,
          ),
          // Combo packs (owner, 2026-10-09): the subtotal already charges
          // the combo price; this only says what the packs save, from the
          // backend's own `saving` per pack.
          if (cart.comboSavings > 0) ...[
            const SizedBox(height: BlynkSpace.s4),
            Text(
              'Includes ${formatLkr(cart.comboSavings)} saved on combo packs',
              key: const Key('summary-combo-savings'),
              style: BlynkText.caption.copyWith(color: BlynkColors.positiveInk),
            ),
          ],
          const SizedBox(height: BlynkSpace.s8),
          if (freeDelivery) ...[
            Row(
              key: const Key('summary-free-delivery'),
              children: [
                Expanded(
                  child: Text(
                    'Delivery fee',
                    style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                  ),
                ),
                Text(
                  'FREE',
                  style: BlynkType.price.copyWith(color: BlynkColors.positiveInk),
                ),
              ],
            ),
            const SizedBox(height: BlynkSpace.s4),
            Text(
              freeDeliveryNote(offer),
              style: BlynkText.caption.copyWith(color: BlynkColors.positiveInk),
            ),
          ] else
            _SummaryRow(
              label: 'Delivery fee',
              amount: deliveryFee,
            ),
          if (birthdayGift > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            Row(
              key: const Key('summary-birthday-gift'),
              children: [
                const Icon(BlynkIcons.birthday, size: BlynkIcons.xs, color: BlynkColors.positiveInk),
                const SizedBox(width: BlynkSpace.s4),
                Expanded(
                  child: Text(
                    birthday != null ? 'Birthday gift (${birthday.percentLabel})' : 'Birthday gift',
                    style: BlynkText.body.copyWith(color: BlynkColors.positiveInk),
                  ),
                ),
                Semantics(
                  label: 'minus ${formatLkr(birthdayGift)}',
                  excludeSemantics: true,
                  child: Text(
                    '−${formatLkr(birthdayGift)}',
                    style: BlynkType.price.copyWith(color: BlynkColors.positiveInk),
                  ),
                ),
              ],
            ),
          ],
          if (coupon != null && discount > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            Row(
              key: const Key('summary-discount'),
              children: [
                Expanded(
                  child: Text(
                    'Discount (${coupon.code})',
                    style: BlynkText.body.copyWith(color: BlynkColors.positiveInk),
                  ),
                ),
                Semantics(
                  label: 'minus ${formatLkr(discount)}',
                  excludeSemantics: true,
                  child: Text(
                    '−${formatLkr(discount)}',
                    style: BlynkType.price.copyWith(color: BlynkColors.positiveInk),
                  ),
                ),
              ],
            ),
          ],
          if (referralGift > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            _DiscountRow(key: const Key('summary-referral'), label: 'Referral reward', amount: referralGift),
          ],
          if (pointsOff > 0) ...[
            const SizedBox(height: BlynkSpace.s8),
            _DiscountRow(key: const Key('summary-points'), label: 'Blynk Points (estimate)', amount: pointsOff),
          ],
          const Padding(
            padding: EdgeInsets.symmetric(vertical: BlynkSpace.s12),
            child: Divider(height: 1, color: BlynkColors.line),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Expanded(
                child: Text('Total', style: BlynkText.sectionHeader),
              ),
              MoneyText(total, style: BlynkType.priceTotal),
            ],
          ),
          const SizedBox(height: BlynkSpace.s4),
          Text(
            '${StoreInfo.paymentMethodLabel} · final amount is confirmed when you place the order.',
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
          if (footer != null) ...[
            const SizedBox(height: BlynkSpace.s16),
            footer,
          ],
        ],
      ),
    );
  }
}

/// The line under a FREE delivery fee, e.g. "Free delivery — 1 of 2 free
/// deliveries left." (the next order included). No "welcome": the free
/// deliveries are for every customer, existing ones too (owner, 2026-10-09).
String freeDeliveryNote(FreeDeliveryOffer offer) {
  final plural = offer.count == 1 ? 'delivery' : 'deliveries';
  return 'Free delivery — ${offer.remaining} of ${offer.count} free $plural left.';
}

/// A green "−LKR 150" line (owner, 2026-10-10).
class _DiscountRow extends StatelessWidget {
  const _DiscountRow({super.key, required this.label, required this.amount});

  final String label;
  final double amount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(label, style: BlynkText.body.copyWith(color: BlynkColors.positiveInk))),
        Semantics(
          label: 'minus ${formatLkr(amount)}',
          excludeSemantics: true,
          child: Text('−${formatLkr(amount)}', style: BlynkType.price.copyWith(color: BlynkColors.positiveInk)),
        ),
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.label, required this.amount});

  final String label;
  final double amount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
        ),
        MoneyText(amount, style: BlynkType.price),
      ],
    );
  }
}
