import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/cart.provider.dart';
import '../UI/Widgets/Atoms/card_cancellation_policy.dart';
import '../UI/Widgets/Organisms/card_cart_prices_detail.dart';
import '../UI/Widgets/Organisms/cart_screen_address_container.dart';
import '../UI/Widgets/Organisms/cart_screen_payment_container.dart';
import '../UI/Widgets/Organisms/empty_cart_view.dart';
import '../app_design.dart';

/// Checkout step reached from the Cart's Proceed to Checkout.
///
/// This hosts the existing, already-verified checkout pieces unchanged:
/// the delivery address bar and the Cash on Delivery / Place Order bar
/// (which submits to the backend and opens the confirmation). Its visual
/// redesign belongs to the Checkout phase.
class CheckoutScreen extends StatelessWidget {
  const CheckoutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isEmpty = context.select<CartProvider, bool>((c) => c.isEmpty);

    return Scaffold(
      backgroundColor: AppSurfaces.subtle,
      appBar: AppBar(
        title: const Text('Checkout'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: isEmpty
          ? const EmptyCartView()
          : Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: const [
                    CartPriceDetailWidget(),
                    CancellationPolicyCard(),
                  ],
                ),
              ),
            ),
      bottomNavigationBar: isEmpty
          ? null
          : SafeArea(
              top: false,
              child: Center(
                heightFactor: 1,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 720),
                  child: const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CartScreenAddressContainer(),
                      CartScreenPaymentContainer(),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}
