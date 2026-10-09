import 'dart:async';

import 'package:flutter/material.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../../../app_design.dart' show appButtonTextScale, kStackButtonsAboveTextScale;
import '../../../design/tokens.dart';
import '../Atoms/blynk_button.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/product.provider.dart';
import '../../../Services/Exceptions/api_exception.dart';
import '../../../Services/app_errors.dart';
import '../../../Services/ordering_hours.dart';
import '../../../Services/store_info.dart';
import '../../../Services/push/push_notifications.dart';

/// The toast for a failed place-order. A timeout is worded as "we could not
/// confirm" because the order may well have been placed: the customer is sent
/// to Orders to check rather than told it failed. Trying again is safe:
/// OrderProvider.placeOrder sends the same idempotency key for the same
/// checkout, so the server answers a retry with the order it already made.
String placeOrderFailureMessage(CustomerError failure) => failure.isTimeout
    ? "We couldn't confirm your order. Check Orders before trying again."
    : failure.message;

class CartScreenPaymentContainer extends StatelessWidget {
  const CartScreenPaymentContainer({
    super.key,
  });

  Future<void> _placeOrder(BuildContext context) async {
    final cart = context.read<CartProvider>();
    final address = context.read<AddressProvider>().defaultAddress;
    final orderProvider = context.read<OrderProvider>();

    if (cart.isEmpty) return;

    if (address == null) {
      showAppToast(msg: 'Add a delivery address to place your order.');
      Navigator.of(context).pushNamed('/user/address');
      return;
    }

    try {
      // The backend independently verifies the delivery geofence,
      // recalculates prices, and computes the real total from its own
      // catalog data - this call submits the order, it doesn't assume the
      // client's estimate is what gets charged.
      final order = await orderProvider.placeOrder(cart: cart, addressId: address.id);
      if (order != null && context.mounted) {
        // The moment order updates matter: ask to allow notifications
        // (Android 13+; the system asks at most once or twice).
        unawaited(PushNotifications.instance.requestPermission());
        Navigator.of(context).pushNamed('/order/confirm');
      }
    } catch (e) {
      // A combo pack ended, changed or sold out (owner, 2026-10-09): reload
      // the combos so the rail and the cart line show where it stands now.
      if (e is ApiException && (e.code ?? '').startsWith('COMBO_') && context.mounted) {
        final products = context.read<ProductProvider?>();
        if (products != null) {
          unawaited(products.loadCombos(force: true).then((_) => cart.syncCombos(products.combos)));
        }
      }
      if (context.mounted) {
        showAppToast(msg: placeOrderFailureMessage(AppErrors.from(e)));
      }
    }
  }

  @override
  Widget build(BuildContext context) =>
      OrderingHoursBuilder(builder: (context, isOpen) => _bar(context, isOpen));

  Widget _bar(BuildContext context, bool isOpen) {
    final isPlacingOrder = context.watch<OrderProvider>().isPlacingOrder;
    final isCartEmpty = context.watch<CartProvider>().isEmpty;
    final stack = appButtonTextScale(context) > kStackButtonsAboveTextScale;

    // The same row shape, the same two type roles and the same icon size as
    // the delivery-address row directly above it on the checkout page: the
    // answer in `rowLabel`, its supporting line in `body`/`ink2`. They used to
    // be `bold`/`w500` and `label`/`body` - two ramps for one pattern.
    const method = Row(
      children: [
        Icon(Icons.payments_outlined, color: BlynkColors.ink2, size: BlynkIcons.md),
        SizedBox(width: BlynkSpace.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Phase 1 is Cash on Delivery only - the payments module
              // is a deliberate stub server-side, so no other method is
              // offered here.
              Text(StoreInfo.paymentMethodLabel, style: BlynkText.rowLabel),
              Text('Payment method', style: BlynkText.bodyMuted),
            ],
          ),
        ),
      ],
    );
    final place = BlynkButton.primary(
      label: 'Place order',
      loading: isPlacingOrder,
      expand: stack,
      // While placing, `loading` swallows taps, so the button keeps its look.
      // Outside ordering hours the backend would refuse it (STORE_CLOSED),
      // so the button waits for 8 AM and the note below says why.
      onPressed: isCartEmpty || !isOpen ? null : () => _placeOrder(context),
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s8, vertical: BlynkSpace.s8),
      color: BlynkColors.paper,
      width: double.infinity,
      // A floor, not a fixed height: a large text size must be able to grow the row.
      constraints: const BoxConstraints(minHeight: 70),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!isOpen) ...[const ClosedForOrdersNote(), const SizedBox(height: BlynkSpace.s8)],
          stack
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [method, const SizedBox(height: BlynkSpace.s8), place],
                )
              : Row(
                  children: [
                    const Expanded(child: method),
                    const SizedBox(width: BlynkSpace.s8),
                    place,
                  ],
                ),
        ],
      ),
    );
  }
}

/// Shown above Place order outside ordering hours (8 AM - 9 PM Sri Lanka).
class ClosedForOrdersNote extends StatelessWidget {
  const ClosedForOrdersNote({super.key});

  static const String text =
      "We're closed now. Orders open at ${StoreInfo.opensAtLabel} (we take orders ${StoreInfo.deliveryHoursLabel}).";

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
      decoration: const BoxDecoration(color: BlynkColors.noticeTint, borderRadius: BlynkRadius.smAll),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.schedule, color: BlynkColors.ink, size: BlynkIcons.md),
          SizedBox(width: BlynkSpace.s8),
          Expanded(child: Text(text, style: BlynkText.label)),
        ],
      ),
    );
  }
}
