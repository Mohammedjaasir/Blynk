import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_format.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../design/tokens.dart';
import 'combo_card.dart';
import 'money_text.dart';
import 'quantity_stepper.dart';

/// One combo pack line in the cart (owner, 2026-10-09): its own line, apart
/// from any product line - the combo's name, the products in one pack listed
/// underneath in small text, the line total (combo price × packs) with
/// "2 × LKR 900" under it, the saving on these packs, and a - n + stepper.
/// Same card recipe as [CartProductCard]; every number is the
/// [CartComboLine]'s own snapshot, and the server re-prices it at checkout.
class CartComboCard extends StatelessWidget {
  const CartComboCard({super.key, required this.line});

  final CartComboLine line;

  static const double _thumb = 72;

  @override
  Widget build(BuildContext context) {
    final combo = line.combo;
    final cart = context.read<CartProvider>();
    return Container(
      key: ValueKey('cart-combo/${combo.id}'),
      decoration: const BoxDecoration(
        color: BlynkCardProduct.surface,
        borderRadius: BlynkCardProduct.radius,
        boxShadow: BlynkCardProduct.elevation,
      ),
      padding: const EdgeInsets.all(BlynkSpace.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            button: true,
            label: 'View ${combo.name}',
            excludeSemantics: true,
            child: InkWell(
              borderRadius: BlynkWell.radius,
              onTap: () => showComboSheet(context, combo),
              child: SizedBox(
                width: _thumb,
                height: _thumb,
                child: ComboThumb(combo: combo),
              ),
            ),
          ),
          const SizedBox(width: BlynkSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(BlynkIcons.combo, size: BlynkIcons.xs, color: BlynkColors.ink2),
                              const SizedBox(width: BlynkSpace.s4),
                              Text('Combo pack', style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
                            ],
                          ),
                          Text(
                            combo.name,
                            maxLines: BlynkType.productNameMaxLines,
                            overflow: BlynkType.productNameOverflow,
                            style: BlynkType.productName,
                          ),
                          const SizedBox(height: BlynkSpace.s4 - 2),
                          for (final item in combo.items)
                            Text(
                              item.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                            ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Remove ${combo.name}',
                      onPressed: () => cart.removeCombo(combo.id),
                      icon: const Icon(Icons.delete_outline, size: BlynkIcons.sm),
                      color: BlynkColors.ink2,
                      constraints: const BoxConstraints(
                        minWidth: BlynkControl.minHeight,
                        minHeight: BlynkControl.minHeight,
                      ),
                      padding: EdgeInsets.zero,
                    ),
                  ],
                ),
                const SizedBox(height: BlynkSpace.s8),
                SizedBox(
                  width: double.infinity,
                  child: Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: BlynkSpace.s8,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          MoneyText(
                            line.lineTotal,
                            key: const Key('cart-combo-total'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: BlynkType.price,
                          ),
                          if (line.quantity > 1)
                            Text(
                              '${line.quantity} × ${formatLkr(combo.price)}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                            ),
                          // Behind the Show 'Save LKR' switch (owner, 2026-10-10).
                          if (combo.hasSaving && watchShowOfferSavings(context))
                            Text(
                              'You save ${formatLkr(line.savingTotal)}',
                              key: const Key('cart-combo-saving'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: BlynkText.caption.copyWith(color: BlynkColors.positiveInk),
                            ),
                        ],
                      ),
                      QuantityStepper(
                        quantity: line.quantity,
                        productName: combo.name,
                        max: kComboQuantityMax,
                        onIncrement: combo.isAvailable ? () => cart.addCombo(combo) : null,
                        onDecrement: () => cart.decrementCombo(combo),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
