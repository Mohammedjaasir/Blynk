import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../design/tokens.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../Screens/user_address_screen.dart';
import '../Atoms/blynk_button.dart';

/// The checkout screen's delivery-address row.
///
/// It loads the address book once after the first frame, shows "Add" instead
/// of "Change" when there is none, and pushes `/user/address`. Since
/// 2026-10-11 it shows the address the customer picked for this checkout
/// (`selectedAddress` - the default until they tap another card), and opens
/// the address book in pick mode, so tapping a card chooses it and comes
/// straight back here. The address-required guard itself lives in
/// [CartScreenPaymentContainer].
///
/// It draws **no surface of its own**. `checkout_screen.dart` already wraps it
/// in `appCardDecoration()` with `Clip.antiAlias`, so the top-rounded white box
/// this used to paint was a second card inside the first one.
class CartScreenAddressContainer extends StatefulWidget {
  const CartScreenAddressContainer({
    super.key,
  });

  @override
  State<CartScreenAddressContainer> createState() => _CartScreenAddressContainerState();
}

class _CartScreenAddressContainerState extends State<CartScreenAddressContainer> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final addressProvider = context.read<AddressProvider>();
      if (addressProvider.addresses.isEmpty) {
        addressProvider.loadAddresses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final address = context.watch<AddressProvider>().selectedAddress;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: BlynkSpace.s12,
        vertical: BlynkSpace.s8,
      ),
      width: double.infinity,
      // A floor, not a fixed height: two lines of text at a large text size
      // must be able to grow the row.
      constraints: const BoxConstraints(minHeight: 70),
      child: Center(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Row(
                children: [
                  const Icon(
                    BlynkIcons.addressOther,
                    color: BlynkColors.ink2,
                    size: BlynkIcons.md,
                  ),
                  const SizedBox(width: BlynkSpace.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // The answer, then the supporting detail — the same
                        // two type roles the payment row beside it uses.
                        Text(
                          address != null
                              ? 'Deliver to'
                              : 'No delivery address yet',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: BlynkText.rowLabel,
                        ),
                        Text(
                          address?.displaySummary ?? 'Add an address to check out',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: BlynkText.bodyMuted,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: BlynkSpace.s8),
            // The app's one plain-ink text button, the same one the address
            // book's own cards use. It is deliberately not a second yellow:
            // "Place order" below is this screen's single yellow action.
            BlynkButton.tertiary(
              label: address != null ? 'Change' : 'Add',
              semanticLabel:
                  address != null ? 'Change delivery address' : 'Add delivery address',
              onPressed: () {
                Navigator.of(context).pushNamed(
                  '/user/address',
                  arguments: UserAddressScreen.pickForCheckout,
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
