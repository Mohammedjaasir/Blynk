import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../design/tokens.dart';

/// A rupee amount, formatted only by [formatLkr] (never re-implemented here)
/// and typed only by [BlynkType.price] — the two places money may be decided.
/// Blynk prices are LKR; there is no dollar path anywhere in the app and a
/// guard keeps it that way.
///
/// [compact] (the default) hides the `.00` on a whole amount and shows cents
/// otherwise, exactly as [formatLkr] does; `compact: false` keeps `.00` for
/// aligned bill columns. Paise are never rounded away either way.
class MoneyText extends StatelessWidget {
  const MoneyText(
    this.amount, {
    super.key,
    this.style,
    this.compact = true,
    this.semanticsLabel,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });

  final double amount;
  final TextStyle? style;
  final bool compact;

  /// Overrides the spoken label; defaults to the formatted amount.
  final String? semanticsLabel;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    final text = formatLkr(amount, alwaysShowCents: !compact);
    return Semantics(
      label: semanticsLabel ?? text,
      excludeSemantics: true,
      child: Text(
        text,
        textAlign: textAlign,
        maxLines: maxLines,
        overflow: overflow,
        style: BlynkType.price.merge(style),
      ),
    );
  }
}

/// A struck-through regular price, designed to sit next to [MoneyText]:
/// [BlynkType.priceStruck] ([BlynkColors.strike] with a line-through), at the
/// same [amount] formatting rules as [MoneyText].
///
/// **Only ever for a real offer.** Plan §3 rejected the reference mock's
/// struck prices because there was no data source for them; since product
/// offers (owner, 2026-10-09) the backend sends a real `offer_price`, so the
/// one honest use is a product's regular `selling_price` beside its offer
/// price while [ProductModel.isOnOffer]. A guard pins the callers to the
/// product card and the product detail screen; never strike a "was" price
/// computed or assumed on the client.
class StruckPrice extends StatelessWidget {
  const StruckPrice(this.amount, {super.key, this.style, this.compact = true, this.maxLines, this.overflow});

  final double amount;
  final TextStyle? style;
  final bool compact;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    final text = formatLkr(amount, alwaysShowCents: !compact);
    return Semantics(
      label: 'was $text',
      excludeSemantics: true,
      child: Text(
        text,
        maxLines: maxLines,
        overflow: overflow,
        style: BlynkType.priceStruck.merge(style),
      ),
    );
  }
}
