import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/category_model.dart';
import '../UI/Widgets/Atoms/category_offer_banner.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Organisms/bottom_cart_container.dart';
import '../UI/Widgets/Organisms/products_screen_grid.dart';
import '../UI/Widgets/Organisms/products_screen_sub_category_list.dart';
import '../Services/Providers/product.provider.dart';
import '../Services/analytics/analytics.dart';
import '../design/tokens.dart';
import 'package:ecom/UI/Widgets/Atoms/entrance_fade.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_crossfade.dart';

/// Category listing: a sticky category rail on the left, the responsive
/// product grid on the right.
///
/// 2026-09 redesign (W3): the rail is a fixed-width `paper` column rather than
/// a fifth of the screen, so a wide viewport spends its extra width on product
/// columns instead of on a rail that grows to 300 dp.
///
/// The page sits on the soft [BlynkColors.well] tint and the cards and the
/// rail on `paper`: a page is the opposite surface of what sits on it, so a
/// screen of white cards gets a tinted page. That contrast is also what
/// separates the rail from the grid - there is no divider between them,
/// because sections are separated by space, not rules.
///
/// Everything a customer can do here is unchanged: the rail re-filters from
/// the real category list, the grid is the shared [buildProductsGrid], and the
/// floating cart bar still stacks over the content.
///
/// Sub-categories (2026-10-05): opened on a category, the rail is that
/// category's own - "All" and its sub-categories - and the title stays the
/// opened category's name while a sub-category filters the grid.
class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key, required this.categorySlug});

  /// Empty string means "all products" (no category filter).
  final String categorySlug;

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  late String _activeSlug;
  String? _listSentFor; // view_item_list once per category shown (owner, 2026-10-10)

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

  /// The category whose offer the banner shows, or null when none is running.
  CategoryModel? _offerCategory(ProductProvider provider, String titleSlug) {
    final known = [
      ...provider.categories,
      for (final group in provider.homeGroups) ...group.categories,
    ];
    CategoryModel? find(String slug) {
      if (slug.isEmpty) return null;
      for (final c in known) {
        if (c.slug == slug && c.isOfferActive) return c;
      }
      return null;
    }

    return find(_activeSlug) ?? find(titleSlug);
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        // Opened on a category: its name, whichever sub-category is picked.
        // Opened on "All products": the picked top-level category's name.
        final titleSlug =
            widget.categorySlug.isEmpty ? _activeSlug : widget.categorySlug;
        final title = titleSlug.isEmpty
            ? 'All Products'
            : productProvider.categories
                .firstWhere(
                  (c) => c.slug == titleSlug,
                  orElse: () => const CategoryModel(id: '', name: 'Products', slug: ''),
                )
                .name;

        // Category offer (owner, 2026-10-09): the picked (sub-)category's own
        // offer - the backend already gives a sub-category the larger of its
        // own and its parent's - else the opened category's.
        final offerCategory = _offerCategory(productProvider, titleSlug);

        final products = productProvider.productsFor(_activeSlug);
        if (products.isNotEmpty && _listSentFor != _activeSlug) {
          _listSentFor = _activeSlug;
          Analytics.instance.viewItemList(
              listId: _activeSlug.isEmpty ? 'all_products' : 'category_$_activeSlug', listName: title, products: products);
        }
        final isLoading = productProvider.isLoadingProducts(_activeSlug);
        // Per category: only this category's own failed first load shows here.
        final failure = productProvider.productsFailureFor(_activeSlug);

        // One EntranceScope per screen: a card that scrolls off and back is rebuilt at rest, not replayed.
        return EntranceScope(
          child: Scaffold(
          backgroundColor: BlynkColors.well,
          appBar: AppBar(
            automaticallyImplyLeading: true,
            title: Text(title),
            actions: [
              IconButton(
                icon: const Icon(BlynkIcons.search),
                tooltip: 'Search',
                onPressed: () => Navigator.of(context).pushNamed(
                  '/search',
                  arguments: _activeSlug.isEmpty ? null : _activeSlug,
                ),
              ),
              const SizedBox(width: BlynkSpace.s4),
            ],
          ),
          body: Stack(
            children: [
              // CrossAxisAlignment.stretch lets each child fill exactly the
              // Row's real height - the height left inside Scaffold.body, not
              // the whole screen, which is what a raw MediaQuery gave here and
              // which overflowed at every breakpoint.
              LayoutBuilder(
                builder: (context, constraints) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SizedBox(
                        width: CategorySidebar.widthFor(constraints.maxWidth),
                        child: ColoredBox(
                          color: BlynkColors.paper,
                          child: CategorySidebar(
                            rootSlug: widget.categorySlug,
                            activeSlug: _activeSlug,
                            onSelect: _onCategorySelected,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (offerCategory != null) CategoryOfferBanner(category: offerCategory),
                            Expanded(
                        // The skeleton gives way to the grid on a crossfade,
                        // top-aligned so the first row lands where its
                        // placeholder was. Keyed by state, so only a change
                        // fades; the first frame is never faded in.
                        child: BlynkCrossfade(
                          child: KeyedSubtree(
                            key: ValueKey<String>(isLoading
                                ? 'loading'
                                : (failure != null && products.isEmpty) ? 'failure' : 'grid'),
                            child: isLoading
                            ? buildProductsSkeletonGrid(context)
                            : (failure != null && products.isEmpty)
                                ? FailureState(
                                    failure: failure,
                                    title: "We couldn't load products",
                                    retryKey: const Key('products-retry'),
                                    scrollable: false,
                                    onRetry: () => productProvider.loadProducts(
                                      categorySlug: _activeSlug.isEmpty
                                          ? null
                                          : _activeSlug,
                                      force: true,
                                    ),
                                  )
                                : buildProductsGrid(context, products),
                          ),
                        ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
              const BottomStickyContainer(),
            ],
          ),
          ),
        );
      },
    );
  }
}
