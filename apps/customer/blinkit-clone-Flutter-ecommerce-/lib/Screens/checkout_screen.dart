import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/cart.provider.dart';
import '../Services/Providers/store_info.provider.dart';
import '../UI/Widgets/Atoms/birthday_offer_banner.dart';
import '../UI/Widgets/Atoms/card_cancellation_policy.dart';
import '../UI/Widgets/Atoms/combo_card.dart';
import '../UI/Widgets/Atoms/image_well.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Atoms/section_header.dart';
import '../UI/Widgets/Organisms/card_cart_prices_detail.dart';
import '../UI/Widgets/Organisms/cart_screen_address_container.dart';
import '../UI/Widgets/Organisms/cart_screen_payment_container.dart';
import '../UI/Widgets/Organisms/checkout_coupon_field.dart';
import '../UI/Widgets/Organisms/empty_cart_view.dart';
import '../app_design.dart';
import '../design/tokens.dart';

/// Checkout step reached from the Cart's Proceed to checkout.
///
/// 2026-09 redesign (W4): the page now reads in the order the decision is
/// made — **delivery address → items → order summary → cancellation rule**,
/// with the payment method and the one confirming action pinned at the bottom.
///
/// **No business logic lives here.** The address bar, the Cash on Delivery /
/// Place Order bar (which submits to the backend, guards an empty cart, sends
/// the customer to Addresses when none is set, and keeps its own in-flight
/// duplicate-submission guard) and the price summary are the existing,
/// already-verified pieces, unchanged — this screen only decides where they
/// sit. The items list below is read-only: it shows the cart lines the
/// customer is about to order and offers no controls, so nothing about the
/// order can be changed on the step that submits it.
class CheckoutScreen extends StatelessWidget {
  const CheckoutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isEmpty = context.select<CartProvider, bool>((c) => c.isEmpty);
    // "Coupon code is not needed" (owner, 2026-10-08): the field shows only
    // while Admin / Operations have coupons switched on (GET /store).
    final couponsEnabled = watchCouponsEnabled(context);

    return Scaffold(
      backgroundColor: BlynkColors.well,
      appBar: AppBar(
        title: const Text('Checkout'),
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.paper,
      ),
      body: isEmpty
          ? const EmptyCartView()
          : Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    BlynkSpace.s16,
                    BlynkSpace.s16,
                    BlynkSpace.s16,
                    BlynkSpace.s24,
                  ),
                  children: [
                    // The birthday gift (owner, 2026-10-09), when it applies.
                    const BirthdayOfferBanner(padding: EdgeInsets.only(bottom: BlynkSpace.s16)),
                    const BlynkSectionHeader(
                      title: 'Delivery address',
                      padding: EdgeInsets.only(bottom: BlynkSpace.s12),
                    ),
                    Container(
                      decoration: appCardDecoration(),
                      clipBehavior: Clip.antiAlias,
                      child: const CartScreenAddressContainer(),
                    ),
                    const BlynkSectionHeader(
                      title: 'Items',
                      padding: EdgeInsets.only(
                        top: BlynkSpace.s24,
                        bottom: BlynkSpace.s12,
                      ),
                    ),
                    const _CheckoutItems(),
                    const SizedBox(height: BlynkSpace.s24),
                    if (couponsEnabled) ...[
                      const CheckoutCouponField(),
                      const SizedBox(height: BlynkSpace.s16),
                    ],
                    CartPriceDetailWidget(showCoupon: couponsEnabled, showBirthday: true),
                    const CancellationPolicyCard(),
                  ],
                ),
              ),
            ),
      bottomNavigationBar: isEmpty
          ? null
          // Keyed so a test can measure the bar's RENDERED height - see the
          // note on the cart's bar and W4 report section 8.1.
          : DecoratedBox(
              key: const Key('checkout-action-bar'),
              decoration: const BoxDecoration(
                color: BlynkColors.paper,
                border: Border(top: BorderSide(color: BlynkColors.line)),
              ),
              child: SafeArea(
                top: false,
                child: Center(
                  heightFactor: 1,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    // The payment bar's inner Column is MainAxisSize.max, so
                    // a bounded height budget makes it swallow the whole
                    // viewport. A Column(min) hands it an unbounded main axis
                    // instead, which is what the old two-bar footer did by
                    // accident. Do not flatten this away.
                    child: const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [CartScreenPaymentContainer()],
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

/// The cart lines, read-only. Every value is the [CartLine]'s own: the
/// product's name and unit, its quantity, its `effectivePrice` and the line
/// total the cart already holds. Nothing is re-priced or re-summed here.
class _CheckoutItems extends StatelessWidget {
  const _CheckoutItems();

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final lines = cart.lines;
    // Combo packs (owner, 2026-10-09) first, each with its products under it.
    final rows = <Widget>[
      for (final combo in cart.comboLines) _CheckoutComboRow(line: combo),
      for (final line in lines) _CheckoutItemRow(line: line),
    ];

    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(BlynkSpace.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const SizedBox(height: BlynkSpace.s16),
            rows[i],
          ],
        ],
      ),
    );
  }
}

class _CheckoutItemRow extends StatelessWidget {
  const _CheckoutItemRow({required this.line});

  final CartLine line;

  static const double _thumb = 48;

  @override
  Widget build(BuildContext context) {
    final product = line.product;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: _thumb,
          height: _thumb,
          child: ProductImageWell(product: product, semantic: false),
        ),
        const SizedBox(width: BlynkSpace.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                product.name,
                maxLines: BlynkType.productNameMaxLines,
                overflow: BlynkType.productNameOverflow,
                style: BlynkText.rowLabel,
              ),
              const SizedBox(height: BlynkSpace.s4 - 2),
              Text(
                product.unit.trim().isEmpty
                    ? '${line.quantity} in cart'
                    : '${line.quantity} × ${product.unit}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: BlynkType.productUnit,
              ),
            ],
          ),
        ),
        const SizedBox(width: BlynkSpace.s12),
        MoneyText(
          line.lineTotal,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: BlynkType.price,
        ),
      ],
    );
  }
}

/// One combo pack, read-only: its picture, name, the products in one pack in
/// small text, the packs, and the line total the cart holds.
class _CheckoutComboRow extends StatelessWidget {
  const _CheckoutComboRow({required this.line});

  final CartComboLine line;

  static const double _thumb = 48;

  @override
  Widget build(BuildContext context) {
    final combo = line.combo;
    return Row(
      key: ValueKey('checkout-combo/${combo.id}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: _thumb, height: _thumb, child: ComboThumb(combo: combo)),
        const SizedBox(width: BlynkSpace.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                combo.name,
                maxLines: BlynkType.productNameMaxLines,
                overflow: BlynkType.productNameOverflow,
                style: BlynkText.rowLabel,
              ),
              const SizedBox(height: BlynkSpace.s4 - 2),
              Text(
                '${line.quantity} × combo pack',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: BlynkType.productUnit,
              ),
              Text(
                combo.itemsSummary,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
              ),
            ],
          ),
        ),
        const SizedBox(width: BlynkSpace.s12),
        MoneyText(
          line.lineTotal,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: BlynkType.price,
        ),
      ],
    );
  }
}
