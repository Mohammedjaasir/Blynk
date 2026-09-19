import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/category_model.dart';
import '../../../app_colors.dart';
import '../../../Services/Providers/product.provider.dart';

// The backend's catalog is flat (categories, no nested subcategories - see
// backend/api/src/database/migrations/001_initial_schema.sql), so this is
// repurposed as a "browse other categories" rail using the same real
// category list shown on Home, rather than an invented subcategory taxonomy.
class CategorySidebar extends StatelessWidget {
  const CategorySidebar({super.key, required this.activeSlug, required this.onSelect});

  final String activeSlug;
  final ValueChanged<CategoryModel> onSelect;

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<ProductProvider>().categories;

    if (categories.isEmpty) {
      return const SizedBox.shrink();
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const BouncingScrollPhysics(),
      itemCount: categories.length,
      itemBuilder: (BuildContext context, int index) {
        final category = categories[index];
        final isActive = category.slug == activeSlug;

        return InkWell(
          onTap: () => onSelect(category),
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 10),
            padding: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              border: isActive
                  ? const Border(
                      right: BorderSide(
                        color: AppColors.primaryGreenColor,
                        width: 3,
                      ),
                    )
                  : null,
            ),
            child: Column(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: AppColors.greyWhiteColor,
                  backgroundImage: category.imageUrl != null && category.imageUrl!.isNotEmpty
                      ? NetworkImage(category.imageUrl!)
                      : null,
                  child: category.imageUrl == null || category.imageUrl!.isEmpty
                      ? const Icon(Icons.category_outlined, color: Color(0xffB0C4DE))
                      : null,
                ),
                Text(
                  category.name,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
