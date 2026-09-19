import 'package:flutter/material.dart';

import '../../../app_design.dart';

/// A softly pulsing placeholder block. Deliberately hand-rolled rather than
/// pulling in a shimmer package for what amounts to one opacity tween.
class AppSkeleton extends StatefulWidget {
  const AppSkeleton({
    super.key,
    this.width,
    this.height = 14,
    this.radius = 8,
  });

  final double? width;
  final double height;
  final double radius;

  @override
  State<AppSkeleton> createState() => _AppSkeletonState();
}

class _AppSkeletonState extends State<AppSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.45, end: 1.0).animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
      ),
      child: Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: AppSurfaces.tile,
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// Placeholder shaped like a ProductCard, so a loading grid holds the same
/// layout the real products will occupy instead of collapsing and jumping.
class ProductCardSkeleton extends StatelessWidget {
  const ProductCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: AppSkeleton(height: double.infinity, radius: 12)),
          SizedBox(height: AppSpacing.sm),
          AppSkeleton(height: 12),
          SizedBox(height: AppSpacing.xs + 2),
          AppSkeleton(width: 60, height: 10),
          SizedBox(height: AppSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AppSkeleton(width: 54, height: 14),
              AppSkeleton(width: 46, height: 26, radius: 12),
            ],
          ),
        ],
      ),
    );
  }
}

/// Placeholder for a category tile.
class CategoryTileSkeleton extends StatelessWidget {
  const CategoryTileSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AspectRatio(
          aspectRatio: 1,
          child: AppSkeleton(height: double.infinity, radius: 14),
        ),
        SizedBox(height: AppSpacing.sm),
        AppSkeleton(width: 56, height: 10),
      ],
    );
  }
}

/// Placeholder for a list row (orders, addresses).
class ListRowSkeleton extends StatelessWidget {
  const ListRowSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: appCardDecoration(),
      child: const Row(
        children: [
          AppSkeleton(width: 44, height: 44, radius: 12),
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
    );
  }
}
