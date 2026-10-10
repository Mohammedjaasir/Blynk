import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_model.dart';
import '../../../Models/usuals_model.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/rewards.provider.dart';
import '../../../Services/reorder.dart';
import '../../../design/tokens.dart';
import '../Atoms/section_header.dart';
import '../Atoms/snackbar_helper.dart';
import 'product_rail.dart';

/// "Your usuals" on Home (owner, 2026-10-10): the products of the signed-in
/// customer's most recent order that was not cancelled (`GET /me/usuals`),
/// as the same product cards every Home rail uses, with one "Add all" that
/// puts every product on sale now in the cart at its last quantity.
///
/// Nothing at all for a guest, while unknown, on a failure, or when there is
/// no past order. It asks again when the customer signs in or out and after
/// an order is placed ([OrderProvider.lastPlacedOrder]); Home's pull to
/// refresh asks too.
class HomeUsualsRow extends StatefulWidget {
  const HomeUsualsRow({super.key});

  static const Key rowKey = Key('home-usuals-row');
  static const Key addAllKey = Key('home-usuals-add-all');

  @override
  State<HomeUsualsRow> createState() => _HomeUsualsRowState();
}

class _HomeUsualsRowState extends State<HomeUsualsRow> {
  bool? _askedSignedIn;
  OrderModel? _askedAfterOrder;

  void _askIfNeeded(bool signedIn, OrderModel? lastPlaced) {
    if (_askedSignedIn == signedIn && identical(_askedAfterOrder, lastPlaced)) return;
    _askedSignedIn = signedIn;
    _askedAfterOrder = lastPlaced;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<RewardsProvider?>()?.loadUsuals(signedIn: signedIn);
    });
  }

  void _addAll() {
    final usuals = context.read<RewardsProvider?>()?.usuals;
    if (usuals == null) return;
    final result = addUsualsInto(usuals: usuals, cart: context.read<CartProvider>());
    showBlynkSnackBar(
      context: context,
      message: usualsAddedMessage(result),
      tone: result.addedUnits > 0 ? SnackTone.success : SnackTone.info,
    );
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false);
    final lastPlaced = context.select<OrderProvider?, OrderModel?>((o) => o?.lastPlacedOrder);
    _askIfNeeded(signedIn, lastPlaced);
    final usuals = context.select<RewardsProvider?, UsualsData?>((r) => r?.usuals);
    if (!signedIn || usuals == null || usuals.isEmpty) return const SizedBox.shrink();
    final canAdd = usuals.available.isNotEmpty;

    return Column(
      key: HomeUsualsRow.rowKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        BlynkSectionHeader(
          title: 'Your usuals',
          actionLabel: canAdd ? 'Add all' : null,
          actionKey: HomeUsualsRow.addAllKey,
          onAction: canAdd ? _addAll : null,
          padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s8, BlynkSpace.s8, BlynkSpace.s4),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, 0, BlynkSpace.s16, BlynkSpace.s12),
          child: Text(
            usuals.orderNumber == null ? 'From your last order' : 'From your last order, ${usuals.orderNumber}',
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
        ),
        ProductRail(
          key: const ValueKey('home-usuals-rail'),
          products: [for (final i in usuals.items) i.product],
          heroes: false,
        ),
        const SizedBox(height: BlynkSpace.s16),
      ],
    );
  }
}
