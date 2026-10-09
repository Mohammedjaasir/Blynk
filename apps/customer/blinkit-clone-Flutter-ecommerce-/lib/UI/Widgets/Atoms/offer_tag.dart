import 'package:flutter/material.dart';

import '../../../Models/product_model.dart';
import '../../../design/tokens.dart';

/// The small "Offer −12%" tag on a product that is on offer (owner,
/// 2026-10-09). Drawn only for [ProductModel.isOnOffer], beside a
/// [StruckPrice] of the regular price — both come from the backend's real
/// `offer_price`, never from a computed or assumed "was" price.
///
/// Same look as [StatusBadge]'s notice tone (tint fill, ink-dark word, no
/// colour-only meaning), tightened so it fits over a compact card's image.
/// The percentage is left out when it rounds to 0.
class OfferTag extends StatelessWidget {
  const OfferTag({super.key, required this.product});

  final ProductModel product;

  /// "Offer −12%", or just "Offer" for a saving under half a percent.
  static String labelFor(ProductModel product) {
    final percent = product.offerPercentOff;
    return percent > 0 ? 'Offer −$percent%' : 'Offer';
  }

  @override
  Widget build(BuildContext context) {
    final percent = product.offerPercentOff;
    return Semantics(
      label: percent > 0 ? 'Offer, $percent percent off' : 'Offer',
      excludeSemantics: true,
      child: DecoratedBox(
        key: const Key('offer-tag'),
        decoration: const BoxDecoration(color: BlynkColors.noticeTint, borderRadius: BlynkRadius.full),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s8, vertical: BlynkSpace.s4 / 2),
          child: Text(
            labelFor(product),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.caption.copyWith(color: BlynkColors.notice, fontWeight: FontWeight.w700),
          ),
        ),
      ),
    );
  }
}
