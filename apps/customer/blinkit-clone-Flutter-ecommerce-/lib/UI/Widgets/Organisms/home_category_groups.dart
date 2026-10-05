import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/category_widget.dart';
import '../Atoms/entrance_fade.dart';
import '../Atoms/failure_states.dart';
import '../Atoms/section_header.dart';
import '../../../Models/category_group_model.dart';
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
              onRetry: () => provider.loadHomeGroups(force: true),
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
                  return _groupSlivers(context, group, metrics, start);
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
    int start,
  ) {
    return [
      SliverToBoxAdapter(
        child: BlynkSectionHeader(
          key: ValueKey('home-group/${group.key}'),
          title: group.name,
          padding: EdgeInsets.fromLTRB(
              metrics.gutter, BlynkSpace.s24, BlynkSpace.s8, BlynkSpace.s12),
        ),
      ),
      metrics.grid(
        itemCount: group.categories.length,
        item: (index) {
          final category = group.categories[index];
          return EntranceFade(
            key: ValueKey('home-group/${group.key}/${category.id}'),
            delay: widget.entranceDelay + EntranceFade.delayFor(start + index),
            // Merged so the tile is announced once, as a link, rather than
            // as a label and a target side by side.
            child: MergeSemantics(
              child: Semantics(
                button: true,
                child: CategoryWidget(
                  category: category,
                  rounded: true,
                  fit: BoxFit.contain,
                  diameter: metrics.tile,
                  onTap: () => Navigator.of(context)
                      .pushNamed('/products', arguments: category.slug),
                ),
              ),
            ),
          );
        },
      ),
    ];
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
