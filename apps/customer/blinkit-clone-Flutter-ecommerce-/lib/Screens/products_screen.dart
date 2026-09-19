import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/app_colors.dart';
import '../Models/category_model.dart';
import '../UI/Widgets/Organisms/bottom_cart_container.dart';
import '../UI/Widgets/Organisms/products_screen_grid.dart';
import '../UI/Widgets/Organisms/products_screen_sub_category_list.dart';
import '../Services/Providers/product.provider.dart';

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key, required this.categorySlug});

  /// Empty string means "all products" (no category filter).
  final String categorySlug;

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  late String _activeSlug;

  @override
  void initState() {
    super.initState();
    _activeSlug = widget.categorySlug;
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  void _load() {
    final productProvider = context.read<ProductProvider>();
    // Opening a listing re-validates against the backend: whatever Home
    // cached earlier shows at once and is replaced when the answer arrives.
    productProvider.loadCategories();
    productProvider.loadProducts(
      categorySlug: _activeSlug.isEmpty ? null : _activeSlug,
      force: true,
    );
  }

  void _onCategorySelected(CategoryModel category) {
    setState(() => _activeSlug = category.slug);
    context
        .read<ProductProvider>()
        .loadProducts(categorySlug: category.slug, force: true);
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        final title = _activeSlug.isEmpty
            ? 'All Products'
            : productProvider.categories
                .firstWhere(
                  (c) => c.slug == _activeSlug,
                  orElse: () => const CategoryModel(id: '', name: 'Products', slug: ''),
                )
                .name;

        final products = productProvider.productsFor(_activeSlug);
        final isLoading = productProvider.isLoadingProducts(_activeSlug);

        return Scaffold(
          backgroundColor: AppColors.greyWhiteColor,
          appBar: AppBar(
            leadingWidth: 25,
            automaticallyImplyLeading: true,
            title: Text(title),
            actions: [
              IconButton(
                icon: const Icon(Icons.search),
                tooltip: 'Search',
                onPressed: () => Navigator.of(context).pushNamed(
                  '/search',
                  arguments: _activeSlug.isEmpty ? null : _activeSlug,
                ),
              ),
              const SizedBox(
                width: 10,
              ),
            ],
          ),
          body: Stack(
            children: [
              // Both side panels used to be forced to the full screen height via
              // raw MediaQuery, which is taller than what's actually left inside
              // Scaffold.body once the AppBar/status bar are subtracted - a real
              // vertical overflow on every breakpoint. CrossAxisAlignment.stretch
              // lets each Expanded child fill exactly the Row's real height.
              Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    flex: 1,
                    child: Container(
                      color: Colors.white,
                      child: CategorySidebar(
                        activeSlug: _activeSlug,
                        onSelect: _onCategorySelected,
                      ),
                    ),
                  ),
                  const SizedBox(
                    width: 10,
                  ),
                  Expanded(
                    flex: 4,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 10),
                      child: productProvider.productsError != null
                          ? Center(
                              child: Text(
                                'Something went wrong loading products.',
                                style: TextStyle(color: Colors.grey.shade600),
                              ),
                            )
                          : isLoading
                              ? const Center(child: CircularProgressIndicator())
                              : buildProductsGrid(context, products),
                    ),
                  ),
                  const SizedBox(
                    width: 10,
                  ),
                ],
              ),
              const BottomStickyContainer()
            ],
          ),
        );
      },
    );
  }
}
