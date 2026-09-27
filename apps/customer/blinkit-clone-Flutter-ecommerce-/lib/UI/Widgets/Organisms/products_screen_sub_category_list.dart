import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';
import '../Atoms/category_widget.dart';

// The backend's catalog is flat (categories, no nested subcategories - see
// backend/api/src/database/migrations/001_initial_schema.sql), so this is
// repurposed as a "browse other categories" rail using the same real
// category list shown on Home, rather than an invented subcategory taxonomy.
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
  const CategorySidebar({super.key, required this.activeSlug, required this.onSelect});

  final String activeSlug;
  final ValueChanged<CategoryModel> onSelect;

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
    final categories = context.watch<ProductProvider>().categories;

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

        return Semantics(
          button: true,
          selected: isActive,
          label: category.name,
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
                onTap: () => onSelect(category),
              ),
            ),
          ),
        );
      },
    );
  }
}
