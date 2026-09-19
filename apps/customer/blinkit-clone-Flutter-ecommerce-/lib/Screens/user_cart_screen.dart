import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/cart.provider.dart';
import '../UI/Widgets/Atoms/card_product_cart_screen.dart';
import '../UI/Widgets/Organisms/card_cart_prices_detail.dart';
import '../UI/Widgets/Organisms/empty_cart_view.dart';
import '../app_design.dart';
import '../constants.dart';

/// The cart: real CartProvider lines, an order summary and one action,
/// Proceed to Checkout. The global floating cart bar is deliberately not
/// shown here - it would only link back to this screen.
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
      backgroundColor: AppSurfaces.subtle,
      appBar: AppBar(
        title: const Text('Cart'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 250),
        child: isEmpty
            ? const EmptyCartView(key: ValueKey('empty'))
            : (wide
                ? const _WideCart(key: ValueKey('wide'))
                : const _NarrowCart(key: ValueKey('narrow'))),
      ),
      bottomNavigationBar:
          isEmpty || wide ? null : const _CheckoutBar(),
    );
  }
}

class _CartHeader extends StatelessWidget {
  const _CartHeader();

  @override
  Widget build(BuildContext context) {
    final count = context.select<CartProvider, int>((c) => c.itemCount);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Semantics(
            header: true,
            child: const Text(
              'Your Cart',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: AppTextColors.primary,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            '$count ${count == 1 ? 'item' : 'items'}',
            style: const TextStyle(
              fontSize: 14,
              color: AppTextColors.secondary,
            ),
          ),
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
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.lg,
                0,
              ),
              sliver: SliverToBoxAdapter(child: _CartHeader()),
            ),
            SliverPadding(
              padding: EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              sliver: _CartLineList(),
            ),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.xs,
                AppSpacing.lg,
                AppSpacing.xxl,
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
                      AppSpacing.xxxl,
                      AppSpacing.xxl,
                      AppSpacing.md,
                      0,
                    ),
                    sliver: SliverToBoxAdapter(child: _CartHeader()),
                  ),
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      AppSpacing.xxxl,
                      0,
                      AppSpacing.md,
                      AppSpacing.xxl,
                    ),
                    sliver: _CartLineList(),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 380,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.xxl + 38,
                  AppSpacing.xxxl,
                  AppSpacing.xxl,
                ),
                child: CartPriceDetailWidget(
                  footer: SizedBox(
                    height: 52,
                    child: ElevatedButton(
                      onPressed: () => CartScreen.proceedToCheckout(context),
                      child: const Text('Proceed to Checkout'),
                    ),
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

class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar();

  @override
  Widget build(BuildContext context) {
    final subtotal = context.select<CartProvider, double>((c) => c.subtotal);
    final total = subtotal + kDeliveryFeeEstimate;

    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppSurfaces.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.md,
            AppSpacing.lg,
            AppSpacing.md,
          ),
          child: Row(
            children: [
              Semantics(
                label: 'Total $appCurrencySybmbol ${total.toStringAsFixed(0)}',
                excludeSemantics: true,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$appCurrencySybmbol ${total.toStringAsFixed(0)}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppTextColors.primary,
                      ),
                    ),
                    const Text(
                      'TOTAL',
                      style: TextStyle(
                        fontSize: 11,
                        letterSpacing: 0.6,
                        fontWeight: FontWeight.w700,
                        color: AppTextColors.secondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.lg),
              Expanded(
                child: SizedBox(
                  height: 52,
                  child: ElevatedButton(
                    onPressed: () => CartScreen.proceedToCheckout(context),
                    child: const FittedBox(
                      child: Text('Proceed to Checkout'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
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
  static const _removeDuration = Duration(milliseconds: 260);

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
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: child,
          ),
        ),
      ),
    );
  }
}
