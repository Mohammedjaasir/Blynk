import 'package:flutter/widgets.dart';

import '../../../Models/order_format.dart';
import '../../../design/motion.dart';
import 'money_text.dart';

/// A money amount that counts to its new value instead of jumping to it.
///
/// The cart bar's total is the one number a customer watches change as they
/// tap. Cutting from `LKR 936` to `LKR 1,541` reads as a replacement; counting
/// up reads as the thing they just did having an effect. That is the whole
/// job of this widget.
///
/// It renders through [MoneyText], so formatting, currency, cents rules and
/// semantics stay in one place - this adds motion and nothing else. The
/// semantics label is always the *final* amount, so a screen reader is never
/// read an in-between number.
///
/// Reduced motion: the amount snaps. The tween still runs at zero length so
/// the tree is identical either way.
class BlynkAnimatedNumber extends StatelessWidget {
  const BlynkAnimatedNumber(
    this.amount, {
    super.key,
    this.style,
    // Mirrors MoneyText's own default exactly: this atom adds motion to a
    // number and must never change how it is written.
    this.compact = true,
    this.textAlign,
  });

  final double amount;
  final TextStyle? style;
  final bool compact;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: amount),
      duration: BlynkMotion.resolve(context, BlynkMotion.entrance),
      curve: BlynkMotion.easeOut,
      builder: (context, value, _) => MoneyText(
        // In-between values are almost never whole, and compact money shows
        // cents whenever there are any - so a count from LKR 258 to LKR 516
        // flickered through "LKR 300.60". Count in whole rupees unless the
        // amount it lands on has cents itself.
        amount == amount.roundToDouble() ? value.roundToDouble() : value,
        style: style,
        compact: compact,
        textAlign: textAlign,
        maxLines: 1,
        // The announced value is where the number is going, not where it is.
        semanticsLabel: formatLkr(amount, alwaysShowCents: !compact),
      ),
    );
  }
}
