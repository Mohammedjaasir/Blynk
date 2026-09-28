import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';

/// The Flutter half of the opening. It begins as a pixel-for-pixel copy of
/// Android's native splash - the same stacked mark and wordmark, the same
/// size, the same centre, the same white - so the handover is invisible, and
/// then it comes alive: the mark breathes up a touch and the whole
/// composition lifts away into the app. Plain white throughout - the
/// yellow disc that used to bloom behind the mark was removed at the
/// owner's request (2026-09-26).
///
/// Why this exists again (2026-09-26): with no Flutter screen, a screen
/// recording showed Android's static logo, then a **blank white frame**, then
/// the next screen popping in with nothing between them. The earlier version
/// of this screen was removed because it drew a *different* logo layout
/// (mark beside wordmark) after the native one (mark over wordmark), which
/// read as a second intro. This one draws the native one, so it cannot.
///
/// It is presentation only: [SessionGate] reads the session alongside it and
/// leaves when both are done, capped, so it can never become a loading
/// screen. [onLeave] fires as the exit begins, so the next screen fades in
/// *over* the exit rather than after it.
class BlynkLaunchScreen extends StatefulWidget {
  const BlynkLaunchScreen({super.key, this.onLeave});

  /// Called once, when the composition starts to lift away.
  final VoidCallback? onLeave;

  /// The native splash's logo, cropped to its bounds (Assets/splash2.png,
  /// the same crop the android12splash buckets are generated from).
  static const String logoAsset = 'Assets/Images/splash_logo.png';

  /// Drawn height of [logoAsset]. Measured on the running emulator: the
  /// native splash draws the logo at 124 x 171 dp inside this 180 dp crop.
  static const double logoHeight = 180;

  /// The whole Flutter-side sequence. Together with the native splash the
  /// opening lands inside the brief's 1.5-2 s.
  static const Duration sequence = Duration(milliseconds: 1100);

  /// When the exit begins (and [onLeave] fires), as a fraction of [sequence].
  static const double leaveAt = 0.62;

  /// Under reduced motion: the logo, still, for this long.
  static const Duration reducedMotionHold = Duration(milliseconds: 400);

  @override
  State<BlynkLaunchScreen> createState() => _BlynkLaunchScreenState();
}

class _BlynkLaunchScreenState extends State<BlynkLaunchScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: BlynkLaunchScreen.sequence);

  // The breath: the mark swells slightly.
  late final Animation<double> _breath = CurvedAnimation(
      parent: _c, curve: const Interval(0.1, 0.55, curve: Curves.easeInOutCubic));
  // The exit: everything lifts and fades while the next screen fades in.
  late final Animation<double> _exit = CurvedAnimation(
      parent: _c, curve: const Interval(BlynkLaunchScreen.leaveAt, 1.0, curve: Curves.easeInCubic));

  bool _started = false;
  bool _left = false;

  void _leave() {
    if (_left || !mounted) return;
    _left = true;
    widget.onLeave?.call();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (MediaQuery.disableAnimationsOf(context)) {
      Future<void>.delayed(BlynkLaunchScreen.reducedMotionHold, _leave);
      return;
    }
    _c.addListener(() {
      if (_c.value >= BlynkLaunchScreen.leaveAt) _leave();
    });
    _c.forward();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const logo = Image(
      image: AssetImage(BlynkLaunchScreen.logoAsset),
      height: BlynkLaunchScreen.logoHeight,
      filterQuality: FilterQuality.medium,
    );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: BlynkColors.paper,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: BlynkColors.paper,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: BlynkColors.paper,
        // No SafeArea: the native splash centres on the whole window, so this
        // must too, or the mark would jump by half the status bar.
        body: Semantics(
          label: 'Blynk',
          image: true,
          child: ExcludeSemantics(
            child: Center(
              child: AnimatedBuilder(
                animation: _c,
                child: logo,
                builder: (context, mark) {
                  final exit = _exit.value;
                  final breath = 1 + 0.05 * _breath.value;
                  return Opacity(
                    opacity: 1 - exit,
                    child: Transform.translate(
                      offset: Offset(0, -28 * exit),
                      child: Transform.scale(
                        scale: (1 + 0.06 * exit) * breath,
                        child: mark,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}
