import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app_colors.dart';
import '../../../app_design.dart';
import '../../../Models/product_model.dart';
import '../../../Services/Providers/cart.provider.dart';

/// Shows "Add" while the product isn't in the cart, and swaps to a
/// [-] qty [+] stepper once it is - backed by the real CartProvider, which
/// is the app's single source of cart truth. The swap is animated so the
/// change registers without feeling like a layout jump.
///
/// [expanded] is the full-width variant used as the Product Details CTA:
/// same states and same cart calls, just sized as a primary button.
class AddToCartButton extends StatelessWidget {
  const AddToCartButton({
    super.key,
    required this.product,
    this.compact = true,
    this.expanded = false,
  });

  final ProductModel product;
  final bool compact;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    return Consumer<CartProvider>(
      builder: (context, cart, _) {
        final quantity = cart.quantityOf(product.id);

        final child = AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          transitionBuilder: (child, animation) => ScaleTransition(
            scale: Tween<double>(begin: 0.9, end: 1.0).animate(animation),
            child: FadeTransition(opacity: animation, child: child),
          ),
          child: quantity == 0
              ? _AddButton(
                  key: const ValueKey('add'),
                  product: product,
                  compact: compact,
                  expanded: expanded,
                )
              : _QuantityStepper(
                  key: const ValueKey('stepper'),
                  product: product,
                  quantity: quantity,
                  compact: compact,
                  expanded: expanded,
                ),
        );

        return expanded ? SizedBox(height: 52, child: child) : child;
      },
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({
    super.key,
    required this.product,
    required this.compact,
    required this.expanded,
  });

  final ProductModel product;
  final bool compact;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final isAvailable = product.isAvailable;
    final label = expanded
        ? (isAvailable ? 'Add to Cart' : 'Currently unavailable')
        : (isAvailable ? 'ADD' : 'N/A');

    return Semantics(
      button: true,
      enabled: isAvailable,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: AppRadius.buttonBorder,
          onTap: isAvailable
              ? () => context.read<CartProvider>().add(product)
              : null,
          child: Container(
            alignment: expanded ? Alignment.center : null,
            padding: EdgeInsets.symmetric(
              horizontal: compact ? AppSpacing.lg : AppSpacing.xl,
              vertical: compact ? 6 : AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              // Blynk Yellow is the action colour; unavailable falls back to a
              // neutral so it doesn't read as a live CTA.
              color: isAvailable
                  ? AppColors.primaryYellowColor
                  : AppSurfaces.tile,
              borderRadius: AppRadius.buttonBorder,
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: expanded ? 16 : (compact ? 12 : 14),
                fontWeight: FontWeight.w800,
                letterSpacing: expanded ? 0.1 : 0.4,
                color: isAvailable
                    ? AppTextColors.onYellow
                    : AppTextColors.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({
    super.key,
    required this.product,
    required this.quantity,
    required this.compact,
    required this.expanded,
  });

  final ProductModel product;
  final int quantity;
  final bool compact;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final cart = context.read<CartProvider>();
    final iconSize = expanded ? 22.0 : (compact ? 15.0 : 18.0);

    Widget tap(Widget child) => expanded ? Expanded(child: child) : child;

    return Container(
      height: expanded ? 52 : null,
      decoration: BoxDecoration(
        color: AppColors.primaryYellowColor,
        borderRadius: AppRadius.buttonBorder,
      ),
      child: Row(
        mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
        children: [
          tap(_StepperTap(
            icon: Icons.remove,
            size: iconSize,
            expanded: expanded,
            compact: compact,
            onTap: () => cart.decrement(product),
            semanticLabel: 'Remove one ${product.name}',
          )),
          SizedBox(
            width: expanded ? 40 : (compact ? 20 : 26),
            child: Semantics(
              label: '$quantity in cart',
              excludeSemantics: true,
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 160),
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: ScaleTransition(
                    scale: Tween<double>(begin: 0.7, end: 1.0)
                        .animate(animation),
                    child: child,
                  ),
                ),
                child: Text(
                  '$quantity',
                  key: ValueKey(quantity),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppTextColors.onYellow,
                    fontWeight: FontWeight.w800,
                    fontSize: expanded ? 18 : (compact ? 13 : 15),
                  ),
                ),
              ),
            ),
          ),
          tap(_StepperTap(
            icon: Icons.add,
            size: iconSize,
            expanded: expanded,
            compact: compact,
            onTap: () => cart.add(product),
            semanticLabel: 'Add one more ${product.name}',
          )),
        ],
      ),
    );
  }
}

class _StepperTap extends StatelessWidget {
  const _StepperTap({
    required this.icon,
    required this.onTap,
    required this.size,
    required this.semanticLabel,
    this.expanded = false,
    this.compact = true,
  });

  final IconData icon;
  final VoidCallback onTap;
  final double size;
  final String semanticLabel;
  final bool expanded;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: InkWell(
        borderRadius: AppRadius.buttonBorder,
        onTap: onTap,
        // Expanded taps fill their half of the CTA, so the whole side is
        // a target and the stepper fits however narrow the bar gets.
        child: expanded
            ? SizedBox.expand(
                child: Icon(icon, size: size, color: AppTextColors.onYellow),
              )
            : Padding(
                // The medium (cart row) size gets a 40 px tall target.
                padding: EdgeInsets.symmetric(
                  horizontal: compact ? AppSpacing.sm : AppSpacing.md - 2,
                  vertical: compact ? 6 : 11,
                ),
                child: Icon(icon, size: size, color: AppTextColors.onYellow),
              ),
      ),
    );
  }
}
