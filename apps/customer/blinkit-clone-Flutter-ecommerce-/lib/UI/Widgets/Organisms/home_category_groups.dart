import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/category_widget.dart';
import '../Atoms/entrance_fade.dart';
import '../Atoms/failure_states.dart';
import '../Atoms/section_header.dart';
import '../../../Models/category_group_model.dart';
import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';

/// Home's shop front (2026-10-05, owner's reference app): **groups of
/// category tiles**. Each group is a heading ("Grocery & Kitchen") over a grid
/// of rounded-square tiles - the category's image contained on the tinted
/// well, its name under it - and a tile opens that category's full product
/// list on `/products`. It replaced the per-category product shelves and the
/// separate "Categories" preview grid, which listed the same categories twice.
///
/// - Data is `GET /catalog/home-groups` via [ProductProvider.loadHomeGroups],
///   in the backend's order; it refreshes with the rest of the catalog
///   (pull to refresh, the live catalog events, returning to the tab).
/// - Columns follow [columnsFor] the available width: 4 on a phone, more on
///   a tablet or desktop. Row height is **measured** from the tile plus its
///   two reserved label lines at the live text scale, so large type grows the
///   rows instead of overflowing them.
/// - The tile is the shared [CategoryWidget] in its rounded form, so its
///   fallback glyph (no image), press and focus states match everywhere else.
class HomeCategoryGroups extends StatefulWidget {
  const HomeCategoryGroups({super.key, this.entranceDelay = Duration.zero});

  /// Added to every tile's own stagger: the moment this section fades in on
  /// Home's entrance timeline.
  final Duration entranceDelay;

  static const Key retryKey = Key('categories-retry');
  static const String failureTitle = "We couldn't load categories";

  /// Tiles per row for an available [width].
  static int columnsFor(double width) {
    if (width >= 900) return 8;
    if (width >= AppBreakpoints.tablet) return 6;
    return 4;
  }

  /// Gap between tiles across a row.
  static double crossSpacingFor(double width) =>
      width < AppBreakpoints.tablet ? BlynkSpace.s12 : BlynkSpace.s16;

  /// Gap between rows.
  static const double rowSpacing = BlynkSpace.s16;

  /// The square tile's side in a cell [cellWidth] wide: the whole cell, capped
  /// so a wide screen shows more tiles rather than giant ones.
  static double tileSizeFor(double cellWidth) => cellWidth.clamp(40.0, 112.0);

  /// Loading placeholders: two rows.
  static int skeletonCountFor(double width) => columnsFor(width) * 2;

  /// A group shows at most two rows (owner, 2026-10-07). Since 2026-10-08
  /// (owner, after Noon's app) a longer group is two rows that swipe sideways
  /// together - the first half of its categories on top, the rest below, in
  /// display order - with the next column peeking at the edge.
  static int maxTilesFor(int columns) => columns * 2;

  /// The sideways two-row scroller, when a group has more than two rows' worth.
  static const Key swipeKey = Key('home-categories-swipe');

  /// How much of the next column shows past the edge, as a fraction of a tile.
  static const double peek = 0.45;

  /// The heading for the backend's catch-all group when it is the only one:
  /// "More" over a grid that ends in a "More" tile reads as a mistake.
  static const String onlyGroupTitle = 'Shop by category';



  @override
  State<HomeCategoryGroups> createState() => _HomeCategoryGroupsState();
}

class _HomeCategoryGroupsState extends State<HomeCategoryGroups> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final products = context.read<ProductProvider>();
      products.loadHomeGroups();
      // The search field's rotating hint reads the flat category list.
      products.loadCategories();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ProductProvider>(
      builder: (context, provider, _) {
        final groups = provider.homeGroups;

        if (groups.isEmpty && provider.isLoadingHomeGroups) {
          return SliverLayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.crossAxisExtent;
              final metrics = _GridMetrics(context, width);
              return SliverMainAxisGroup(slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                        metrics.gutter, BlynkSpace.s24, metrics.gutter, BlynkSpace.s12),
                    child: const Align(
                      alignment: Alignment.centerLeft,
                      child: AppSkeleton(width: 140, height: 16),
                    ),
                  ),
                ),
                metrics.grid(
                  itemCount: HomeCategoryGroups.skeletonCountFor(width),
                  item: (_) => CategoryTileSkeleton(size: metrics.tile, rounded: true),
                ),
              ]);
            },
          );
        }

        final failure = provider.homeGroupsFailure;
        if (groups.isEmpty && failure != null) {
          return SliverToBoxAdapter(
            child: FailureState(
              failure: failure,
              title: HomeCategoryGroups.failureTitle,
              retryKey: HomeCategoryGroups.retryKey,
              scrollable: false,
              // Home's products failed with the groups and show no message of
              // their own (HomeProductFeed), so this one retry covers both.
              onRetry: () {
                provider.loadHomeGroups(force: true);
                if (provider.productsFailureFor('') != null) provider.loadProducts(force: true);
              },
            ),
          );
        }

        // Nothing to show and nothing coming: no heading over an empty box.
        if (groups.isEmpty) {
          return const SliverToBoxAdapter(child: SizedBox.shrink());
        }

        return SliverLayoutBuilder(
          builder: (context, constraints) {
            final metrics = _GridMetrics(context, constraints.crossAxisExtent);
            // One running index across groups, so the entrance wave keeps
            // flowing down the page instead of restarting at every heading.
            var offset = 0;
            return SliverMainAxisGroup(
              slivers: [
                for (final group in groups) ...() {
                  final start = offset;
                  offset += group.categories.length;
                  return _groupSlivers(context, group, metrics, start, onlyGroup: groups.length == 1);
                }(),
              ],
            );
          },
        );
      },
    );
  }

  List<Widget> _groupSlivers(
    BuildContext context,
    CategoryGroupModel group,
    _GridMetrics metrics,
    int start, {
    bool onlyGroup = false,
  }) {
    final swipe = group.categories.length > HomeCategoryGroups.maxTilesFor(metrics.columns);
    return [
      SliverToBoxAdapter(
        child: BlynkSectionHeader(
          key: ValueKey('home-group/${group.key}'),
          title: onlyGroup && group.isUngrouped ? HomeCategoryGroups.onlyGroupTitle : group.name,
          padding: EdgeInsets.fromLTRB(
              metrics.gutter, BlynkSpace.s24, BlynkSpace.s8, BlynkSpace.s12),
        ),
      ),
      if (swipe)
        SliverToBoxAdapter(child: _twoRowSwipe(context, group, metrics, start))
      else
        metrics.grid(
          itemCount: group.categories.length,
          item: (index) => _tile(context, group, group.categories[index], start + index, metrics.tile),
        ),
    ];
  }

  /// One category tile: opens that category's products page.
  Widget _tile(BuildContext context, CategoryGroupModel group, CategoryModel category, int order, double size) {
    return EntranceFade(
      key: ValueKey('home-group/${group.key}/${category.id}'),
      delay: widget.entranceDelay + EntranceFade.delayFor(order),
      // Merged so the tile is announced once, as a link, rather than
      // as a label and a target side by side.
      child: MergeSemantics(
        child: Semantics(
          button: true,
          child: CategoryWidget(
            category: category,
            rounded: true,
            fit: BoxFit.contain,
            diameter: size,
            onTap: () => Navigator.of(context).pushNamed('/products', arguments: category.slug),
          ),
        ),
      ),
    );
  }

  /// Two rows that scroll sideways together (Noon-style): the first half of
  /// the group on top, the rest underneath, both in display order.
  Widget _twoRowSwipe(BuildContext context, CategoryGroupModel group, _GridMetrics metrics, int start) {
    final all = group.categories;
    final perRow = (all.length + 1) ~/ 2;
    final top = all.sublist(0, perRow);
    final bottom = all.sublist(perRow);
    // Tiles a little narrower than the grid's so the next column peeks in.
    final visible = metrics.columns + HomeCategoryGroups.peek;
    final cellWidth = (metrics.width - metrics.gutter - metrics.spacing * metrics.columns) / visible;
    final tile = HomeCategoryGroups.tileSizeFor(cellWidth);
    final cellHeight = CategoryWidget.heightFor(context, tile);
    return SizedBox(
      height: cellHeight * 2 + HomeCategoryGroups.rowSpacing,
      child: ListView.separated(
        key: HomeCategoryGroups.swipeKey,
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: metrics.gutter),
        itemCount: perRow,
        separatorBuilder: (_, __) => SizedBox(width: metrics.spacing),
        itemBuilder: (context, column) => SizedBox(
          width: cellWidth,
          child: Column(
            children: [
              SizedBox(height: cellHeight, child: _tile(context, group, top[column], start + column, tile)),
              const SizedBox(height: HomeCategoryGroups.rowSpacing),
              SizedBox(
                height: cellHeight,
                child: column < bottom.length
                    ? _tile(context, group, bottom[column], start + perRow + column, tile)
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The grid's geometry for one available width, at the live text scale.
class _GridMetrics {
  _GridMetrics(BuildContext context, this.width)
      : columns = HomeCategoryGroups.columnsFor(width),
        gutter = BlynkSpace.gutterFor(width),
        spacing = HomeCategoryGroups.crossSpacingFor(width) {
    final cell = (width - gutter * 2 - spacing * (columns - 1)) / columns;
    tile = HomeCategoryGroups.tileSizeFor(cell);
    cellHeight = CategoryWidget.heightFor(context, tile);
  }

  final double width;
  final int columns;
  final double gutter;
  final double spacing;
  late final double tile;
  late final double cellHeight;

  Widget grid({required int itemCount, required Widget Function(int index) item}) =>
      SliverPadding(
        padding: EdgeInsets.symmetric(horizontal: gutter),
        sliver: SliverGrid.builder(
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: spacing,
            mainAxisSpacing: HomeCategoryGroups.rowSpacing,
            mainAxisExtent: cellHeight,
          ),
          itemCount: itemCount,
          itemBuilder: (context, index) => item(index),
        ),
      );
}
