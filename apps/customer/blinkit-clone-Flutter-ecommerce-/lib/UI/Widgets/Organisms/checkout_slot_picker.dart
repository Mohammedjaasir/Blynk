import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../Services/ordering_hours.dart';
import '../../../app_design.dart';
import '../../../design/tokens.dart';
import '../Atoms/section_header.dart';

/// "Delivery time" at checkout, while staff have scheduled delivery slots
/// switched on (`delivery_slots_enabled` on GET /store, and GET
/// /orders/slots says enabled). "As soon as possible" is the default while
/// the store is open; the slots follow, grouped by day, a full one shown
/// but not pickable. While the store is closed ASAP is not offered and a
/// slot must be picked before Place order works (owner, 2026-10-10).
///
/// Draws nothing while slots are off, and asks GET /orders/slots only once
/// the store says they are on.
class CheckoutSlotPicker extends StatefulWidget {
  const CheckoutSlotPicker({super.key, this.padding = EdgeInsets.zero});

  /// Space around the picker when it shows.
  final EdgeInsetsGeometry padding;

  static const String asapLabel = 'As soon as possible';
  static const String fullLabel = 'Full';
  static const String closedNote = "We're closed now. Pick a time and we'll deliver then.";
  static const String noSlotsNote = 'No delivery times left right now. Check back later.';
  static const String loadFailedNote = "We couldn't load delivery times.";

  static Key slotKey(String start) => Key('delivery-slot/$start');
  static const Key asapKey = Key('delivery-slot/asap');

  @override
  State<CheckoutSlotPicker> createState() => _CheckoutSlotPickerState();
}

class _CheckoutSlotPickerState extends State<CheckoutSlotPicker> {
  bool _asked = false;

  void _askIfNeeded(bool enabled) {
    if (!enabled || _asked) return;
    _asked = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<OrderProvider>().loadSlots();
    });
  }

  @override
  Widget build(BuildContext context) {
    final storeSaysOn = watchDeliverySlotsEnabled(context);
    _askIfNeeded(storeSaysOn);
    final orders = context.watch<OrderProvider>();
    final slots = orders.deliverySlots;

    if (!storeSaysOn && !(slots?.enabled ?? false)) return const SizedBox.shrink();
    if (slots == null) {
      if (orders.slotsFailure == null) return const SizedBox.shrink();
      return Padding(
        padding: widget.padding,
        child: _Section(children: [
          Row(
            children: [
              const Expanded(child: Text(CheckoutSlotPicker.loadFailedNote, style: BlynkText.bodyMuted)),
              TextButton(onPressed: orders.isLoadingSlots ? null : orders.loadSlots, child: const Text('Retry')),
            ],
          ),
        ]),
      );
    }
    if (!slots.enabled) return const SizedBox.shrink();

    return OrderingHoursBuilder(builder: (context, isOpen) {
      final asap = slots.asapAvailable && isOpen;
      final picked = orders.selectedSlot?.start;
      return Padding(
        padding: widget.padding,
        child: _Section(children: [
          if (asap)
            _SlotChoice(
              key: CheckoutSlotPicker.asapKey,
              label: CheckoutSlotPicker.asapLabel,
              selected: picked == null,
              onTap: () => orders.selectSlot(null),
            )
          else
            const Padding(
              padding: EdgeInsets.only(bottom: BlynkSpace.s4),
              child: Text(CheckoutSlotPicker.closedNote, style: BlynkText.bodyMuted),
            ),
          if (slots.slots.isEmpty && !asap)
            const Text(CheckoutSlotPicker.noSlotsNote, style: BlynkText.bodyMuted),
          for (final day in slots.byDay) ...[
            Padding(
              padding: const EdgeInsets.only(top: BlynkSpace.s8, bottom: BlynkSpace.s4),
              child: Semantics(
                header: true,
                child: Text(day.key, style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
              ),
            ),
            for (final slot in day.value)
              _SlotChoice(
                key: CheckoutSlotPicker.slotKey(slot.start),
                label: slot.timeLabel,
                semanticLabel: slot.label,
                selected: picked == slot.start,
                full: !slot.available,
                onTap: slot.available ? () => orders.selectSlot(slot.start) : null,
              ),
          ],
        ]),
      );
    });
  }
}

/// The "Delivery time" header and its card.
class _Section extends StatelessWidget {
  const _Section({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const BlynkSectionHeader(title: 'Delivery time', padding: EdgeInsets.only(bottom: BlynkSpace.s12)),
        Container(
          decoration: appCardDecoration(),
          padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: children),
        ),
      ],
    );
  }
}

/// One choice: a filled vs outline mark (not a colour) says which is picked,
/// the pattern of the SMS language choice. A full slot is shown, greyed,
/// with "Full", and cannot be picked.
class _SlotChoice extends StatelessWidget {
  const _SlotChoice({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.semanticLabel,
    this.full = false,
  });

  final String label;
  final String? semanticLabel;
  final bool selected;
  final bool full;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final ink = onTap == null ? BlynkColors.ink3 : BlynkColors.ink;
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      enabled: onTap != null,
      label: full ? '${semanticLabel ?? label}, ${CheckoutSlotPicker.fullLabel}' : (semanticLabel ?? label),
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BlynkRadius.mdAll,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
          child: Row(
            children: [
              Icon(
                selected ? BlynkIcons.choiceOn : BlynkIcons.choiceOff,
                size: BlynkIcons.md,
                color: selected ? BlynkColors.ink : BlynkColors.ink3,
              ),
              const SizedBox(width: BlynkSpace.s12),
              Expanded(child: Text(label, style: BlynkText.body.copyWith(color: ink))),
              if (full) Text(CheckoutSlotPicker.fullLabel, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
            ],
          ),
        ),
      ),
    );
  }
}
