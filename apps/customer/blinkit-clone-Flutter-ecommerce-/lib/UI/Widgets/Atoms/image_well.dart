import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../Models/product_model.dart';
import '../../../design/tokens.dart';

/// The tinted, rounded container a product image sits in — the most reused
/// primitive in the redesign. Home rails, category and search grids, the cart
/// line and the detail hero all render through this one widget, so the tint,
/// the radius, the inset, the fade-in and (above all) the **no-image
/// fallback** cannot diverge surface to surface.
///
/// It is **sized entirely by its caller**: the well fills whatever constraints
/// it is given and lays its content out with `StackFit.expand`. That is what
/// makes the anti-layout-shift guarantee structural rather than a coincidence
/// of two numbers happening to match — see [BlynkImageContent].
///
/// Per plan §4.1 the well has a soft `well` tint and **no border**.
class BlynkImageWell extends StatelessWidget {
  const BlynkImageWell({
    super.key,
    this.imageUrl,
    this.glyph = BlynkIcons.product,
    this.semanticLabel,
    this.inset = BlynkWell.inset,
    this.radius = BlynkWell.radius,
    this.tint = BlynkWell.tint,
    this.alignment = Alignment.center,
    this.overlay,
  });

  /// The product photo, when the backend has one. `null` or empty means the
  /// fallback — which is today's default for 40 of 41 products.
  final String? imageUrl;

  /// The fallback glyph. [ProductImageWell] derives it from the product's
  /// real category name; callers with no category pass nothing.
  final IconData glyph;

  /// Spoken description of the well's content. Omitted entirely (no semantics
  /// node) when null, so a decorative well is not announced twice.
  final String? semanticLabel;

  final double inset;
  final BorderRadius radius;
  final Color tint;

  /// Where the `cover` crop anchors - the operator's focal point, mapped from
  /// the backend's 0-100 percentages (see `Models/image_focal.dart`).
  ///
  /// [Alignment.center] is the default and is what every caller that has not
  /// been given a focal point passes, so the well crops from the centre
  /// exactly as it always has.
  final Alignment alignment;

  /// Drawn over the image and clipped to [radius] — the product card's
  /// unavailable wash. It lives inside the well so it can never end up a
  /// different shape from the image underneath it.
  final Widget? overlay;

  @override
  Widget build(BuildContext context) {
    // 2026-09-26: a real photo fills the well edge to edge. The inset only
    // ever existed to frame the fallback medallion; on a photo it showed the
    // well tint as a grey border around the picture, which is what the
    // customer saw and asked to have removed. The tint itself stays: it is
    // the placeholder a photo fades in over (brief 11, never a blank white
    // box) and the surface the fallback glyph sits on when there is no
    // photo or the load fails.
    final hasPhoto = imageUrl != null && imageUrl!.trim().isNotEmpty;
    final photoInset = hasPhoto ? 0.0 : inset;

    final well = DecoratedBox(
      decoration: BoxDecoration(color: tint, borderRadius: radius),
      child: ClipRRect(
        borderRadius: radius,
        child: Stack(
          fit: StackFit.expand,
          children: [
            // 2026-09-24: the image used to be a bare `Padding` inside the
            // well's ClipRRect. The clip is at the OUTER edge, so an inset
            // photo kept square corners sitting inside a rounded tint — it
            // read as a rectangle pasted on a rounded card. The fallback
            // filled the well and so looked correct, which is exactly why the
            // two states did not match.
            //
            // The photo now carries its own rounded clip, concentric with the
            // well: the inner radius is the outer radius minus the inset, so
            // the curves stay parallel instead of the inner corner looking
            // tighter or squarer than the frame around it.
            Padding(
              padding: EdgeInsets.all(photoInset),
              child: ClipRRect(
                borderRadius: BorderRadius.all(
                  Radius.circular(
                    ((radius.topLeft.x - photoInset) < 0 ? 0 : radius.topLeft.x - photoInset).toDouble(),
                  ),
                ),
                child: BlynkImageContent(
                  imageUrl: imageUrl,
                  blend: tint,
                  glyph: glyph,
                  alignment: alignment,
                ),
              ),
            ),
            if (overlay != null) Positioned.fill(child: overlay!),
          ],
        ),
      ),
    );

    if (semanticLabel == null) return well;
    return Semantics(image: true, label: semanticLabel, child: well);
  }
}

/// [BlynkImageWell] bound to a real product: the photo the backend sent (or
/// none), the fallback glyph its real `category_name` maps to, and the
/// product name as the spoken description.
class ProductImageWell extends StatelessWidget {
  const ProductImageWell({
    super.key,
    required this.product,
    this.inset = BlynkWell.inset,
    this.radius = BlynkWell.radius,
    this.tint = BlynkWell.tint,
    this.semantic = true,
    this.overlay,
  });

  final ProductModel product;
  final double inset;
  final BorderRadius radius;
  final Color tint;

  /// The product card announces the name through its own tap target, so it
  /// turns the image's node off rather than saying the name twice.
  final bool semantic;

  final Widget? overlay;

  @override
  Widget build(BuildContext context) {
    return BlynkImageWell(
      imageUrl: product.imageUrl,
      glyph: fallbackGlyphFor(product.categoryName),
      semanticLabel: semantic ? product.name : null,
      inset: inset,
      radius: radius,
      tint: tint,
      // The operator's focal point, or the centre when they never set one -
      // which is every product until someone does.
      alignment: product.imageAlignment,
      overlay: overlay,
    );
  }
}

/// The image itself — a real photo or the branded fallback — with **no** tint,
/// radius or inset of its own. [BlynkImageWell] owns those; this is exposed
/// separately only for the two surfaces that already draw their own container
/// (the cart line and the product-detail hero).
///
/// ## The no-image fallback contract
///
/// * **Identical geometry, image or not.** Both branches are laid out by the
///   parent's constraints (`StackFit.expand` / `double.infinity`), never by
///   the picture's intrinsic size, so uploading a photo later moves nothing
///   on the screen. `image_well_test.dart` asserts the box is the same size
///   both ways; that assertion is the guarantee.
/// * **Never** a broken-image glyph, a grey box or "image unavailable" text.
/// * **No** stock, generated or externally-hosted imagery — the fallback is
///   drawn from `BlynkWell` tokens and one Material glyph.
/// * **Load-in does not flash**: the fallback holds the box while the photo
///   decodes and the photo fades in over it, in the same rect.
/// * **Load failure falls back** — it does not throw and does not resize.
class BlynkImageContent extends StatefulWidget {
  const BlynkImageContent({
    super.key,
    this.imageUrl,
    this.glyph = BlynkIcons.product,
    this.alignment = Alignment.center,
    this.blend,
  });

  final String? imageUrl;
  final IconData glyph;

  /// The surface the photo sits on. When set, the photo is multiplied onto
  /// it, so the white studio background most product shots come with takes
  /// on the surface colour and the photo's edge disappears - no white square
  /// on a tinted well. The product itself is unchanged in practice: the well
  /// tint is within a few percent of white, so multiplying by it only shifts
  /// the white areas.
  final Color? blend;

  /// Where the `cover` crop anchors. [Alignment.center] - the 50/50 focal
  /// default - is exactly the crop this widget performed before focal points
  /// existed, so an unset image is pixel-for-pixel unchanged.
  final Alignment alignment;

  /// How far a photo's shape may differ from its box before it is fitted
  /// whole instead of filling the box. See [BlynkImageContent.fitFor].
  static const double maxCropRatio = 1.35;

  /// `cover` when the photo is roughly the box's shape (a little crop off
  /// the edges, the box filled), `contain` when it is far off it.
  ///
  /// 2026-09-26: `cover` alone cropped a 151 x 400 bottle shot into a wide
  /// card box down to a strip of its label - the whole product gone, which
  /// on the emulator read as the image being bent. Such a photo is now shown
  /// whole on the well (its white studio background multiplies into the
  /// tint, so there is no visible band). A photo near the box's shape still
  /// fills it, exactly as before. Unknown size (still loading) -> `cover`.
  static BoxFit fitFor(Size? image, Size box) {
    if (image == null || image.isEmpty || box.isEmpty) return BoxFit.cover;
    final r = (image.width / image.height) / (box.width / box.height);
    return (r > maxCropRatio || r < 1 / maxCropRatio) ? BoxFit.contain : BoxFit.cover;
  }

  @override
  State<BlynkImageContent> createState() => _BlynkImageContentState();
}

class _BlynkImageContentState extends State<BlynkImageContent> {
  ImageStream? _stream;
  ImageStreamListener? _listener;
  Size? _imageSize;

  String? get _url {
    final url = widget.imageUrl?.trim();
    return (url == null || url.isEmpty) ? null : url;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolve();
  }

  @override
  void didUpdateWidget(BlynkImageContent old) {
    super.didUpdateWidget(old);
    if (old.imageUrl != widget.imageUrl) {
      _imageSize = null;
      _resolve();
    }
  }

  /// Reads the photo's pixel size from the same (cached) stream the
  /// [Image.network] below uses - no second download.
  void _resolve() {
    final url = _url;
    final stream = url == null
        ? null
        : NetworkImage(url).resolve(createLocalImageConfiguration(context));
    if (stream?.key == _stream?.key && stream != null) return;
    _stop();
    _stream = stream;
    if (stream == null) return;
    _listener = ImageStreamListener(
      (info, _) {
        final size = Size(info.image.width.toDouble(), info.image.height.toDouble());
        info.dispose();
        if (mounted && size != _imageSize) setState(() => _imageSize = size);
      },
      onError: (_, __) {},
    );
    stream.addListener(_listener!);
  }

  void _stop() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    _stream = null;
    _listener = null;
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final url = _url;
    final fallback = _WellFallback(glyph: widget.glyph);
    if (url == null) return fallback;

    return LayoutBuilder(builder: (context, box) => Image.network(
      url,
      // 2026-09-24: was `contain`, which fitted the WHOLE photo inside the
      // well — so a landscape product shot in a square well letterboxed, with
      // dead bands above and below it. `cover` fills the well and crops the
      // overflow, which is what every product grid does and what the reference
      // design shows.
      //
      // This is deliberately fixed in the APP rather than by asking the
      // operator to crop on upload: it corrects every photo already uploaded
      // and every future one with no extra step at upload time, and an
      // operator cropping by hand would still not guarantee the aspect ratio
      // the grid needs. Product shots are centre-weighted, so cropping the
      // edges is safe; a photo with detail at the extreme edge is the rare
      // case, and the fix for that one is a better source image.
      fit: BlynkImageContent.fitFor(_imageSize, box.biggest),
      // 2026-09-24 (migration 009): `cover` crops whatever does not fit, and
      // it used to crop from the centre unconditionally - so a photo whose
      // subject sits off-centre lost the subject. The operator now picks the
      // point that must survive, in Blynk Ops, and it arrives here as an
      // Alignment. The 50/50 default IS Alignment.center, so nothing about an
      // untouched photo changes.
      alignment: widget.alignment,
      color: widget.blend,
      colorBlendMode: widget.blend == null ? null : BlendMode.multiply,
      width: double.infinity,
      height: double.infinity,
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        if (wasSynchronouslyLoaded) return child;
        return Stack(
          fit: StackFit.expand,
          children: [
            if (frame == null) fallback,
            AnimatedOpacity(
              opacity: frame == null ? 0 : 1,
              duration: BlynkMotion.resolve(context, BlynkMotion.base),
              child: child,
            ),
          ],
        );
      },
      errorBuilder: (_, __, ___) => fallback,
    ));
  }
}

/// The fallback: a `line` medallion on the `well` tint carrying a
/// low-emphasis category glyph. Sized from the box it is handed, so the one
/// composition covers a 56 dp cart thumbnail and a 220 dp detail hero without
/// any caller passing a size.
class _WellFallback extends StatelessWidget {
  const _WellFallback({required this.glyph});

  final IconData glyph;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final height = constraints.maxHeight;
        final side = math.min(
          width.isFinite ? width : BlynkWell.fallbackDiscMax,
          height.isFinite ? height : BlynkWell.fallbackDiscMax,
        );
        final disc = math.min(
          side,
          (side * BlynkWell.fallbackDiscFraction)
              .clamp(BlynkWell.fallbackDiscMin, BlynkWell.fallbackDiscMax),
        );

        return Center(
          child: SizedBox(
            width: disc,
            height: disc,
            child: DecoratedBox(
              decoration: const BoxDecoration(
                color: BlynkWell.fallbackDisc,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Icon(
                  glyph,
                  size: disc * BlynkWell.fallbackGlyphFraction,
                  color: BlynkWell.fallbackGlyph,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Picks the fallback glyph for a **real** backend category name. Unrecognised
/// or empty names get [BlynkIcons.product]: nothing is guessed about the
/// product, and no category is invented.
IconData fallbackGlyphFor(String categoryName) {
  final name = categoryName.toLowerCase();
  bool has(List<String> words) => words.any(name.contains);

  if (has(['dairy', 'egg', 'milk', 'cheese', 'yog'])) return BlynkIcons.groupDairy;
  if (has(['baker', 'bread', 'bun', 'cake', 'pastr'])) return BlynkIcons.groupBakery;
  if (has(['fruit', 'veget', 'produce', 'fresh', 'greens'])) return BlynkIcons.groupProduce;
  if (has(['drink', 'beverage', 'juice', 'water', 'tea', 'coffee', 'soda'])) {
    return BlynkIcons.groupDrinks;
  }
  if (has(['snack', 'biscuit', 'chocolate', 'confection', 'sweet', 'chips'])) {
    return BlynkIcons.groupSnacks;
  }
  if (has(['meat', 'fish', 'seafood', 'chicken', 'poultry'])) return BlynkIcons.groupMeat;
  if (has(['rice', 'grain', 'pantry', 'staple', 'spice', 'flour', 'noodle', 'pasta'])) {
    return BlynkIcons.groupPantry;
  }
  if (has(['clean', 'household', 'home care', 'laundry', 'detergent'])) {
    return BlynkIcons.groupHousehold;
  }
  if (has(['personal', 'beauty', 'hygiene', 'body', 'hair', 'skin'])) {
    return BlynkIcons.groupPersonalCare;
  }
  if (has(['baby', 'infant', 'toddler'])) return BlynkIcons.groupBaby;
  if (has(['health', 'dental', 'pharma', 'medic', 'wellness'])) return BlynkIcons.groupHealth;
  return BlynkIcons.product;
}
