import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_format.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../app_design.dart' show appButtonTextScale, kStackButtonsAboveTextScale;
import '../../../design/tokens.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/blynk_animated_number.dart';

/// The floating cart bar: ink, 56 dp, raised. The left is two lines — the
/// item count above, quiet, and the items total below, loud — and the right
/// is the yellow "View cart" pill with its forward arrow. The whole bar
/// opens the cart. Every number comes from [CartProvider].
///
/// The total is the **items** total only: delivery is worked out at
/// checkout, so no fee, saving or discount is claimed here, and the word
/// "Total" is not used for a figure that is not the final one.
///
/// It is absent from the tree while the cart is empty, and slides in and out
/// over [BlynkMotion.emphasized] (instantly under reduced motion). Its height is
/// part of its own layout, so placed in a column it pushes the content up
/// instead of covering it; placed in a Stack it simply floats.
class CartBar extends StatelessWidget {
  const CartBar({super.key, this.bottomSafeArea = false});

  /// Adds the device's bottom inset under the bar. Pushed routes need it; the
  /// shell sits the bar above the nav, which already owns the inset.
  final bool bottomSafeArea;

  static const double height = 56;
  static const double sideMargin = 12;
  static const double maxWidth = 720;

  @override
  Widget build(BuildContext context) {
    final count = context.select<CartProvider, int>((c) => c.itemCount);
    final total = context.select<CartProvider, double>((c) => c.subtotal);
    final hasItems = count > 0;

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: hasItems ? 1 : 0),
      duration: BlynkMotion.resolve(context, BlynkMotion.emphasized),
      curve: hasItems ? BlynkMotion.easeOut : BlynkMotion.easeIn,
      builder: (context, t, _) {
        if (t == 0) return const SizedBox.shrink();
        return ClipRect(
          child: Align(
            alignment: Alignment.bottomCenter,
            heightFactor: t,
            child: Opacity(
              opacity: t,
              child: _Bar(
                count: count,
                total: total,
                bottomInset: bottomSafeArea ? MediaQuery.paddingOf(context).bottom : 0,
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Bar extends StatefulWidget {
  const _Bar({required this.count, required this.total, required this.bottomInset});

  final int count;
  final double total;
  final double bottomInset;

  @override
  State<_Bar> createState() => _BarState();
}

class _BarState extends State<_Bar> {
  bool _focused = false;

  int get count => widget.count;
  double get total => widget.total;
  double get bottomInset => widget.bottomInset;

  void _openCart(BuildContext context) => Navigator.of(context).pushNamed('/cart');

  @override
  Widget build(BuildContext context) {
    final items = '$count ${count == 1 ? 'item' : 'items'}';
    // A big system font would squeeze the pill and the total into one line,
    // so the pill drops below the total instead.
    final stacked = appButtonTextScale(context) > kStackButtonsAboveTextScale;

    // Two lines, not one run of equal-weight text. The total is the number
    // this bar exists to show, so it carries the price ramp in full-contrast
    // paper; the count is the supporting line, one step down the size ramp
    // and one step down the contrast ramp (`onInkMuted`, still 9.09:1). A
    // single line gave "1 item" and "Rs. 624" identical weight, which is
    // what made the bar read flat.
    final left = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          items,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: BlynkText.caption.copyWith(color: BlynkColors.onInkMuted),
        ),
        // Counts to the new total rather than cutting to it: the one number
        // the customer watches as they tap, shown to be the effect of the tap.
        BlynkAnimatedNumber(
          total,
          style: BlynkText.price.copyWith(color: BlynkColors.onInk),
        ),
      ],
    );
    // The whole bar is the one keyboard stop; the pill stays a visual (and
    // pointer) target so Tab does not stop twice for one action.
    Widget pill(bool expand) => ExcludeFocus(
          child: BlynkButton.primary(
            label: 'View cart',
            // The bar navigates forward; the arrow says so without a word of
            // extra copy. `Icons.arrow_forward`, never a "→" character.
            trailingIcon: Icons.arrow_forward,
            compact: true,
            expand: expand,
            onPressed: () => _openCart(context),
          ),
        );

    return Padding(
      padding: EdgeInsets.fromLTRB(
        CartBar.sideMargin,
        BlynkSpace.s8,
        CartBar.sideMargin,
        BlynkSpace.s12 + bottomInset,
      ),
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: CartBar.maxWidth),
          child: Semantics(
            container: true,
            button: true,
            label: 'Cart, $items, ${formatLkr(total)}. View cart',
            onTap: () => _openCart(context),
            excludeSemantics: true,
            child: DecoratedBox(
              decoration: const BoxDecoration(
                color: BlynkColors.ink,
                borderRadius: BlynkRadius.mdAll,
                boxShadow: BlynkElevation.raised,
              ),
              child: DecoratedBox(
                key: const ValueKey('cart-bar-focus'),
                position: DecorationPosition.foreground,
                // A 2 dp paper ring inside the ink bar (16:1 against it);
                // yellow stays reserved for the pill's fill.
                decoration: BoxDecoration(
                  borderRadius: BlynkRadius.mdAll,
                  border: _focused ? Border.all(color: BlynkColors.paper, width: 2) : null,
                ),
                child: Material(
                  type: MaterialType.transparency,
                  borderRadius: BlynkRadius.mdAll,
                  child: InkWell(
                    borderRadius: BlynkRadius.mdAll,
                    onTap: () => _openCart(context),
                    onFocusChange: (focused) => setState(() => _focused = focused),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: CartBar.height),
                      child: Padding(
                        padding: stacked
                            ? const EdgeInsets.all(BlynkSpace.s12)
                            : const EdgeInsets.fromLTRB(
                                BlynkSpace.s16,
                                BlynkSpace.s4,
                                BlynkSpace.s8,
                                BlynkSpace.s4,
                              ),
                        child: stacked
                            ? Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [left, const SizedBox(height: BlynkSpace.s8), pill(true)],
                              )
                            : Row(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Expanded(child: left),
                                  const SizedBox(width: BlynkSpace.s8),
                                  pill(false),
                                ],
                              ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
