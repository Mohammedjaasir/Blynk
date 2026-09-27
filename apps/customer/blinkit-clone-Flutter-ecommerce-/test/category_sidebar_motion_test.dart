import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/UI/Widgets/Organisms/products_screen_sub_category_list.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

/// The Products screen's category rail was the one surface still wearing the
/// old selected look - a solid yellow disc with a generic "shapes" glyph -
/// after Home's category redesign. M4 makes each row the same `CategoryWidget`
/// as Home, so the app has one selected-category appearance, one press
/// response and one transition. These tests pin that, and keep the rail's ink
/// edge bar, which `audit_fixes_test` treats as the selection signal.
const _categories = {
  'success': true,
  'data': {
    'categories': [
      {'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs', 'image_url': null, 'display_order': 1},
      {'id': 'c2', 'name': 'Rice & Grains', 'slug': 'rice-grains', 'image_url': null, 'display_order': 2},
      {'id': 'c3', 'name': 'Fruits & Vegetables', 'slug': 'fruits-veg', 'image_url': null, 'display_order': 3},
    ],
  },
};

Future<dynamic> _backend(String url, Map<String, dynamic> query) async {
  if (url == '/catalog/categories') return _categories;
  throw StateError('unexpected $url');
}

class _Host extends StatefulWidget {
  const _Host({this.reduceMotion = false});
  final bool reduceMotion;
  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  String _slug = 'dairy-eggs';
  @override
  Widget build(BuildContext context) => MediaQuery(
        data: MediaQueryData(size: const Size(400, 860), disableAnimations: widget.reduceMotion),
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: Scaffold(
            body: SizedBox(
              width: CategorySidebar.compactWidth,
              child: CategorySidebar(
                activeSlug: _slug,
                onSelect: (CategoryModel c) => setState(() => _slug = c.slug),
              ),
            ),
          ),
        ),
      );
}

Future<void> _pump(WidgetTester tester, {bool reduceMotion = false}) async {
  final products = ProductProvider(request: _backend);
  await products.loadCategories();
  await tester.pumpWidget(
    ChangeNotifierProvider<ProductProvider>.value(
      value: products,
      child: _Host(reduceMotion: reduceMotion),
    ),
  );
  await tester.pump();
}

/// The disc of the row labelled [name]: CategoryWidget's one AnimatedContainer.
AnimatedContainer _disc(WidgetTester tester, String name) {
  final tile = find.ancestor(of: find.text(name), matching: find.byType(CategoryWidget));
  return tester.widget<AnimatedContainer>(
    find.descendant(of: tile, matching: find.byType(AnimatedContainer)).first,
  );
}

BoxDecoration _decorationOf(AnimatedContainer c) => c.decoration! as BoxDecoration;

/// The row's edge bar, if it has one: the plain Container the audit test also
/// looks for, with a right border.
Border? _edgeOf(WidgetTester tester, String name) {
  final rows = find.ancestor(of: find.text(name), matching: find.byType(Container));
  for (final c in tester.widgetList<Container>(rows)) {
    final d = c.decoration;
    if (d is BoxDecoration && d.border is Border && (d.border! as Border).right.width > 0) {
      return d.border! as Border;
    }
  }
  return null;
}

void main() {
  group('CategorySidebar (M4)', () {
    testWidgets('every row is the shared CategoryWidget, at the rail size', (tester) async {
      await _pump(tester);
      final tiles = tester.widgetList<CategoryWidget>(find.byType(CategoryWidget)).toList();
      expect(tiles, hasLength(3));
      for (final t in tiles) {
        expect(t.diameter, CategorySidebar.tileSize, reason: 'one component, sized for the rail');
      }
    });

    testWidgets('selected is the wash + ring, not a solid yellow disc', (tester) async {
      await _pump(tester);
      final active = _decorationOf(_disc(tester, 'Dairy & Eggs'));
      expect(active.color, BlynkCategory.selectedSurface);
      expect(active.color, isNot(BlynkColors.signal), reason: 'the old solid fill is gone');
      expect(active.border, isNotNull);
      expect((active.border! as Border).top.color, BlynkCategory.selectedRing);

      final idle = _decorationOf(_disc(tester, 'Rice & Grains'));
      expect(idle.color, BlynkCategory.surface);
      expect(idle.border, isNull);
    });

    testWidgets("the glyph is the category's own, not a generic shapes icon", (tester) async {
      await _pump(tester);
      expect(find.byIcon(Icons.category_outlined), findsNothing);
      // The same mapping the product image wells use, so a category and the
      // products inside it show one symbol.
      expect(find.byIcon(fallbackGlyphFor('Dairy & Eggs')), findsOneWidget);
      expect(find.byIcon(fallbackGlyphFor('Fruits & Vegetables')), findsOneWidget);
    });

    testWidgets('the selected row keeps its ink edge bar', (tester) async {
      await _pump(tester);
      expect(_edgeOf(tester, 'Dairy & Eggs')?.right.color, BlynkColors.ink);
      expect(_edgeOf(tester, 'Dairy & Eggs')?.right.width, CategorySidebar.activeBarWidth);
      expect(_edgeOf(tester, 'Rice & Grains'), isNull);
    });

    testWidgets('selecting another row moves the selection over one fast beat', (tester) async {
      await _pump(tester);
      await tester.tap(find.text('Rice & Grains'));
      await tester.pump();
      // The disc's transition is the shared fast token, the same as Home's tiles.
      expect(_disc(tester, 'Rice & Grains').duration, BlynkMotion.fast);
      await tester.pump(BlynkMotion.fast);
      await tester.pump(BlynkMotion.fast);
      expect(_decorationOf(_disc(tester, 'Rice & Grains')).color, BlynkCategory.selectedSurface);
      expect(_decorationOf(_disc(tester, 'Dairy & Eggs')).color, BlynkCategory.surface);
      expect(_edgeOf(tester, 'Rice & Grains'), isNotNull);
      expect(_edgeOf(tester, 'Dairy & Eggs'), isNull);
    });

    testWidgets('reduced motion: the selection changes with no transition', (tester) async {
      await _pump(tester, reduceMotion: true);
      await tester.tap(find.text('Rice & Grains'));
      await tester.pump();
      expect(_disc(tester, 'Rice & Grains').duration, Duration.zero);
      expect(_decorationOf(_disc(tester, 'Rice & Grains')).color, BlynkCategory.selectedSurface);
    });

    testWidgets('every row is at least the 48 dp tap-target floor, and nothing overflows', (tester) async {
      await _pump(tester);
      for (final name in ['Dairy & Eggs', 'Rice & Grains', 'Fruits & Vegetables']) {
        final row = find.ancestor(of: find.text(name), matching: find.byType(InkWell)).last;
        expect(tester.getSize(row).height, greaterThanOrEqualTo(BlynkControl.minHeight), reason: name);
      }
      expect(tester.takeException(), isNull);
    });
  });
}
