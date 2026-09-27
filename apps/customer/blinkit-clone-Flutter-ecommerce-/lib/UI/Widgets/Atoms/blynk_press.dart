import 'package:flutter/widgets.dart';

import '../../../design/motion.dart';

/// Scales [child] to [BlynkMotion.pressScale] while a pointer is down on it,
/// and back when the pointer lifts or leaves. The press response the brief
/// asks for on cards and controls: felt under the thumb, never a bounce.
///
/// **It does not take the gesture.** It watches the raw pointer through a
/// [Listener], so whatever [child] already does on tap - an `InkWell`, a
/// button, a card that navigates - keeps doing it unchanged. This wrapper
/// only ever adds the scale; it can never swallow or delay a tap.
///
/// **It is cheap.** One `AnimatedScale`, no controller, nothing runs when the
/// pointer is up. Wrapping every card in a grid costs nothing at rest.
///
/// Reduced motion: the scale is skipped entirely, so the tap is unchanged and
/// the control simply does not move.
class BlynkPress extends StatefulWidget {
  const BlynkPress({
    super.key,
    required this.child,
    this.enabled = true,
  });

  final Widget child;

  /// False for a control that is disabled: a press it ignores must not look
  /// like a press it took.
  final bool enabled;

  @override
  State<BlynkPress> createState() => _BlynkPressState();
}

class _BlynkPressState extends State<BlynkPress> {
  bool _down = false;

  void _set(bool down) {
    if (!widget.enabled || _down == down) return;
    setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) {
    final duration = BlynkMotion.resolve(context, BlynkMotion.instant);
    return Listener(
      // Opaque, so the press is felt over the whole box - a card's padding
      // included - not only where the child happens to paint. A Listener only
      // observes the pointer; it cannot take the tap from the child.
      behavior: HitTestBehavior.opaque,
      onPointerDown: (_) => _set(true),
      onPointerUp: (_) => _set(false),
      onPointerCancel: (_) => _set(false),
      child: AnimatedScale(
        scale: _down && widget.enabled ? BlynkMotion.pressScale : 1,
        duration: duration,
        // Down is instant so the finger is answered; up eases so it settles.
        curve: _down ? BlynkMotion.easeIn : BlynkMotion.easeOut,
        child: widget.child,
      ),
    );
  }
}
