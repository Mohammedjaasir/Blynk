import 'package:flutter/material.dart';

import '../../../design/motion.dart';
import 'card_product.dart';
import 'image_well.dart';

/// The shared-element flight between a product's card and its detail screen:
/// the image lifts off the card and lands as the detail's hero, so the two
/// screens read as one space rather than a page dealt on top of another.
///
/// ## The flight never re-lays-out the image (2026-09-26)
///
/// A plain [Hero] flies its child inside a rectangle tweened from the card's
/// image box (landscape, 0.85) to the detail's (square), and lays the child
/// out at every intermediate size. The photo is `BoxFit.cover`, so each frame
/// recomputed a different crop: the product slid and re-framed inside a box
/// that was changing shape, which on the emulator read as the image bending
/// and a tall box collapsing. Pixels were never scaled unevenly, but the
/// picture visibly was not stable.
///
/// [_uniformShuttle] fixes that at the root. The flight carries the detail's
/// image laid out **once, at its final size**, and only ever scales it
/// uniformly and clips it to the flying box (`FittedBox(cover)`). Its
/// geometry is identical in every frame, in both directions (push and pop);
/// only position, uniform scale and the clip change. This works for any
/// photo ratio - portrait, landscape, square - and for the no-photo
/// fallback, because nothing about the content depends on the flying box.
///
/// **Both ends are the same shape** (2026-09-26, second pass). The shuttle
/// alone still let the flying *window* change shape - the card's image box
/// is [ProductCard.imageRatio] tall, the detail's was square - so the crop
/// visibly slid as the window reshaped, which still read as bending. The
/// detail image now uses the card's ratio too, so the rect Flutter tweens
/// between is the same shape at every frame and the flight is a pure,
/// uniform zoom: no re-crop, no reshaping, rounded corners throughout.
///
/// **One tag per product, per route.** The tag is the product id. That is
/// only safe because no screen shows the same product in two lists at once;
/// two [Hero]s with one tag in a single route assert in debug.
///
/// **Reduced motion turns the flight off**, not down.
class ProductHero extends StatelessWidget {
  const ProductHero({super.key, required this.productId, required this.child});

  final String productId;
  final Widget child;

  /// The tag both ends of the flight share.
  static Object tagFor(String productId) => 'product-image-$productId';

  /// The detail screen's image box: the card's own shape
  /// ([ProductCard.imageRatio] high per unit of width), as large as fits
  /// [maxWidth] x [maxHeight]. Same shape at both ends is what makes the
  /// flight a pure uniform zoom (see the class doc).
  static Size detailSizeFor(double maxWidth, double maxHeight) {
    final width = maxWidth < maxHeight / ProductCard.imageRatio
        ? maxWidth
        : maxHeight / ProductCard.imageRatio;
    return Size(width, width * ProductCard.imageRatio);
  }

  @override
  Widget build(BuildContext context) {
    return HeroMode(
      enabled: !BlynkMotion.reduced(context),
      child: Hero(
        tag: tagFor(productId),
        // A straight tween, not MaterialApp's default MaterialRectArcTween:
        // the arc moves the corners on curved paths, so even between two
        // same-shaped boxes the window squashed mid-flight (measured 0.82
        // against 0.85). Linear between same-shaped rects keeps the shape.
        createRectTween: (begin, end) => RectTween(begin: begin, end: end),
        flightShuttleBuilder: _uniformShuttle,
        child: child,
      ),
    );
  }
}

/// The flying image: the larger end's content (the detail hero), laid out at
/// that end's own size and scaled uniformly into the flying box. See
/// [ProductHero].
Widget _uniformShuttle(
  BuildContext flightContext,
  Animation<double> animation,
  HeroFlightDirection direction,
  BuildContext fromHeroContext,
  BuildContext toHeroContext,
) {
  // The detail end is the destination on a push and the origin on a pop.
  final push = direction == HeroFlightDirection.push;
  final detail = push ? toHeroContext : fromHeroContext;
  final card = push ? fromHeroContext : toHeroContext;
  final hero = detail.widget as Hero;
  final box = detail.findRenderObject() as RenderBox?;
  final size = (box != null && box.hasSize) ? box.size : null;
  if (size == null || size.isEmpty) return hero.child;
  // The corners travel too: the card's small radius grows into the detail's
  // larger one instead of snapping to a square clip for the flight.
  // `animation` runs 0 -> 1 towards the detail on a push and 1 -> 0 back
  // on a pop, so t = 1 is always the detail end.
  final from = _radiusOf(card.widget as Hero);
  final to = _radiusOf(hero);
  return AnimatedBuilder(
    animation: animation,
    builder: (context, child) => ProductHeroShuttle(
      size: size,
      radius: BorderRadius.lerp(from, to, animation.value) ?? BorderRadius.zero,
      child: child!,
    ),
    child: hero.child,
  );
}

BorderRadius _radiusOf(Hero hero) {
  final child = hero.child;
  return child is ProductImageWell ? child.radius : BorderRadius.zero;
}

/// Exposed for tests: the content at a fixed [size], scaled uniformly (cover)
/// and clipped to whatever box the flight gives it.
class ProductHeroShuttle extends StatelessWidget {
  const ProductHeroShuttle({
    super.key,
    required this.size,
    this.radius = BorderRadius.zero,
    required this.child,
  });

  final Size size;
  final BorderRadius radius;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: radius,
      child: FittedBox(
        fit: BoxFit.cover,
        child: SizedBox.fromSize(size: size, child: child),
      ),
    );
  }
}
