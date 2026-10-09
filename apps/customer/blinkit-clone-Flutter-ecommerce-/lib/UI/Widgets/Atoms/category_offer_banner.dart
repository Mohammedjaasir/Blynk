import 'package:flutter/material.dart';

import '../../../Models/category_model.dart';
import '../../../Models/order_format.dart';
import '../../../design/tokens.dart';

/// "10% off everything here" over a category's products while the category
/// has an offer running (owner, 2026-10-09), with "until 12 Oct, 11:59 PM"
/// when the offer has an end date. Drawn only for
/// [CategoryModel.isOfferActive] - the backend's own `offer_percent` - and
/// nothing at all otherwise. The product prices under it already carry the
/// offer, so this is wording only.
///
/// The notice tone [OfferTag] uses (tint fill, ink-dark words), as a slim
/// full-width strip so it reads as the page's header, not a product's tag.
class CategoryOfferBanner extends StatelessWidget {
  const CategoryOfferBanner({super.key, required this.category});

  final CategoryModel category;

  static String labelFor(CategoryModel category) {
    final ends = category.offerEndsAt;
    final base = '${category.offerPercentLabel} off everything here';
    return ends == null ? base : '$base until ${formatOrderTime(ends)}';
  }

  @override
  Widget build(BuildContext context) {
    if (!category.isOfferActive) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s8, BlynkSpace.s8, BlynkSpace.s8, 0),
      child: DecoratedBox(
        key: const Key('category-offer-banner'),
        decoration: const BoxDecoration(color: BlynkColors.noticeTint, borderRadius: BlynkRadius.mdAll),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
          child: Row(
            children: [
              const Icon(BlynkIcons.offer, size: BlynkIcons.sm, color: BlynkColors.notice),
              const SizedBox(width: BlynkSpace.s8),
              Expanded(
                child: Text(
                  labelFor(category),
                  style: BlynkText.caption.copyWith(color: BlynkColors.notice, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
