import 'package:flutter/material.dart';

import '../../../app_design.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import 'card_product.dart';
import 'category_widget.dart';

/// Owns the ONE pulse animation every skeleton below it shares, so a loading
/// screen runs a single ticker instead of one per block.
///
/// Wrap a whole loading region in it. A skeleton with no scope above it makes
/// its own (see [SkeletonScope.ensure]), so existing screens keep working.
/// The pulse is static when the platform asks for reduced motion.
///
/// [active] false parks the pulse (no ticker) without changing the tree, so a
/// screen can keep one scope above its scroll view and switch it on only while
/// something under it is loading.
class SkeletonScope extends StatefulWidget {
  const SkeletonScope({super.key, required this.child, this.active = true});

  final Widget child;
  final bool active;

  /// The shared pulse (opacity 0.6 to 1.0), or null when there is no scope.
  static Animation<double>? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_SkeletonPulse>()?.animation;

  /// [child] inside a scope: the existing one if there is one, else a new one.
  static Widget ensure({required Widget child}) => _EnsureScope(child: child);

  @override
  State<SkeletonScope> createState() => _SkeletonScopeState();
}

class _SkeletonScopeState extends State<SkeletonScope> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: BlynkMotion.slow,
  );
  late final Animation<double> _opacity = _controller
      .drive(CurveTween(curve: Curves.easeInOut))
      .drive(Tween<double>(begin: 0.6, end: 1.0));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(SkeletonScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active) _sync();
  }

  void _sync() {
    if (!widget.active || (MediaQuery.maybeDisableAnimationsOf(context) ?? false)) {
      // Static: fully opaque, no ticker running.
      _controller
        ..stop()
        ..value = 1;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _SkeletonPulse(animation: _opacity, child: widget.child);
}

class _SkeletonPulse extends InheritedWidget {
  const _SkeletonPulse({required this.animation, required super.child});

  final Animation<double> animation;

  @override
  bool updateShouldNotify(_SkeletonPulse oldWidget) => animation != oldWidget.animation;
}

class _EnsureScope extends StatelessWidget {
  const _EnsureScope({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (SkeletonScope.maybeOf(context) != null) return child;
    return SkeletonScope(child: child);
  }
}

/// A softly pulsing placeholder block: `well` fill, small radius.
class AppSkeleton extends StatelessWidget {
  const AppSkeleton({
    super.key,
    this.width,
    this.height = 14,
    this.radius = BlynkRadius.sm,
  });

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return SkeletonScope.ensure(child: _SkeletonBlock(width: width, height: height, radius: radius));
  }
}

class _SkeletonBlock extends StatelessWidget {
  const _SkeletonBlock({required this.width, required this.height, required this.radius});

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: SkeletonScope.maybeOf(context)!,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: BlynkColors.well,
          borderRadius: BorderRadius.circular(radius),
        ),
      ),
    );
  }
}

/// Placeholder shaped like a ProductCard, so a loading grid holds the same
/// layout the real products will occupy instead of collapsing and jumping:
/// an image well, two name lines, the unit, the price and the 48 dp control
/// row (heights are the card's at 1.0x text scale).
///
/// It carries the **card's own** surface, radius and elevation rather than
/// the generic `appCardDecoration()`, which adds a `line` stroke and a
/// 16 dp radius the real card does not have — the placeholder used to pop
/// into a different silhouette the moment content landed.
/// `product_card_layout_test.dart` pins the box to `ProductCard.heightFor`;
/// T3 must move both together when it restyles the card.
class ProductCardSkeleton extends StatelessWidget {
  const ProductCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    // W1: every box below is read from ProductCard's own geometry helpers, so
    // the placeholder cannot drift from the card it stands in for (T2 report
    // §8 E). A restyle of the card moves this in the same edit or the
    // silhouette tests go red.
    return SkeletonScope.ensure(
      child: Container(
        decoration: const BoxDecoration(
          color: BlynkCardProduct.surface,
          borderRadius: BlynkCardProduct.radius,
          boxShadow: BlynkCardProduct.elevation,
        ),
        padding: const EdgeInsets.all(ProductCard.padding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // The image well's own radius, not the default block radius.
            const Expanded(
              child: AppSkeleton(height: double.infinity, radius: BlynkRadius.chip),
            ),
            const SizedBox(height: ProductCard.gap),
            // The name box: two lines, at the card's own two-line height.
            SizedBox(
              height: ProductCard.nameBox(context),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppSkeleton(height: 12),
                  SizedBox(height: AppSpacing.xs + 2),
                  AppSkeleton(width: 80, height: 12),
                ],
              ),
            ),
            const SizedBox(height: ProductCard.rowGap),
            SizedBox(
              height: ProductCard.unitBox(context),
              child: const Align(
                alignment: Alignment.centerLeft,
                child: AppSkeleton(width: 60, height: 10),
              ),
            ),
            const SizedBox(height: ProductCard.rowGap),
            SizedBox(
              height: ProductCard.priceBox(context),
              child: const Align(
                alignment: Alignment.centerLeft,
                child: AppSkeleton(width: 54, height: 14),
              ),
            ),
            // The control row: a 40 dp pill in the card's control slot, right
            // aligned, at the add control's own radius (BlynkRadius.pill).
            const SizedBox(
              height: ProductCard.controlSlot,
              width: double.infinity,
              child: Align(
                alignment: Alignment.centerRight,
                child: AppSkeleton(width: 64, height: 40, radius: BlynkRadius.pill),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Placeholder for a category tile.
class CategoryTileSkeleton extends StatelessWidget {
  const CategoryTileSkeleton({super.key, this.size, this.rounded = false});

  /// The tile's size; defaults to [CategoryWidget.diameterFor] the screen.
  final double? size;

  /// A rounded square, matching a `CategoryWidget(rounded: true)` tile.
  final bool rounded;

  @override
  Widget build(BuildContext context) {
    return SkeletonScope.ensure(
      // A circle and a centred label, because that is what the real
      // [CategoryWidget] is: a square skeleton under a circular tile makes
      // the row jump shape the moment categories arrive.
      child: Builder(
        builder: (context) {
          final size = this.size ?? CategoryWidget.diameterFor(Responsive.of(context).width);
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppSkeleton(width: size, height: size, radius: rounded ? size * 0.28 : size / 2),
              const SizedBox(height: BlynkCategory.gap),
              const AppSkeleton(width: 56, height: 10),
            ],
          );
        },
      ),
    );
  }
}

/// Placeholder for a list row (orders, addresses).
class ListRowSkeleton extends StatelessWidget {
  const ListRowSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return SkeletonScope.ensure(
      child: Container(
        margin: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: appCardDecoration(),
        child: const Row(
          children: [
            AppSkeleton(width: 44, height: 44),
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppSkeleton(height: 13),
                  SizedBox(height: AppSpacing.sm),
                  AppSkeleton(width: 120, height: 11),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
