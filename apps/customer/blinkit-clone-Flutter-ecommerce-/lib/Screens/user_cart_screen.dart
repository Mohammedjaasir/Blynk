import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/cart.provider.dart';
import '../Services/Providers/store_info.provider.dart';
import '../UI/Widgets/Atoms/adaptive_sheet.dart';
import '../UI/Widgets/Atoms/birthday_offer_banner.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/card_combo_cart.dart';
import '../UI/Widgets/Atoms/card_product_cart_screen.dart';
import '../UI/Widgets/Atoms/connectivity_banner.dart';
import '../UI/Widgets/Organisms/card_cart_prices_detail.dart';
import '../UI/Widgets/Organisms/empty_cart_view.dart';
import '../design/tokens.dart';
import '../Models/order_format.dart';
import '../UI/Widgets/Atoms/money_text.dart';

/// The cart: real CartProvider lines, an order summary and one action,
/// Proceed to checkout. The global floating cart bar is deliberately not
/// shown here - it would only link back to this screen.
///
/// 2026-09 redesign (W4): the header carries the real item count and the
/// clear-cart action, the lines use the shared image well, and the single
/// yellow action on this screen is the sticky Checkout CTA. There is no
/// savings banner, discount row or promo-code field: the backend returns no
/// discount of any kind, so rendering one would be fabricated commerce data.
class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  /// Side-by-side items and summary from here up.
  static const double wideBreakpoint = 900;

  static void proceedToCheckout(BuildContext context) =>
      Navigator.of(context).pushNamed('/checkout');

  @override
  Widget build(BuildContext context) {
    final isEmpty = context.select<CartProvider, bool>((c) => c.isEmpty);
    final wide = MediaQuery.sizeOf(context).width >= wideBreakpoint;

    return Scaffold(
      backgroundColor: BlynkColors.well,
      appBar: AppBar(
        title: const Text('Your Cart'),
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.paper,
        actions: [if (!isEmpty) const _ClearCartAction()],
      ),
      body: Column(
        children: [
          // The cart is saved on the device, so it stays usable offline.
          ConnectivityBanner(hasContent: !isEmpty),
          Expanded(
            child: AnimatedSwitcher(
              duration: BlynkMotion.resolve(context, BlynkMotion.slow),
              child: isEmpty
                  ? const EmptyCartView(key: ValueKey('empty'))
                  : (wide
                      ? const _WideCart(key: ValueKey('wide'))
                      : const _NarrowCart(key: ValueKey('narrow'))),
            ),
          ),
        ],
      ),
      bottomNavigationBar: isEmpty || wide
          ? null
          // Keyed so a test can measure the bar's RENDERED height. A
          // bottomNavigationBar is handed the whole remaining viewport as its
          // budget, and anything that fills a bounded height (a
          // `Container(alignment:)` such as BlynkButton.cta's, or ContentFrame)
          // will take all of it and leave the body zero-high *without
          // throwing* - so finders silently return nothing and tests can go
          // green over a blank screen. See W4 report section 8.1.
          : const _CheckoutBar(key: Key('cart-checkout-bar')),
    );
  }
}

/// Empties the cart, after asking. [CartProvider.clear] is a real capability
/// the app already uses (logout, and after an order is placed), so this is a
/// live control rather than a decorative trash icon - but it is destructive
/// and has no undo, so it confirms first through the shared adaptive surface.
class _ClearCartAction extends StatelessWidget {
  const _ClearCartAction();

  Future<void> _confirm(BuildContext context) async {
    final cart = context.read<CartProvider>();
    final cleared = await showAdaptiveSheet<bool>(
      context,
      semanticLabel: 'Clear cart',
      builder: (_) => const _ClearCartSheet(),
    );
    if (cleared == true) cart.clear();
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      key: const Key('clear-cart'),
      tooltip: 'Clear cart',
      onPressed: () => _confirm(context),
      icon: const Icon(Icons.delete_outline),
      color: BlynkColors.ink2,
      constraints: const BoxConstraints(
        minWidth: BlynkControl.minHeight,
        minHeight: BlynkControl.minHeight,
      ),
    );
  }
}

class _ClearCartSheet extends StatelessWidget {
  const _ClearCartSheet();

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        BlynkSpace.s24,
        BlynkSpace.s8,
        BlynkSpace.s24,
        BlynkSpace.s24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Clear cart?', style: BlynkText.heading),
          const SizedBox(height: BlynkSpace.s8),
          Text(
            'Every item is removed. You can add them again from the shop.',
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
          const SizedBox(height: BlynkSpace.s24),
          BlynkButtonPair(
            secondary: BlynkButton.secondary(
              label: 'Cancel',
              onPressed: () => Navigator.of(context).pop(false),
            ),
            primary: BlynkButton.destructive(
              key: const Key('clear-cart-confirm'),
              label: 'Clear cart',
              onPressed: () => Navigator.of(context).pop(true),
            ),
          ),
        ],
      ),
    );
  }
}

/// The real number of items in the cart, from [CartProvider]. It sits under
/// the screen title rather than beside it so a large system font grows the
/// line instead of squeezing the title.
class _CartHeader extends StatelessWidget {
  const _CartHeader();

  @override
  Widget build(BuildContext context) {
    final count = context.select<CartProvider, int>((c) => c.itemCount);

    return Padding(
      padding: const EdgeInsets.only(bottom: BlynkSpace.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '$count ${count == 1 ? 'item' : 'items'}',
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
          // The birthday gift (owner, 2026-10-09), when it applies.
          const BirthdayOfferBanner(padding: EdgeInsets.only(top: BlynkSpace.s12)),
        ],
      ),
    );
  }
}

/// Phones and tablets: one column, summary under the items, CTA pinned in
/// the Scaffold's bottom bar so it never covers the last row.
class _NarrowCart extends StatelessWidget {
  const _NarrowCart({super.key});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: const CustomScrollView(
          slivers: [
            SliverPadding(
              padding: EdgeInsets.fromLTRB(
                BlynkSpace.s16,
                BlynkSpace.s16,
                BlynkSpace.s16,
                0,
              ),
              sliver: SliverToBoxAdapter(child: _CartHeader()),
            ),
            SliverPadding(
              padding: EdgeInsets.symmetric(horizontal: BlynkSpace.s16),
              sliver: SliverMainAxisGroup(slivers: [_CartComboList(), _CartLineList()]),
            ),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(
                BlynkSpace.s16,
                BlynkSpace.s4,
                BlynkSpace.s16,
                BlynkSpace.s24,
              ),
              sliver: SliverToBoxAdapter(child: CartPriceDetailWidget()),
            ),
          ],
        ),
      ),
    );
  }
}

/// Desktop: items on the left, a summary column with the CTA on the right,
/// inside a capped frame so rows don't stretch edge to edge.
class _WideCart extends StatelessWidget {
  const _WideCart({super.key});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1160),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Expanded(
              child: CustomScrollView(
                slivers: [
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      BlynkSpace.s32,
                      BlynkSpace.s24,
                      BlynkSpace.s12,
                      0,
                    ),
                    sliver: SliverToBoxAdapter(child: _CartHeader()),
                  ),
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      BlynkSpace.s32,
                      0,
                      BlynkSpace.s12,
                      BlynkSpace.s24,
                    ),
                    sliver: SliverMainAxisGroup(slivers: [_CartComboList(), _CartLineList()]),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 380,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  BlynkSpace.s12,
                  BlynkSpace.s24,
                  BlynkSpace.s32,
                  BlynkSpace.s24,
                ),
                child: CartPriceDetailWidget(
                  // No fixed height: the CTA's own floor grows with a large text size.
                  footer: BlynkButton.cta(
                    label: 'Proceed to checkout',
                    onPressed: () => CartScreen.proceedToCheckout(context),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The sticky checkout bar: the estimate, then the screen's one yellow action
/// full width under it. The number comes from [cartEstimateTotal], the single
/// place the subtotal and the flat fee are combined.
///
/// The CTA sits on its own row rather than beside the total on purpose, and
/// not only because the mock's action is full-width: `BlynkButton.cta` paints
/// a `Container` with an `alignment`, which **expands to fill a bounded height**.
/// A bottom bar is handed the whole remaining viewport as its height budget, so
/// putting the CTA in a `Row` there made it ~836 dp tall and left the cart's
/// body zero height. A `Column(mainAxisSize: min)` hands its children an
/// unbounded main axis, so the CTA sizes to its own content instead.
class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar({super.key});

  @override
  Widget build(BuildContext context) {
    final deliveryFee = watchCheckoutDeliveryFee(context);
    final total = context.select<CartProvider, double>(
      (cart) => cartEstimateTotal(cart, deliveryFee),
    );

    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BlynkColors.paper,
        border: Border(top: BorderSide(color: BlynkColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            BlynkSpace.s16,
            BlynkSpace.s12,
            BlynkSpace.s16,
            BlynkSpace.s12,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                label: 'Total ${formatLkr(total)}',
                excludeSemantics: true,
                child: Row(
                  children: [
                    Text(
                      'Total',
                      style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                    ),
                    const SizedBox(width: BlynkSpace.s12),
                    Expanded(
                      child: MoneyText(
                        total,
                        style: BlynkType.price,
                        textAlign: TextAlign.end,
                        maxLines: 1,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: BlynkSpace.s12),
              BlynkButton.cta(
                label: 'Proceed to checkout',
                onPressed: () => CartScreen.proceedToCheckout(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Combo pack lines (owner, 2026-10-09), above the product lines: each is
/// its own line with the pack's products listed under its name. Removing one
/// is immediate (the product lines below keep their own animation).
class _CartComboList extends StatelessWidget {
  const _CartComboList();

  @override
  Widget build(BuildContext context) {
    final combos = context.watch<CartProvider>().comboLines;
    return SliverList.list(
      children: [
        for (final line in combos)
          Padding(
            key: ValueKey('cart-combo-line/${line.combo.id}'),
            padding: const EdgeInsets.only(bottom: BlynkSpace.s12),
            child: CartComboCard(line: line),
          ),
      ],
    );
  }
}

/// The cart lines as an animated sliver list. Lines removed from
/// CartProvider (trash, or − at quantity 1) slide and fade out while the
/// rest close the gap; nothing else on the screen animates.
class _CartLineList extends StatefulWidget {
  const _CartLineList();

  @override
  State<_CartLineList> createState() => _CartLineListState();
}

class _CartLineListState extends State<_CartLineList> {
  static const _removeDuration = BlynkMotion.slow;

  final _listKey = GlobalKey<SliverAnimatedListState>();
  CartProvider? _cart;
  List<String> _ids = [];
  Map<String, CartLine> _lastLines = {};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final cart = context.read<CartProvider>();
    if (!identical(cart, _cart)) {
      _cart?.removeListener(_sync);
      _cart = cart;
      _ids = cart.lines.map((l) => l.product.id).toList();
      _lastLines = {for (final l in cart.lines) l.product.id: l};
      cart.addListener(_sync);
    }
  }

  @override
  void dispose() {
    _cart?.removeListener(_sync);
    super.dispose();
  }

  void _sync() {
    final lines = _cart!.lines;
    final nextIds = lines.map((l) => l.product.id).toList();
    final list = _listKey.currentState;

    for (var i = _ids.length - 1; i >= 0; i--) {
      final id = _ids[i];
      if (nextIds.contains(id)) continue;
      final snapshot = _lastLines[id]!;
      _ids.removeAt(i);
      list?.removeItem(
        i,
        (context, animation) => _AnimatedLine(
          animation: animation,
          child: CartProductCard(line: snapshot, interactive: false),
        ),
        duration: _removeDuration,
      );
    }
    for (var i = 0; i < nextIds.length; i++) {
      if (_ids.contains(nextIds[i])) continue;
      _ids.insert(i, nextIds[i]);
      list?.insertItem(i);
    }

    _lastLines = {for (final l in lines) l.product.id: l};
    // Quantity changes rebuild the rows in place.
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return SliverAnimatedList(
      key: _listKey,
      initialItemCount: _ids.length,
      itemBuilder: (context, index, animation) {
        final line = _lastLines[_ids[index]]!;
        return _AnimatedLine(
          animation: animation,
          child: CartProductCard(key: ValueKey(line.product.id), line: line),
        );
      },
    );
  }
}

class _AnimatedLine extends StatelessWidget {
  const _AnimatedLine({required this.animation, required this.child});

  final Animation<double> animation;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final curved = CurvedAnimation(
      parent: animation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    return SizeTransition(
      sizeFactor: curved,
      child: FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0.12, 0),
            end: Offset.zero,
          ).animate(curved),
          child: Padding(
            padding: const EdgeInsets.only(bottom: BlynkSpace.s12),
            child: child,
          ),
        ),
      ),
    );
  }
}
