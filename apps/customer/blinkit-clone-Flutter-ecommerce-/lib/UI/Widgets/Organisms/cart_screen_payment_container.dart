import 'package:flutter/material.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../../../app_colors.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';

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
        Navigator.of(context).pushNamed('/order/confirm');
      }
    } catch (e) {
      if (context.mounted) {
        showAppToast(
          msg: orderProvider.placeOrderError ?? 'Could not place your order. Please try again.',
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isPlacingOrder = context.watch<OrderProvider>().isPlacingOrder;
    final isCartEmpty = context.watch<CartProvider>().isEmpty;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      color: Colors.white,
      width: double.infinity,
      height: 70,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Row(
            children: [
              Icon(
                Icons.payment,
                color: Colors.orangeAccent,
              ),
              SizedBox(
                width: 15,
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    "Payment Method",
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                  // Phase 1 is Cash on Delivery only - the payments module
                  // is a deliberate stub server-side, so no other method is
                  // offered here.
                  Text(
                    "Cash on Delivery",
                    style: TextStyle(fontWeight: FontWeight.w300),
                  ),
                ],
              )
            ],
          ),
          ElevatedButton(
            onPressed: (isPlacingOrder || isCartEmpty) ? null : () => _placeOrder(context),
            style: TextButton.styleFrom(
              backgroundColor: AppColors.primaryGreenColor,
              foregroundColor: AppColors.greyWhiteColor,
              padding: const EdgeInsets.symmetric(
                horizontal: 25,
              ),
            ),
            child: isPlacingOrder
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text("Place Order"),
          )
        ],
      ),
    );
  }
}
