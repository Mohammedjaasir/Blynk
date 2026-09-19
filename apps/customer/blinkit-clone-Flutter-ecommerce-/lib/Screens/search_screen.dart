import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Infrastructure/LocalStorage/recent_searches_storage.dart';
import '../Models/category_model.dart';
import '../Services/Providers/product.provider.dart';
import '../Services/Validation/app_validators.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/card_product.dart';
import '../UI/Widgets/Organisms/bottom_cart_container.dart';
import '../app_colors.dart';
import '../app_design.dart';
import '../app_responsive.dart';

/// Catalog search. Results come from the backend's server-side search
/// (ProductProvider.search), rendered with the app's single ProductCard, so
/// adding from here goes through the same CartProvider as everywhere else.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, this.initialCategorySlug});

  /// Pre-selects a category filter (e.g. when opened from a category page).
  final String? initialCategorySlug;

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

    return Scaffold(
      backgroundColor: AppSurfaces.subtle,
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
    );
  }
}

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

  @override
  Widget build(BuildContext context) {
    final activeBorder = OutlineInputBorder(
      borderRadius: AppRadius.fieldBorder,
      borderSide: const BorderSide(
        color: AppColors.primaryYellowColor,
        width: 2,
      ),
    );

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xs,
        AppSpacing.lg,
        AppSpacing.md,
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
          buildCounter: (_, {required currentLength, required isFocused, maxLength}) =>
              null,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: AppTextColors.primary,
          ),
          decoration: InputDecoration(
            hintText: 'Search groceries & essentials',
            fillColor: Colors.white,
            isDense: true,
            prefixIcon: const Icon(
              Icons.search_rounded,
              color: AppTextColors.primary,
            ),
            suffixIcon: controller.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(
                      Icons.close_rounded,
                      color: AppTextColors.secondary,
                    ),
                    onPressed: onClear,
                  ),
            focusedBorder: activeBorder,
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

    if (recent.isEmpty && categories.isEmpty) {
      return const AppStateView(
        icon: Icons.manage_search_rounded,
        title: 'What are you looking for?',
        message: 'Search for groceries, snacks and everyday essentials.',
      );
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: 96),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: [
        if (recent.isNotEmpty) ...[
          _SectionTitle(
            title: 'Recent searches',
            trailing: TextButton(
              onPressed: onClearRecent,
              child: const Text('Clear'),
            ),
          ),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            decoration: appCardDecoration(),
            child: Material(
              color: Colors.transparent,
              child: Column(
                children: [
                  for (final query in recent)
                    ListTile(
                      dense: true,
                      leading: const Icon(
                        Icons.history_rounded,
                        color: AppTextColors.muted,
                      ),
                      title: Text(
                        query,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppTextColors.primary,
                        ),
                      ),
                      trailing: const Icon(
                        Icons.north_west_rounded,
                        size: 18,
                        color: AppTextColors.muted,
                      ),
                      onTap: () => onRecentTap(query),
                    ),
                ],
              ),
            ),
          ),
        ],
        if (categories.isNotEmpty) ...[
          const _SectionTitle(title: 'Browse categories'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                for (final category in categories)
                  ActionChip(
                    avatar: const Icon(
                      Icons.local_grocery_store_outlined,
                      size: 16,
                      color: AppTextColors.secondary,
                    ),
                    label: Text(category.name),
                    backgroundColor: Colors.white,
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.sm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
                color: AppTextColors.secondary,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
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
    final crossAxisCount = Responsive.of(context).gridColumns;

    CategoryModel? activeCategory;
    for (final c in categories) {
      if (c.slug == categorySlug) activeCategory = c;
    }

    // A fixed aspect ratio makes tiles grow ever taller as columns widen.
    // Instead: a square image the width of the tile, plus the card's
    // fixed-height text block (scaled with the user's text size).
    final contentWidth = math.min(
      MediaQuery.sizeOf(context).width,
      Responsive.of(context).contentMaxWidth,
    );
    final tileWidth = (contentWidth -
            AppSpacing.lg * 2 -
            AppSpacing.md * (crossAxisCount - 1)) /
        crossAxisCount;
    final textScale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.6);
    final gridDelegate = SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: crossAxisCount,
      mainAxisSpacing: AppSpacing.md,
      crossAxisSpacing: AppSpacing.md,
      mainAxisExtent: tileWidth - AppSpacing.lg + 124 * textScale,
    );
    const gridPadding = EdgeInsets.fromLTRB(
      AppSpacing.lg,
      0,
      AppSpacing.lg,
      AppSpacing.lg,
    );

    final List<Widget> content;
    if (isLoading) {
      content = [
        const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.md)),
        SliverPadding(
          padding: gridPadding,
          sliver: SliverGrid(
            gridDelegate: gridDelegate,
            delegate: SliverChildBuilderDelegate(
              (_, __) => const ProductCardSkeleton(),
              childCount: crossAxisCount * 2,
            ),
          ),
        ),
      ];
    } else if (provider.searchError != null) {
      content = [
        SliverFillRemaining(
          hasScrollBody: false,
          child: AppStateView(
            icon: Icons.wifi_off_rounded,
            title: "Couldn't load results",
            message: 'Check your connection and try again.',
            actionLabel: 'Try Again',
            onAction: provider.retrySearch,
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
            icon: Icons.search_off_rounded,
            title: 'Sorry!',
            message: 'We couldn\'t find anything for "$query"$scope.\n'
                'Try checking the spelling or using a broader search.',
            actionLabel: 'Browse Categories',
            onAction: () => Navigator.of(context).pushNamed('/categories'),
            accent: AppTextColors.secondary,
          ),
        ),
      ];
    } else {
      final total = provider.searchTotal;
      content = [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Search results',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTextColors.secondary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '"$query"',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppTextColors.primary,
                  ),
                ),
                Text(
                  '$total ${total == 1 ? 'product' : 'products'}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTextColors.secondary,
                  ),
                ),
              ],
            ),
          ),
        ),
        SliverPadding(
          padding: gridPadding,
          sliver: SliverGrid(
            gridDelegate: gridDelegate,
            delegate: SliverChildBuilderDelegate(
              (context, index) =>
                  ProductCard(product: provider.searchResults[index]),
              childCount: provider.searchResults.length,
            ),
          ),
        ),
        if (provider.isLoadingMoreSearch)
          const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(AppSpacing.lg),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
              ),
            ),
          ),
        // Clears the floating cart bar.
        const SliverToBoxAdapter(child: SizedBox(height: 96)),
      ];
    }

    return CustomScrollView(
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

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.sm,
        ),
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
      padding: const EdgeInsets.only(right: AppSpacing.sm),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => onTap(),
        selectedColor: AppColors.primaryYellowColor,
        backgroundColor: AppSurfaces.subtle,
        side: BorderSide(
          color: selected
              ? AppColors.primaryYellowColor
              : AppSurfaces.border,
        ),
        labelStyle: TextStyle(
          fontSize: 13,
          fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
          color: AppTextColors.primary,
        ),
      ),
    );
  }
}
