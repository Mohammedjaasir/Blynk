import 'package:flutter/material.dart';

import 'add_to_cart_button.dart';
import 'image_well.dart';
import 'money_text.dart';
import 'offer_tag.dart';
import '../../../Models/product_model.dart';
import '../../../design/tokens.dart';
import 'blynk_press.dart';
import 'product_hero.dart';

/// The single product tile used by Home rails, category grids and search
/// results. There is deliberately only one of these — every product surface in
/// the app renders through it, so spacing, price formatting, the image well
/// and the add-to-cart affordance cannot diverge screen to screen.
///
/// ```
/// ┌─────────────────────┐
/// │   PRODUCT IMAGE     │  BlynkImageWell — dominant, the largest element
/// ├─────────────────────┤
/// │ Product Name        │  BlynkCardProduct.name, 2 lines, ellipsis
/// │ Unit                │  BlynkType.productUnit
/// │ LKR 605  LKR 650    │  MoneyText -> BlynkCardProduct.price (+ StruckPrice on offer)
/// │              [ + ]  │  AddToCartButton (ADD -> stepper)
/// └─────────────────────┘
/// ```
///
/// `paper` surface, [BlynkCardProduct.radius], the soft (not heavy)
/// [BlynkCardProduct.elevation], **no border**. Every value is a
/// `BlynkCardProduct` token — the card declares no bare geometry number and no
/// text size of its own.
///
/// **Product offers (owner, 2026-10-09):** while [ProductModel.isOnOffer] the
/// price line shows the offer price, then the regular price struck through
/// ([StruckPrice]), and an [OfferTag] ("Offer −12%") sits on the image well's
/// corner. Both come from the backend's real `offer_price`; a product with no
/// offer renders exactly as before, in the same fixed-height boxes.
///
/// **Deliberately absent, because the backend has no field for any of them:**
/// rating, review count, per-unit price, and the favourite/heart control
/// (there is no wishlist backend). Each is omitted entirely rather than
/// rendered as a placeholder or a zero — fabricated commerce data is the
/// highest-priority defect in review.
///
/// The price sits on its own line above a full-width control slot rather than
/// sharing the mock's `LKR 605  [+]` row: the in-cart quantity stepper is
/// 124 dp wide at minimum (48 + 28 + 48) and a compact card's inner width is
/// 128 dp, so a shared row would leave the price ~4 dp and make it vanish the
/// moment a product entered the cart. See `task-W1-report.md`.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, this.hero = true});

  final ProductModel product;

  /// Whether the image flies to the detail screen ([ProductHero]). Off where
  /// the same product is also shown in another list on the same screen (Home's
  /// category rails above its "All products" grid): one tag per route.
  final bool hero;

  /// The card's inner padding, the gap under the image well, and the slot the
  /// ADD control / stepper occupies. Public so [ProductCardSkeleton] can wear
  /// the same silhouette instead of re-deriving it.
  static const double padding = BlynkCardProduct.padding;
  static const double gap = BlynkCardProduct.gap;
  static const double rowGap = BlynkSpace.s4;
  static const double controlSlot = BlynkControl.minHeight;

  /// The height one text block occupies at the current text scale, derived
  /// from the token's own size and line height so the card and its skeleton
  /// cannot drift from the type scale.
  static double _block(BuildContext context, TextStyle style, {int lines = 1}) {
    final scaler = MediaQuery.textScalerOf(context);
    final size = style.fontSize ?? BlynkText.minSize;
    final leading = style.height ?? 1.25;
    return (scaler.scale(size) * leading * lines).ceilToDouble();
  }

  /// The two-line name box. Always two lines, so a one-line name does not give
  /// its tile a taller image than its two-line neighbour in the same row.
  static double nameBox(BuildContext context) =>
      _block(context, BlynkCardProduct.name, lines: BlynkCardProduct.nameMaxLines);

  static double unitBox(BuildContext context) => _block(context, BlynkType.productUnit);

  static double priceBox(BuildContext context) => _block(context, BlynkCardProduct.price);

  /// Everything in the card except the image, at the current text scale. The
  /// card lays out exactly this, so a rail or grid that gives the card
  /// [heightFor] never overflows and never leaves the image squashed.
  static double chromeHeight(BuildContext context) =>
      padding * 2 +
      gap +
      nameBox(context) +
      rowGap +
      unitBox(context) +
      rowGap +
      priceBox(context) +
      controlSlot;

  /// The image well's width inside a card [width] wide.
  static double imageSideFor(double width) => width - padding * 2;

  /// How tall the image well is as a fraction of its width.
  ///
  /// 0.85 - a shallow landscape well. The photo still leads the card, but the
  /// card is ~24 dp shorter at a 183 dp tile, which is what puts a third row
  /// within reach on a phone.
  ///
  /// Recorded so the rejected values are not retried blindly:
  /// - 1.0 (square) was the previous value. Honest, but the tallest option.
  /// - 0.68 was tried on 2026-09-24 and reverted: it worked arithmetically but
  ///   left a squat, unattractive photograph, which is the wrong thing to cut
  ///   on an image-first card. 0.85 is deliberately short of that floor.
  /// - Three columns was tried before that and overflowed at both 360 and
  ///   412 dp at every text scale - see [BlynkProductGrid.columnsFor].
  ///
  /// The card's height is dominated by its chrome, and the chrome's largest
  /// block - the 48 dp control row - cannot be removed (see [chromeHeight])
  /// or shrunk (48 dp is the tap-target floor), so the image well is the only
  /// height left to give.
  static const double imageRatio = 0.85;

  /// The image well's height inside a card [width] wide.
  static double imageHeightFor(double width) => imageSideFor(width) * imageRatio;

  /// Card height for a card [width] wide: the image well plus [chromeHeight].
  static double heightFor(BuildContext context, double width) =>
      imageHeightFor(width) + chromeHeight(context);

  @override
  Widget build(BuildContext context) {
    // Only ever read from the backend - never inferred or faked client-side.
    final isAvailable = product.isAvailable;
    final onOffer = product.isOnOffer;

    // The press response wraps the whole card, ripple included, so the card
    // settles under the thumb before it opens. BlynkPress only observes the
    // pointer; the InkWell keeps the tap.
    // A repaint boundary per card: a press, an entrance or a stepper tick
    // repaints this card alone, not the whole grid it sits in (M12).
    return RepaintBoundary(
      child: BlynkPress(
      child: InkWell(
      borderRadius: BlynkCardProduct.radius,
      onTap: () => Navigator.of(context).pushNamed('/product', arguments: product),
      child: Container(
        decoration: const BoxDecoration(
          color: BlynkCardProduct.surface,
          borderRadius: BlynkCardProduct.radius,
          boxShadow: BlynkCardProduct.elevation,
        ),
        padding: const EdgeInsets.all(padding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // The image is the one thing that travels to the detail
                  // screen; the offer tag stays on the card.
                  ProductHero(
                    productId: product.id,
                    enabled: hero,
                    child: ProductImageWell(
                      product: product,
                      semantic: false,
                      overlay: isAvailable ? null : const _UnavailableWash(),
                    ),
                  ),
                  if (onOffer)
                    Positioned(
                      top: BlynkSpace.s4,
                      left: BlynkSpace.s4,
                      right: BlynkSpace.s4,
                      child: Align(alignment: Alignment.topLeft, child: OfferTag(product: product)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: gap),
            // Always reserves two lines, so every tile in a row lines up.
            SizedBox(
              height: nameBox(context),
              child: Text(
                product.name,
                maxLines: BlynkCardProduct.nameMaxLines,
                overflow: BlynkType.productNameOverflow,
                style: BlynkCardProduct.name,
              ),
            ),
            const SizedBox(height: rowGap),
            SizedBox(
              height: unitBox(context),
              child: Text(
                product.unit,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: BlynkType.productUnit,
              ),
            ),
            const SizedBox(height: rowGap),
            SizedBox(
              height: priceBox(context),
              child: onOffer
                  // The offer price leads; the regular price, struck
                  // through, gives way first when the card is narrow.
                  ? LayoutBuilder(
                      builder: (context, constraints) => Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          ConstrainedBox(
                            constraints: BoxConstraints(maxWidth: constraints.maxWidth),
                            child: MoneyText(
                              product.effectivePrice,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: BlynkCardProduct.price,
                            ),
                          ),
                          Flexible(
                            child: Padding(
                              padding: const EdgeInsets.only(left: BlynkSpace.s4),
                              child: StruckPrice(
                                product.sellingPrice,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  : MoneyText(
                      product.sellingPrice,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: BlynkCardProduct.price,
                    ),
            ),
            SizedBox(
              height: controlSlot,
              child: Align(
                alignment: Alignment.centerRight,
                child: AddToCartButton(product: product),
              ),
            ),
          ],
        ),
      ),
    ),
    ),
    );
  }
}

/// The unavailable state: a `paper` wash over the image well at
/// [BlynkCardProduct.unavailableWashOpacity], keeping the photo (or the
/// fallback) legible underneath rather than hiding the product. Shown **only**
/// when the backend reports `is_available == false`.
class _UnavailableWash extends StatelessWidget {
  const _UnavailableWash();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: BlynkCardProduct.unavailableWashColor
          .withValues(alpha: BlynkCardProduct.unavailableWashOpacity),
      child: Center(
        child: Text(
          'Unavailable',
          style: BlynkText.caption.copyWith(
            fontWeight: FontWeight.w800,
            color: BlynkColors.ink3,
          ),
        ),
      ),
    );
  }
}

/// The one product image renderer for surfaces that already draw their own
/// container (the cart line, the product-detail hero): the real photo or the
/// shared no-image fallback, with no tint, radius or inset of its own.
///
/// New surfaces should use [BlynkImageWell] / [ProductImageWell] instead,
/// which bring the well with them. The fallback is the same widget either way,
/// so there is exactly one no-image appearance in the app.
class ProductImage extends StatelessWidget {
  const ProductImage({super.key, required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) => BlynkImageContent(
        imageUrl: product.imageUrl,
        glyph: fallbackGlyphFor(product.categoryName),
        // The same focal point [ProductImageWell] honours, so the deprecated
        // surface cannot crop a photo differently from the current one.
        alignment: product.imageAlignment,
      );
}
