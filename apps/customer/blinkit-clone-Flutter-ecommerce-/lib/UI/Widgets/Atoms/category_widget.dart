import 'package:flutter/material.dart';

import '../../../Models/category_model.dart';
import '../../../app_colors.dart';
import '../../../app_design.dart';

/// A single category tile. Used both in Home's compact category rail and in
/// the full Categories screen, so the two can never drift out of sync.
class CategoryWidget extends StatelessWidget {
  const CategoryWidget({
    super.key,
    required this.category,
    this.isActive = false,
    this.onTap,
  });

  final CategoryModel category;
  final bool isActive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: AppRadius.cardBorder,
      onTap: onTap ??
          () => Navigator.pushNamed(
                context,
                '/products',
                arguments: category.slug,
              ),
      // The label takes the height it needs (names like "Biscuits & Snacks"
      // wrap to two lines) and the tile image absorbs whatever is left, so
      // the tile can't overflow its grid cell at narrow widths.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              decoration: BoxDecoration(
                color: isActive
                    ? AppColors.primaryYellowColor.withValues(alpha: 0.35)
                    : AppSurfaces.tile,
                borderRadius: AppRadius.cardBorder,
                border: isActive
                    ? Border.all(color: AppColors.primaryYellowColor, width: 2)
                    : null,
              ),
              padding: const EdgeInsets.all(AppSpacing.sm),
              alignment: Alignment.center,
              child: category.imageUrl != null && category.imageUrl!.isNotEmpty
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.field),
                      child: Image.network(
                        category.imageUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const _CategoryFallbackIcon(),
                      ),
                    )
                  : const _CategoryFallbackIcon(),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            category.name,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.15,
              fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
              color: AppTextColors.primary,
            ),
          ),
        ],
      ),
    );
  }
}

// Seeded categories currently have no image_url, so this is the honest
// default rather than a broken-image box.
class _CategoryFallbackIcon extends StatelessWidget {
  const _CategoryFallbackIcon();

  @override
  Widget build(BuildContext context) {
    return const Icon(
      Icons.local_grocery_store_outlined,
      color: AppTextColors.muted,
      size: 26,
    );
  }
}
