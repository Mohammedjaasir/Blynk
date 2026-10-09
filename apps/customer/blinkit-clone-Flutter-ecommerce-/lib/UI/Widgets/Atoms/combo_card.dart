import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/combo_model.dart';
import '../../../Models/order_format.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../design/tokens.dart';
import 'adaptive_sheet.dart';
import 'blynk_button.dart';
import 'blynk_press.dart';
import 'image_well.dart';
import 'money_text.dart';
import 'quantity_stepper.dart';

/// Combo packs (owner, 2026-10-09): a fixed bundle of products at one price
/// below what they cost on their own. Everything on these widgets is the
/// backend's ComboPublic (GET /combos) - the struck items total and the
/// "Save" tag only while [ComboModel.hasSaving], i.e. the backend's own
/// `items_total` and `saving` say the pack really is cheaper.
///
/// ```
/// ┌──────────────────────────────┐
/// │ [ image or item collage ]    │  ComboThumb, "Save LKR 120" on its corner
/// │ Breakfast pack               │  BlynkCardProduct.name, 2 lines
/// │ Bread, Eggs ×2, Milk         │  caption, ink2, 2 lines
/// │ LKR 900  LKR 1,020           │  MoneyText + StruckPrice (items total)
/// │                    [ ADD ]   │  ComboAddButton (ADD -> stepper / Sold out)
/// └──────────────────────────────┘
/// ```
class ComboCard extends StatelessWidget {
  const ComboCard({super.key, required this.combo});

  final ComboModel combo;

  static const double padding = BlynkCardProduct.padding;
  static const double gap = BlynkCardProduct.gap;
  static const double rowGap = BlynkSpace.s4;
  static const double controlSlot = BlynkControl.minHeight;

  /// The image is a little shallower than a product card's: a combo card is
  /// wider, and its items line needs the room.
  static const double imageRatio = 0.6;

  static const int summaryMaxLines = 2;

  static double _block(BuildContext context, TextStyle style, {int lines = 1}) {
    final scaler = MediaQuery.textScalerOf(context);
    final size = style.fontSize ?? BlynkText.minSize;
    final leading = style.height ?? 1.25;
    return (scaler.scale(size) * leading * lines).ceilToDouble();
  }

  static double nameBox(BuildContext context) =>
      _block(context, BlynkCardProduct.name, lines: BlynkCardProduct.nameMaxLines);

  static double summaryBox(BuildContext context) => _block(context, BlynkText.caption, lines: summaryMaxLines);

  static double priceBox(BuildContext context) => _block(context, BlynkCardProduct.price);

  /// Everything except the image, at the current text scale, so a rail that
  /// gives the card [heightFor] never overflows.
  static double chromeHeight(BuildContext context) =>
      padding * 2 + gap + nameBox(context) + rowGap + summaryBox(context) + rowGap + priceBox(context) + controlSlot;

  static double heightFor(BuildContext context, double width) =>
      (width - padding * 2) * imageRatio + chromeHeight(context);

  /// A combo card is half again as wide as a rail product card, so the items
  /// line has room - never wider than most of the screen, so the next card
  /// still peeks in.
  static double widthFor(double available, double productCardWidth) =>
      math.min(productCardWidth * 1.5, available * 0.8);

  @override
  Widget build(BuildContext context) {
    final soldOut = !combo.isAvailable;
    return RepaintBoundary(
      child: BlynkPress(
        child: InkWell(
          key: ValueKey('combo-card/${combo.id}'),
          borderRadius: BlynkCardProduct.radius,
          onTap: () => showComboSheet(context, combo),
          child: Container(
            decoration: const BoxDecoration(
              color: BlynkCardProduct.surface,
              borderRadius: BlynkCardProduct.radius,
              boxShadow: BlynkCardProduct.elevation,
            ),
            padding: const EdgeInsets.all(padding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ComboThumb(combo: combo, dimmed: soldOut),
                      if (combo.hasSaving)
                        Positioned(
                          top: BlynkSpace.s4,
                          left: BlynkSpace.s4,
                          right: BlynkSpace.s4,
                          child: Align(
                            alignment: Alignment.topLeft,
                            child: ComboSaveTag(combo: combo),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: gap),
                SizedBox(
                  height: nameBox(context),
                  child: Text(
                    combo.name,
                    maxLines: BlynkCardProduct.nameMaxLines,
                    overflow: TextOverflow.ellipsis,
                    style: BlynkCardProduct.name,
                  ),
                ),
                const SizedBox(height: rowGap),
                SizedBox(
                  height: summaryBox(context),
                  child: Text(
                    combo.itemsSummary,
                    key: const Key('combo-items-summary'),
                    maxLines: summaryMaxLines,
                    overflow: TextOverflow.ellipsis,
                    style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                  ),
                ),
                const SizedBox(height: rowGap),
                SizedBox(
                  height: priceBox(context),
                  child: ComboPriceLine(combo: combo, style: BlynkCardProduct.price),
                ),
                SizedBox(
                  height: controlSlot,
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: ComboAddButton(combo: combo),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The combo's own photo when the operator uploaded one; otherwise a collage
/// of up to four of its products' photos; otherwise (no photo anywhere) the
/// shared no-image well with the combo glyph. Every tile is a
/// [BlynkImageWell], so the fallback is the app's one fallback.
class ComboThumb extends StatelessWidget {
  const ComboThumb({super.key, required this.combo, this.dimmed = false});

  final ComboModel combo;

  /// The sold-out wash, the same one a product card uses.
  final bool dimmed;

  static const int collageMax = 4;

  @override
  Widget build(BuildContext context) {
    final wash = dimmed
        ? ColoredBox(
            color: BlynkCardProduct.unavailableWashColor.withValues(alpha: BlynkCardProduct.unavailableWashOpacity),
          )
        : null;
    final own = combo.imageUrl;
    final pictured = combo.items.where((i) => (i.imageUrl ?? '').trim().isNotEmpty).toList();
    if ((own != null && own.trim().isNotEmpty) || pictured.isEmpty) {
      return BlynkImageWell(imageUrl: own, glyph: BlynkIcons.combo, overlay: wash);
    }

    final tiles = combo.items.take(collageMax).toList();
    Widget tile(ComboItem item) => BlynkImageWell(
      imageUrl: item.imageUrl,
      glyph: fallbackGlyphFor(item.name),
      alignment: item.imageAlignment,
      inset: BlynkSpace.s4,
      radius: BlynkRadius.smAll,
    );
    const space = BlynkSpace.s4;
    final Widget collage;
    if (tiles.length < 3) {
      collage = Row(
        children: [
          for (var i = 0; i < tiles.length; i++) ...[
            if (i > 0) const SizedBox(width: space),
            Expanded(child: tile(tiles[i])),
          ],
        ],
      );
    } else {
      collage = Column(
        children: [
          Expanded(
            child: Row(
              children: [
                Expanded(child: tile(tiles[0])),
                const SizedBox(width: space),
                Expanded(child: tile(tiles[1])),
              ],
            ),
          ),
          const SizedBox(height: space),
          Expanded(
            child: Row(
              children: [
                Expanded(child: tile(tiles[2])),
                if (tiles.length > 3) ...[const SizedBox(width: space), Expanded(child: tile(tiles[3]))],
              ],
            ),
          ),
        ],
      );
    }
    return ClipRRect(
      key: const Key('combo-collage'),
      borderRadius: BlynkWell.radius,
      child: Stack(fit: StackFit.expand, children: [collage, if (wash != null) wash]),
    );
  }
}

/// The combo price, then - only while [ComboModel.hasSaving] - one pack's
/// products at their own prices, struck through. The struck price gives way
/// first when the line is narrow.
class ComboPriceLine extends StatelessWidget {
  const ComboPriceLine({super.key, required this.combo, this.style});

  final ComboModel combo;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final price = MoneyText(combo.price, maxLines: 1, overflow: TextOverflow.ellipsis, style: style);
    if (!combo.hasSaving) return price;
    // Same as a product offer (owner, 2026-10-09): the items' total struck
    // in green, then the combo price in green.
    return OfferPriceLine(
      regular: combo.itemsTotal,
      price: combo.price,
      style: style,
      struckKey: const Key('combo-items-total'),
    );
  }
}

/// "Save LKR 120" - the backend's `saving` for one pack. Positive tone: a
/// saving is good news, not a warning.
class ComboSaveTag extends StatelessWidget {
  const ComboSaveTag({super.key, required this.combo});

  final ComboModel combo;

  static String labelFor(ComboModel combo) => 'Save ${formatLkr(combo.saving)}';

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: const Key('combo-save-tag'),
      decoration: const BoxDecoration(color: BlynkColors.positiveTint, borderRadius: BlynkRadius.full),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s8, vertical: BlynkSpace.s4 / 2),
        child: Text(
          labelFor(combo),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: BlynkText.caption.copyWith(color: BlynkColors.positiveInk, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

/// ADD while the combo is not in the cart, a [QuantityStepper] once it is,
/// and a disabled "Sold out" pill while the backend reports it unavailable
/// (packs already in the cart can still be taken out).
class ComboAddButton extends StatelessWidget {
  const ComboAddButton({super.key, required this.combo});

  final ComboModel combo;

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartProvider, int>((cart) => cart.comboQuantityOf(combo.id));
    if (quantity > 0) {
      return QuantityStepper(
        key: ValueKey('combo-stepper/${combo.id}'),
        quantity: quantity,
        productName: combo.name,
        max: kComboQuantityMax,
        onIncrement: combo.isAvailable ? () => context.read<CartProvider>().addCombo(combo) : null,
        onDecrement: () => context.read<CartProvider>().decrementCombo(combo),
      );
    }
    return _ComboPill(combo: combo);
  }
}

class _ComboPill extends StatelessWidget {
  const _ComboPill({required this.combo});

  final ComboModel combo;

  static const double _hit = BlynkControl.minHeight;
  static const double _visual = 40;

  @override
  Widget build(BuildContext context) {
    final available = combo.isAvailable;
    void add() => context.read<CartProvider>().addCombo(combo);
    return Semantics(
      button: true,
      enabled: available,
      label: available ? 'Add ${combo.name}' : '${combo.name}, sold out',
      onTap: available ? add : null,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkResponse(
          key: ValueKey('combo-add/${combo.id}'),
          onTap: available ? add : null,
          containedInkWell: false,
          highlightColor: BlynkColors.clear,
          splashColor: BlynkColors.clear,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 64, minHeight: _hit),
            child: Center(
              widthFactor: 1,
              heightFactor: 1,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: available ? BlynkCardProduct.addFill : BlynkCardProduct.addFillUnavailable,
                  borderRadius: BlynkCardProduct.addRadius,
                ),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: _visual),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s16),
                    child: Center(
                      widthFactor: 1,
                      heightFactor: 1,
                      child: Text(
                        available ? 'ADD' : 'Sold out',
                        maxLines: 1,
                        style: BlynkText.caption.copyWith(
                          fontWeight: FontWeight.w800,
                          letterSpacing: available ? 0.4 : 0,
                          color: available ? BlynkCardProduct.addLabel : BlynkCardProduct.addLabelUnavailable,
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

/// The combo's detail: picture, name, price and saving, the end date if it
/// has one, every product in it with its quantity and its own price, the
/// description, and the same add / stepper / sold-out control as the card.
Future<void> showComboSheet(BuildContext context, ComboModel combo) => showAdaptiveSheet<void>(
  context,
  semanticLabel: combo.name,
  builder: (_) => ComboDetail(combo: combo),
);

class ComboDetail extends StatelessWidget {
  const ComboDetail({super.key, required this.combo});

  final ComboModel combo;

  static const double _imageHeight = 160;
  static const double _thumb = 44;

  @override
  Widget build(BuildContext context) {
    final ends = combo.endsAt;
    final description = combo.description;
    return SingleChildScrollView(
      key: const Key('combo-detail'),
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s8, BlynkSpace.s16, BlynkSpace.s24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: _imageHeight,
            child: ComboThumb(combo: combo, dimmed: !combo.isAvailable),
          ),
          const SizedBox(height: BlynkSpace.s16),
          Text(combo.name, style: BlynkText.title),
          const SizedBox(height: BlynkSpace.s8),
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: BlynkSpace.s8,
            runSpacing: BlynkSpace.s4,
            children: [
              ComboPriceLine(combo: combo, style: BlynkType.priceHero),
              if (combo.hasSaving) ComboSaveTag(combo: combo),
            ],
          ),
          if (ends != null) ...[
            const SizedBox(height: BlynkSpace.s4),
            Text('Offer ends ${formatOrderTime(ends)}', style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
          ],
          if (description != null) ...[
            const SizedBox(height: BlynkSpace.s12),
            Text(description, style: BlynkText.body.copyWith(color: BlynkColors.ink3)),
          ],
          const SizedBox(height: BlynkSpace.s16),
          Semantics(header: true, child: const Text("What's inside", style: BlynkText.sectionHeader)),
          const SizedBox(height: BlynkSpace.s8),
          for (final item in combo.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s4),
              child: Row(
                children: [
                  SizedBox(
                    width: _thumb,
                    height: _thumb,
                    child: BlynkImageWell(
                      imageUrl: item.imageUrl,
                      glyph: fallbackGlyphFor(item.name),
                      alignment: item.imageAlignment,
                      inset: BlynkSpace.s4,
                    ),
                  ),
                  const SizedBox(width: BlynkSpace.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: BlynkText.rowLabel),
                        Text(
                          ['× ${item.quantity}', if (item.unit.trim().isNotEmpty) item.unit.trim()].join(' · '),
                          style: BlynkType.productUnit,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: BlynkSpace.s8),
                  MoneyText(item.unitPrice * item.quantity, style: BlynkType.priceCompact),
                ],
              ),
            ),
          const SizedBox(height: BlynkSpace.s16),
          _ComboDetailAction(combo: combo),
        ],
      ),
    );
  }
}

class _ComboDetailAction extends StatelessWidget {
  const _ComboDetailAction({required this.combo});

  final ComboModel combo;

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartProvider, int>((cart) => cart.comboQuantityOf(combo.id));
    if (quantity == 0) {
      return BlynkButton.primary(
        key: const Key('combo-detail-add'),
        label: combo.isAvailable ? 'Add to cart' : 'Sold out',
        expand: true,
        onPressed: combo.isAvailable ? () => context.read<CartProvider>().addCombo(combo) : null,
      );
    }
    return Row(
      children: [
        Expanded(child: Text('$quantity in cart · ${formatLkr(combo.price * quantity)}', style: BlynkText.rowLabel)),
        ComboAddButton(combo: combo),
      ],
    );
  }
}
