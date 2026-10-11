import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/address_model.dart';
import '../../../Screens/add_edit_address_screen.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../design/tokens.dart';
import 'blynk_button.dart';
import 'status_badge.dart';

/// A saved address, as a card.
///
/// W8 re-skin: this atom fell outside every screen wave and was the last
/// address surface still painting `Colors.white`, `deepOrangeAccent`,
/// `redAccent`, `grey.shade300` and hand-typed radii. Everything it draws now
/// comes from the token layer or a shared component, so it reads as the same
/// app as the cards beside it.
///
/// Owner, 2026-10-11: tapping the card chooses it as the delivery address
/// for this checkout ([onSelect]) without making it the default; "Set
/// default" stays its own action. The chosen card has the ink outline and a
/// "Delivering here" badge, so the choice never rests on the outline alone.
class AddressCard extends StatelessWidget {
  const AddressCard({
    super.key,
    required this.address,
    this.onSelect,
    this.selected = false,
  });

  final AddressModel address;

  /// Tap to deliver this checkout here. Null: tapping does nothing (Edit,
  /// Delete and Set default still do).
  final VoidCallback? onSelect;

  /// Whether this is the address checkout will deliver to.
  final bool selected;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete address?'),
        content: Text(
          'Remove "${address.addressLine1}" from your saved addresses?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text(
              'Delete',
              style: TextStyle(color: BlynkColors.problem),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await context.read<AddressProvider>().deleteAddress(address.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      key: ValueKey('address-card-${address.id}'),
      button: onSelect != null,
      selected: selected,
      hint: onSelect != null && !selected ? 'Deliver here' : null,
      child: InkWell(
        borderRadius: BlynkCardProduct.radius,
        onTap: onSelect,
        child: Container(
          padding: const EdgeInsets.symmetric(
            vertical: BlynkSpace.s12,
            horizontal: BlynkSpace.s12,
          ),
          margin: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
          decoration: BoxDecoration(
            color: BlynkCardProduct.surface,
            borderRadius: BlynkCardProduct.radius,
            boxShadow: BlynkCardProduct.elevation,
            // The address this checkout delivers to is marked with an ink
            // outline, not green: `positive` is reserved for a genuine positive
            // state (available, delivered, confirmed), and "this is the one we
            // will use" is a selection, not an outcome. The badge below says it
            // in words too, so the outline is never the only signal.
            border: selected
                ? Border.all(
                    color: BlynkColors.ink,
                    width: BlynkControl.outlineWidth,
                  )
                : null,
          ),
          child: Column(
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(BlynkSpace.s8),
                    decoration: const BoxDecoration(
                      color: BlynkWell.tint,
                      borderRadius: BlynkWell.radius,
                    ),
                    // One pin for every address: customers no longer name them
                    // Home/Work (2026-10-05), the address itself is the title.
                    child: const Icon(
                      BlynkIcons.addressOther,
                      color: BlynkWell.fallbackGlyph,
                      size: BlynkIcons.sm,
                    ),
                  ),
                  const SizedBox(width: BlynkSpace.s16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          address.addressLine1,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: BlynkText.heading,
                        ),
                        if (selected || address.isDefault) ...[
                          const SizedBox(height: BlynkSpace.s4),
                          // A Wrap, so two badges at a large font reflow
                          // instead of squeezing the address line.
                          Wrap(
                            spacing: BlynkSpace.s8,
                            runSpacing: BlynkSpace.s4,
                            children: [
                              if (selected)
                                const StatusBadge(
                                  tone: BadgeTone.neutral,
                                  label: 'Delivering here',
                                  icon: BlynkIcons.check,
                                ),
                              if (address.isDefault)
                                const StatusBadge(
                                  tone: BadgeTone.neutral,
                                  label: 'Default',
                                  icon: BlynkIcons.addressOther,
                                ),
                            ],
                          ),
                        ],
                        const SizedBox(height: BlynkSpace.s4),
                        Text(
                          '${address.recipientName} · ${address.recipientPhone}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: BlynkText.caption.copyWith(
                            color: BlynkColors.ink2,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: BlynkSpace.s8),
              // Actions are separated from the identity block by space, not a
              // rule (plan §4: sections are separated by space). A Wrap, so a
              // large system font reflows the three actions instead of
              // overflowing the card - the same three actions, in the same
              // order, doing the same thing.
              Wrap(
                alignment: WrapAlignment.spaceEvenly,
                spacing: BlynkSpace.s8,
                runSpacing: BlynkSpace.s8,
                children: [
                  if (!address.isDefault)
                    BlynkButton.tertiary(
                      label: 'Set default',
                      onPressed: () => context
                          .read<AddressProvider>()
                          .setDefaultAddress(address.id),
                    ),
                  BlynkButton.tertiary(
                    label: 'Edit',
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => AddEditAddressScreen(existing: address),
                      ),
                    ),
                  ),
                  // The one destructive action gets the shared destructive kind
                  // (a `problem` outline), so it is not merely red text and it
                  // inherits the shared 48 dp target, focus ring and disabled
                  // recipe. The confirmation dialog is unchanged.
                  BlynkButton.destructive(
                    label: 'Delete',
                    onPressed: () => _confirmDelete(context),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
