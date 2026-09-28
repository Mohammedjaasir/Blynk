import 'package:flutter/material.dart';

import '../../../design/motion.dart';

/// The app's one route transition: the incoming page fades in and rises
/// [BlynkMotion.entranceTravel] dp, the outgoing page stays put beneath it.
///
/// Installed once, through `ThemeData.pageTransitionsTheme`, so all 21
/// routes in `route_generator.dart` change together and no screen carries a
/// transition of its own. A shop's screens should feel like one surface the
/// customer moves across, not a stack of cards being dealt.
///
/// **Why not the Material default.** Android's default slides the whole page
/// up from the bottom over ~300 ms with a fade - a large motion for a "tap a
/// product, see the product" step, and one that fights the `Hero` the
/// product image already performs. A short fade-through under a hero reads
/// as the image carrying the customer to the next screen; a page sliding up
/// underneath it reads as two things happening at once.
///
/// **Back is the reverse.** The leaving page fades and sinks the same 8 dp,
/// on [BlynkMotion.easeIn], so going back feels lighter than going forward.
///
/// Reduced motion: [BlynkMotion.resolve] returns zero and the page cuts.
class BlynkPageTransitionsBuilder extends PageTransitionsBuilder {
  const BlynkPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (BlynkMotion.reduced(context)) return child;

    final enter = CurvedAnimation(
      parent: animation,
      curve: BlynkMotion.easeOut,
      reverseCurve: BlynkMotion.easeIn,
    );
    return FadeTransition(
      opacity: enter,
      child: AnimatedBuilder(
        animation: enter,
        child: child,
        builder: (context, page) => Transform.translate(
          offset: Offset(0, BlynkMotion.entranceTravel * (1 - enter.value)),
          child: page,
        ),
      ),
    );
  }
}

/// The theme entry for [BlynkPageTransitionsBuilder] on every platform the
/// customer app ships to. Referenced from `app_theme.dart`.
const PageTransitionsTheme blynkPageTransitions = PageTransitionsTheme(
  builders: {
    TargetPlatform.android: BlynkPageTransitionsBuilder(),
    TargetPlatform.iOS: BlynkPageTransitionsBuilder(),
    TargetPlatform.windows: BlynkPageTransitionsBuilder(),
    TargetPlatform.linux: BlynkPageTransitionsBuilder(),
    TargetPlatform.macOS: BlynkPageTransitionsBuilder(),
  },
);
