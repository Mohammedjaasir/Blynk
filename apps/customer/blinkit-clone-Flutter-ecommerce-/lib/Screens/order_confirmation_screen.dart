import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import 'package:provider/provider.dart';

import '../Models/order_format.dart';
import '../Services/Providers/order.provider.dart';
import '../app_colors.dart';
import '../app_design.dart';

class OrderConfirmationScreen extends StatelessWidget {
  const OrderConfirmationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final order = context.watch<OrderProvider>().lastPlacedOrder;

    return Scaffold(
      backgroundColor: AppColors.greyWhiteColor,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Lottie.asset(
                'Assets/cart_packing.json',
                height: 180,
                width: 180,
                repeat: true,
              ),
              if (order != null) ...[
                Text(
                  order.orderNumber,
                  textAlign: TextAlign.center,
                  // The scaffold is the grey-white page, so this uses the
                  // on-background token (6.72:1) rather than `secondary`,
                  // which is only 4.29:1 off a card.
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppTextColors.onBackground,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
              ],
              const Text(
                'Gotcha!',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Your order has been placed successfully.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                ),
              ),
              if (order != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(
                  key: const Key('confirmation-amount'),
                  order.paymentMethod == 'COD'
                      ? '${formatLkr(order.totalAmount)} · Cash on delivery'
                      : formatLkr(order.totalAmount),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppTextColors.primary,
                  ),
                ),
                if (order.isScheduled) ...[
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: AppSpacing.sm,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                      border: Border.all(color: AppSurfaces.border),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(top: 2),
                          child: Icon(Icons.schedule, size: 16, color: AppTextColors.secondary),
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        Flexible(
                          child: Text(
                            key: const Key('confirmation-schedule'),
                            'Scheduled — delivery ${formatScheduled(order.scheduledFor!)}',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppTextColors.primary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
              const SizedBox(height: AppSpacing.xxl),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  key: const Key('view-order'),
                  onPressed: order == null
                      ? null
                      : () => Navigator.of(context).pushNamed('/order', arguments: order.id),
                  style: appPrimaryButtonStyle(),
                  child: const Text('View order'),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context)
                      .pushNamedAndRemoveUntil('/home', (route) => false),
                  child: const Text('Back to Home'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
