import 'package:flutter/material.dart';

import '../../../design/motion.dart';

/// Fades and lifts [child] into place once, [delay] after it is first built.
///
/// This is what stops a grid appearing fully-formed in a single frame, which
/// is what makes a page read as static. The motion is deliberately small — a
/// fraction of the tile's height and one [BlynkMotion.base] — so it reads as
/// settling into place, not as an effect.
///
/// **It plays once, on first build.** Scrolling a tile out of view and back
/// does not replay it: a grid that re-animates on every scroll is the thing
/// that makes a page feel slow rather than alive.
///
/// **No timers.** The delay is expressed as an [Interval] on one controller
/// rather than a `Timer`, so the widget never leaves a pending timer behind —
/// that is what would otherwise fail a widget test that pumps without
/// settling.
///
/// Honours the platform's reduced-motion setting through
/// [BlynkMotion.resolve]: the child is then simply visible, immediately, with
/// no controller running at all.
///
/// **Once means once, even after a rebuild.** A card in a lazy list that
/// scrolls past the cache extent is disposed and built again on the way back;
/// a self-contained entrance would replay. Inside an [EntranceScope] this
/// widget records its [key] the first time it plays and renders at rest on
/// every later build with that key, so scrolling back through a grid shows
/// cards that are simply there. Without a scope it behaves as before.
class EntranceFade extends StatefulWidget {
  const EntranceFade({
    super.key,
    required this.child,
    this.delay = Duration.zero,
  });

  final Widget child;

  /// How long to wait before this child starts arriving. Use [delayFor] to
  /// derive it from an item's index so a grid arrives as a wave.
  final Duration delay;

  /// The distance travelled, as a fraction of the child's own height. Small
  /// on purpose: a tile that flies in from far away draws attention to the
  /// animation instead of to the product.
  static const double travel = 0.06;

  /// The gap between one item's arrival and the next.
  static const Duration step = BlynkMotion.staggerStep;

  /// How many items still stagger. Past this the delay is flat, so the last
  /// tile of a long grid is not left waiting on the first.
  static const int staggerCap = BlynkMotion.staggerCap;

  /// The delay for the item at [index] in a staggered list.
  static Duration delayFor(int index) =>
      step * (index < staggerCap ? index : staggerCap);

  @override
  State<EntranceFade> createState() => _EntranceFadeState();
}

class _EntranceFadeState extends State<EntranceFade>
    with SingleTickerProviderStateMixin {
  AnimationController? _controller;
  Animation<double>? _curve;
  bool _resolved = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reduced motion is a MediaQuery value, so it cannot be read in initState.
    if (_resolved) return;
    _resolved = true;

    final motion = BlynkMotion.resolve(context, BlynkMotion.entrance);
    if (motion == Duration.zero) return; // no controller: child is just visible

    // Already played on this screen: at rest, no controller.
    final scope = EntranceScope.maybeOf(context);
    final key = widget.key;
    if (scope != null && key != null && !scope.markPlayed(key)) return;

    final total = widget.delay + motion;
    final controller = AnimationController(vsync: this, duration: total);
    // The delay is the leading dead zone of one animation, not a timer.
    final begin = total.inMicroseconds == 0
        ? 0.0
        : widget.delay.inMicroseconds / total.inMicroseconds;
    _curve = CurvedAnimation(
      parent: controller,
      curve: Interval(begin.clamp(0.0, 1.0), 1, curve: BlynkMotion.easeOut),
    );
    _controller = controller;
    controller.forward();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final curve = _curve;
    if (curve == null) return widget.child; // reduced motion, or already played

    return FadeTransition(
      opacity: curve,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, EntranceFade.travel),
          end: Offset.zero,
        ).animate(curve),
        child: widget.child,
      ),
    );
  }
}

/// Remembers which [EntranceFade] keys have already played on a screen.
///
/// One per screen, above its lists. The set lives in this widget's state, so
/// it survives every rebuild of the lists beneath it and is discarded with
/// the screen - a fresh visit to the same screen is a fresh entrance.
class EntranceScope extends StatefulWidget {
  const EntranceScope({super.key, required this.child});

  final Widget child;

  static EntranceRegistry? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<EntranceRegistry>();

  @override
  State<EntranceScope> createState() => _EntranceScopeState();
}

class _EntranceScopeState extends State<EntranceScope> {
  final Set<Key> _played = <Key>{};

  @override
  Widget build(BuildContext context) =>
      EntranceRegistry(played: _played, child: widget.child);
}

/// The scope's record. Public only so [EntranceScope.maybeOf] can name it;
/// screens never build one directly.
class EntranceRegistry extends InheritedWidget {
  const EntranceRegistry({super.key, required this.played, required super.child});

  final Set<Key> played;

  /// True if [key] had not played yet - and it is now recorded as played.
  bool markPlayed(Key key) => played.add(key);

  @override
  bool updateShouldNotify(EntranceRegistry old) => false;
}
