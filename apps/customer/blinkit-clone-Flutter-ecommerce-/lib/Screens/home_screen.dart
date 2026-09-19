import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/product.provider.dart';

import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Organisms/bottom_cart_container.dart';
import '../UI/Widgets/Organisms/home_product_sections.dart';
import '../UI/Widgets/Organisms/home_screen_app_bar.dart';
import '../UI/Widgets/Organisms/home_screen_category_builder.dart';
import '../UI/Widgets/Organisms/home_screen_search_bar.dart';
import '../UI/Widgets/Organisms/home_screen_carousel.dart';
import '../app_responsive.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);

    return Scaffold(
      primary: true,
      body: Stack(
        children: [
          // On a wide desktop viewport, a single-column feed of sections
          // stretched full-width looks like a mobile layout blown up rather
          // than a real desktop composition - cap and center it instead.
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
              // Pull down for the backend's current catalog. Forced, because
              // the customer asked for it explicitly.
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
                    const HomeScreenAppBar(),
                    const HomeScreenSearchBar(),
                    const HomeScreenCarousel(),
                    SliverToBoxAdapter(
                      child: AppSectionHeader(
                        title: 'Categories',
                        actionLabel: 'See all',
                        onAction: () =>
                            Navigator.of(context).pushNamed('/categories'),
                      ),
                    ),
                    const HomeScreenCateogoryWidget(),
                    // One rail per real backend category - nothing about the
                    // catalog is hardcoded here, so a category added server
                    // side appears without a code change.
                    const HomeProductSections(),
                    // Clears the floating cart bar so the last rail isn't
                    // hidden behind it.
                    const SliverToBoxAdapter(child: SizedBox(height: 96)),
                  ],
                ),
              ),
            ),
          ),
          // Width-aligned with the centered content column above so it
          // doesn't span full desktop width while the feed above it is
          // capped.
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
