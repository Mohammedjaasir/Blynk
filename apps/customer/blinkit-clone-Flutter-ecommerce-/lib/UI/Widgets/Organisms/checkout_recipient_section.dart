import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../Services/Validation/app_validators.dart';
import '../../../app_design.dart';
import '../../../design/tokens.dart';
import '../Atoms/blynk_text_field.dart';
import '../Atoms/section_header.dart';

/// "Who is it for?" at checkout (owner, 2026-10-12): a customer can send the
/// order to family - "For someone else" with the receiver's name and Sri
/// Lankan mobile for THIS order only (the saved address is not changed). The
/// receiver gets the order texts (and the delivery code while staff have
/// "Send delivery code to receiver" on); the buyer still follows by SMS and
/// in the app. A note for the rider and "Needs help at the door" go with any
/// order.
///
/// "For someone else" shows only while staff allow it (checkout-info's
/// `order_for_someone_else.enabled`); the note and "needs help" always show.
/// The values live in [OrderProvider], which sends them with the order.
class CheckoutRecipientSection extends StatefulWidget {
  const CheckoutRecipientSection({super.key, this.padding = EdgeInsets.zero});

  final EdgeInsetsGeometry padding;

  static const Key forSomeoneElseKey = Key('checkout-for-someone-else');
  static const Key nameKey = Key('checkout-recipient-name');
  static const Key phoneKey = Key('checkout-recipient-phone');
  static const Key noteKey = Key('checkout-delivery-note');
  static const Key needsHelpKey = Key('checkout-needs-help');

  static const String forSomeoneElseLabel = 'For someone else';
  static const String needsHelpLabel = 'Needs help at the door';
  static const String needsHelpHint = 'Elderly or unwell: the rider knocks, waits and carries the items inside.';

  @override
  State<CheckoutRecipientSection> createState() => _CheckoutRecipientSectionState();
}

class _CheckoutRecipientSectionState extends State<CheckoutRecipientSection> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _note;
  bool _touchedName = false;
  bool _touchedPhone = false;

  @override
  void initState() {
    super.initState();
    final orders = context.read<OrderProvider>();
    _name = TextEditingController(text: orders.recipientName);
    _phone = TextEditingController(text: orders.recipientPhone);
    _note = TextEditingController(text: orders.deliveryNote);
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final orders = context.watch<OrderProvider>();
    final ordering = context.watch<StoreInfoProvider?>()?.someoneElseOrdering;
    final allowed = ordering?.enabled ?? false;
    final on = allowed && orders.forSomeoneElse;
    // An order was placed (the provider cleared its fields): clear the boxes too.
    if (orders.recipientName.isEmpty && _name.text.isNotEmpty) _name.clear();
    if (orders.recipientPhone.isEmpty && _phone.text.isNotEmpty) _phone.clear();
    if (orders.deliveryNote.isEmpty && _note.text.isNotEmpty) _note.clear();

    return Padding(
      padding: widget.padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const BlynkSectionHeader(
            title: 'Delivery details',
            padding: EdgeInsets.only(bottom: BlynkSpace.s12),
          ),
          Container(
            decoration: appCardDecoration(),
            padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
            // The list tiles paint their ink on this Material, not under the card.
            child: Material(
              type: MaterialType.transparency,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (allowed) ...[
                    SwitchListTile.adaptive(
                      key: CheckoutRecipientSection.forSomeoneElseKey,
                      contentPadding: EdgeInsets.zero,
                      value: on,
                      onChanged: orders.setForSomeoneElse,
                      title: const Text(CheckoutRecipientSection.forSomeoneElseLabel, style: BlynkText.rowLabel),
                      subtitle: Text(
                        ordering!.sendCodeToReceiver
                            ? 'Send this order to family. They get the order texts and the delivery code; you get updates too.'
                            : 'Send this order to family. They get the order texts; you get the delivery code and updates.',
                        style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                      ),
                    ),
                    if (on) ...[
                      const SizedBox(height: BlynkSpace.s8),
                      BlynkTextField(
                        key: CheckoutRecipientSection.nameKey,
                        label: "Receiver's name",
                        controller: _name,
                        textCapitalization: TextCapitalization.words,
                        maxLength: AppValidators.recipientNameMax,
                        errorText: _touchedName ? _nameError(orders.recipientName) : null,
                        onChanged: (v) {
                          if (!_touchedName) setState(() => _touchedName = true);
                          orders.setRecipientName(v);
                        },
                      ),
                      const SizedBox(height: BlynkSpace.s8),
                      BlynkTextField(
                        key: CheckoutRecipientSection.phoneKey,
                        label: "Receiver's mobile",
                        hintText: '07X XXX XXXX',
                        controller: _phone,
                        keyboardType: TextInputType.phone,
                        errorText: _touchedPhone ? AppValidators.phone(orders.recipientPhone) : null,
                        onChanged: (v) {
                          if (!_touchedPhone) setState(() => _touchedPhone = true);
                          orders.setRecipientPhone(v);
                        },
                      ),
                      const SizedBox(height: BlynkSpace.s4),
                      Text(
                        'Only for this order - your saved address stays the same.',
                        style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                      ),
                      const SizedBox(height: BlynkSpace.s8),
                    ],
                  ],
                  CheckboxListTile.adaptive(
                    key: CheckoutRecipientSection.needsHelpKey,
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: orders.needsHelp,
                    onChanged: (v) => orders.setNeedsHelp(v ?? false),
                    title: const Text(CheckoutRecipientSection.needsHelpLabel, style: BlynkText.rowLabel),
                    subtitle: Text(
                      CheckoutRecipientSection.needsHelpHint,
                      style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                    ),
                  ),
                  BlynkTextField(
                    key: CheckoutRecipientSection.noteKey,
                    label: 'Note for the rider (optional)',
                    hintText: 'Gate, floor, landmark',
                    controller: _note,
                    maxLines: 2,
                    maxLength: AppValidators.instructionsMax,
                    errorText: AppValidators.deliveryInstructions(orders.deliveryNote),
                    onChanged: orders.setDeliveryNote,
                  ),
                  const SizedBox(height: BlynkSpace.s4),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String? _nameError(String value) =>
      AppValidators.recipientName(value) == null ? null : "Enter the receiver's name";
}
