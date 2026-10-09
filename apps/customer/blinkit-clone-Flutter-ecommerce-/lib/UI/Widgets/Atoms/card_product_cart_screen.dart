import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/cart.provider.dart';
import '../../../Models/order_format.dart';
import 'add_to_cart_button.dart';
import 'image_well.dart';
import 'money_text.dart';
import '../../../design/tokens.dart';

/// One cart line. Everything shown comes from the [CartLine] held by
/// CartProvider; quantity changes go through the shared [AddToCartButton]
/// stepper, so the cart, product cards and Product Details can't drift
/// apart.
///
/// 2026-09 redesign (W4): the thumbnail is the shared [ProductImageWell], so a
/// cart line shows exactly the same tint, radius, inset and no-image fallback
/// as a product card — and uploading a photo later moves nothing. The line's
/// money is still the line's own `lineTotal`; nothing here re-prices anything.
class CartProductCard extends StatelessWidget {
  const CartProductCard({
    super.key,
    required this.line,
    this.interactive = true,
  });

  final CartLine line;

  /// False for the frozen copy shown while a removed line animates out -
  /// its product is no longer in the cart, so it must not offer controls.
  final bool interactive;

  // Rows at least this wide put price and stepper on the name's line.
  static const double _wideRowBreakpoint = 520;

  @override
  Widget build(BuildContext context) {
    final product = line.product;

    return Container(
      // W9: the PRODUCT card recipe, not the generic one. A cart line is the
      // same object the customer tapped on Home and on the listing, and both
      // of those draw `BlynkCardProduct` — paper, the card radius, the soft
      // elevation and deliberately **no** stroke. This card carried
      // `appCardDecoration()`'s extra hairline, so the identical product
      // gained an outline on its way into the cart. The generic recipe stays
      // where it belongs: the bill, the timeline, the items section.
      decoration: const BoxDecoration(
        color: BlynkCardProduct.surface,
        borderRadius: BlynkCardProduct.radius,
        boxShadow: BlynkCardProduct.elevation,
      ),
      padding: const EdgeInsets.all(BlynkSpace.s12),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= _wideRowBreakpoint;
          final imageSize = wide ? 80.0 : 72.0;

          final image = Semantics(
            button: interactive,
            label: interactive ? 'View ${product.name}' : null,
            excludeSemantics: true,
            child: InkWell(
              borderRadius: BlynkWell.radius,
              onTap: interactive
                  ? () => Navigator.of(context)
                      .pushNamed('/product', arguments: product)
                  : null,
              child: SizedBox(
                width: imageSize,
                height: imageSize,
                // The card already speaks the product name through this tap
                // target, so the well's own image node is turned off.
                child: ProductImageWell(product: product, semantic: false),
              ),
            ),
          );

          final details = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                product.name,
                maxLines: BlynkType.productNameMaxLines,
                overflow: BlynkType.productNameOverflow,
                style: BlynkType.productName,
              ),
              if (product.unit.trim().isNotEmpty) ...[
                const SizedBox(height: BlynkSpace.s4 - 2),
                Text(
                  product.unit,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: BlynkType.productUnit,
                ),
              ],
            ],
          );

          final price = _LinePrice(line: line, alignEnd: wide);
          final stepper = interactive
              ? AddToCartButton(product: product, compact: false)
              // Same footprint as the live stepper (48 dp tall) so the fade-out
              // copy doesn't shift while it leaves.
              : const SizedBox(height: BlynkStepper.minTapSize, width: 124);
          final remove = _RemoveButton(line: line, enabled: interactive);

          if (wide) {
            return Row(
              children: [
                image,
                const SizedBox(width: BlynkSpace.s16),
                Expanded(child: details),
                const SizedBox(width: BlynkSpace.s16),
                SizedBox(width: 120, child: price),
                const SizedBox(width: BlynkSpace.s16),
                stepper,
                const SizedBox(width: BlynkSpace.s4),
                remove,
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              image,
              const SizedBox(width: BlynkSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: details),
                        remove,
                      ],
                    ),
                    const SizedBox(height: BlynkSpace.s8),
                    // Wrap: at a large text size the stepper drops below the
                    // price instead of squeezing it.
                    SizedBox(
                      width: double.infinity,
                      child: Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: BlynkSpace.s8,
                        children: [price, stepper],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _LinePrice extends StatelessWidget {
  const _LinePrice({required this.line, required this.alignEnd});

  final CartLine line;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment:
          alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        MoneyText(
          line.lineTotal,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: BlynkType.price,
        ),
        if (line.quantity > 1)
          Text(
            '${line.quantity} × ${formatLkr(line.product.effectivePrice)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
      ],
    );
  }
}

class _RemoveButton extends StatelessWidget {
  const _RemoveButton({required this.line, required this.enabled});

  final CartLine line;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Remove ${line.product.name}',
      onPressed: enabled
          ? () => context.read<CartProvider>().remove(line.product.id)
          : null,
      icon: const Icon(Icons.delete_outline, size: BlynkIcons.sm),
      color: BlynkColors.ink2,
      disabledColor: BlynkDisabled.fill,
      // A 48 x 48 hit target (it sat at 40 x 40 with compact density).
      constraints: const BoxConstraints(
        minWidth: BlynkControl.minHeight,
        minHeight: BlynkControl.minHeight,
      ),
      padding: EdgeInsets.zero,
    );
  }
}
