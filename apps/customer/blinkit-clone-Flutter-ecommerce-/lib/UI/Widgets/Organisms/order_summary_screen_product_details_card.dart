import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../Atoms/card_product_order_summary.dart';
import '../../../design/tokens.dart';

/// Section 3 of the order detail: what was ordered, straight from the
/// order's item snapshots (name, unit, quantity and line subtotal as the
/// backend recorded them at placement).
class OrderSummaryProductsDetails extends StatelessWidget {
  const OrderSummaryProductsDetails({
    super.key,
    required this.order,
  });

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final itemCount = order.items.fold<int>(0, (sum, i) => sum + i.quantity);

    return Container(
      key: const Key('order-items'),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      // The app's one card recipe, the same one the bill card uses.
      decoration: appCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Items', style: BlynkText.sectionHeader)),
              Text(
                '$itemCount ${itemCount == 1 ? 'item' : 'items'}',
                style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
              ),
            ],
          ),
          const SizedBox(height: BlynkSpace.s8),
          // Combo packs (owner, 2026-10-09): each pack's name, packs and
          // price, with its products grouped under it; then loose items.
          for (final combo in order.combos) ...[
            _OrderComboHeader(combo: combo),
            Padding(
              padding: const EdgeInsets.only(left: BlynkSpace.s12),
              child: Column(
                children: [
                  for (final item in order.itemsOfCombo(combo.id)) OrderSummaryProductCard(item: item),
                ],
              ),
            ),
          ],
          for (final item in order.looseItems) OrderSummaryProductCard(item: item),
        ],
      ),
    );
  }
}

/// The heading of one combo pack in an order: its name, how many packs and
/// what they cost, as the backend recorded them.
class _OrderComboHeader extends StatelessWidget {
  const _OrderComboHeader({required this.combo});

  final OrderComboModel combo;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: ValueKey('order-combo/${combo.id}'),
      padding: const EdgeInsets.only(top: BlynkSpace.s8),
      child: Row(
        children: [
          const Icon(BlynkIcons.combo, size: BlynkIcons.sm, color: BlynkColors.ink2),
          const SizedBox(width: BlynkSpace.s8),
          Expanded(
            child: Text(
              combo.quantity > 1 ? '${combo.name} × ${combo.quantity}' : combo.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: BlynkText.rowLabel,
            ),
          ),
          const SizedBox(width: BlynkSpace.s8),
          Text(formatLkr(combo.subtotal), style: BlynkType.price),
        ],
      ),
    );
  }
}
