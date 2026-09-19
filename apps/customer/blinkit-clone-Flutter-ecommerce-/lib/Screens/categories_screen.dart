import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/product.provider.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/category_widget.dart';
import '../app_design.dart';
import '../app_responsive.dart';

/// Full catalog browse screen. Every category comes from the backend via
/// ProductProvider - nothing here is a hardcoded list.
class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Re-validate on open; the cached list stays visible meanwhile.
      context.read<ProductProvider>().loadCategories(force: true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    // Category tiles are small, so they take more columns than the product
    // grid does at the same width.
    final crossAxisCount = responsive.isDesktop
        ? (responsive.width >= 1600 ? 8 : 6)
        : (responsive.isTablet ? 5 : 3);

    return Scaffold(
      appBar: AppBar(title: const Text('Categories')),
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
          child: Consumer<ProductProvider>(
            builder: (context, productProvider, _) {
              if (productProvider.isLoadingCategories) {
                return GridView.builder(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  gridDelegate: _delegate(crossAxisCount),
                  itemCount: 12,
                  itemBuilder: (_, __) => const CategoryTileSkeleton(),
                );
              }

              if (productProvider.categoriesError != null) {
                return AppStateView(
                  icon: Icons.wifi_off_rounded,
                  title: "We couldn't load categories",
                  message:
                      'Check your connection and try again - your cart is safe.',
                  actionLabel: 'Try Again',
                  onAction: () =>
                      productProvider.loadCategories(force: true),
                );
              }

              final categories = productProvider.categories;

              if (categories.isEmpty) {
                return const AppStateView(
                  icon: Icons.storefront_outlined,
                  title: 'No categories yet',
                  message:
                      'Our catalog is being stocked. Please check back shortly.',
                );
              }

              return RefreshIndicator(
                onRefresh: () => productProvider.loadCategories(force: true),
                child: GridView.builder(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  gridDelegate: _delegate(crossAxisCount),
                  itemCount: categories.length,
                  itemBuilder: (context, index) =>
                      CategoryWidget(category: categories[index]),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  SliverGridDelegate _delegate(int crossAxisCount) {
    return SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: crossAxisCount,
      mainAxisSpacing: AppSpacing.lg,
      crossAxisSpacing: AppSpacing.md,
      childAspectRatio: 0.78,
    );
  }
}
