import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../../../design/motion.dart';

/// One screen, one timeline. A screen owns a single [AnimationController],
/// hands each section a slice of it through [section], and every section
/// fades in on its slice. That is what makes an entrance read as one
/// composition arriving rather than seven widgets each doing their own thing
/// - the brief's exact complaint about "every element animating
/// independently with exaggerated delays".
///
/// Why one controller and not an entrance widget per section:
/// - **It plays once.** Slivers that scroll off and back are rebuilt; a
///   self-starting entrance would replay every time. The controller lives in
///   the screen's state and runs once, so a section scrolled back into view
///   is simply at rest. Pull-to-refresh never touches it either.
/// - **Reduced motion is one decision**, made once, for the whole screen.
/// - **Nothing runs off-screen.** A fade on a sliver that is not painted
///   costs nothing, and at rest `SliverFadeTransition` paints its child
///   directly with no compositing layer.
///
/// Each section fades and rises [BlynkMotion.entranceRise] dp (a paint-only
/// offset, see [_SliverRise]), beats [BlynkMotion.entranceStep] apart, each
/// lasting [BlynkMotion.entrance]: 810 ms for Home's five beats.
class EntranceTimeline {
  EntranceTimeline({required this.controller, required this.beats})
      : assert(beats > 0),
        total = BlynkMotion.entranceStep * (beats - 1) + BlynkMotion.entrance;

  final AnimationController controller;

  /// How many distinct beats the screen has. The last beat starts at
  /// `(beats - 1) * entranceStep` and the timeline ends one [BlynkMotion.entrance] later.
  final int beats;

  /// The full length: what the controller's duration must be set to.
  final Duration total;

  /// The slice for beat [index]: starts [BlynkMotion.entranceStep] x index
  /// in, lasts [BlynkMotion.entrance], decelerates into place.
  Animation<double> section(int index) {
    final start = BlynkMotion.entranceStep * index;
    final t = total.inMicroseconds.toDouble();
    return CurvedAnimation(
      parent: controller,
      curve: Interval(
        start.inMicroseconds / t,
        (start + BlynkMotion.entrance).inMicroseconds / t,
        curve: BlynkMotion.easeOut,
      ),
    );
  }

  /// When beat [index] begins - for content inside a section that staggers
  /// on its own (a product grid), so it starts as its section appears rather
  /// than invisibly before it.
  Duration delayOf(int index) => BlynkMotion.entranceStep * index;
}

/// Fades and raises [sliver] in on [animation], a slice from [EntranceTimeline.section].
class SliverEntrance extends StatelessWidget {
  const SliverEntrance({super.key, required this.animation, required this.sliver});

  final Animation<double> animation;
  final Widget sliver;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: animation,
        // The fade is built once; only the rise offset changes per frame.
        child: SliverFadeTransition(opacity: animation, sliver: sliver),
        builder: (context, faded) => _SliverRise(
          dy: BlynkMotion.entranceRise * (1 - animation.value),
          sliver: faded!,
        ),
      );
}

/// Paints its sliver [dy] lower than where it is laid out. Paint-only on
/// purpose: moving the layout would shove every section below it down and
/// back during the entrance. 2026-09-26: the fade-only version was measured
/// on a screen recording and could not be seen as a sequence; the rise is
/// what makes the order of arrival legible.
class _SliverRise extends SingleChildRenderObjectWidget {
  const _SliverRise({required this.dy, required Widget sliver}) : super(child: sliver);

  final double dy;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderSliverRise(dy);

  @override
  void updateRenderObject(BuildContext context, _RenderSliverRise renderObject) =>
      renderObject.dy = dy;
}

class _RenderSliverRise extends RenderProxySliver {
  _RenderSliverRise(this._dy);

  double _dy;
  set dy(double value) {
    if (value == _dy) return;
    _dy = value;
    markNeedsPaint();
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    final child = this.child;
    if (child != null && child.geometry!.visible) {
      context.paintChild(child, offset + Offset(0, _dy));
    }
  }

  @override
  void applyPaintTransform(RenderObject child, Matrix4 transform) =>
      transform.translateByDouble(0.0, _dy, 0.0, 1.0);
}
