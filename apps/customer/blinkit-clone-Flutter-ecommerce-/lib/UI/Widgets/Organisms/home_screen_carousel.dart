import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart' show PointerDeviceKind;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:provider/provider.dart';

import '../../../Models/promotion_model.dart';
import '../../../Services/analytics/analytics.dart';
import '../../../Services/Providers/product.provider.dart';
import '../../../app_responsive.dart';
import '../../../design/contrast.dart';
import '../../../design/tokens.dart';
import '../Atoms/blynk_button.dart';

/// The hero's rounded card, and the focus ring drawn around it. One radius,
/// from the token layer, so the ring can never drift off the card.
const BorderRadius _slideRadius = BlynkRadius.lgAll;

/// Home's promotional hero.
///
/// Composition is a poster: the operator's background (a flat colour or a
/// scrimmed photograph, chosen in Blynk Ops), then the headline block, then
/// the foreground product visual over it. Every value comes from
/// GET /promotions; this widget invents no campaign content and picks no
/// colours of its own. With nothing active it renders nothing at all.
///
/// **There is no fallback hero.** If the backend returns no active promotion
/// - which is the case on a catalogue with nothing scheduled - Home simply
/// has no hero. Nothing here is hardcoded, placeheld or copied from a mock.
class HomeScreenCarousel extends StatefulWidget {
  const HomeScreenCarousel({super.key});

  @override
  State<HomeScreenCarousel> createState() => _HomeScreenCarouselState();
}

class _HomeScreenCarouselState extends State<HomeScreenCarousel> {
  // Nothing moves by itself (WCAG 2.2.2). Slides change by drag (any pointer,
  // see _dragDevices), by the Left/Right arrow keys while the carousel has
  // keyboard focus, or by the screen reader's increase/decrease actions.
  late final PageController _pageController;
  int _currentPage = 0;
  int _slideCount = 0;

  /// Designed banners in any size (owner, 2026-10-08): each artwork's own
  /// width / height, measured when its picture loads. The carousel is as tall
  /// as the banner on screen, so nothing is cropped; between two slides the
  /// height follows the swipe. Until a picture is measured - and for every
  /// non-artwork slide - the designed card height applies.
  final Map<String, double> _artworkAspects = {};
  final Set<String> _measuring = {};

  /// Banner shapes the carousel follows: from a very wide strip to a
  /// portrait 4:5. Anything beyond is shown at the nearest of the two.
  static const double minAspect = 0.8;
  static const double maxAspect = 5.0;

  void _measureArtwork(String url) {
    if (_artworkAspects.containsKey(url) || !_measuring.add(url)) return;
    final stream = NetworkImage(url).resolve(ImageConfiguration.empty);
    late final ImageStreamListener listener;
    listener = ImageStreamListener(
      (info, _) {
        stream.removeListener(listener);
        final w = info.image.width.toDouble();
        final h = info.image.height.toDouble();
        if (!mounted || h <= 0) return;
        setState(() => _artworkAspects[url] = (w / h).clamp(minAspect, maxAspect));
      },
      onError: (_, __) => stream.removeListener(listener),
    );
    stream.addListener(listener);
  }

  /// The pager height for slide [index] at [width] (the whole carousel width).
  double _slideHeight(List<PromotionModel> promotions, int index, double width, _HeroMetrics metrics, double designed) {
    final promotion = promotions[index.clamp(0, promotions.length - 1)];
    final url = promotion.hasArtwork ? promotion.backgroundImageUrl : null;
    final aspect = url == null ? null : _artworkAspects[url];
    if (aspect == null) return designed;
    final cardWidth = width - metrics.sideMargin * 2;
    final natural = cardWidth / aspect + BlynkSpace.s4 * 2;
    // A banner that also carries the app's button needs the card's room for it.
    return promotion.hasAction ? math.max(natural, designed) : natural;
  }
  final FocusNode _focusNode = FocusNode(debugLabel: 'promotions carousel');
  bool _keyboardHighlight = false;

  // Flutter leaves mouse (and trackpad) out of the default drag devices, which
  // would make the carousel unusable with a mouse on desktop and web.
  static const _dragDevices = {
    PointerDeviceKind.touch,
    PointerDeviceKind.mouse,
    PointerDeviceKind.stylus,
    PointerDeviceKind.trackpad,
  };

  static const _shortcuts = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.arrowLeft): _StepIntent(-1),
    SingleActivator(LogicalKeyboardKey.arrowRight): _StepIntent(1),
  };

  bool _canStep(int delta) {
    final target = _currentPage + delta;
    return target >= 0 && target < _slideCount;
  }

  void _step(int delta) {
    // Arrow keys and the screen-reader adjust gesture are both the shopper
    // steering. Once they do, the carousel stops driving itself.
    _stopAutoAdvance();
    if (!_canStep(delta) || !_pageController.hasClients) return;
    final target = _currentPage + delta;
    final duration = BlynkMotion.resolve(context, BlynkMotion.base);
    if (duration == Duration.zero) {
      _pageController.jumpToPage(target);
    } else {
      _pageController.animateToPage(
        target,
        duration: duration,
        curve: BlynkMotion.easeOut,
      );
    }
  }

  /// How long each promotion is shown before the carousel moves on.
  ///
  /// 3 s (was 5, 2026-09-27 - the owner wanted it livelier): still long
  /// enough to read a slide's headline, and a finger on the carousel holds
  /// it still, so a shopper reaching for a slide never has it pulled away.
  static const Duration _autoAdvanceEvery = Duration(seconds: 3);

  /// How long after the shopper lets go before the loop picks up again.
  static const Duration _resumeAfterTouch = Duration(seconds: 4);
  Timer? _resume;

  Timer? _autoAdvance;

  /// True once the shopper has touched, dragged, focused or keyed the
  /// carousel. Auto-advance then stops **for good** rather than resuming a few
  /// seconds later and yanking the slide away again — WCAG 2.2.2 wants moving
  /// content pausable, and "pauses, then restarts itself" is not pausable.
  bool _userTookOver = false;

  void _startAutoAdvance() {
    _autoAdvance?.cancel();
    if (_userTookOver) return;
    _autoAdvance = Timer.periodic(_autoAdvanceEvery, (_) {
      if (!mounted) return;
      final count = context.read<ProductProvider>().promotions.length;
      // One slide has nowhere to go; a missing controller means no viewport.
      if (count < 2 || !_pageController.hasClients) return;
      _pageController.animateToPage(
        (_currentPage + 1) % count,
        duration: BlynkMotion.emphasized,
        curve: Curves.easeInOutCubic,
      );
    });
  }

  /// A touch: hold still while the finger is down, then loop again once the
  /// shopper has let go for [_resumeAfterTouch]. 2026-09-26: a touch used to
  /// stop the carousel for good, so a thumb brushing it while scrolling Home
  /// froze it - the product owner saw a static banner. Keyboard focus, arrow
  /// keys and the screen-reader adjust gesture still stop it for good: that
  /// is the WCAG 2.2.2 pause mechanism, and reduced motion still turns the
  /// loop off entirely.
  void _pauseForTouch() {
    _resume?.cancel();
    _autoAdvance?.cancel();
    _autoAdvance = null;
  }

  void _resumeAfterRelease() {
    _resume?.cancel();
    if (_userTookOver || (MediaQuery.maybeDisableAnimationsOf(context) ?? false)) return;
    _resume = Timer(_resumeAfterTouch, () {
      if (mounted) _startAutoAdvance();
    });
  }

  /// Keyboard / assistive-technology takeover. Idempotent.
  void _stopAutoAdvance() {
    if (_userTookOver) return;
    _userTookOver = true;
    _autoAdvance?.cancel();
    _autoAdvance = null;
  }

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    // The ring marks the carousel itself; a focused slide button has its own.
    _focusNode.addListener(() {
      if (mounted) setState(() {});
      // Keyboard focus is a shopper taking over: stop moving under them.
      if (_focusNode.hasFocus) _stopAutoAdvance();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<ProductProvider>().loadPromotions();
      // Honour the OS "reduce motion" setting: a carousel that advances on its
      // own is exactly the motion that setting exists to switch off. Read here
      // rather than in initState because it needs a MediaQuery.
      if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return;
      _startAutoAdvance();
    });
  }

  @override
  void dispose() {
    _autoAdvance?.cancel();
    _resume?.cancel();
    _pageController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Widget _pagerBody(List<PromotionModel> promotions, _HeroMetrics metrics) {
    // A touch anywhere on the pager is the shopper taking over. Listener
    // (not GestureDetector) so it sees the press without competing with the
    // PageView's drag or the slide's own tap.
    return Listener(
      onPointerDown: (_) => _pauseForTouch(),
      onPointerUp: (_) => _resumeAfterRelease(),
      onPointerCancel: (_) => _resumeAfterRelease(),
      child: ScrollConfiguration(
      behavior: ScrollConfiguration.of(context).copyWith(
        dragDevices: _dragDevices,
        scrollbars: false,
      ),
      child: PageView.builder(
        controller: _pageController,
        itemCount: promotions.length,
        onPageChanged: (index) => setState(() => _currentPage = index),
        itemBuilder: (context, index) {
          return Padding(
            padding: EdgeInsets.symmetric(
              horizontal: metrics.sideMargin,
              vertical: BlynkSpace.s4,
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
    );
  }

  @override
  Widget build(BuildContext context) {
    final promotions = context.watch<ProductProvider>().promotions;

    // Nothing active, still loading, or the request failed: Home carries on
    // without a carousel instead of showing placeholder campaigns.
    if (promotions.isEmpty) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    if (_currentPage >= promotions.length) {
      _currentPage = promotions.length - 1;
    }

    final metrics = _HeroMetrics.of(Responsive.of(context));
    _slideCount = promotions.length;
    final multiple = promotions.length > 1;
    for (final p in promotions) {
      if (p.hasArtwork) _measureArtwork(p.backgroundImageUrl!);
    }
    final designed = metrics.heightFor(context);

    Widget pager = LayoutBuilder(
      builder: (context, constraints) => AnimatedBuilder(
        animation: _pageController,
        builder: (context, child) {
          // Between two slides the height follows the swipe.
          final page = _pageController.hasClients && _pageController.position.haveDimensions
              ? (_pageController.page ?? _currentPage.toDouble())
              : _currentPage.toDouble();
          final from = page.floor();
          final t = page - from;
          final a = _slideHeight(promotions, from, constraints.maxWidth, metrics, designed);
          final b = _slideHeight(promotions, from + 1, constraints.maxWidth, metrics, designed);
          return SizedBox(height: a + (b - a) * t, child: child);
        },
        child: _pagerBody(promotions, metrics),
      ),
    );

    if (multiple) {
      pager = Semantics(
        container: true,
        label: 'Promotion ${_currentPage + 1} of ${promotions.length}',
        // Screen readers move between promotions with their adjust gesture.
        onIncrease: _canStep(1) ? () => _step(1) : null,
        onDecrease: _canStep(-1) ? () => _step(-1) : null,
        onScrollLeft: _canStep(1) ? () => _step(1) : null,
        onScrollRight: _canStep(-1) ? () => _step(-1) : null,
        child: FocusableActionDetector(
          shortcuts: _shortcuts,
          actions: {_StepIntent: _StepAction(this)},
          focusNode: _focusNode,
          onShowFocusHighlight: (show) => setState(() => _keyboardHighlight = show),
          // Sits above the slides so the ring is visible on any background.
          child: Stack(
            children: [
              pager,
              if (_keyboardHighlight && _focusNode.hasPrimaryFocus)
                Positioned.fill(
                  child: IgnorePointer(
                    child: _FocusRing(margin: metrics.sideMargin),
                  ),
                ),
            ],
          ),
        ),
      );
    }

    return SliverToBoxAdapter(
      child: Column(
        children: [
          pager,
          if (multiple) ...[
            const SizedBox(height: BlynkSpace.s12),
            _SlideIndicator(
              key: const ValueKey('promo-pager'),
              count: promotions.length,
              current: _currentPage.clamp(0, promotions.length - 1),
            ),
          ],
        ],
      ),
    );
  }
}

class _StepIntent extends Intent {
  const _StepIntent(this.delta);

  final int delta;
}

/// Disabled at either end, so the arrow key falls through (and does nothing)
/// instead of being swallowed.
class _StepAction extends Action<_StepIntent> {
  _StepAction(this._state);

  final _HomeScreenCarouselState _state;

  @override
  bool isEnabled(_StepIntent intent, [BuildContext? context]) =>
      _state._canStep(intent.delta);

  @override
  Object? invoke(_StepIntent intent) {
    _state._step(intent.delta);
    return null;
  }
}

/// Keyboard focus indication: a 2 dp ink ring with a 2 dp paper ring inside
/// it, so it holds 3:1 against the page (ink) and against any slide colour or
/// photo (paper against ink).
class _FocusRing extends StatelessWidget {
  const _FocusRing({required this.margin});

  final double margin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: const ValueKey('carousel-focus-ring'),
      padding: EdgeInsets.symmetric(horizontal: margin, vertical: BlynkSpace.s4),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: _slideRadius,
          border: Border.all(color: BlynkColors.ink, width: BlynkCta.focusRingWidth),
        ),
        child: Padding(
          padding: const EdgeInsets.all(BlynkCta.focusRingWidth),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(BlynkRadius.lg - BlynkCta.focusRingWidth),
              border: Border.all(color: BlynkColors.paper, width: BlynkCta.focusRingWidth),
            ),
          ),
        ),
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
  final int contentFlex;
  final int visualFlex;

  /// The card's height at the current text scale.
  ///
  /// [height] is the designed height of the band and is what a 1.0x screen
  /// gets. A [PageView] page cannot size itself to its child, so at 1.3x and
  /// 2.0x the headline and the CTA grow inside a box that used to stay put -
  /// which overflowed the slide's [Column] by a few pixels on a phone. This
  /// measures what the slide's content really needs (the same blocks
  /// [_SlideContent] lays out, at the live [TextScaler]) and takes whichever
  /// is larger, so the designed proportions are untouched at 1.0x and the
  /// card grows rather than clipping above it.
  double heightFor(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    final titleStyle = BlynkText.heroTitle(titleSize);
    final title =
        scaler.scale(titleStyle.fontSize!) * titleStyle.height! * titleMaxLines;

    var subtitle = 0.0;
    if (showSubtitle) {
      final style = BlynkText.heroSubtitle(subtitleSize);
      subtitle =
          titleSize * 0.3 + scaler.scale(style.fontSize!) * style.height! * 2;
    }

    // The CTA is optional per slide, but the carousel is one box: size for
    // the slide that has one.
    const label = BlynkText.label;
    final cta = titleSize * 0.55 +
        math.max(
          BlynkCta.promoMinHeight,
          scaler.scale(label.fontSize!) * label.height! +
              BlynkCta.promoPadding.vertical,
        );

    // The vertical padding [_SlideContent] sits in, plus the PageView page's
    // own vertical inset, plus one step of slack so a font whose metrics are
    // a shade taller than its declared line height cannot re-open this.
    final content = padding * 0.72 * 2 +
        BlynkSpace.s4 * 2 +
        BlynkSpace.s8 +
        title +
        subtitle +
        cta;
    return math.max(height, content);
  }

  factory _HeroMetrics.of(Responsive responsive) {
    final width = responsive.width;

    if (width < 360) {
      return const _HeroMetrics(
        height: 190,
        sideMargin: BlynkSpace.s12,
        padding: BlynkSpace.s12 + 2,
        titleSize: 16,
        subtitleSize: 12,
        showSubtitle: false,
        titleMaxLines: 3,
        contentFlex: 8,
        visualFlex: 5,
      );
    }
    if (width < 420) {
      return const _HeroMetrics(
        height: 202,
        sideMargin: BlynkSpace.s16,
        padding: BlynkSpace.s16,
        titleSize: 19,
        subtitleSize: 12,
        showSubtitle: false,
        titleMaxLines: 3,
        contentFlex: 7,
        visualFlex: 5,
      );
    }
    if (width < AppBreakpoints.tablet) {
      return const _HeroMetrics(
        height: 214,
        sideMargin: BlynkSpace.s16,
        padding: BlynkSpace.s16 + BlynkSpace.s4,
        titleSize: 22,
        subtitleSize: 12,
        showSubtitle: true,
        titleMaxLines: 2,
        contentFlex: 6,
        visualFlex: 5,
      );
    }
    if (width < 900) {
      return const _HeroMetrics(
        height: 238,
        sideMargin: BlynkSpace.s16 + BlynkSpace.s4,
        padding: BlynkSpace.s24,
        titleSize: 26,
        subtitleSize: 13,
        showSubtitle: true,
        titleMaxLines: 2,
        contentFlex: 6,
        visualFlex: 5,
      );
    }
    if (width < 1440) {
      return const _HeroMetrics(
        height: 268,
        sideMargin: BlynkSpace.s24,
        padding: BlynkSpace.s32,
        titleSize: 31,
        subtitleSize: 14,
        showSubtitle: true,
        titleMaxLines: 2,
        contentFlex: 5,
        visualFlex: 6,
      );
    }
    return const _HeroMetrics(
      height: 300,
      sideMargin: BlynkSpace.s24,
      padding: BlynkSpace.s48 - BlynkSpace.s4,
      titleSize: 35,
      subtitleSize: 15,
      showSubtitle: true,
      titleMaxLines: 2,
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
    Analytics.instance.selectPromotion(promotion); // owner, 2026-10-10
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
    // Text colour is measured against the operator's background, so a dark
    // background never swallows the headline - and a light one never bleaches
    // it. See [_onDark].
    final onDark = _onDark(promotion);

    // ARTWORK: a finished banner, uploaded as-is. The card is the operator's
    // file - no scrim, no headline, no subtitle - so [_SlideContent] is
    // replaced by a CTA-only column. Everything else (the radius, the shadow,
    // the Row's flexes, the foreground slot, the card's measured height) is
    // the same as every other type, so the carousel does not resize or
    // reshape as the reader swipes between slide types.
    final content = promotion.hasArtwork
        ? _ArtworkContent(
            promotion: promotion,
            isActive: isActive,
            onCta: () => _onCtaPressed(context),
          )
        : _SlideContent(
            promotion: promotion,
            metrics: metrics,
            isActive: isActive,
            onDark: onDark,
            onCta: () => _onCtaPressed(context),
          );

    final Widget card = DecoratedBox(
      decoration: const BoxDecoration(
        borderRadius: _slideRadius,
        // The one card-elevation token, exactly as every other card in the
        // app; the hero does not invent a shadow of its own.
        boxShadow: BlynkElevation.soft,
      ),
      child: ClipRRect(
        borderRadius: _slideRadius,
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
                      BlynkSpace.s8,
                      metrics.padding * 0.72,
                    ),
                    child: content,
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

    if (!promotion.hasArtwork) return card;

    // Accessibility is the whole risk of this slide type. The campaign's
    // words are baked into a picture, so without a label a screen-reader user
    // gets silence where every other slide reads out its headline. The
    // promotion's `title` is required by the backend precisely so it can be
    // spoken here.
    if (promotion.isTappableCard) {
      // No button label, but somewhere to go: the operator drew the call to
      // action into the artwork, so the card itself is the target. One node -
      // labelled, announced as a button, with a tap action - rather than a
      // labelled container wrapping an unlabelled one.
      return Semantics(
        container: true,
        button: true,
        label: promotion.title,
        onTap: () => _onCtaPressed(context),
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _onCtaPressed(context),
          child: card,
        ),
      );
    }

    // Either purely decorative or carrying its own CTA button; the button
    // keeps its own node and stays reachable by keyboard and screen reader.
    return Semantics(
      container: true,
      image: true,
      label: promotion.title,
      child: card,
    );
  }
}

/// Whether this slide's words should be [BlynkColors.paper] rather than
/// [BlynkColors.ink].
///
/// Measured rather than guessed. The operator picks the background colour in
/// Blynk Ops, so the app cannot know it in advance; it compares its only two
/// text colours against that colour and takes whichever actually reads. A
/// photographic background is covered by [_Background.scrimOpacity] ink, so it
/// is always the light one.
///
/// An ARTWORK slide draws no words of its own, so this never decides anything
/// for one.
bool _onDark(PromotionModel promotion) {
  if (promotion.hasBackgroundImage) return true;
  final base = promotion.backgroundStart;
  if (base == null) return false;
  return contrastRatio(BlynkColors.paper, base) >
      contrastRatio(BlynkColors.ink, base);
}

/// The operator's background: a finished banner full-bleed, a photograph
/// under a flat ink scrim, or their chosen colour, flat. No decorative shapes
/// are added on top of an image - the operator's visual is the design.
///
/// **No gradient is rendered here** (plan §5: "no gradients as decoration").
/// A `GRADIENT` promotion paints its `background_color`; its
/// `background_color_end` is not drawn. That is a deliberate app-wide visual
/// rule, not a data loss: the colour on screen is still exactly the one the
/// operator stored, and nothing is invented to replace the second stop.
class _Background extends StatelessWidget {
  const _Background({required this.promotion});

  final PromotionModel promotion;

  /// The flat ink wash over an operator's photograph. Measured: `paper` on
  /// ink at this alpha clears 5.3:1 even over a pure-white photograph, which
  /// is the worst case, so the headline reads whatever image is uploaded.
  ///
  /// W8: the number now lives in the token layer as [BlynkPromo.scrimOpacity]
  /// (W2 asked for it). `BlynkColors.scrim` still cannot serve — it measures
  /// 3.95:1 for the same pairing.
  static const double scrimOpacity = BlynkPromo.scrimOpacity;

  @override
  Widget build(BuildContext context) {
    // ARTWORK: the operator's finished banner, exactly as uploaded. No scrim
    // - not even a light one - because nothing is drawn over it that would
    // need to stay legible, and a wash would dim artwork that is already
    // composed. Identical fit and failure handling to IMAGE otherwise.
    if (promotion.hasArtwork) {
      return _networkFill(promotion.backgroundImageUrl!, promotion.backgroundAlignment);
    }

    if (promotion.hasBackgroundImage) {
      return Stack(
        fit: StackFit.expand,
        children: [
          _networkFill(promotion.backgroundImageUrl!, promotion.backgroundAlignment),
          // One flat scrim, never a gradient: it keeps the headline legible
          // over any photograph an operator uploads.
          ColoredBox(color: BlynkColors.ink.withValues(alpha: scrimOpacity)),
        ],
      );
    }

    // SOLID, GRADIENT or anything unparseable - including a background_type
    // this build has never heard of: the operator's own colour, flat - and
    // the app's neutral surface when they stored nothing usable, never an
    // invented brand colour.
    return ColoredBox(color: promotion.backgroundStart ?? BlynkColors.well);
  }

  /// The card-filling network image, shared by IMAGE and ARTWORK so the two
  /// cannot drift apart in fit, fade-in or failure behaviour - including, now,
  /// in where they crop from.
  ///
  /// 2026-09-24 (migration 009): `cover` fills the card and crops the rest,
  /// and it used to crop from the centre - so a finished banner whose wording
  /// runs along the top lost the wording. [alignment] is the operator's focal
  /// point, chosen in Blynk Ops. Its 50/50 default IS [Alignment.center], so
  /// every card stored before this renders exactly as it did.
  Widget _networkFill(String url, Alignment alignment) {
    return Image.network(
      url,
      fit: BoxFit.cover,
      alignment: alignment,
      // A failed background falls back to the neutral surface rather than
      // leaving a broken-image box behind the words.
      errorBuilder: (_, __, ___) => const ColoredBox(color: BlynkColors.well),
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        if (wasSynchronouslyLoaded) return child;
        return AnimatedOpacity(
          opacity: frame == null ? 0 : 1,
          duration: BlynkMotion.resolve(context, BlynkMotion.slow),
          child: child,
        );
      },
    );
  }
}

/// What an ARTWORK slide puts over the operator's banner: nothing, or just
/// their button.
///
/// No headline and no subtitle - that is the entire point of the type. The
/// CTA keeps the same slot, the same pill and the same 48 dp target as every
/// other slide, so an artwork banner that wants a button gets the app's real
/// one rather than a painted-on rectangle.
class _ArtworkContent extends StatelessWidget {
  const _ArtworkContent({
    required this.promotion,
    required this.isActive,
    required this.onCta,
  });

  final PromotionModel promotion;
  final bool isActive;
  final VoidCallback onCta;

  @override
  Widget build(BuildContext context) {
    if (!promotion.hasAction) return const SizedBox.shrink();

    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _Entrance(
          isActive: isActive,
          delayMs: 130,
          child: BlynkButton.promo(
            label: promotion.ctaLabel!,
            onPressed: onCta,
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
    // One colour for both lines. Hierarchy comes from size and weight, not
    // from a translucent second tone: the operator's background is arbitrary,
    // and a washed-out subtitle is the first thing to fall under 4.5:1 on it.
    final contentColor = onDark ? BlynkColors.paper : BlynkColors.ink;

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
            // The size ladder is this widget's responsive concern; the
            // family, weight, tracking and the 12 px floor come from the type
            // layer, so no `fontSize` literal lives outside it.
            style: BlynkText.heroTitle(metrics.titleSize).copyWith(color: contentColor),
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
              style: BlynkText.heroSubtitle(metrics.subtitleSize).copyWith(color: contentColor),
            ),
          ),
        ],
        if (promotion.hasAction) ...[
          SizedBox(height: metrics.titleSize * 0.55),
          _Entrance(
            isActive: isActive,
            delayMs: 130,
            // 44 dp visual, 48 dp target, one type size at every width.
            //
            // W9: this is `BlynkButton.promo`, the solid-ink pill that exists
            // precisely for this slot, not `BlynkButton.primary`. The slide's
            // background is whatever colour the operator stored in Blynk Ops,
            // and the captured backend fixture stores `#FFE141` — the same
            // yellow `primary` fills with, so the action was painting at
            // 1.00:1 on its own background and vanishing. The promo surface is
            // already Home's yellow moment; its action must not be a second
            // one. `home_carousel_test.dart` measures the pill against every
            // slide colour the API can return.
            child: BlynkButton.promo(
              label: promotion.ctaLabel!,
              onPressed: onCta,
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
        padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
        child: Image.network(
          imageUrl,
          fit: BoxFit.contain,
          alignment: Alignment.bottomRight,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
            if (wasSynchronouslyLoaded) return child;
            return AnimatedOpacity(
              opacity: frame == null ? 0 : 1,
              duration: BlynkMotion.resolve(context, BlynkMotion.slow),
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
    final delay = Duration(milliseconds: delayMs);
    final duration = BlynkMotion.resolve(context, BlynkMotion.emphasized + delay);
    final fade = BlynkMotion.resolve(context, BlynkMotion.slow + delay);

    return AnimatedSlide(
      offset: isActive ? Offset.zero : Offset(offsetX, 0.24),
      duration: duration,
      curve: BlynkMotion.easeOut,
      child: AnimatedScale(
        scale: isActive ? 1 : scaleFrom,
        duration: duration,
        curve: BlynkMotion.easeOut,
        child: AnimatedOpacity(
          opacity: isActive ? 1 : 0,
          duration: fade,
          child: child,
        ),
      ),
    );
  }
}

/// A connected track of pills; the active one is `ink`, which holds contrast
/// against the white feed. It is a status readout, not a control: one
/// labelled node, no tappable dots (swipe moves between promotions).
class _SlideIndicator extends StatelessWidget {
  const _SlideIndicator({
    super.key,
    required this.count,
    required this.current,
  });

  final int count;
  final int current;

  @override
  Widget build(BuildContext context) {
    // Decoration only: the carousel group above carries the spoken label.
    return ExcludeSemantics(
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: BlynkSpace.s8,
          vertical: 5,
        ),
        decoration: const BoxDecoration(
          color: BlynkColors.well,
          borderRadius: BlynkRadius.full,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(count, (index) {
            final isActive = index == current;
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: AnimatedContainer(
                duration: BlynkMotion.resolve(context, BlynkMotion.slow),
                curve: BlynkMotion.easeOut,
                width: isActive ? 22 : 7,
                height: 7,
                decoration: BoxDecoration(
                  color: isActive ? BlynkColors.ink : BlynkColors.lineStrong,
                  borderRadius: BlynkRadius.full,
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}
