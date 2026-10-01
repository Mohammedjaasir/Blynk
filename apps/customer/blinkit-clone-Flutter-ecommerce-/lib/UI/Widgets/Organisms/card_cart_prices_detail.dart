import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../app_design.dart';
import '../../../Services/store_info.dart';
import '../../../Models/order_format.dart';
import '../Atoms/money_text.dart';
import '../../../design/tokens.dart';

/// The estimate the customer is shown before the order exists: the cart's own
/// [CartProvider.subtotal] plus the store's flat delivery fee.
///
/// **This is the one place that combination is expressed.** It was written out
/// at two call sites (this card and the cart's pinned checkout bar), which is
/// how a summary and a bar end up disagreeing. Nothing else here is derived:
/// the subtotal is the provider's, the fee is the live one from `GET /store`
/// ([watchDeliveryFee], mirroring `system_configurations.delivery_fee`), and
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
class CartPriceDetailWidget extends StatelessWidget {
  const CartPriceDetailWidget({super.key, this.footer, this.showCoupon = false});

  /// Optional content under the total (the desktop checkout CTA).
  final Widget? footer;

  /// Checkout: include an applied coupon's Discount line in the estimate.
  final bool showCoupon;

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final subtotal = cart.subtotal;
    final itemCount = cart.itemCount;
    final deliveryFee = watchDeliveryFee(context);
    final coupon = showCoupon ? context.watch<OrderProvider>().couponFor(cart) : null;
    final discount = coupon?.discountAmount ?? 0;
    final total = cartEstimateTotal(cart, deliveryFee, discount: discount);

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
          const SizedBox(height: BlynkSpace.s8),
          _SummaryRow(
            label: 'Delivery fee',
            amount: deliveryFee,
          ),
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
            footer!,
          ],
        ],
      ),
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
