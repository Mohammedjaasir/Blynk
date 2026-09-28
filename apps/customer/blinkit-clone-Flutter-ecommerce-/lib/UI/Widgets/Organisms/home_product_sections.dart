import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/card_product.dart';
import '../Atoms/entrance_fade.dart';
import '../Atoms/section_header.dart';
import 'products_screen_grid.dart';
import '../../../Models/product_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/product_ranking.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/product.provider.dart';

/// Home's products, **shelf by shelf**: one section per real backend
/// category, each titled with the category's name, holding every available
/// product in it, with "See all" into the category page (see `_byCategory`).
/// Given a [categorySlug] it is instead one grid of that category.
///
/// **The title is what the query is, and what was actually done to it.**
/// There is still no recommendations endpoint in this backend, no popularity
/// signal and no cross-customer data, so the section is never called
/// "Recommended for you", "Popular right now" or "Trending" — those would be
/// invented.
///
/// What it may do, and say, is reorder the catalogue against **this
/// customer's own past orders** (see [rankByPurchaseHistory]). When that
/// ranking actually ran the title is [personalisedTitle], which is a
/// statement of fact the Orders screen can corroborate line for line. When
/// the customer is signed out, or signed in with nothing bought yet, no
/// reordering happens and the title stays [allTitle] — literally
/// `GET /catalog/products`. The claim and the data move together, or not at
/// all.
///
/// Columns, gutter, spacing and tile height all come from [BlynkProductGrid]
/// via [productGridDelegate], the one grid rule, so Home's grid is the same
/// grid as the category and search screens: 2 across on a phone.
class HomeProductSections extends StatefulWidget {
  const HomeProductSections({
    super.key,
    required this.categorySlug,
    required this.categoryName,
    this.entranceDelay = Duration.zero,
  });

  /// Added to every card's own stagger. Home passes the moment this section
  /// fades in on its entrance timeline, so the first card starts rising as
  /// the section becomes visible instead of having finished behind it.
  final Duration entranceDelay;

  /// The selected category's slug, or `null` for the whole catalogue.
  final String? categorySlug;

  /// The selected category's real backend name, or `null` for "All".
  final String? categoryName;

  /// The honest name for the catalogue-wide query, in the backend's own order.
  static const String allTitle = 'Browse all';

  /// Shown **only** when [rankByPurchaseHistory] actually reordered the grid,
  /// which needs a signed-in customer with at least one product in their
  /// order history. It names its source rather than implying an engine.
  static const String personalisedTitle = 'Based on your orders';

  /// Home lists **every available product** (2026-09-26, asked for by the
  /// owner): the catalogue is small enough that the shop front can be the
  /// whole shop. It was a 6-row preview (18 of 41 on a phone) behind a
  /// "See all"; that link is gone because nothing is behind it any more. The
  /// grid is a lazy [SliverGrid], so a longer list costs only what is on
  /// screen. Unavailable products are left out here - they still open from
  /// search and category listings, which say so on the card.

  static const Key retryKey = Key('home-products-retry');

  @override
  State<HomeProductSections> createState() => _HomeProductSectionsState();
}

class _HomeProductSectionsState extends State<HomeProductSections> {
  String get _key => widget.categorySlug ?? '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void didUpdateWidget(HomeProductSections oldWidget) {
    super.didUpdateWidget(oldWidget);
    // After the frame: the provider notifies its listeners synchronously, and
    // this runs inside a build.
    if (oldWidget.categorySlug != widget.categorySlug) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }
  }

  void _load({bool force = false}) {
    if (!mounted) return;
    context
        .read<ProductProvider>()
        .loadProducts(categorySlug: widget.categorySlug, force: force);
    _loadHistory();
  }

  /// Fetches the customer's own orders once, and only when there is a
  /// customer: a signed-out visitor must not have a request made on their
  /// behalf that can only come back 401, and must not be ranked at all.
  void _loadHistory() {
    if (!mounted || widget.categorySlug != null) return;
    if (!context.read<AuthProvider>().isAuthenticated) return;
    final orders = context.read<OrderProvider>();
    if (orders.hasLoadedOrders || orders.isLoadingOrders) return;
    orders.loadOrders();
  }

  @override
  Widget build(BuildContext context) {
    // Only the catalogue-wide section is ranked. Inside one category the
    // customer has already said what they want, and reordering it would
    // just make the same shelf look different every visit.
    final signal = widget.categorySlug == null
        ? context.select<OrderProvider, PurchaseHistorySignal>(
            (o) => PurchaseHistorySignal.fromOrders(o.orders),
          )
        : PurchaseHistorySignal.none;

    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        final products = rankByPurchaseHistory(productProvider.productsFor(_key), signal);
        // The title follows what actually happened to the list above, so it
        // can never claim a personalisation that did not run.
        final ranked = widget.categorySlug == null && signal.isNotEmpty;
        final title = widget.categoryName ??
            (ranked
                ? HomeProductSections.personalisedTitle
                : HomeProductSections.allTitle);
        final isLoading = productProvider.isLoadingProducts(_key);
        final failure = productProvider.productsFailureFor(_key);

        // Nothing to show and nothing coming: no header over an empty box,
        // and no invented "check back soon" promise about restocking.
        if (!isLoading && products.isEmpty && failure == null) {
          return const SliverToBoxAdapter(child: SizedBox.shrink());
        }

        // A section that failed to load says so and offers a retry, instead
        // of silently vanishing as if the shelf were empty. It stays a
        // compact row rather than a full-page state so the offline banner
        // above it is still the screen's one voice about being offline.
        if (!isLoading && products.isEmpty) {
          return SliverMainAxisGroup(
            slivers: [
              SliverToBoxAdapter(child: BlynkSectionHeader(title: title)),
              SliverToBoxAdapter(
                child: _SectionRetryRow(
                  message: widget.categoryName == null
                      ? "Couldn't load products."
                      : "Couldn't load ${widget.categoryName}.",
                  onRetry: () => _load(force: true),
                ),
              ),
            ],
          );
        }

        return SliverLayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.crossAxisExtent;
            final columns = BlynkProductGrid.columnsFor(width);

            if (isLoading && products.isEmpty) {
              return SliverMainAxisGroup(slivers: [
                SliverToBoxAdapter(child: BlynkSectionHeader(title: title)),
                _grid(context, width, itemCount: columns * 2,
                    item: (_) => const ProductCardSkeleton()),
              ]);
            }

            final sections = widget.categorySlug == null
                ? _byCategory(products, productProvider, signal, ranked, columns)
                : [_Section(title: title, products: [
                    for (final p in products)
                      if (p.isAvailable) p,
                  ])];

            // One running index across sections, so the entrance wave keeps
            // flowing down the page instead of restarting at every header.
            var offset = 0;
            return SliverMainAxisGroup(
              slivers: [
                for (final section in sections) ...() {
                  final start = offset;
                  offset += section.products.length;
                  return [
                    SliverToBoxAdapter(
                      child: BlynkSectionHeader(
                        title: section.title,
                        actionLabel: section.slug == null ? null : 'See all',
                        onAction: section.slug == null
                            ? null
                            : () => Navigator.of(context).pushNamed(
                                  '/products',
                                  arguments: section.slug,
                                ),
                      ),
                    ),
                    _grid(
                      context,
                      width,
                      itemCount: section.products.length,
                      // Tiles arrive as a wave rather than all at once.
                      // Keyed by product id so the arrival belongs to the
                      // product, not to the slot: without the key a reorder
                      // (see rankByPurchaseHistory) would replay the
                      // animation on whichever card took the slot.
                      item: (index) => EntranceFade(
                        key: ValueKey('${section.title}/${section.products[index].id}'),
                        delay: widget.entranceDelay + EntranceFade.delayFor(start + index),
                        child: ProductCard(product: section.products[index]),
                      ),
                    ),
                  ];
                }(),
              ],
            );
          },
        );
      },
    );
  }

  Widget _grid(
    BuildContext context,
    double width, {
    required int itemCount,
    required Widget Function(int index) item,
  }) =>
      SliverPadding(
        padding: EdgeInsets.symmetric(horizontal: BlynkProductGrid.gutterFor(width)),
        sliver: SliverGrid.builder(
          gridDelegate: productGridDelegate(context, width),
          itemCount: itemCount,
          itemBuilder: (context, index) => item(index),
        ),
      );

  /// Home's shop front, shelf by shelf (2026-09-26, asked for from the
  /// reference app): one section per real backend category, in the store's
  /// own category order, each with every available product on that shelf and
  /// a "See all" into the category's page.
  ///
  /// - A signed-in customer with order history first gets
  ///   [HomeProductSections.personalisedTitle]: the products they have
  ///   actually bought, most relevant first (two rows at most).
  /// - Products keep the ranked order inside their shelf.
  /// - If the categories have not loaded (or a product's category is not in
  ///   the list), nothing is hidden: those products go under
  ///   [HomeProductSections.allTitle] at the end.
  List<_Section> _byCategory(
    List<ProductModel> ranked,
    ProductProvider provider,
    PurchaseHistorySignal signal,
    bool personalised,
    int columns,
  ) {
    final available = [
      for (final p in ranked)
        if (p.isAvailable) p,
    ];
    final sections = <_Section>[];

    if (personalised) {
      final bought = [
        for (final p in available)
          if (signal.ordersContaining.containsKey(p.id)) p,
      ];
      if (bought.isNotEmpty) {
        sections.add(_Section(
          title: HomeProductSections.personalisedTitle,
          products: bought.take(columns * 2).toList(),
        ));
      }
    }

    final placed = <String>{};
    for (final c in provider.categories) {
      final shelf = [
        for (final p in available)
          if (p.categoryId == c.id) p,
      ];
      if (shelf.isEmpty) continue;
      placed.addAll(shelf.map((p) => p.id));
      sections.add(_Section(title: c.name, slug: c.slug, products: shelf));
    }

    final rest = [
      for (final p in available)
        if (!placed.contains(p.id)) p,
    ];
    if (rest.isNotEmpty) {
      sections.add(_Section(title: HomeProductSections.allTitle, products: rest));
    }
    return sections;
  }
}

/// One shelf on Home: a real title, where "See all" goes (null: no link),
/// and the products on it.
class _Section {
  const _Section({required this.title, this.slug, required this.products});

  final String title;
  final String? slug;
  final List<ProductModel> products;
}

/// The compact per-section failure: one sentence and a "Try again" that asks
/// only for this section's products.
class _SectionRetryRow extends StatelessWidget {
  const _SectionRetryRow({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: BlynkSpace.gutterFor(Responsive.of(context).width),
      ),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: BlynkSpace.s8,
        children: [
          Text(message, style: BlynkText.body),
          BlynkButton.tertiary(
            key: HomeProductSections.retryKey,
            label: 'Try again',
            onPressed: onRetry,
          ),
        ],
      ),
    );
  }
}
