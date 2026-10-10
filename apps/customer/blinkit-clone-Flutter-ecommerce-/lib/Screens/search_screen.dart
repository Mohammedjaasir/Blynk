import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Infrastructure/LocalStorage/recent_searches_storage.dart';
import '../Models/category_model.dart';
import '../Services/Providers/product.provider.dart';
import '../Services/Validation/app_validators.dart';
import '../Services/analytics/analytics.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/card_product.dart';
import '../UI/Widgets/Atoms/connectivity_banner.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/section_header.dart';
import '../UI/Widgets/Organisms/bottom_cart_container.dart';
import '../UI/Widgets/Organisms/products_screen_grid.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';
import 'package:ecom/UI/Widgets/Atoms/entrance_fade.dart';

/// Catalog search. Results come from the backend's server-side search
/// (ProductProvider.search), rendered with the app's single ProductCard, so
/// adding from here goes through the same CartProvider as everywhere else.
///
/// Every surface on this screen is backed by something real: the results and
/// their count come from the search endpoint's `pagination.total`, the filter
/// chips from the live category list, and "Recent searches" from queries this
/// customer actually ran. There are no suggested, trending or popular
/// searches, because the backend has no such source.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, this.initialCategorySlug});

  /// Pre-selects a category filter (e.g. when opened from a category page).
  final String? initialCategorySlug;

  /// Clearance under the last row so the floating cart bar never covers it.
  static const double bottomClearance = BlynkSpace.s48 + BlynkSpace.s48;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  // Server-side search - wait for a short pause in typing rather than
  // firing a request per keystroke.
  static const Duration _debounce = Duration(milliseconds: 350);

  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  final ScrollController _scrollController = ScrollController();
  late final ProductProvider _products;

  Timer? _debounceTimer;
  List<String> _recent = const [];
  String? _categorySlug;
  // The last term sent as a `search` event (owner, 2026-10-10): a finished
  // search counts once, not once per pause in typing.
  String? _trackedQuery;

  void _track(String query) {
    if (query == _trackedQuery) return;
    _trackedQuery = query;
    Analytics.instance.search(query);
  }

  String get _query => _controller.text.trim();

  @override
  void initState() {
    super.initState();
    _products = context.read<ProductProvider>();
    _categorySlug = widget.initialCategorySlug;
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _products.clearSearch();
      _products.loadCategories();
    });
    _loadRecent();
  }

  Future<void> _loadRecent() async {
    final saved = await RecentSearchesStorage.load();
    if (mounted) setState(() => _recent = saved);
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    // A search the customer actually got results for and then left is worth
    // remembering even if they never pressed the keyboard's search key.
    final query = _query;
    if (query.isNotEmpty &&
        _products.lastQuery == query &&
        _products.searchResults.isNotEmpty) {
      RecentSearchesStorage.save(addRecentSearch(_recent, query));
      _track(query);
    }
    _scrollController
      ..removeListener(_onScroll)
      ..dispose();
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onScroll() {
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - 400) {
      _products.loadMoreSearchResults();
    }
  }

  void _runSearch(String query) {
    if (!mounted) return;
    _products.search(query, categorySlug: _categorySlug);
  }

  void _onChanged(String value) {
    setState(() {});
    _debounceTimer?.cancel();
    // Normalized the same way for every entry point: trimmed, repeated
    // spaces collapsed, and capped at the backend's 100-character limit.
    final query = AppValidators.normalizeSearch(value);
    if (query.isEmpty) {
      _products.clearSearch();
      return;
    }
    _debounceTimer = Timer(_debounce, () => _runSearch(query));
  }

  void _onSubmitted(String value) {
    _debounceTimer?.cancel();
    final query = AppValidators.normalizeSearch(value);
    if (query.isEmpty) return;
    _runSearch(query);
    _remember(query);
  }

  void _remember(String query) {
    _track(query);
    final next = addRecentSearch(_recent, query);
    setState(() => _recent = next);
    RecentSearchesStorage.save(next);
  }

  void _clearQuery() {
    _debounceTimer?.cancel();
    _controller.clear();
    _products.clearSearch();
    setState(() {});
    _focusNode.requestFocus();
  }

  void _useRecent(String query) {
    _debounceTimer?.cancel();
    _controller.value = TextEditingValue(
      text: query,
      selection: TextSelection.collapsed(offset: query.length),
    );
    _focusNode.unfocus();
    setState(() {});
    _runSearch(query);
    _remember(query);
  }

  Future<void> _clearRecent() async {
    setState(() => _recent = const []);
    await RecentSearchesStorage.clear();
  }

  void _selectCategory(String? slug) {
    if (slug == _categorySlug) return;
    setState(() => _categorySlug = slug);
    final query = _query;
    if (query.isNotEmpty) {
      _debounceTimer?.cancel();
      _runSearch(query);
    }
  }

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final hasResults = context
        .select<ProductProvider, bool>((p) => p.searchResults.isNotEmpty);

    // One EntranceScope per screen: a card that scrolls off and back is rebuilt at rest, not replayed.
    return EntranceScope(
      child: Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Search')),
      body: Stack(
        children: [
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
              child: Column(
                children: [
                  _SearchField(
                    controller: _controller,
                    focusNode: _focusNode,
                    onChanged: _onChanged,
                    onSubmitted: _onSubmitted,
                    onClear: _clearQuery,
                  ),
                  ConnectivityBanner(
                    hasContent: hasResults,
                    onRetry: context.read<ProductProvider>().retrySearch,
                  ),
                  Expanded(
                    child: _query.isEmpty
                        ? _InitialState(
                            recent: _recent,
                            onRecentTap: _useRecent,
                            onClearRecent: _clearRecent,
                          )
                        : _ResultsView(
                            query: _query,
                            categorySlug: _categorySlug,
                            scrollController: _scrollController,
                            onCategorySelected: _selectCategory,
                          ),
                  ),
                ],
              ),
            ),
          ),
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
              child: const BottomStickyContainer(),
            ),
          ),
        ],
      ),
      ),
    );
  }
}

/// The query field. It wears the app's one field recipe - `well` fill, `md`
/// radius, a `lineStrong` boundary at rest and a 2 dp `ink` focus ring - so
/// it reads as the same control the customer tapped on Home.
class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
    required this.onSubmitted,
    required this.onClear,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onSubmitted;
  final VoidCallback onClear;

  static OutlineInputBorder _border(Color color, double width) =>
      OutlineInputBorder(
        borderRadius: BlynkRadius.mdAll,
        borderSide: BorderSide(color: color, width: width),
      );

  @override
  Widget build(BuildContext context) {
    final gutter = BlynkSpace.gutterFor(Responsive.of(context).width);

    return Container(
      color: BlynkColors.paper,
      padding: EdgeInsets.fromLTRB(
        gutter,
        BlynkSpace.s4,
        gutter,
        BlynkSpace.s12,
      ),
      child: Semantics(
        label: 'Search groceries and essentials',
        textField: true,
        child: TextField(
          controller: controller,
          focusNode: focusNode,
          autofocus: true,
          textInputAction: TextInputAction.search,
          // Hard stop at the backend's search limit; the query is also
          // normalized before every request.
          maxLength: AppValidators.searchMax,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          style: BlynkText.body,
          cursorColor: BlynkColors.ink,
          decoration: InputDecoration(
            hintText: 'Search groceries & essentials',
            hintStyle: BlynkText.body.copyWith(color: BlynkColors.ink2),
            filled: true,
            fillColor: BlynkColors.well,
            // The counter is decoration, not information a shopper needs.
            counterText: '',
            constraints:
                const BoxConstraints(minHeight: BlynkControl.minHeight),
            contentPadding: const EdgeInsets.fromLTRB(
              0,
              BlynkSpace.s12,
              BlynkSpace.s16,
              BlynkSpace.s12,
            ),
            // Same geometry as Home's search field (16 dp in from the edge,
            // 12 dp to the text), so tapping through does not shift the icon.
            // It used to have no horizontal room at all and sat on the border.
            prefixIcon: const Padding(
              padding: EdgeInsets.only(left: BlynkSpace.s16, right: BlynkSpace.s12),
              child: Icon(
                BlynkIcons.search,
                color: BlynkColors.ink,
                size: BlynkIcons.md,
              ),
            ),
            prefixIconConstraints:
                const BoxConstraints(minHeight: BlynkControl.minHeight),
            suffixIcon: controller.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(BlynkIcons.close, size: BlynkIcons.sm),
                    color: BlynkColors.ink2,
                    constraints: const BoxConstraints.tightFor(
                      width: BlynkControl.minHeight,
                      height: BlynkControl.minHeight,
                    ),
                    onPressed: onClear,
                  ),
            suffixIconConstraints:
                const BoxConstraints(minHeight: BlynkControl.minHeight),
            border: _border(BlynkColors.lineStrong, 1),
            enabledBorder: _border(BlynkColors.lineStrong, 1),
            // Focus is still unmistakable, but a quiet 1.5 dp line rather
            // than a heavy black box around the one field on the screen.
            focusedBorder: _border(BlynkColors.ink2, 1.5),
          ),
        ),
      ),
    );
  }
}

/// Shown before anything is typed: real recent searches and real
/// categories only. No invented "popular searches" - with neither available
/// this is just a short prompt.
class _InitialState extends StatelessWidget {
  const _InitialState({
    required this.recent,
    required this.onRecentTap,
    required this.onClearRecent,
  });

  final List<String> recent;
  final ValueChanged<String> onRecentTap;
  final VoidCallback onClearRecent;

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<ProductProvider>().categories;
    final gutter = BlynkSpace.gutterFor(Responsive.of(context).width);

    if (recent.isEmpty && categories.isEmpty) {
      return const AppStateView(
        icon: Icons.manage_search,
        title: 'What are you looking for?',
        message: 'Search for groceries, snacks and everyday essentials.',
      );
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: SearchScreen.bottomClearance),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: [
        if (recent.isNotEmpty) ...[
          BlynkSectionHeader(
            title: 'Recent searches',
            actionLabel: 'Clear',
            onAction: onClearRecent,
          ),
          // Rows on the page, not a bordered card: sections here are
          // separated by space, never by a rule or a box.
          for (final query in recent)
            _RecentRow(
              query: query,
              gutter: gutter,
              onTap: () => onRecentTap(query),
            ),
        ],
        if (categories.isNotEmpty) ...[
          const BlynkSectionHeader(title: 'Browse categories'),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: gutter),
            child: Wrap(
              spacing: BlynkSpace.s8,
              runSpacing: BlynkSpace.s8,
              children: [
                for (final category in categories)
                  ActionChip(
                    label: Text(category.name),
                    labelStyle: BlynkText.label,
                    backgroundColor: BlynkColors.well,
                    side: const BorderSide(color: BlynkColors.lineStrong),
                    onPressed: () => Navigator.of(context).pushNamed(
                      '/products',
                      arguments: category.slug,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// One remembered query. The whole row is the target, at the shared control
/// height, and the trailing glyph says it will be put back in the field.
class _RecentRow extends StatelessWidget {
  const _RecentRow({
    required this.query,
    required this.gutter,
    required this.onTap,
  });

  final String query;
  final double gutter;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: gutter,
            vertical: BlynkSpace.s8,
          ),
          child: Row(
            children: [
              const Icon(
                Icons.history,
                size: BlynkIcons.sm,
                color: BlynkColors.ink2,
              ),
              const SizedBox(width: BlynkSpace.s12),
              Expanded(
                child: Text(
                  query,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: BlynkText.body,
                ),
              ),
              const SizedBox(width: BlynkSpace.s8),
              const Icon(
                Icons.north_west,
                size: BlynkIcons.xs,
                color: BlynkColors.ink2,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ResultsView extends StatelessWidget {
  const _ResultsView({
    required this.query,
    required this.categorySlug,
    required this.scrollController,
    required this.onCategorySelected,
  });

  final String query;
  final String? categorySlug;
  final ScrollController scrollController;
  final ValueChanged<String?> onCategorySelected;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ProductProvider>();
    final categories = provider.categories;
    // Until the debounced request for *this* query and filter has started,
    // whatever the provider holds belongs to something else.
    final isCurrent = provider.lastQuery == query &&
        provider.searchCategorySlug == categorySlug;
    final isLoading = !isCurrent || provider.isSearching;

    CategoryModel? activeCategory;
    for (final c in categories) {
      if (c.slug == categorySlug) activeCategory = c;
    }

    // The grid follows the app's one column rule (BlynkProductGrid): 2/3/4/5
    // by width, with its gutter and tile spacing, and a *measured* tile
    // height rather than a fixed aspect ratio - a product card is a square
    // image plus a text-scale-dependent block, so a ratio either squashes the
    // image or clips the name at 2.0x.
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final gridDelegate = productGridDelegate(context, width);
        final gridPadding = BlynkProductGrid.paddingFor(width);
        final columns = BlynkProductGrid.columnsFor(width);

        final List<Widget> content;
        if (isLoading) {
          content = [
            const SliverToBoxAdapter(child: SizedBox(height: BlynkSpace.s12)),
            SliverPadding(
              padding: gridPadding,
              sliver: SliverGrid(
                gridDelegate: gridDelegate,
                delegate: SliverChildBuilderDelegate(
                  (_, __) => const ProductCardSkeleton(),
                  childCount: columns * 2,
                ),
              ),
            ),
          ];
        } else if (provider.searchFailure != null) {
          content = [
            SliverFillRemaining(
              hasScrollBody: false,
              child: FailureState(
                failure: provider.searchFailure!,
                title: "Couldn't load results",
                scrollable: false,
                onRetry: provider.retrySearch,
              ),
            ),
          ];
        } else if (provider.searchResults.isEmpty) {
          final scope =
              activeCategory != null ? ' in ${activeCategory.name}' : '';
          content = [
            SliverFillRemaining(
              hasScrollBody: false,
              child: AppStateView(
                icon: Icons.search_off,
                title: 'No results for "$query"$scope',
                message: 'Check the spelling or browse categories.',
                actionLabel: 'Browse categories',
                onAction: () => Navigator.of(context).pushNamed('/categories'),
              ),
            ),
          ];
        } else {
          content = [
            SliverToBoxAdapter(
              child: _ResultsSummary(
                query: query,
                // The count is the backend's pagination.total, never the
                // length of the page we happen to be holding.
                total: provider.searchTotal,
                padding: EdgeInsets.fromLTRB(
                  gridPadding.left,
                  BlynkSpace.s16,
                  gridPadding.right,
                  BlynkSpace.s12,
                ),
              ),
            ),
            SliverPadding(
              padding: gridPadding,
              sliver: SliverGrid(
                gridDelegate: gridDelegate,
                delegate: SliverChildBuilderDelegate(
                  (context, index) => EntranceFade(
                    key: ValueKey(provider.searchResults[index].id),
                    delay: BlynkMotion.staggerFor(index),
                    child: ProductCard(product: provider.searchResults[index]),
                  ),
                  childCount: provider.searchResults.length,
                ),
              ),
            ),
            if (provider.isLoadingMoreSearch)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(BlynkSpace.s16),
                  child: Center(
                    child: SizedBox(
                      width: BlynkSpace.s24,
                      height: BlynkSpace.s24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: BlynkColors.ink,
                      ),
                    ),
                  ),
                ),
              ),
            // Clears the floating cart bar.
            const SliverToBoxAdapter(
              child: SizedBox(height: SearchScreen.bottomClearance),
            ),
          ];
        }

        // One pulse for every skeleton card; parked (no ticker) when not loading.
        return SkeletonScope(
          active: isLoading,
          child: CustomScrollView(
            controller: scrollController,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            slivers: [
              if (categories.isNotEmpty)
                SliverToBoxAdapter(
                  child: _CategoryFilterBar(
                    categories: categories,
                    selectedSlug: categorySlug,
                    onSelected: onCategorySelected,
                  ),
                ),
              ...content,
            ],
          ),
        );
      },
    );
  }
}

/// What was searched for and how many the backend found. Both values are
/// real: the query as typed, and `pagination.total` from the response.
class _ResultsSummary extends StatelessWidget {
  const _ResultsSummary({
    required this.query,
    required this.total,
    required this.padding,
  });

  final String query;
  final int total;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Search results',
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
          const SizedBox(height: BlynkSpace.s4),
          Text(
            '"$query"',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.sectionHeader,
          ),
          const SizedBox(height: BlynkSpace.s4),
          Text(
            '$total ${total == 1 ? 'product' : 'products'}',
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
        ],
      ),
    );
  }
}

class _CategoryFilterBar extends StatelessWidget {
  const _CategoryFilterBar({
    required this.categories,
    required this.selectedSlug,
    required this.onSelected,
  });

  final List<CategoryModel> categories;
  final String? selectedSlug;
  final ValueChanged<String?> onSelected;

  /// A floor, not a fixed height: a large text size must be able to grow the
  /// bar, so the chips sit in a scroll view that sizes to them.
  static const double minBarHeight = 52;

  @override
  Widget build(BuildContext context) {
    final gutter = BlynkSpace.gutterFor(Responsive.of(context).width);

    return Container(
      color: BlynkColors.paper,
      constraints: const BoxConstraints(minHeight: minBarHeight),
      alignment: Alignment.centerLeft,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(
          horizontal: gutter,
          vertical: BlynkSpace.s8,
        ),
        child: Row(
          children: [
            _FilterChip(
              label: 'All',
              selected: selectedSlug == null,
              onTap: () => onSelected(null),
            ),
            for (final category in categories)
              _FilterChip(
                label: category.name,
                selected: selectedSlug == category.slug,
                onTap: () => onSelected(category.slug),
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: BlynkSpace.s8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => onTap(),
        // Selected is ink, not yellow: yellow is only the forward action.
        selectedColor: BlynkColors.ink,
        backgroundColor: BlynkColors.well,
        side: const BorderSide(color: BlynkColors.lineStrong),
        labelStyle: BlynkText.label.copyWith(
          color: selected ? BlynkColors.paper : BlynkColors.ink,
        ),
      ),
    );
  }
}
