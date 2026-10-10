import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/address_model.dart';
import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../Services/store_info.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Screens/customer_shell.dart';
import '../Atoms/blynk_logo.dart';
import '../Atoms/circular_icon_button.dart';

/// Home's header: the Blynk lockup on the left, and the circular chrome
/// controls on the right — the cart with its **real** line count, and the way
/// into the account.
///
/// Under that brand row sits the **address block**, which the reference
/// composition gives a whole row of its own rather than a cramped strip: a
/// quiet caption naming the hub we deliver from and the real service window,
/// then, one step up the type scale, where this order is actually going —
/// `Home · 12 Galle Road, Dharga Town` — with a chevron, because tapping it
/// opens the address list.
///
/// 2026-09-24: the two facts used to share one 12 px line with the auth link,
/// and a real address truncated to `…` the moment one existed. They are two
/// lines now, with the destination allowed to wrap rather than be cut.
///
/// Nothing here is invented. The reference puts a **delivery ETA** ("8
/// minutes") and a **distance** ("720 m away") in this slot; the backend has
/// neither field, and a customer who plans around a made-up delivery time is a
/// real-world failure, not a cosmetic one. Our truthful equivalent is the
/// service window, so that is what the caption carries. The badge is
/// `CartProvider.itemCount` rather than a decoration.
///
/// The circular **search** button that briefly lived in the brand row is gone:
/// Home carries a full-width search field again ([HomeScreenSearchBar]), and
/// two paths to the same screen a finger apart is duplicate chrome.
class HomeScreenAppBar extends StatefulWidget {
  const HomeScreenAppBar({super.key});

  /// The Blynk mark's height in the header. The wordmark is sized against it
  /// by [BlynkLogo].
  static const double markHeight = 30;

  @override
  State<HomeScreenAppBar> createState() => _HomeScreenAppBarState();
}

class _HomeScreenAppBarState extends State<HomeScreenAppBar> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      final addresses = context.read<AddressProvider>();
      // Addresses are an authenticated endpoint - don't fire it for a
      // browsing guest and trigger a pointless 401.
      if (auth.isAuthenticated && addresses.addresses.isEmpty) {
        addresses.loadAddresses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final address = context.watch<AddressProvider>().defaultAddress;
    final isAuthenticated = context.watch<AuthProvider>().isAuthenticated;
    final gutter = BlynkSpace.gutterFor(Responsive.of(context).width);

    return SliverToBoxAdapter(
      child: SafeArea(
        bottom: false,
        child: ColoredBox(
          color: BlynkColors.paper,
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              gutter,
              BlynkSpace.s8,
              BlynkSpace.s8,
              BlynkSpace.s4,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Row(
                  children: [
                    // Scales down rather than overflowing: the wordmark's
                    // intrinsic width is artwork, not a layout constant.
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: BlynkLogo(
                            height: HomeScreenAppBar.markHeight,
                          ),
                        ),
                      ),
                    ),
                    _CartButton(),
                    _ProfileButton(),
                  ],
                ),
                const SizedBox(height: BlynkSpace.s4),
                Padding(
                  padding: const EdgeInsets.only(right: BlynkSpace.s8),
                  child: _AddressBlock(
                    address: address,
                    isAuthenticated: isAuthenticated,
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

/// The cart, with the real number of lines in it. The badge is
/// [BlynkNav.countBadgeFill] ink — never a second yellow, so the screen's one
/// yellow action stays with the action.
class _CartButton extends StatelessWidget {
  const _CartButton();

  @override
  Widget build(BuildContext context) {
    // Nullable on purpose: this header is also rendered on its own by the
    // component tests, which host it without a CartProvider. A missing cart
    // means no badge, never a crash and never an invented count.
    final count = context.watch<CartProvider?>()?.itemCount ?? 0;

    return Tooltip(
      message: 'Cart',
      child: CircularIconButton(
        icon: BlynkIcons.cart,
        semanticLabel: 'Cart',
        badgeCount: count,
        onPressed: () => Navigator.of(context).pushNamed('/cart'),
      ),
    );
  }
}

/// The account entry: circular chrome, never the screen's yellow.
class _ProfileButton extends StatelessWidget {
  const _ProfileButton();

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'Profile',
      child: CircularIconButton(
        icon: BlynkIcons.profile,
        semanticLabel: 'Profile',
        onPressed: () => CustomerShell.selectTab(context, 3),
      ),
    );
  }
}

/// Where this order is going — its **own** block under the brand row, with
/// room to breathe, mirroring the reference's stacked caption-over-destination
/// hierarchy.
///
/// Two lines, and the split is the point:
///
/// * the **caption** is the service: the hub we deliver from and the real
///   window we deliver in, at [BlynkText.microLabel] in [BlynkColors.ink2].
///   This is the slot the reference fills with a delivery ETA and a distance.
///   Blynk has **no** ETA field and **no** distance field, so it carries
///   neither; the service window is the true fact that belongs there.
/// * the **destination** is a step up the scale ([BlynkText.heading]): the
///   real [AddressModel.label] in emphasis, then the real summary — and when
///   there is no address yet, the action that creates one, because that *is*
///   the destination's state. It wraps rather than truncating: a Sri Lankan
///   street address does not fit one phone line and an elided address is
///   worse than a taller header.
///
/// The whole block is one 48 dp target and one semantics node: a guest lands
/// on login, a signed-in customer on the address book.
class _AddressBlock extends StatelessWidget {
  const _AddressBlock({required this.address, required this.isAuthenticated});

  final AddressModel? address;
  final bool isAuthenticated;

  /// The destination line's spans. Signed in with an address this is the
  /// label in emphasis then the summary; otherwise it is the one action that
  /// would fill the slot. Never a placeholder address, never a guessed one.
  List<TextSpan> get _destinationSpans {
    final current = address;
    if (current == null) {
      return [
        TextSpan(
          text: isAuthenticated
              ? 'Add a delivery address'
              : 'Log in to set your delivery address',
          style: BlynkText.heading,
        ),
      ];
    }
    return [
      // The reference shouts this label; Blynk sets no label in capitals
      // anywhere, and `design_hygiene_ratchet_test` enforces that app-wide.
      // The emphasis comes from weight instead, and the word is the
      // customer's own — `Home`, `Work`, or whatever they typed — exactly as
      // the address book shows it.
      TextSpan(text: current.label, style: BlynkText.heading),
      TextSpan(
        text: ' · ${current.displaySummary}',
        // Same size, lighter weight: the label leads, the street follows.
        style: BlynkText.heading.copyWith(fontWeight: FontWeight.w500),
      ),
    ];
  }

  String get _spokenLabel {
    if (!isAuthenticated) return 'Log in to set your delivery address';
    final current = address;
    if (current == null) return 'Add a delivery address';
    return 'Delivering to ${current.label}, ${current.displaySummary}. '
        'Change delivery address';
  }

  @override
  Widget build(BuildContext context) {
    void open() => Navigator.of(context)
        .pushNamed(isAuthenticated ? '/user/address' : '/login');

    return Semantics(
      button: true,
      label: _spokenLabel,
      // The block's own node carries the action, because its fragments are
      // excluded below: one target, one spoken sentence.
      onTap: open,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BlynkRadius.mdAll,
        onTap: open,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              vertical: BlynkSpace.s8,
              horizontal: BlynkSpace.s4,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(
                  children: [
                    const Icon(
                      BlynkIcons.shop,
                      size: BlynkIcons.xs,
                      color: BlynkColors.ink2,
                    ),
                    const SizedBox(width: BlynkSpace.s4),
                    Flexible(
                      child: Text(
                        // The live hours Ops/Admin set (owner, 2026-10-10).
                        '${StoreInfo.hubName} · '
                        '${watchHoursLabel(context)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: BlynkText.microLabel
                            .copyWith(color: BlynkColors.ink2),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: BlynkSpace.s4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text.rich(
                        TextSpan(children: _destinationSpans),
                        // Deliberately unbounded: no `maxLines`, no ellipsis.
                        // A real address must never be cut, at any text scale.
                        style: BlynkText.heading,
                      ),
                    ),
                    const SizedBox(width: BlynkSpace.s4),
                    // Points at the address list this opens. Not a down-caret:
                    // the block pushes a screen, it does not drop a menu.
                    const Icon(
                      BlynkIcons.chevron,
                      size: BlynkIcons.sm,
                      color: BlynkColors.ink2,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
