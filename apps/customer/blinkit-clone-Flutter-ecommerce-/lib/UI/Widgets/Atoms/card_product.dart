import 'package:flutter/material.dart';

import 'add_to_cart_button.dart';
import '../../../Models/product_model.dart';
import '../../../app_design.dart';
import '../../../constants.dart';

/// The single product tile used by Home rails, category grids and search
/// results. There is deliberately only one of these - every grid in the app
/// renders through it so spacing, price formatting and the add-to-cart
/// affordance can't diverge screen to screen.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final isAvailable = product.isAvailable;

    return InkWell(
      borderRadius: AppRadius.cardBorder,
      onTap: () => Navigator.of(context).pushNamed('/product', arguments: product),
      child: Container(
        decoration: appCardDecoration(),
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.field),
                      child: Container(
                        color: AppSurfaces.subtle,
                        child: ProductImage(product: product),
                      ),
                    ),
                  ),
                  // Only shown when the backend actually reports the product
                  // as unavailable - never inferred or faked client-side.
                  if (!isAvailable)
                    Positioned.fill(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(AppRadius.field),
                        child: Container(
                          color: Colors.white.withValues(alpha: 0.72),
                          alignment: Alignment.center,
                          child: const Text(
                            'Unavailable',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 12,
                              color: AppTextColors.secondary,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            // Always reserves two lines so a one-line name doesn't give its
            // tile a taller image than its two-line neighbour in the row.
            SizedBox(
              height: MediaQuery.textScalerOf(context).scale(14) * 1.25 * 2 + 1,
              child: Text(
                product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  height: 1.25,
                  color: AppTextColors.primary,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              product.unit,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                color: AppTextColors.secondary,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Flexible(
                  child: Text(
                    '$appCurrencySybmbol ${product.sellingPrice.toStringAsFixed(0)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppTextColors.primary,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.xs),
                AddToCartButton(product: product),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The one product image renderer (grid tiles and Product Details), so
/// fit, fade-in and the no-image fallback stay identical everywhere.
class ProductImage extends StatelessWidget {
  const ProductImage({super.key, required this.product, this.fallbackIconSize = 34});

  final ProductModel product;
  final double fallbackIconSize;

  @override
  Widget build(BuildContext context) {
    final url = product.imageUrl;
    if (url == null || url.isEmpty) {
      return _ImageFallback(iconSize: fallbackIconSize);
    }

    return Image.network(
      url,
      fit: BoxFit.contain,
      // Flutter's network image cache handles repeats; this only smooths
      // the first paint so the grid doesn't flash.
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        if (wasSynchronouslyLoaded) return child;
        return AnimatedOpacity(
          opacity: frame == null ? 0 : 1,
          duration: const Duration(milliseconds: 220),
          child: child,
        );
      },
      errorBuilder: (_, __, ___) => _ImageFallback(iconSize: fallbackIconSize),
    );
  }
}

// Seeded products have no image_url yet, so this is what actually renders
// today - a clean placeholder rather than a broken-image glyph.
class _ImageFallback extends StatelessWidget {
  const _ImageFallback({required this.iconSize});

  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppSurfaces.subtle,
      alignment: Alignment.center,
      child: Icon(
        Icons.shopping_basket_outlined,
        color: AppTextColors.muted,
        size: iconSize,
      ),
    );
  }
}
