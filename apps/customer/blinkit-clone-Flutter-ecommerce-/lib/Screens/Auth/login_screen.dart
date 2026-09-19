import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_logo.dart';
import 'package:ecom/UI/Widgets/Organisms/login_screen_otp_sheet.dart';
import 'package:ecom/app_colors.dart';

class OnboardingSlideData {
  final String assetPath;
  final bool isLottie;
  // The asset's own width/height ratio, so the hero card is sized to hug the
  // artwork exactly (BoxFit.contain inside a mismatched box is what causes
  // visible letterboxing/dead space around the image).
  final double aspectRatio;
  final String titleLine1;
  final String titleLine2;
  final String description;

  const OnboardingSlideData({
    required this.assetPath,
    this.isLottie = false,
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
      isLottie: false,
      aspectRatio: 452 / 516,
      titleLine1: 'Your Groceries',
      titleLine2: 'Delivered Fast',
      description:
          'Fresh groceries and everyday essentials\ndelivered to your doorstep in Dharga Town.',
    ),
    OnboardingSlideData(
      assetPath: 'Assets/cart_packing.json',
      isLottie: true,
      aspectRatio: 1.0,
      titleLine1: 'Fast Delivery',
      titleLine2: 'To Your Door',
      description:
          'Order anytime and get your groceries delivered\nduring our delivery window.',
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
      _pageController.nextPage(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    } else {
      _openAuthSheet(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final screenWidth = mediaQuery.size.width;
    final screenHeight = mediaQuery.size.height;

    final isDesktop = screenWidth >= 1024;
    final isTablet = screenWidth >= 600 && screenWidth < 1024;
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
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          // Ambient Organic Pastel Yellow Glow (Top-Right)
          Positioned(
            top: -60,
            right: -40,
            child: Container(
              width: isDesktop ? 340 : 220,
              height: isDesktop ? 340 : 220,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    const Color(0xFFFFF6D6),
                    const Color(0xFFFFF6D6).withValues(alpha: 0.0),
                  ],
                ),
              ),
            ),
          ),

          // Ambient Organic Pastel Yellow Glow (Bottom-Left)
          Positioned(
            bottom: -70,
            left: -50,
            child: Container(
              width: isDesktop ? 360 : 240,
              height: isDesktop ? 360 : 240,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    const Color(0xFFFFF8D6),
                    const Color(0xFFFFF8D6).withValues(alpha: 0.0),
                  ],
                ),
              ),
            ),
          ),

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
                    children: [
                      // Blynk Logo + Tagline (FittedBox keeps this from
                      // overflowing when the header is squeezed narrow)
                      Flexible(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              BlynkLogo(height: isDesktop ? 36 : 30),
                              const SizedBox(height: 4),
                              Text(
                                'FRESHER. FASTER. NEARER.',
                                style: TextStyle(
                                  fontSize: isDesktop ? 10.5 : 8.5,
                                  fontWeight: FontWeight.w800,
                                  color: const Color(0xFF374151),
                                  letterSpacing: 1.4,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const Spacer(),
                      // Skip Action Button
                      TextButton(
                        onPressed: () {
                          Navigator.of(context).pushReplacementNamed('/home');
                        },
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: Text(
                          'Skip',
                          style: TextStyle(
                            color: AppColors.primaryGreenColor,
                            fontSize: isDesktop ? 18 : 16,
                            fontWeight: FontWeight.w700,
                          ),
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
                                    child: slide.isLottie
                                        // Lottie assets here have a
                                        // transparent composition (no
                                        // background layer) with real
                                        // per-element motion - wrapping them
                                        // in a white card + shadow is what
                                        // reads as "content trapped in a
                                        // box". Render directly so it blends
                                        // into the page instead.
                                        ? SizedBox(
                                            width: cardWidth,
                                            height: cardHeight,
                                            child: Lottie.asset(
                                              slide.assetPath,
                                              fit: BoxFit.contain,
                                              repeat: true,
                                            ),
                                          )
                                        : Container(
                                            width: cardWidth,
                                            height: cardHeight,
                                            decoration: BoxDecoration(
                                              color: Colors.white,
                                              borderRadius:
                                                  BorderRadius.circular(32.0),
                                              boxShadow: [
                                                BoxShadow(
                                                  color: Colors.black
                                                      .withValues(alpha: 0.04),
                                                  blurRadius: 20,
                                                  offset: const Offset(0, 8),
                                                ),
                                              ],
                                            ),
                                            child: ClipRRect(
                                              borderRadius:
                                                  BorderRadius.circular(32.0),
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

                            // 4. Page Indicator Dots (Dynamic & Interactive)
                            Row(
                              children: List.generate(_slides.length, (index) {
                                final isActive = index == _currentPage;
                                return GestureDetector(
                                  onTap: () {
                                    _pageController.animateToPage(
                                      index,
                                      duration:
                                          const Duration(milliseconds: 350),
                                      curve: Curves.easeInOut,
                                    );
                                  },
                                  child: Container(
                                    margin: const EdgeInsets.only(right: 6.0),
                                    width: isActive ? 24 : 7,
                                    height: 7,
                                    decoration: BoxDecoration(
                                      color: isActive
                                          ? AppColors.primaryYellowColor
                                          : const Color(0xFFE5E7EB),
                                      borderRadius: BorderRadius.circular(3.5),
                                    ),
                                  ),
                                );
                              }),
                            ),

                            SizedBox(height: isCompact ? 12 : 18),

                            // 5. Dynamic Headline & Accent Underline
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 250),
                              child: Column(
                                key: ValueKey<int>(_currentPage),
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _slides[_currentPage].titleLine1,
                                    style: TextStyle(
                                      fontSize: isDesktop ? 36 : 32,
                                      fontWeight: FontWeight.w900,
                                      color: const Color(0xFF111827),
                                      letterSpacing: -0.5,
                                      height: 1.15,
                                    ),
                                  ),
                                  Stack(
                                    clipBehavior: Clip.none,
                                    children: [
                                      Text(
                                        _slides[_currentPage].titleLine2,
                                        style: TextStyle(
                                          fontSize: isDesktop ? 36 : 32,
                                          fontWeight: FontWeight.w900,
                                          color: AppColors.primaryGreenColor,
                                          letterSpacing: -0.5,
                                          height: 1.15,
                                        ),
                                      ),
                                      Positioned(
                                        left: 0,
                                        right: 0,
                                        bottom: -3,
                                        child: CustomPaint(
                                          size: const Size(double.infinity, 7),
                                          painter: _CurvedUnderlinePainter(),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),

                            SizedBox(height: isCompact ? 10 : 14),

                            // 6. Dynamic Supporting Description
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 250),
                              child: Text(
                                _slides[_currentPage].description,
                                key: ValueKey<int>(_currentPage),
                                style: TextStyle(
                                  fontSize: isDesktop ? 16.5 : 15.0,
                                  fontWeight: FontWeight.w500,
                                  color: const Color(0xFF6B7280),
                                  height: 1.4,
                                ),
                              ),
                            ),

                            SizedBox(height: isCompact ? 18 : 24),

                            // 7. Next / Get Started Action Button
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                ElevatedButton(
                                  onPressed: _onNextPressed,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.primaryYellowColor,
                                    foregroundColor: const Color(0xFF111827),
                                    elevation: 0,
                                    padding: EdgeInsets.symmetric(
                                      horizontal: isDesktop ? 30 : 26,
                                      vertical: isDesktop ? 15 : 13,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(28.0),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        isLastSlide ? 'Get Started' : 'Next',
                                        style: TextStyle(
                                          fontSize: isDesktop ? 18 : 17,
                                          fontWeight: FontWeight.w800,
                                          color: const Color(0xFF111827),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      const Icon(
                                        Icons.arrow_forward_rounded,
                                        size: 20,
                                        color: Color(0xFF111827),
                                      ),
                                    ],
                                  ),
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

class _CurvedUnderlinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primaryYellowColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4.0
      ..strokeCap = StrokeCap.round;

    final path = Path();
    path.moveTo(0, size.height * 0.4);
    path.quadraticBezierTo(
      size.width * 0.5,
      size.height * 1.1,
      size.width * 0.95,
      size.height * 0.2,
    );

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

