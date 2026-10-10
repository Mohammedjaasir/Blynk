import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_format.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../../../design/tokens.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/blynk_text_field.dart';

/// "Have a coupon code?" on the checkout page (backend migration 018).
///
/// Apply asks the server what the code takes off this cart
/// (`POST /orders/validate-coupon`, via [OrderProvider.applyCoupon]) and the
/// Order Summary then shows the Discount line. A refusal is shown under the
/// field in plain words. Remove takes the code off. The server checks the
/// code again when the order is placed; nothing here is trusted as final.
class CheckoutCouponField extends StatefulWidget {
  const CheckoutCouponField({super.key});

  @override
  State<CheckoutCouponField> createState() => _CheckoutCouponFieldState();
}

class _CheckoutCouponFieldState extends State<CheckoutCouponField> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final orders = context.read<OrderProvider>();
    final cart = context.read<CartProvider>();
    FocusScope.of(context).unfocus();
    // The preview prices delivery for the selected address (owner, 2026-10-10).
    final addressId = context.read<AddressProvider?>()?.defaultAddress?.id;
    final ok = await orders.applyCoupon(_controller.text, cart, addressId: addressId);
    if (ok && mounted) _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final orders = context.watch<OrderProvider>();
    final cart = context.watch<CartProvider>();
    final applied = orders.couponFor(cart);

    return Container(
      key: const Key('checkout-coupon'),
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      child: applied != null
          ? Row(
              children: [
                const Icon(BlynkIcons.check, color: BlynkColors.positiveInk, size: BlynkIcons.md),
                const SizedBox(width: BlynkSpace.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('${applied.code} applied', key: const Key('coupon-applied'), style: BlynkText.rowLabel),
                      // The gift and a code never stack (owner, 2026-10-09):
                      // when the server says the gift saves more, it is used
                      // and the code is not.
                      Text(
                        applied.birthdayWins
                            ? "Your birthday gift saves more, so it's used instead of this code."
                            // A referral reward never stacks either (owner, 2026-10-10).
                            : applied.referralWins
                                ? "Your referral reward saves more, so it's used instead of this code."
                                : applied.isFreeDelivery
                                ? 'Free delivery on this order'
                                : 'You save ${formatLkr(applied.discountAmount)}',
                        key: const Key('coupon-applied-note'),
                        style: BlynkText.body.copyWith(
                          color: applied.birthdayWins || applied.referralWins ? BlynkColors.ink2 : BlynkColors.positiveInk,
                        ),
                      ),
                    ],
                  ),
                ),
                BlynkButton.tertiary(
                  key: const Key('coupon-remove'),
                  label: 'Remove',
                  semanticLabel: 'Remove coupon ${applied.code}',
                  onPressed: orders.removeCoupon,
                ),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Have a coupon code?', style: BlynkText.rowLabel),
                const SizedBox(height: BlynkSpace.s8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: BlynkTextField(
                        key: const Key('coupon-field'),
                        label: 'Coupon code',
                        controller: _controller,
                        textCapitalization: TextCapitalization.characters,
                        textInputAction: TextInputAction.done,
                        maxLength: 20,
                        showClear: false,
                        enabled: !orders.isApplyingCoupon,
                        errorText: orders.couponError,
                        helperText: orders.couponIsStale(cart)
                            ? 'Your cart changed. Apply ${orders.appliedCouponCode} again.'
                            : null,
                        onSubmitted: (_) => _apply(),
                      ),
                    ),
                    const SizedBox(width: BlynkSpace.s8),
                    Padding(
                      padding: const EdgeInsets.only(top: BlynkSpace.s4),
                      child: BlynkButton.secondary(
                        key: const Key('coupon-apply'),
                        label: 'Apply',
                        loading: orders.isApplyingCoupon,
                        onPressed: cart.isEmpty ? null : _apply,
                      ),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}
