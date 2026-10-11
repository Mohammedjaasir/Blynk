import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/card_add_address.dart';
import '../UI/Widgets/Atoms/card_address_screen.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../Services/Providers/address.provider.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// My Addresses. Tapping a card chooses it as the delivery address for this
/// checkout without making it the default (owner, 2026-10-11); "Set default"
/// stays its own action. Opened from checkout ([pickMode]), the tap also
/// comes straight back to checkout.
class UserAddressScreen extends StatefulWidget {
  const UserAddressScreen({super.key, this.pickMode = false});

  /// The route argument checkout passes to open this screen in [pickMode].
  static const String pickForCheckout = 'pick-for-checkout';

  /// Opened from checkout: a tap picks the address and returns.
  final bool pickMode;

  @override
  State<UserAddressScreen> createState() => _UserAddressScreenState();
}

class _UserAddressScreenState extends State<UserAddressScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AddressProvider>().loadAddresses();
    });
  }

  /// Deliver this checkout to [id] (the default does not change); from
  /// checkout, go straight back to it.
  void _choose(AddressProvider addresses, String id) {
    addresses.selectAddress(id);
    if (widget.pickMode) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        title: Text(
          widget.pickMode ? 'Choose delivery address' : 'My Addresses',
        ),
      ),
      body: ContentFrame(
        maxWidth: 720,
        gutter: false,
        child: Consumer<AddressProvider>(
          builder: (context, addressProvider, _) {
            return RefreshIndicator(
              onRefresh: addressProvider.loadAddresses,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  BlynkSpace.s8,
                  BlynkSpace.s4,
                  BlynkSpace.s8,
                  BlynkSpace.s32,
                ),
                children: [
                  const AddNewAddressCard(),
                  if (addressProvider.isLoading)
                    // The list's own shape while it loads, so nothing jumps
                    // when the real rows arrive.
                    const Column(
                      children: [
                        ListRowSkeleton(),
                        ListRowSkeleton(),
                        ListRowSkeleton(),
                      ],
                    )
                  else if (addressProvider.failure != null)
                    // A real failure, with the mapped customer copy - never
                    // dressed up as "you have no addresses".
                    FailureState(
                      failure: addressProvider.failure!,
                      title: "We couldn't load your addresses",
                      retryKey: const Key('addresses-retry'),
                      scrollable: false,
                      onRetry: addressProvider.loadAddresses,
                    )
                  else if (addressProvider.addresses.isEmpty)
                    // Genuinely empty, and it says so in those words - the
                    // failure branch above is the only thing that reports a
                    // problem. Written out rather than an AppStateView
                    // because that one scrolls, and a scroll view cannot be
                    // nested inside this list's unbounded height.
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: BlynkSpace.s24,
                        vertical: BlynkSpace.s48,
                      ),
                      child: Column(
                        children: [
                          const ExcludeSemantics(
                            child: Icon(
                              BlynkIcons.empty,
                              size: BlynkIcons.lg,
                              color: BlynkColors.ink3,
                            ),
                          ),
                          const SizedBox(height: BlynkSpace.s16),
                          const Text(
                            'No saved addresses yet.',
                            textAlign: TextAlign.center,
                            style: BlynkText.heading,
                          ),
                          const SizedBox(height: BlynkSpace.s8),
                          Text(
                            'Add one and it will be ready the next time you check out.',
                            textAlign: TextAlign.center,
                            style: BlynkText.body.copyWith(color: BlynkColors.ink3),
                          ),
                        ],
                      ),
                    )
                  else ...[
                    Padding(
                      padding: const EdgeInsets.only(top: BlynkSpace.s8),
                      child: Text(
                        'Tap an address to deliver there. Your default stays the same.',
                        style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                      ),
                    ),
                    ...addressProvider.addresses.map(
                      (address) => AddressCard(
                        address: address,
                        selected: addressProvider.isSelected(address.id),
                        onSelect: () => _choose(addressProvider, address.id),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
