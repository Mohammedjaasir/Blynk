import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';
import '../Atoms/category_widget.dart';
import '../Atoms/image_well.dart';

// Sub-categories (backend migration 026, 2026-10-05):
// opening "Bakery" shows Bakery's own rail - "All" (Bakery itself, whose
// listing includes its children's products) and then Bread, Cakes, Buns.
// A category with no children shows just its own "All" row; the other
// top-level categories are no longer listed beside it. Opening "All
// products" (an empty root) keeps the top-level categories as the rail.
//
// 2026-09 redesign (W3): the rail is a `paper` column that stays put while the
// grid beside it scrolls. The selected row keeps its ink edge bar - that is
// what `audit_fixes_test` pins as the selection signal.
//
// 2026-09-26 (motion M4): each row is now the same [CategoryWidget] Home
// uses, at the rail's own diameter. Before this the rail drew a private
// tile - a solid `signal` disc with a generic `Icons.category_outlined` - and
// was the last surface still wearing the look the category redesign replaced
// everywhere else. One component now means one selected appearance (the
// `signalWash` well with a `signal` ring), one press response, one `fast`
// transition, and the category's own glyph from `fallbackGlyphFor`, so a
// category and the products inside it show the same symbol.
class CategorySidebar extends StatelessWidget {
  const CategorySidebar({
    super.key,
    required this.activeSlug,
    required this.onSelect,
    this.rootSlug = '',
  });

  final String activeSlug;
  final ValueChanged<CategoryModel> onSelect;

  /// The category the screen was opened on; empty for "All products".
  final String rootSlug;

  /// The label of the row that stands for the opened category itself.
  static const String allLabel = 'All';

  /// The rail's rows for [rootSlug] over the full category list: the
  /// top-level categories for an empty root, otherwise the root itself
  /// (labelled [allLabel]) followed by its sub-categories. An unknown root
  /// (the list has not loaded, or the category is gone) has no rows.
  static List<CategoryModel> railFor(List<CategoryModel> categories, String rootSlug) {
    if (rootSlug.isEmpty) return CategoryModel.topLevelOf(categories);
    CategoryModel? root;
    for (final c in categories) {
      if (c.slug == rootSlug) {
        root = c;
        break;
      }
    }
    if (root == null) return const [];
    return [
      CategoryModel(
        id: root.id,
        name: allLabel,
        slug: root.slug,
        description: root.description,
        imageUrl: root.imageUrl,
        displayOrder: root.displayOrder,
        imageFocalX: root.imageFocalX,
        imageFocalY: root.imageFocalY,
        parentId: root.parentId,
      ),
      for (final c in categories)
        if (c.parentId == root.id) c,
    ];
  }

  /// The rail's own measured width, not a design token and not a breakpoint:
  /// it is the [_tileSize] circle plus the row padding, wide enough for a
  /// two-line 12 px label. Screens ask [widthFor]; the responsive *classes*
  /// still come from the one ladder in `app_responsive.dart`.
  static const double compactWidth = 88;
  static const double expandedWidth = 112;

  static double widthFor(double availableWidth) =>
      Responsive.classOf(availableWidth) == ResponsiveClass.compact
          ? compactWidth
          : expandedWidth;

  /// Diameter of the category circle inside a row. Smaller than Home's
  /// [BlynkCategory.diameterCompact] because the rail is 88 dp wide; the
  /// tile is the same component, only sized for where it sits.
  static const double tileSize = 44;

  /// The selected row's edge bar.
  static const double activeBarWidth = 3;

  @override
  Widget build(BuildContext context) {
    final all = context.watch<ProductProvider>().categories;
    final categories = railFor(all, rootSlug);

    if (categories.isEmpty) {
      return const SizedBox.shrink();
    }

    return ListView.builder(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
      itemCount: categories.length,
      itemBuilder: (BuildContext context, int index) {
        final category = categories[index];
        final isActive = category.slug == activeSlug;
        // The "All" row is the opened category itself: it keeps that
        // category's own glyph, and says whose "All" it is.
        final isAllRow = rootSlug.isNotEmpty && index == 0;
        final rootName = isAllRow
            ? all.firstWhere((c) => c.slug == rootSlug, orElse: () => category).name
            : category.name;

        return Semantics(
          button: true,
          selected: isActive,
          label: isAllRow ? '$allLabel $rootName' : category.name,
          excludeSemantics: true,
          onTap: () => onSelect(category),
          child: InkWell(
            onTap: () => onSelect(category),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: BlynkSpace.s4,
                vertical: BlynkSpace.s8,
              ),
              // A floor, not a height: a large text size grows the row.
              constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
              decoration: BoxDecoration(
                border: isActive
                    ? const Border(
                        right: BorderSide(
                          color: BlynkColors.ink,
                          width: activeBarWidth,
                        ),
                      )
                    : null,
              ),
              // The tile owns the disc, the glyph, the label and the
              // selected / pressed transitions; the rail owns the edge bar.
              // onTap is passed so the tile selects in place rather than
              // pushing a second Products screen, which is its default.
              child: CategoryWidget(
                category: category,
                isActive: isActive,
                diameter: tileSize,
                glyph: isAllRow ? fallbackGlyphFor(rootName) : null,
                onTap: () => onSelect(category),
              ),
            ),
          ),
        );
      },
    );
  }
}
