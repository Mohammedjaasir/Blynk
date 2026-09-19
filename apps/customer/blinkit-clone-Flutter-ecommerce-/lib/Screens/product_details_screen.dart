import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/product_model.dart';
import '../Services/Providers/cart.provider.dart';
import '../Services/Providers/product.provider.dart';
import '../UI/Widgets/Atoms/add_to_cart_button.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/card_product.dart';
import '../UI/Widgets/Organisms/bottom_cart_container.dart';
import '../app_colors.dart';
import '../app_design.dart';
import '../constants.dart';

/// Full product page, opened from any ProductCard (Home, Categories,
/// Search). The tapped product renders immediately, then the page asks
/// the backend for that product by id so price and availability are the
/// current ones.
///
/// There is no favourite action: the backend has no favourites module and
/// this page doesn't pretend otherwise.
class ProductDetailsScreen extends StatefulWidget {
  const ProductDetailsScreen({
    super.key,
    required this.productId,
    this.initialProduct,
  });

  final String productId;

  /// The listing copy the customer tapped, shown while the fresh copy
  /// loads. Null when the page is opened by id alone.
  final ProductModel? initialProduct;

  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

/// Two columns from here up; below it the page stacks like a phone.
const double _twoColumnBreakpoint = 720;

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  void _load() {
    if (!mounted) return;
    context.read<ProductProvider>().loadProductDetail(widget.productId);
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ProductProvider>();
    final failure = provider.productDetailFailure(widget.productId);
    final product =
        provider.productDetail(widget.productId) ?? widget.initialProduct;
    final wide = MediaQuery.sizeOf(context).width >= _twoColumnBreakpoint;

    Widget body;
    Widget? bottomBar;

    if (failure == ProductDetailFailure.notFound) {
      // Removed or deactivated in the store - even if we have a listing
      // copy, it must not stay purchasable here.
      body = AppStateView(
        icon: Icons.inventory_2_outlined,
        title: 'Product no longer available',
        message: 'This item has been removed from the store.',
        actionLabel: 'Go Back',
        onAction: () => Navigator.of(context).maybePop(),
        accent: AppTextColors.secondary,
      );
    } else if (product == null) {
      body = failure == ProductDetailFailure.network
          ? AppStateView(
              icon: Icons.wifi_off_rounded,
              title: "Couldn't load this product",
              message: 'Check your connection and try again.',
              actionLabel: 'Try Again',
              onAction: _load,
              accent: AppTextColors.secondary,
            )
          : _DetailsSkeleton(wide: wide);
    } else {
      body = _DetailsBody(product: product, wide: wide);
      if (!wide) bottomBar = _BottomCtaBar(product: product);
    }

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0.5,
      ),
      body: body,
      bottomNavigationBar: bottomBar,
    );
  }
}

class _DetailsBody extends StatelessWidget {
  const _DetailsBody({required this.product, required this.wide});

  final ProductModel product;
  final bool wide;

  // Leaves room for the global floating cart bar when it slides in.
  static const double _floatingCartClearance = 96;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final content = wide
            ? _wideLayout(constraints)
            : _narrowLayout(constraints);

        return Stack(
          children: [
            Positioned.fill(child: content),
            Align(
              alignment: Alignment.bottomCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: wide ? 560 : 9999),
                child: const BottomStickyContainer(),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _narrowLayout(BoxConstraints constraints) {
    const pad = AppSpacing.lg;
    // Square image, but never so tall that the name and price fall below
    // the fold on a short phone.
    final imageSize = math.min(
      constraints.maxWidth - pad * 2,
      constraints.maxHeight * 0.48,
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        pad,
        AppSpacing.xs,
        pad,
        _floatingCartClearance,
      ),
      children: [
        _Entrance(
          scaleFrom: 0.96,
          child: _ImagePanel(product: product, height: imageSize),
        ),
        const SizedBox(height: AppSpacing.xl),
        _Entrance(
          delay: 60,
          child: _ProductSummary(product: product),
        ),
        _Entrance(
          delay: 100,
          child: _ProductSections(product: product),
        ),
      ],
    );
  }

  Widget _wideLayout(BoxConstraints constraints) {
    const hPad = AppSpacing.xxxl;
    const vPad = AppSpacing.xxl;
    const gap = 48.0;
    final contentWidth = math.min(constraints.maxWidth, 1120.0) - hPad * 2;
    // Image column takes ~45%, capped so it never outgrows the viewport
    // height on a landscape laptop (1280 x 720).
    final imageSize = math.max(
      160.0,
      math.min(
        (contentWidth - gap) * 0.45,
        constraints.maxHeight - vPad * 2 - AppSpacing.lg,
      ),
    );

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        hPad,
        vPad,
        hPad,
        _floatingCartClearance,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: contentWidth),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Entrance(
                scaleFrom: 0.96,
                child: SizedBox(
                  width: imageSize,
                  child: _ImagePanel(product: product, height: imageSize),
                ),
              ),
              const SizedBox(width: gap),
              Expanded(
                child: _Entrance(
                  delay: 60,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _ProductSummary(product: product),
                      const SizedBox(height: AppSpacing.xl),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 360),
                        child: AddToCartButton(
                          product: product,
                          compact: false,
                          expanded: true,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      _CartFeedback(product: product),
                      _ProductSections(product: product),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ImagePanel extends StatelessWidget {
  const _ImagePanel({required this.product, required this.height});

  final ProductModel product;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: product.name,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: AppSurfaces.subtle,
          borderRadius: BorderRadius.circular(AppRadius.sheet),
        ),
        clipBehavior: Clip.antiAlias,
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ProductImage(product: product, fallbackIconSize: 72),
            if (!product.isAvailable)
              Container(color: Colors.white.withValues(alpha: 0.55)),
          ],
        ),
      ),
    );
  }
}

class _ProductSummary extends StatelessWidget {
  const _ProductSummary({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final unitLine = [
      product.unit,
      if (product.packSize != null && product.packSize!.trim().isNotEmpty)
        product.packSize!,
    ].where((s) => s.trim().isNotEmpty).join(' · ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (product.categoryName.isNotEmpty) ...[
          Text(
            product.categoryName.toUpperCase(),
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
              color: AppTextColors.secondary,
            ),
          ),
          const SizedBox(height: AppSpacing.xs + 2),
        ],
        Semantics(
          header: true,
          child: Text(
            product.name,
            style: const TextStyle(
              fontSize: 24,
              height: 1.2,
              fontWeight: FontWeight.w800,
              color: AppTextColors.primary,
            ),
          ),
        ),
        if (unitLine.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xs + 2),
          Text(
            unitLine,
            style: const TextStyle(
              fontSize: 15,
              color: AppTextColors.secondary,
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: AppSpacing.md,
          runSpacing: AppSpacing.sm,
          children: [
            Text(
              _price(product),
              style: const TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w800,
                color: AppTextColors.primary,
              ),
            ),
            if (!product.isAvailable) const _UnavailablePill(),
          ],
        ),
      ],
    );
  }
}

String _price(ProductModel product) =>
    '$appCurrencySybmbol ${product.sellingPrice.toStringAsFixed(0)}';

class _UnavailablePill extends StatelessWidget {
  const _UnavailablePill();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.xs + 1,
      ),
      decoration: BoxDecoration(
        color: AppSurfaces.tile,
        borderRadius: BorderRadius.circular(AppRadius.chip),
      ),
      child: const Text(
        'Currently unavailable',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: AppTextColors.primary,
        ),
      ),
    );
  }
}

/// Description (only when the backend has one) and the product's real
/// catalogue attributes. Nothing here is generated copy.
class _ProductSections extends StatelessWidget {
  const _ProductSections({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final description = product.description?.trim() ?? '';
    final rows = <MapEntry<String, String>>[
      if (product.unit.trim().isNotEmpty) MapEntry('Unit', product.unit),
      if (product.packSize != null && product.packSize!.trim().isNotEmpty)
        MapEntry('Pack', product.packSize!),
      if (product.categoryName.isNotEmpty)
        MapEntry('Category', product.categoryName),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (description.isNotEmpty) ...[
          const _SectionDivider(),
          const _SectionTitle('About this product'),
          const SizedBox(height: AppSpacing.sm),
          Text(
            description,
            style: const TextStyle(
              fontSize: 15,
              height: 1.5,
              color: AppTextColors.primary,
            ),
          ),
        ],
        if (rows.isNotEmpty) ...[
          const _SectionDivider(),
          const _SectionTitle('Product details'),
          const SizedBox(height: AppSpacing.xs),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs + 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 96,
                    child: Text(
                      row.key,
                      style: const TextStyle(
                        fontSize: 14,
                        color: AppTextColors.secondary,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      row.value,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppTextColors.primary,
                      ),
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

class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Divider(height: 1, color: AppSurfaces.border),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w800,
          color: AppTextColors.primary,
        ),
      ),
    );
  }
}

/// "2 in cart" once the product is in the cart - the confirmation that the
/// tap landed, driven by CartProvider rather than a one-off toast.
class _CartFeedback extends StatelessWidget {
  const _CartFeedback({required this.product, this.fallback});

  final ProductModel product;
  final Widget? fallback;

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartProvider, int>(
      (cart) => cart.quantityOf(product.id),
    );

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 200),
      // The outgoing label drops out at once so the two never overlap.
      switchOutCurve: const Threshold(1),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SizeTransition(sizeFactor: animation, child: child),
      ),
      child: quantity > 0
          ? Row(
              key: const ValueKey('in-cart'),
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.check_circle_rounded,
                  size: 16,
                  color: AppColors.primaryGreenColor,
                ),
                const SizedBox(width: AppSpacing.xs + 2),
                Flexible(
                  child: Text(
                    '$quantity in cart',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryGreenColor,
                    ),
                  ),
                ),
              ],
            )
          : (fallback ?? const SizedBox(key: ValueKey('empty'))),
    );
  }
}

/// Phone CTA pinned under the content (Scaffold.bottomNavigationBar), so
/// it sits inside the safe area and the global floating cart stacks above
/// it rather than on top of it.
class _BottomCtaBar extends StatelessWidget {
  const _BottomCtaBar({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    return _Entrance(
      slideFrom: 24,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppSurfaces.border)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Row(
              children: [
                Flexible(
                  flex: 2,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _price(product),
                        maxLines: 1,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AppTextColors.primary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      _CartFeedback(
                        product: product,
                        fallback: Text(
                          product.unit,
                          key: const ValueKey('unit'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTextColors.secondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.lg),
                Expanded(
                  flex: 3,
                  child: AddToCartButton(
                    product: product,
                    compact: false,
                    expanded: true,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One-shot entrance: fade plus a small slide or scale. Plays when the
/// widget first mounts (content replacing the skeleton), never on rebuilds.
class _Entrance extends StatelessWidget {
  const _Entrance({
    required this.child,
    this.delay = 0,
    this.slideFrom = 12,
    this.scaleFrom = 1,
  });

  final Widget child;
  final int delay;
  final double slideFrom;
  final double scaleFrom;

  @override
  Widget build(BuildContext context) {
    final total = 280 + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: total),
      curve: Interval(delay / total, 1, curve: Curves.easeOutCubic),
      child: child,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, (1 - t) * slideFrom),
          child: Transform.scale(
            scale: scaleFrom + (1 - scaleFrom) * t,
            child: child,
          ),
        ),
      ),
    );
  }
}

class _DetailsSkeleton extends StatelessWidget {
  const _DetailsSkeleton({required this.wide});

  final bool wide;

  @override
  Widget build(BuildContext context) {
    const info = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppSkeleton(width: 90, height: 10),
        SizedBox(height: AppSpacing.md),
        AppSkeleton(height: 22),
        SizedBox(height: AppSpacing.sm),
        AppSkeleton(width: 180, height: 22),
        SizedBox(height: AppSpacing.md),
        AppSkeleton(width: 80, height: 13),
        SizedBox(height: AppSpacing.lg),
        AppSkeleton(width: 110, height: 26),
        SizedBox(height: AppSpacing.xl),
        AppSkeleton(height: 52, radius: AppRadius.button),
      ],
    );

    return Semantics(
      label: 'Loading product',
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (!wide) {
            final size = math.min(
              constraints.maxWidth - AppSpacing.lg * 2,
              constraints.maxHeight * 0.48,
            );
            return ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              physics: const NeverScrollableScrollPhysics(),
              children: [
                AppSkeleton(height: size, radius: AppRadius.sheet),
                const SizedBox(height: AppSpacing.xl),
                info,
              ],
            );
          }
          final width = math.min(constraints.maxWidth, 1120.0) -
              AppSpacing.xxxl * 2;
          final size = math.min(
            (width - 48) * 0.45,
            constraints.maxHeight - AppSpacing.xxl * 2 - AppSpacing.lg,
          );
          return Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.xxxl,
              vertical: AppSpacing.xxl,
            ),
            child: Align(
              alignment: Alignment.topCenter,
              child: SizedBox(
                width: width,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppSkeleton(
                      width: size,
                      height: size,
                      radius: AppRadius.sheet,
                    ),
                    const SizedBox(width: 48),
                    const Expanded(child: info),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
