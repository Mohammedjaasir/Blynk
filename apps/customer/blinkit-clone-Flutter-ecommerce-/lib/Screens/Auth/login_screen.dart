import 'dart:async';

import 'package:flutter/material.dart';
import 'package:ecom/Infrastructure/LocalStorage/guest_choice_storage.dart';

import 'package:ecom/Services/store_info.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_logo.dart';
import 'package:ecom/UI/Widgets/Organisms/login_screen_otp_sheet.dart';
import 'package:ecom/app_responsive.dart';
import 'package:ecom/design/tokens.dart';

class OnboardingSlideData {
  final String assetPath;

  /// True for the animated slide: [assetPath] is an animated WebP and
  /// [stillAssetPath] is shown instead under reduced motion.
  final bool isAnimated;
  final String? stillAssetPath;
  // The asset's own width/height ratio, so the hero card is sized to hug the
  // artwork exactly (BoxFit.contain inside a mismatched box is what causes
  // visible letterboxing/dead space around the image).
  final double aspectRatio;
  final String titleLine1;
  final String titleLine2;
  final String description;

  const OnboardingSlideData({
    required this.assetPath,
    this.isAnimated = false,
    this.stillAssetPath,
    required this.aspectRatio,
    required this.titleLine1,
    required this.titleLine2,
    required this.description,
  });
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final PageController _pageController;
  int _currentPage = 0;
  int? _lastBreakpoint;

  static const List<OnboardingSlideData> _slides = [
    OnboardingSlideData(
      assetPath: 'Assets/Images/onboarding_groceries.png',
      aspectRatio: 452 / 516,
      titleLine1: 'Your groceries,',
      titleLine2: 'delivered.',
      description: 'Fresh groceries and quality essentials,\ndelivered in ${StoreInfo.hubName}.',
    ),
    OnboardingSlideData(
      // 2026-09-28: was a Lottie (cart_packing.json), which stuttered and hung
      // on phones - 36 vector layers drawn from scratch every frame (measured
      // ~15-18 fps even with a drawing cache). The same animation, rendered
      // once by lottie-web into an animated WebP (30 fps, 720 px), is played
      // by the platform image decoder off the UI thread: no per-frame drawing.
      assetPath: 'Assets/Images/cart_packing.webp',
      isAnimated: true,
      stillAssetPath: 'Assets/Images/cart_packing_still.png',
      aspectRatio: 1.0,
      titleLine1: 'Order any time,',
      titleLine2: 'pay on delivery.',
      description:
          'Deliveries go out ${StoreInfo.deliveryHoursLabel}.\nYou pay in cash when your order arrives.',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _openAuthSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => const LoginwithMobileWidget(),
    );
  }

  void _onNextPressed() {
    if (_currentPage < _slides.length - 1) {
      // W9: was a raw 350 ms with no reduced-motion path, so the onboarding
      // was the one place in the app that animated regardless of the setting.
      //
      // The explicit zero branch is load-bearing, not defensive:
      // `ScrollPosition.animateTo` ASSERTS a non-zero duration, so handing it
      // `BlynkMotion.resolve`'s zero throws. `product_details_screen.dart`
      // guards its entrance the same way.
      final duration = BlynkMotion.resolve(context, BlynkMotion.slow);
      if (duration == Duration.zero) {
        _pageController.jumpToPage(_currentPage + 1);
      } else {
        _pageController.nextPage(duration: duration, curve: BlynkMotion.easeOut);
      }
    } else {
      _openAuthSheet(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final screenWidth = mediaQuery.size.width;
    final screenHeight = mediaQuery.size.height;

    final isDesktop = screenWidth >= AppBreakpoints.desktop;
    final isTablet = screenWidth >= AppBreakpoints.tablet && screenWidth < AppBreakpoints.desktop;
    final isCompact = screenHeight < 700;

    // Resnap the carousel to the current logical page when crossing a
    // breakpoint: the PageView's viewport width changes with contentMaxWidth,
    // and a stale pixel offset from the old width lands on a fractional page.
    final breakpoint = isDesktop ? 2 : (isTablet ? 1 : 0);
    if (_lastBreakpoint != null && _lastBreakpoint != breakpoint) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_pageController.hasClients) {
          _pageController.jumpToPage(_currentPage);
        }
      });
    }
    _lastBreakpoint = breakpoint;

    // Responsive horizontal padding for the full-width header
    final headerHorizontalPadding = isDesktop ? 56.0 : (isTablet ? 32.0 : 24.0);

    // Responsive max width for the main onboarding content. The hero card
    // and text share this width so their edges line up; widening it on
    // desktop is what makes the hero grow instead of floating as a small
    // phone-sized column in a wide viewport.
    final contentMaxWidth = isDesktop
        ? (screenWidth * 0.6).clamp(760.0, 1100.0)
        : (isTablet ? 620.0 : double.infinity);
    final contentHorizontalPadding = isDesktop ? 32.0 : (isTablet ? 26.0 : 20.0);

    // Max hero card height. This is a cap, not a fixed size - the card is
    // sized from the slide's own aspect ratio (see itemBuilder) so it never
    // letterboxes, and only shrinks below the column width when there isn't
    // enough vertical room for a full-width card at that ratio.
    final heroHeight = isDesktop
        ? 460.0
        : (isTablet
            ? 420.0
            : (isCompact ? 260.0 : (screenHeight * 0.42).clamp(280.0, 400.0)));

    final isLastSlide = _currentPage == _slides.length - 1;

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                // 1. Full-Width Responsive Header Bar
                Padding(
                  padding: EdgeInsets.symmetric(
                    horizontal: headerHorizontalPadding,
                    vertical: isDesktop ? 18.0 : 10.0,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    // 2026-09-24: `Flexible` (flex 1) plus a `Spacer` (flex 1)
                    // split the leftover width evenly, which parked Skip in the
                    // middle of the row instead of the corner. spaceBetween
                    // pins the logo left and Skip hard right; the Flexible stays
                    // so a squeezed header still scales the logo down rather
                    // than overflowing.
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      // FittedBox keeps the logo from overflowing when the
                      // header is squeezed narrow.
                      Flexible(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: BlynkLogo(height: isDesktop ? 36 : 30),
                        ),
                      ),
                      // Skip Action Button
                      TextButton(
                        onPressed: () {
                          // Opened over the shop by a guest choosing to log in:
                          // Skip goes back to it. As the first screen there is
                          // nothing underneath, so it opens the shop.
                          // Remembered: the next launch opens on the shop.
                          unawaited(GuestChoiceStorage.rememberSkippedLogin());
                          final navigator = Navigator.of(context);
                          if (navigator.canPop()) {
                            navigator.pop();
                          } else {
                            navigator.pushReplacementNamed('/home');
                          }
                        },
                        // A 48 dp target: the wide invisible padding is the
                        // point (it was 30 dp tall with shrinkWrap).
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          minimumSize: const Size(48, 48),
                          tapTargetSize: MaterialTapTargetSize.padded,
                        ),
                        child: Text(
                          'Skip',
                          style: isDesktop ? BlynkText.sectionHeader : BlynkText.heading,
                        ),
                      ),
                    ],
                  ),
                ),

                // 2. Main Content Area with Responsive Constrained Width
                Expanded(
                  child: Center(
                    child: SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      child: Container(
                        constraints: BoxConstraints(maxWidth: contentMaxWidth),
                        padding: EdgeInsets.symmetric(
                          horizontal: contentHorizontalPadding,
                          vertical: isDesktop ? 16.0 : 8.0,
                        ),
                        child: LayoutBuilder(
                          builder: (context, innerConstraints) {
                            final innerWidth = innerConstraints.maxWidth;
                            return Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // 3. Carousel Hero Visual (Swipeable PageView).
                            // Each card is sized from the slide's own aspect
                            // ratio (fit to the column width first, capped by
                            // heroHeight) so it always hugs its artwork -
                            // BoxFit.contain inside a mismatched box is what
                            // causes visible letterboxing/dead space.
                            SizedBox(
                              height: heroHeight,
                              width: double.infinity,
                              child: PageView.builder(
                                controller: _pageController,
                                itemCount: _slides.length,
                                onPageChanged: (index) {
                                  setState(() {
                                    _currentPage = index;
                                  });
                                },
                                itemBuilder: (context, index) {
                                  final slide = _slides[index];
                                  double cardWidth = innerWidth;
                                  double cardHeight =
                                      cardWidth / slide.aspectRatio;
                                  if (cardHeight > heroHeight) {
                                    cardHeight = heroHeight;
                                    cardWidth = cardHeight * slide.aspectRatio;
                                  }
                                  return Center(
                                    child: AnimatedBuilder(
                                    animation: _pageController,
                                    builder: (context, child) {
                                      double delta = 0.0;
                                      if (_pageController.hasClients &&
                                          _pageController
                                              .position.haveDimensions) {
                                        final page = _pageController.page ??
                                            _currentPage.toDouble();
                                        delta =
                                            (page - index).abs().clamp(0.0, 1.0);
                                      }
                                      return Opacity(
                                        opacity: 1 - (delta * 0.35),
                                        child: Transform.scale(
                                          scale: 1 - (delta * 0.05),
                                          child: child,
                                        ),
                                      );
                                    },
                                    child: slide.isAnimated
                                        // The animation has a transparent
                                        // background with real per-element
                                        // motion - wrapping it in a white card
                                        // + shadow is what reads as "content
                                        // trapped in a box". Render directly so
                                        // it blends into the page instead.
                                        ? SizedBox(
                                            width: cardWidth,
                                            height: cardHeight,
                                            // Its own layer: each animation
                                            // frame repaints only the image.
                                            child: RepaintBoundary(
                                              child: Image.asset(
                                                // Reduced motion: a still frame,
                                                // no endless loop.
                                                MediaQuery.disableAnimationsOf(context)
                                                    ? slide.stillAssetPath!
                                                    : slide.assetPath,
                                                key: const Key('onboarding-animation'),
                                                fit: BoxFit.contain,
                                                gaplessPlayback: true,
                                                filterQuality: FilterQuality.medium,
                                              ),
                                            ),
                                          )
                                        // A soft tinted well, rounded, with no
                                        // border - the same treatment every
                                        // image surface in the app wears.
                                        : Container(
                                            width: cardWidth,
                                            height: cardHeight,
                                            decoration: const BoxDecoration(
                                              color: BlynkWell.tint,
                                              borderRadius: BlynkWell.radius,
                                            ),
                                            child: ClipRRect(
                                              borderRadius: BlynkWell.radius,
                                              child: Image.asset(
                                                slide.assetPath,
                                                fit: BoxFit.contain,
                                              ),
                                            ),
                                          ),
                                    ),
                                  );
                                },
                              ),
                            ),

                            SizedBox(height: isCompact ? 12 : 18),

                            // 4. Page indicator: decoration, not controls. Swiping
                            // (or Next) is how pages change, so the group is one
                            // labelled node instead of tiny tappable dots.
                            Semantics(
                              label: 'Page ${_currentPage + 1} of ${_slides.length}',
                              excludeSemantics: true,
                              child: Row(
                                children: List.generate(_slides.length, (index) {
                                  final isActive = index == _currentPage;
                                  return Container(
                                    margin: const EdgeInsets.only(right: 6.0),
                                    width: isActive ? 24 : 7,
                                    height: 7,
                                    decoration: BoxDecoration(
                                      color: isActive
                                          ? BlynkColors.ink
                                          : BlynkColors.lineStrong,
                                      borderRadius: BorderRadius.circular(3.5),
                                    ),
                                  );
                                }),
                              ),
                            ),

                            SizedBox(height: isCompact ? 12 : 18),

                            // 5. Dynamic Headline
                            AnimatedSwitcher(
                              duration: BlynkMotion.resolve(context, BlynkMotion.base),
                              child: Column(
                                key: ValueKey<int>(_currentPage),
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _slides[_currentPage].titleLine1,
                                    style: BlynkText.heroTitle(isDesktop ? 36 : 32)
                                        .copyWith(letterSpacing: -0.5, height: 1.15),
                                  ),
                                  Text(
                                    _slides[_currentPage].titleLine2,
                                    style: BlynkText.heroTitle(isDesktop ? 36 : 32)
                                        .copyWith(letterSpacing: -0.5, height: 1.15),
                                  ),
                                ],
                              ),
                            ),

                            SizedBox(height: isCompact ? 10 : 14),

                            // 6. Dynamic Supporting Description
                            AnimatedSwitcher(
                              duration: BlynkMotion.resolve(context, BlynkMotion.base),
                              child: Text(
                                _slides[_currentPage].description,
                                key: ValueKey<int>(_currentPage),
                                style: BlynkText.heroSubtitle(isDesktop ? 16.5 : 15.0)
                                    .copyWith(color: BlynkColors.ink2, height: 1.4),
                              ),
                            ),

                            SizedBox(height: isCompact ? 18 : 24),

                            // 7. Next / Get Started Action Button
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                BlynkButton.primary(
                                  label: isLastSlide ? 'Get started' : 'Next',
                                  onPressed: _onNextPressed,
                                ),
                              ],
                            ),

                            const SizedBox(height: 12),
                          ],
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
