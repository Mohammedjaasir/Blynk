import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/cart.provider.dart';
import '../../../app_colors.dart';
import '../../../app_design.dart';
import '../../../constants.dart';

/// Floating cart CTA. Animates in when the cart has items and out when it
/// empties, and every number on it comes from CartProvider - there is no
/// hardcoded item count here.
///
/// The subtotal shown is the client-side estimate used while shopping; the
/// backend recalculates the authoritative total at checkout.
class BottomStickyContainer extends StatelessWidget {
  const BottomStickyContainer({super.key});

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final itemCount = cart.itemCount;
    final hasItems = itemCount > 0;

    return Align(
      alignment: Alignment.bottomCenter,
      child: AnimatedSlide(
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
        offset: hasItems ? Offset.zero : const Offset(0, 1.6),
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 200),
          opacity: hasItems ? 1 : 0,
          child: IgnorePointer(
            ignoring: !hasItems,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.sm,
                AppSpacing.md,
                AppSpacing.md,
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: AppRadius.cardBorder,
                  onTap: hasItems
                      ? () => Navigator.of(context).pushNamed('/cart')
                      : null,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg,
                      vertical: AppSpacing.md,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.primaryGreenColor,
                      borderRadius: AppRadius.cardBorder,
                      boxShadow: AppElevation.raised,
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.shopping_basket_rounded,
                          color: Colors.white,
                          size: 20,
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                '$itemCount ${itemCount == 1 ? 'item' : 'items'}',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 14,
                                ),
                              ),
                              Text(
                                '$appCurrencySybmbol ${cart.subtotal.toStringAsFixed(0)}',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.85),
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Text(
                          'View Cart',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        const Icon(
                          Icons.arrow_forward_rounded,
                          color: Colors.white,
                          size: 18,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
