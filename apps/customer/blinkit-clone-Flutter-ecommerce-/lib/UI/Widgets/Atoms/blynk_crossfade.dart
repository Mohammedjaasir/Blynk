import 'package:flutter/widgets.dart';

import '../../../design/motion.dart';

/// Crossfades between children when [child]'s key changes - a skeleton giving
/// way to content, an empty state giving way to a list.
///
/// A thin, opinionated [AnimatedSwitcher]: the app's duration and curves
/// (enter decelerates, exit accelerates), reduced motion honoured, and a
/// layout that aligns the outgoing and incoming children to the **top** so a
/// skeleton and the content it becomes share a top edge and nothing below
/// appears to jump. Screens use this rather than a bare switcher so a change
/// of state fades the same way everywhere.
///
/// The first child is shown at once - `AnimatedSwitcher` creates its initial
/// entry already at full opacity - so this only ever animates a *change*;
/// `motion_components_test` holds it to that.
class BlynkCrossfade extends StatelessWidget {
  const BlynkCrossfade({
    super.key,
    required this.child,
    this.duration,
    this.alignment = Alignment.topCenter,
  });

  /// Give each distinct state its own [Key]; a change of key is what fades.
  final Widget child;

  /// Defaults to [BlynkMotion.base].
  final Duration? duration;

  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: BlynkMotion.resolve(context, duration ?? BlynkMotion.base),
      switchInCurve: BlynkMotion.easeOut,
      switchOutCurve: BlynkMotion.easeIn,
      layoutBuilder: (current, previous) => Stack(
        alignment: alignment,
        children: [...previous, if (current != null) current],
      ),
      child: child,
    );
  }
}
