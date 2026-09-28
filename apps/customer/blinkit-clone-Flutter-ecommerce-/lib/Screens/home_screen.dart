import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/product.provider.dart';

import '../UI/Widgets/Atoms/sliver_entrance.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/connectivity_banner.dart';
import '../UI/Widgets/Organisms/dental_home_entry.dart';
import '../UI/Widgets/Organisms/home_brand_tagline.dart';
import '../UI/Widgets/Organisms/home_product_sections.dart';
import '../UI/Widgets/Organisms/home_screen_app_bar.dart';
import '../UI/Widgets/Organisms/home_screen_category_builder.dart';
import '../UI/Widgets/Organisms/home_screen_carousel.dart';
import '../UI/Widgets/Organisms/home_screen_search_bar.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';
import '../UI/Widgets/Atoms/entrance_fade.dart';

/// The Shop tab.
///
/// Composition, top to bottom: the brand header (the Blynk lockup, the
/// circular cart / account controls, and the real delivery address block
/// under them) - the full-width search field - the two-tone tagline - the
/// promotional hero **only
/// when the backend returns a live promotion** - the category chips - the
/// dental entry - one honest section header and a grid of the real products
/// behind the selected chip.
///
/// Nothing here is hardcoded content except the tagline, which is brand copy
/// rather than data. Every other section renders backend data or does not
/// render: there is no placeholder hero, no invented "recommended" query, no
/// fixed list of categories, and no rating, review, discount, struck price or
/// wishlist control anywhere - the backend has none of those fields. Sections
/// are separated by space, never by a rule.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  /// Clearance under the last section so the floating cart bar never covers
  /// the final row of cards.
  static const double bottomClearance = BlynkSpace.s48 + BlynkSpace.s24;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with SingleTickerProviderStateMixin {
  /// Home's entrance: one timeline, five beats. Header, then search, then
  /// the hero, then categories (with the dental entry), then the products.
  /// The tagline rides the search beat and the dental entry rides the
  /// category beat - fewer beats reads as one composition arriving, and the
  /// whole thing is over in 810 ms. It runs once; a pull to refresh or a
  /// section scrolling back into view never replays it.
  ///
  /// It starts after Home's first frame, not during it (2026-09-26). That
  /// frame is the expensive one (the whole tree, first image decodes), and on
  /// the emulator it stalled the UI thread ~700 ms arriving from onboarding.
  /// A controller started before the stall is already most of the way
  /// through when the next frame paints, so the cascade was simply skipped.
  static const int _beats = 5;
  late final AnimationController _entrance = AnimationController(vsync: this);
  late final EntranceTimeline _timeline =
      EntranceTimeline(controller: _entrance, beats: _beats);
  bool _entranceStarted = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reduced motion is a MediaQuery value, so this cannot live in initState.
    if (_entranceStarted) return;
    _entranceStarted = true;
    _entrance.duration = _timeline.total;
    if (BlynkMotion.reduced(context)) {
      _entrance.value = 1;
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _entrance.forward();
      });
    }
  }

  @override
  void dispose() {
    _entrance.dispose();
    super.dispose();
  }

  /// 2026-09-24: the category tiles used to **filter this screen in place** —
  /// tapping "Dairy & Eggs" swapped the "Browse all" section underneath for a
  /// "Dairy & Eggs" one and you stayed on Home. They now **open the category**
  /// instead, on the products screen that already exists for exactly that
  /// (`/products`, which takes a slug, titles itself after the category and
  /// lists every product in it).
  ///
  /// So Home no longer holds a selection at all, and the section below the
  /// tiles is always the catalogue-wide "Browse all". Home is the shop front;
  /// browsing one category is its own page.

  /// True while the category tiles or the product grid show a skeleton, so
  /// the one shared pulse runs only then. The empty slug is the provider's
  /// own cache key for the catalogue-wide query.
  bool _isLoading(ProductProvider p) =>
      p.isLoadingCategories || p.isLoadingProducts('');

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final loading = context.select<ProductProvider, bool>(_isLoading);
    final hasSavedContent =
        context.select<ProductProvider, bool>((p) => p.categories.isNotEmpty);

    // One EntranceScope per screen: a card that scrolls off and back is rebuilt at rest, not replayed.
    return EntranceScope(
      child: Scaffold(
      primary: true,
      backgroundColor: BlynkColors.paper,
      // The cart bar belongs to the shell, so Home never draws its own.
      // On a wide desktop viewport, a single-column feed of sections
      // stretched full-width looks like a mobile layout blown up rather
      // than a real desktop composition - cap and center it instead.
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
          // Pull down for the backend's current catalog. Forced, because
          // the customer asked for it explicitly.
          child: SkeletonScope(
            active: loading,
            child: RefreshIndicator(
              onRefresh: () =>
                  context.read<ProductProvider>().refreshCatalog(force: true),
              child: CustomScrollView(
                // AlwaysScrollable so the pull works even when Home is
                // shorter than the screen.
                physics: const BouncingScrollPhysics(
                  parent: AlwaysScrollableScrollPhysics(),
                ),
                slivers: [
                  SliverEntrance(animation: _timeline.section(0), sliver: const HomeScreenAppBar()),
                  // The search field sits directly under the address block,
                  // where the reference puts it. It is the screen's only way
                  // into Search — the brand row's circular search button was
                  // removed with this restoration.
                  SliverEntrance(animation: _timeline.section(1), sliver: const HomeScreenSearchBar()),
                  // Saved items are showing while the connection is down.
                  SliverToBoxAdapter(
                    child: ConnectivityBanner(
                      hasContent: hasSavedContent,
                      onRetry: () => context
                          .read<ProductProvider>()
                          .refreshCatalog(force: true),
                    ),
                  ),
                  SliverEntrance(animation: _timeline.section(1), sliver: const HomeBrandTagline()),
                  // Renders only when GET /promotions returns a live
                  // promotion; otherwise it is absent, not placeheld.
                  SliverEntrance(animation: _timeline.section(2), sliver: const HomeScreenCarousel()),
                  const SliverToBoxAdapter(
                    child: SizedBox(height: BlynkSpace.s16),
                  ),
                  SliverEntrance(animation: _timeline.section(3), sliver: const HomeScreenCateogoryWidget()),
                  SliverEntrance(
                    animation: _timeline.section(3),
                    sliver: const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.only(top: BlynkSpace.s16),
                        child: DentalHomeEntry(),
                      ),
                    ),
                  ),
                  // The real products behind the selected chip, titled for
                  // the query that actually runs.
                  // Always the catalogue-wide query: the tiles above open a
                  // category rather than filtering this section.
                  SliverEntrance(
                    animation: _timeline.section(4),
                    sliver: HomeProductSections(
                      categorySlug: null,
                      categoryName: null,
                      // The cards stagger from the moment their section
                      // appears, not from frame 0 behind an invisible section.
                      entranceDelay: _timeline.delayOf(4),
                    ),
                  ),
                  const SliverToBoxAdapter(
                    child: SizedBox(height: HomeScreen.bottomClearance),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      ),
    );
  }
}
