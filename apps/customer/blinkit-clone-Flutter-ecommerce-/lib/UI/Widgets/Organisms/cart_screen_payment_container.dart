import 'dart:async';

import 'package:flutter/material.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../../../app_design.dart' show appButtonTextScale, kStackButtonsAboveTextScale;
import '../../../design/tokens.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/store_closed_banner.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/product.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
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

/// The store and slot refusals of POST /orders whose server sentence is
/// worth showing as is: STORE_CLOSED says when the store opens again (it
/// knows the closure reason and the hours Ops/Admin set), and the slot ones
/// say what happened to the picked time (owner, 2026-10-10).
const Set<String> serverWordedOrderRefusals = {'STORE_CLOSED', 'SLOT_UNAVAILABLE', 'SLOT_FULL'};

/// The toast for a failed place-order, from what was thrown: the server's
/// own sentence for [serverWordedOrderRefusals] (4xx messages are kept by
/// ApiService, 5xx text never is), else [placeOrderFailureMessage]
/// (owner, 2026-10-10).
String placeOrderErrorMessage(Object error) {
  if (error is ApiException &&
      serverWordedOrderRefusals.contains(error.code) &&
      error.statusCode >= 400 &&
      error.statusCode < 500 &&
      error.message.trim().isNotEmpty) {
    return error.message.trim();
  }
  return placeOrderFailureMessage(AppErrors.from(error));
}

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
      // A picked delivery slot goes with the order; none means "as soon as
      // possible" (owner, 2026-10-10).
      final order = await orderProvider.placeOrder(
        cart: cart,
        addressId: address.id,
        deliverySlotStart: orderProvider.selectedSlot?.start,
      );
      // The order took the birthday gift (owner, 2026-10-09): stop offering
      // it at once rather than until the next checkout-info.
      if (order != null && order.hasBirthdayGift && context.mounted) {
        context.read<StoreInfoProvider?>()?.markBirthdayGiftUsed();
      }
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
      // Closed after all (staff closed the store, or hours changed): ask
      // GET /store again so the banner and the button catch up, and reload
      // the slots so one can be picked instead (owner, 2026-10-10).
      if (e is ApiException && e.code == 'STORE_CLOSED' && context.mounted) {
        unawaited(context.read<StoreInfoProvider?>()?.refresh(force: true));
        if (orderProvider.slotsEnabled) unawaited(orderProvider.loadSlots());
      }
      if (context.mounted) {
        showAppToast(msg: placeOrderErrorMessage(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) =>
      OrderingHoursBuilder(builder: (context, isOpen) => _bar(context, isOpen));

  Widget _bar(BuildContext context, bool isOpen) {
    final orders = context.watch<OrderProvider>();
    final isPlacingOrder = orders.isPlacingOrder;
    // While closed, an order can still go in for a picked delivery slot
    // (owner, 2026-10-10).
    final slotsOn = orders.slotsEnabled;
    final canOrder = isOpen || (slotsOn && orders.selectedSlot != null);
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
      // While the store is closed the backend would refuse an ASAP order
      // (STORE_CLOSED), so the button waits for the store to open, or for a
      // delivery slot to be picked, and the note above says why
      // (owner, 2026-10-10).
      onPressed: isCartEmpty || !canOrder ? null : () => _placeOrder(context),
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
          if (!isOpen) ...[
            ClosedForOrdersNote(slotPicked: canOrder, slotsOn: slotsOn),
            const SizedBox(height: BlynkSpace.s8),
          ],
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

/// Shown above Place order while the store is closed: the live closed
/// banner ("Closed now — back at 8 AM tomorrow"), plus what to do when
/// delivery slots are on (owner, 2026-10-10).
class ClosedForOrdersNote extends StatelessWidget {
  const ClosedForOrdersNote({super.key, this.slotsOn = false, this.slotPicked = false});

  final bool slotsOn;
  final bool slotPicked;

  static const String pickSlotHint = 'Pick a delivery time above to order now.';
  static const String slotPickedHint = "We'll deliver at the time you picked.";

  @override
  Widget build(BuildContext context) => StoreClosedBanner(
        hint: !slotsOn ? null : (slotPicked ? slotPickedHint : pickSlotHint),
      );
}
