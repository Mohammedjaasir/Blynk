import 'package:flutter/widgets.dart';

import 'primitives.dart';

/// The app's one motion vocabulary. Every duration in the customer app comes
/// from here (a ratchet test holds the rest of `lib/` to zero literal
/// `Duration(milliseconds:` outside a short allow-list of timers that are not
/// motion at all - search debounce, a map retry).
///
/// Motion answers an action or shows a state change; exits are faster than
/// enters. Every duration goes through [resolve] so reduced motion is
/// honoured everywhere for free - a screen never has to remember to.
///
/// | Token | ms | Used for |
/// |---|---|---|
/// | [instant] | 60 | a press acknowledged, a toggle - felt, not watched |
/// | [fast] | 120 | icon/label swaps, a stepper tick, hover |
/// | [base] | 200 | most enters, crossfades, a route |
/// | [slow] | 280 | an item leaving a list, a marker moving between fixes |
/// | [emphasized] | 320 | the one hero moment on a screen (a cart bar rising, an order confirmed) |
/// | [camera] | 500 | a map camera fit - the whole viewport moves |
abstract final class BlynkMotion {
  static const Duration instant = BlynkScale.instant;
  static const Duration fast = BlynkScale.fast;
  static const Duration base = BlynkScale.base;
  static const Duration slow = BlynkScale.slow;
  static const Duration emphasized = BlynkScale.emphasized;
  static const Duration camera = BlynkScale.camera;
  static const Duration entrance = BlynkScale.entrance;
  static const Duration entranceStep = BlynkScale.entranceStep;

  /// How far a screen section rises as it arrives, in dp.
  static const double entranceRise = 24;

  /// Enter: decelerate into place. The default for anything arriving.
  static const Curve easeOut = Curves.easeOutCubic;

  /// Exit: accelerate away. Leaving should feel lighter than arriving.
  static const Curve easeIn = Curves.easeInCubic;

  /// Both ends eased: for something that moves from one resting place to
  /// another and is watched the whole way (a nav indicator, a marker).
  static const Curve standard = Curves.easeInOutCubic;

  /// The scale a pressed control settles to. Enough to be felt under a
  /// thumb, not enough to read as a bounce - the brief rules bouncing out.
  static const double pressScale = 0.97;

  /// How far an entering element travels, in dp. Small on purpose: a rise
  /// that is noticed as movement has already drawn attention off the content.
  static const double entranceTravel = 16;

  /// Staggered lists: each item starts [staggerStep] after the one before,
  /// up to [staggerCap]. Past the cap every item shares the cap's delay, so
  /// the tenth card of a grid is not left waiting on the first nine.
  static const Duration staggerStep = BlynkScale.stagger;
  static const int staggerCap = 6;

  /// The delay for item [index] in a staggered list.
  static Duration staggerFor(int index) =>
      staggerStep * (index < staggerCap ? index : staggerCap);

  /// [duration], or zero when the platform asks for reduced motion.
  static Duration resolve(BuildContext context, Duration duration) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : duration;

  /// True when the platform asks for reduced motion. For the few places that
  /// need to *skip* a decorative animation rather than run it at zero length.
  static bool reduced(BuildContext context) =>
      MediaQuery.disableAnimationsOf(context);
}
