import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/promotion_model.dart';
import '../../../Services/Providers/product.provider.dart';
import '../../../app_colors.dart';
import '../../../app_design.dart';
import '../../../app_responsive.dart';

/// Home's promotional hero.
///
/// Composition is a poster: the background layer (solid, gradient or image -
/// chosen in Blynk Ops), then quiet depth, then the headline block, then the
/// foreground product visual overlapping it. Every value comes from
/// GET /promotions; this widget invents no campaign content and picks no
/// colours of its own. With nothing active it renders nothing at all.
class HomeScreenCarousel extends StatefulWidget {
  const HomeScreenCarousel({super.key});

  @override
  State<HomeScreenCarousel> createState() => _HomeScreenCarouselState();
}

class _HomeScreenCarouselState extends State<HomeScreenCarousel> {
  static const _autoAdvance = Duration(seconds: 6);
  static const _transition = Duration(milliseconds: 520);

  late final PageController _pageController;
  Timer? _autoScrollTimer;
  int _currentPage = 0;
  int _slideCount = 0;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<ProductProvider>().loadPromotions();
    });
    _startAutoScroll();
  }

  void _startAutoScroll() {
    _autoScrollTimer?.cancel();
    _autoScrollTimer = Timer.periodic(_autoAdvance, (_) {
      if (!mounted || !_pageController.hasClients || _slideCount < 2) return;
      // Not while Home is buried under a pushed route.
      if (!(ModalRoute.of(context)?.isCurrent ?? true)) return;
      _pageController.animateToPage(
        (_currentPage + 1) % _slideCount,
        duration: _transition,
        curve: Curves.easeInOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _autoScrollTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final promotions = context.watch<ProductProvider>().promotions;
    _slideCount = promotions.length;

    // Nothing active, still loading, or the request failed: Home carries on
    // without a carousel instead of showing placeholder campaigns.
    if (promotions.isEmpty) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    if (_currentPage >= promotions.length) {
      _currentPage = promotions.length - 1;
    }

    final metrics = _HeroMetrics.of(Responsive.of(context));

    return SliverToBoxAdapter(
      child: Column(
        children: [
          SizedBox(
            height: metrics.height,
            child: PageView.builder(
              controller: _pageController,
              itemCount: promotions.length,
              onPageChanged: (index) {
                setState(() => _currentPage = index);
                _startAutoScroll();
              },
              itemBuilder: (context, index) {
                return Padding(
                  padding: EdgeInsets.symmetric(
                    horizontal: metrics.sideMargin,
                    vertical: AppSpacing.xs,
                  ),
                  child: _PromoSlide(
                    promotion: promotions[index],
                    isActive: index == _currentPage,
                    metrics: metrics,
                  ),
                );
              },
            ),
          ),
          if (promotions.length > 1) ...[
            const SizedBox(height: AppSpacing.md),
            _SlideIndicator(
              count: promotions.length,
              current: _currentPage.clamp(0, promotions.length - 1),
              onTap: (index) {
                _pageController.animateToPage(
                  index,
                  duration: _transition,
                  curve: Curves.easeInOutCubic,
                );
                _startAutoScroll();
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// Sizes per width band. Each band is composed, not scaled from the desktop
/// one: the headline stays the loudest thing on the card at every size.
class _HeroMetrics {
  const _HeroMetrics({
    required this.height,
    required this.sideMargin,
    required this.padding,
    required this.titleSize,
    required this.subtitleSize,
    required this.showSubtitle,
    required this.titleMaxLines,
    required this.ctaHeight,
    required this.contentFlex,
    required this.visualFlex,
  });

  final double height;
  final double sideMargin;
  final double padding;
  final double titleSize;
  final double subtitleSize;
  final bool showSubtitle;
  final int titleMaxLines;
  final double ctaHeight;
  final int contentFlex;
  final int visualFlex;

  factory _HeroMetrics.of(Responsive responsive) {
    final width = responsive.width;

    if (width < 360) {
      return const _HeroMetrics(
        height: 190,
        sideMargin: AppSpacing.md,
        padding: AppSpacing.md + 2,
        titleSize: 16,
        subtitleSize: 11,
        showSubtitle: false,
        titleMaxLines: 3,
        ctaHeight: 34,
        contentFlex: 8,
        visualFlex: 5,
      );
    }
    if (width < 420) {
      return const _HeroMetrics(
        height: 202,
        sideMargin: AppSpacing.lg,
        padding: AppSpacing.lg,
        titleSize: 19,
        subtitleSize: 11.5,
        showSubtitle: false,
        titleMaxLines: 3,
        ctaHeight: 36,
        contentFlex: 7,
        visualFlex: 5,
      );
    }
    if (width < AppBreakpoints.tablet) {
      return const _HeroMetrics(
        height: 214,
        sideMargin: AppSpacing.lg,
        padding: AppSpacing.xl,
        titleSize: 22,
        subtitleSize: 12,
        showSubtitle: true,
        titleMaxLines: 2,
        ctaHeight: 38,
        contentFlex: 6,
        visualFlex: 5,
      );
    }
    if (width < 900) {
      return const _HeroMetrics(
        height: 238,
        sideMargin: AppSpacing.xl,
        padding: AppSpacing.xxl,
        titleSize: 26,
        subtitleSize: 13,
        showSubtitle: true,
        titleMaxLines: 2,
        ctaHeight: 42,
        contentFlex: 6,
        visualFlex: 5,
      );
    }
    if (width < 1440) {
      return const _HeroMetrics(
        height: 268,
        sideMargin: AppSpacing.xxl,
        padding: AppSpacing.xxxl,
        titleSize: 31,
        subtitleSize: 14,
        showSubtitle: true,
        titleMaxLines: 2,
        ctaHeight: 46,
        contentFlex: 5,
        visualFlex: 6,
      );
    }
    return const _HeroMetrics(
      height: 300,
      sideMargin: AppSpacing.xxl,
      padding: 44,
      titleSize: 35,
      subtitleSize: 15,
      showSubtitle: true,
      titleMaxLines: 2,
      ctaHeight: 50,
      contentFlex: 5,
      visualFlex: 6,
    );
  }
}

class _PromoSlide extends StatelessWidget {
  const _PromoSlide({
    required this.promotion,
    required this.isActive,
    required this.metrics,
  });

  final PromotionModel promotion;
  final bool isActive;
  final _HeroMetrics metrics;

  /// Reuses the app's existing routes. A promotion with no usable
  /// destination has no button at all, so nothing invents a screen.
  void _onCtaPressed(BuildContext context) {
    switch (promotion.ctaDestinationType) {
      case 'CATEGORY':
        Navigator.of(context)
            .pushNamed('/products', arguments: promotion.ctaDestinationValue);
      case 'PRODUCT':
        Navigator.of(context)
            .pushNamed('/product', arguments: promotion.ctaDestinationValue);
      case 'CATALOG':
        Navigator.of(context).pushNamed('/products', arguments: '');
    }
  }

  @override
  Widget build(BuildContext context) {
    // Text colour follows the background's luminance so an operator can pick
    // a dark background without the headline disappearing.
    final onDark = _isDarkBackground(promotion);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.sheet + 4),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 22,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.sheet + 4),
        child: Stack(
          fit: StackFit.expand,
          children: [
            _Background(promotion: promotion),
            Row(
              children: [
                Expanded(
                  flex: metrics.contentFlex,
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      metrics.padding,
                      metrics.padding * 0.72,
                      AppSpacing.sm,
                      metrics.padding * 0.72,
                    ),
                    child: _SlideContent(
                      promotion: promotion,
                      metrics: metrics,
                      isActive: isActive,
                      onDark: onDark,
                      onCta: () => _onCtaPressed(context),
                    ),
                  ),
                ),
                Expanded(
                  flex: metrics.visualFlex,
                  child: _Foreground(
                    promotion: promotion,
                    isActive: isActive,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// True when the admin-chosen background is dark enough that light text
/// reads better. Image backgrounds carry a scrim, so they count as dark.
bool _isDarkBackground(PromotionModel promotion) {
  if (promotion.hasBackgroundImage) return true;
  final base = promotion.backgroundStart;
  if (base == null) return false;
  return base.computeLuminance() < 0.45;
}

/// The admin's background: a photograph under a scrim, a two-stop gradient,
/// or a solid wash. No decorative shapes are added on top of an image - the
/// operator's visual is the design.
class _Background extends StatelessWidget {
  const _Background({required this.promotion});

  final PromotionModel promotion;

  @override
  Widget build(BuildContext context) {
    if (promotion.hasBackgroundImage) {
      return Stack(
        fit: StackFit.expand,
        children: [
          Image.network(
            promotion.backgroundImageUrl!,
            fit: BoxFit.cover,
            // A failed background falls back to the neutral surface rather
            // than leaving a broken-image box behind the words.
            errorBuilder: (_, __, ___) =>
                const ColoredBox(color: AppSurfaces.subtle),
            frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
              if (wasSynchronouslyLoaded) return child;
              return AnimatedOpacity(
                opacity: frame == null ? 0 : 1,
                duration: const Duration(milliseconds: 240),
                child: child,
              );
            },
          ),
          // Scrim: keeps the headline legible over any photograph.
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [Color(0xE6101319), Color(0x66101319)],
                stops: [0.05, 0.85],
              ),
            ),
          ),
        ],
      );
    }

    if (promotion.hasGradient) {
      return DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [promotion.backgroundStart!, promotion.backgroundEnd!],
          ),
        ),
      );
    }

    // SOLID, or anything unparseable: the app's neutral surface, never an
    // invented brand colour.
    final solid = promotion.backgroundStart ?? AppSurfaces.subtle;
    return Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(color: solid),
        // One quiet edge wash for depth, derived from the chosen colour
        // itself rather than an arbitrary decorative gradient.
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white.withValues(alpha: 0.18),
                Colors.white.withValues(alpha: 0),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SlideContent extends StatelessWidget {
  const _SlideContent({
    required this.promotion,
    required this.metrics,
    required this.isActive,
    required this.onDark,
    required this.onCta,
  });

  final PromotionModel promotion;
  final _HeroMetrics metrics;
  final bool isActive;
  final bool onDark;
  final VoidCallback onCta;

  @override
  Widget build(BuildContext context) {
    final subtitle = promotion.subtitle;
    final titleColor = onDark ? Colors.white : AppTextColors.primary;
    final subtitleColor =
        onDark ? Colors.white.withValues(alpha: 0.82) : AppTextColors.secondary;

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _Entrance(
          isActive: isActive,
          delayMs: 0,
          child: Text(
            promotion.title,
            maxLines: metrics.titleMaxLines,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: metrics.titleSize,
              fontWeight: FontWeight.w900,
              height: 1.05,
              letterSpacing: -0.6,
              color: titleColor,
            ),
          ),
        ),
        if (subtitle != null && metrics.showSubtitle) ...[
          SizedBox(height: metrics.titleSize * 0.3),
          _Entrance(
            isActive: isActive,
            delayMs: 70,
            child: Text(
              subtitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: metrics.subtitleSize,
                height: 1.35,
                color: subtitleColor,
              ),
            ),
          ),
        ],
        if (promotion.hasAction) ...[
          SizedBox(height: metrics.titleSize * 0.55),
          _Entrance(
            isActive: isActive,
            delayMs: 130,
            child: SizedBox(
              height: metrics.ctaHeight,
              child: ElevatedButton(
                onPressed: onCta,
                style: appPrimaryButtonStyle(
                  padding: EdgeInsets.symmetric(
                    horizontal: metrics.ctaHeight * 0.62,
                  ),
                ),
                child: Text(
                  promotion.ctaLabel!,
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: metrics.ctaHeight * 0.33,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// The foreground promotional/product image, layered over the background
/// and allowed to bleed past the card's padding so the card reads as one
/// composition rather than two panes. Nothing is drawn when there is no
/// image: the background then carries the card on its own.
class _Foreground extends StatelessWidget {
  const _Foreground({required this.promotion, required this.isActive});

  final PromotionModel promotion;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    final imageUrl = promotion.imageUrl;
    if (imageUrl == null) return const SizedBox.shrink();

    return _Entrance(
      isActive: isActive,
      delayMs: 90,
      offsetX: 0.14,
      scaleFrom: 0.9,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, AppSpacing.sm, 0, AppSpacing.sm),
        child: Image.network(
          imageUrl,
          fit: BoxFit.contain,
          alignment: Alignment.bottomRight,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
            if (wasSynchronouslyLoaded) return child;
            return AnimatedOpacity(
              opacity: frame == null ? 0 : 1,
              duration: const Duration(milliseconds: 240),
              child: child,
            );
          },
        ),
      ),
    );
  }
}

/// Fade plus a small slide/scale that replays whenever its slide becomes
/// the active one, so the words and the visual arrive independently.
class _Entrance extends StatelessWidget {
  const _Entrance({
    required this.isActive,
    required this.delayMs,
    required this.child,
    this.offsetX = 0,
    this.scaleFrom = 1,
  });

  final bool isActive;
  final int delayMs;
  final Widget child;
  final double offsetX;
  final double scaleFrom;

  @override
  Widget build(BuildContext context) {
    final duration = Duration(milliseconds: 360 + delayMs);

    return AnimatedSlide(
      offset: isActive ? Offset.zero : Offset(offsetX, 0.24),
      duration: duration,
      curve: Curves.easeOutCubic,
      child: AnimatedScale(
        scale: isActive ? 1 : scaleFrom,
        duration: duration,
        curve: Curves.easeOutCubic,
        child: AnimatedOpacity(
          opacity: isActive ? 1 : 0,
          duration: Duration(milliseconds: 260 + delayMs),
          child: child,
        ),
      ),
    );
  }
}

/// A connected track of pills; the active one is Blynk Green, which holds
/// contrast against the white feed. Tapping one jumps to that promotion.
class _SlideIndicator extends StatelessWidget {
  const _SlideIndicator({
    required this.count,
    required this.current,
    required this.onTap,
  });

  final int count;
  final int current;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Promotion ${current + 1} of $count',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: 5,
        ),
        decoration: BoxDecoration(
          color: AppSurfaces.subtle,
          borderRadius: BorderRadius.circular(AppRadius.chip),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(count, (index) {
            final isActive = index == current;
            return GestureDetector(
              onTap: () => onTap(index),
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 280),
                  curve: Curves.easeOutCubic,
                  width: isActive ? 22 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: isActive
                        ? AppColors.primaryGreenColor
                        : AppSurfaces.border,
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}
