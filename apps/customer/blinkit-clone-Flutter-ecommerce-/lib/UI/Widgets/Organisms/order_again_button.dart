import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/reorder.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/snackbar_helper.dart';

/// "Order again" (2026-09-30): puts a finished order's products back in the
/// cart at today's prices and opens the cart. [compact] is the orders-list
/// size; the order details page uses the full-width button.
class OrderAgainButton extends StatefulWidget {
  const OrderAgainButton({super.key, required this.order, this.compact = false});

  final OrderModel order;
  final bool compact;

  @override
  State<OrderAgainButton> createState() => _OrderAgainButtonState();
}

class _OrderAgainButtonState extends State<OrderAgainButton> {
  bool _busy = false;

  Future<void> _orderAgain() async {
    if (_busy) return;
    setState(() => _busy = true);
    final navigator = Navigator.of(context);
    final result = await reorderInto(
      order: widget.order,
      products: context.read<ProductProvider>(),
      cart: context.read<CartProvider>(),
    );
    if (!mounted) return;
    setState(() => _busy = false);

    if (result.offline) {
      showBlynkSnackBar(
        context: context,
        message: "You're offline. Nothing was added. Try again when you have signal.",
        tone: SnackTone.error,
      );
      return;
    }
    if (result.addedUnits == 0) {
      showBlynkSnackBar(
        context: context,
        message: "These items aren't available right now.",
        tone: SnackTone.error,
      );
      return;
    }

    final units = result.addedUnits == 1 ? '1 item' : '${result.addedUnits} items';
    final missing = result.unavailable;
    final message = missing.isEmpty
        ? 'Added $units to your cart.'
        : 'Added $units. Not available now: ${missing.join(', ')}.';
    showBlynkSnackBar(context: context, message: message, tone: SnackTone.success);
    await navigator.pushNamed('/cart');
  }

  @override
  Widget build(BuildContext context) {
    return BlynkButton.primary(
      key: const Key('order-again'),
      label: 'Order again',
      semanticLabel: 'Order again: add these items to your cart',
      onPressed: _busy ? null : _orderAgain,
      loading: _busy,
      expand: !widget.compact,
      compact: widget.compact,
    );
  }
}
