import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/card_product.dart';
import '../Atoms/entrance_fade.dart';
import '../Atoms/failure_states.dart';
import '../Atoms/section_header.dart';
import 'product_rail.dart';
import 'products_screen_grid.dart';
import '../../../Models/category_model.dart';
import '../../../Models/product_model.dart';
import '../../../Services/Providers/product.provider.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// Home's products, under the category tiles (owner, 2026-10-07: "the
/// customer should be able to scroll and see lots of products").
///
/// One request for the whole catalogue ([ProductProvider.loadProducts] with no
/// category), then, top to bottom:
///
/// * a **rail per category** that has at least [railMinimum] products, in
///   the categories' own order, each with "See all" opening that category's
///   page - swiped sideways on a phone, one full row of cards on a desktop
///   browser (a mouse wheel cannot scroll sideways);
/// * an **"All products" grid** of every product, on the one grid rule
///   ([BlynkProductGrid]): 2-3 columns on a phone, 4-5 on a desktop browser.
///
/// Only real products: no placeholders, no invented "popular" ranking.
class HomeProductFeed extends StatefulWidget {
  const HomeProductFeed({super.key, this.entranceDelay = Duration.zero});

  /// Added to the grid's stagger: when this section appears on Home's
  /// entrance timeline.
  final Duration entranceDelay;

  /// A category needs this many products to get its own rail; fewer would
  /// read as an empty shelf (they are still in the grid below).
  static const int railMinimum = 3;

  /// The most products a rail carries before "See all".
  static const int railMaximum = 12;

  static const String allProductsTitle = 'All products';
  static const Key retryKey = Key('home-products-retry');

  /// Category rails for [products], ordered like [categories]: categories
  /// with at least [railMinimum] products, at most [railMaximum] each.
  static List<({CategoryModel category, List<ProductModel> products})> railsFor(
    List<CategoryModel> categories,
    List<ProductModel> products,
  ) {
    final byCategory = <String, List<ProductModel>>{};
    for (final p in products) {
      (byCategory[p.categoryId] ??= []).add(p);
    }
    final ordered = [...categories]..sort((a, b) => a.displayOrder.compareTo(b.displayOrder));
    return [
      for (final c in ordered)
        if ((byCategory[c.id]?.length ?? 0) >= railMinimum)
          (category: c, products: byCategory[c.id]!.take(railMaximum).toList()),
    ];
  }

  @override
  State<HomeProductFeed> createState() => _HomeProductFeedState();
}

class _HomeProductFeedState extends State<HomeProductFeed> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final provider = context.read<ProductProvider>();
      provider.loadProducts();
      provider.loadCategories();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ProductProvider>(
      builder: (context, provider, _) {
        final products = provider.productsFor('');
        final loading = provider.isLoadingProducts('');
        final failure = provider.productsFailureFor('');

        return SliverLayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.crossAxisExtent;
            final gutter = BlynkProductGrid.gutterFor(width);
            final header = EdgeInsets.fromLTRB(gutter, BlynkSpace.s24, BlynkSpace.s8, BlynkSpace.s12);

            if (products.isEmpty && loading) {
              return SliverMainAxisGroup(slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(gutter, BlynkSpace.s24, gutter, BlynkSpace.s12),
                    child: const Align(alignment: Alignment.centerLeft, child: AppSkeleton(width: 140, height: 16)),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.symmetric(horizontal: gutter),
                  // Each skeleton card joins the shared pulse itself.
                  sliver: SliverGrid(
                    gridDelegate: productGridDelegate(context, width),
                    delegate: SliverChildBuilderDelegate(
                      (_, __) => const ProductCardSkeleton(),
                      childCount: BlynkProductGrid.columnsFor(width) * 2,
                    ),
                  ),
                ),
              ]);
            }

            // One failure message per screen: when the category tiles above
            // have failed too, theirs already speaks (and retries both).
            if (products.isEmpty && failure != null && provider.homeGroupsFailure != null) {
              return const SliverToBoxAdapter(child: SizedBox.shrink());
            }
            if (products.isEmpty && failure != null) {
              return SliverToBoxAdapter(
                child: FailureState(
                  failure: failure,
                  title: "We couldn't load products",
                  retryKey: HomeProductFeed.retryKey,
                  scrollable: false,
                  onRetry: () => provider.loadProducts(force: true),
                ),
              );
            }

            // An empty catalogue draws nothing: no heading over an empty box.
            if (products.isEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());

            final rails = HomeProductFeed.railsFor(provider.categories, products);
            final desktop = width >= AppBreakpoints.desktop;
            final columns = BlynkProductGrid.columnsFor(width);
            return SliverMainAxisGroup(slivers: [
              for (final rail in rails) ...[
                SliverToBoxAdapter(
                  child: BlynkSectionHeader(
                    key: ValueKey('home-rail/${rail.category.id}'),
                    title: rail.category.name,
                    padding: header,
                    actionLabel: 'See all',
                    onAction: () => Navigator.of(context).pushNamed('/products', arguments: rail.category.slug),
                  ),
                ),
                // The same products are in the grid below, which keeps the
                // image flight (one hero tag per product per screen).
                if (desktop)
                  // A mouse wheel cannot scroll sideways, so a desktop
                  // browser gets one full row of cards; "See all" has the rest.
                  SliverPadding(
                    padding: EdgeInsets.symmetric(horizontal: gutter),
                    sliver: SliverGrid(
                      gridDelegate: productGridDelegate(context, width),
                      delegate: SliverChildListDelegate([
                        for (final p in rail.products.take(columns)) ProductCard(product: p, hero: false),
                      ]),
                    ),
                  )
                else
                  SliverToBoxAdapter(child: ProductRail(products: rail.products, heroes: false)),
              ],
              SliverToBoxAdapter(
                child: BlynkSectionHeader(
                  key: const ValueKey('home-all-products'),
                  title: HomeProductFeed.allProductsTitle,
                  padding: header,
                ),
              ),
              SliverPadding(
                padding: EdgeInsets.symmetric(horizontal: gutter),
                sliver: SliverGrid(
                  gridDelegate: productGridDelegate(context, width),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final product = products[index];
                      return EntranceFade(
                        key: ValueKey('home-all/${product.id}'),
                        delay: widget.entranceDelay + BlynkMotion.staggerFor(index),
                        child: ProductCard(product: product),
                      );
                    },
                    childCount: products.length,
                  ),
                ),
              ),
            ]);
          },
        );
      },
    );
  }
}
