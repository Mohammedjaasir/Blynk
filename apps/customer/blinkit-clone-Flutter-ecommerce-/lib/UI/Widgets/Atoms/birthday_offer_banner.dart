import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../design/tokens.dart';

/// "Happy birthday! 10% off one order this week" on Home, the cart and
/// checkout while this customer's birthday gift applies (owner, 2026-10-09).
/// Drawn only for the server's own `birthday_offer.eligible` (from
/// `GET /orders/checkout-info`), with its percent; nothing at all otherwise,
/// for a guest, or where no [StoreInfoProvider] is in the tree.
///
/// It asks checkout-info itself when it appears and whenever the customer
/// signs in or out, so Home does not depend on checkout having been opened.
/// The gift is taken at checkout by the server; this is wording only.
///
/// The notice tone [CategoryOfferBanner] uses (tint fill, ink-dark words).
class BirthdayOfferBanner extends StatefulWidget {
  const BirthdayOfferBanner({super.key, this.padding = EdgeInsets.zero});

  /// Space around the banner when it shows (none is taken when it does not).
  final EdgeInsetsGeometry padding;

  static const Key bannerKey = Key('birthday-offer-banner');

  @override
  State<BirthdayOfferBanner> createState() => _BirthdayOfferBannerState();
}

class _BirthdayOfferBannerState extends State<BirthdayOfferBanner> {
  bool? _askedSignedIn;

  void _askIfNeeded(bool signedIn) {
    if (_askedSignedIn == signedIn) return;
    _askedSignedIn = signedIn;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<StoreInfoProvider?>()?.loadCheckoutInfo(signedIn: signedIn);
    });
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false);
    _askIfNeeded(signedIn);
    final offer = watchEligibleBirthdayOffer(context);
    if (!signedIn || offer == null) return const SizedBox.shrink();
    return Padding(
      padding: widget.padding,
      child: Semantics(
        container: true,
        child: DecoratedBox(
          key: BirthdayOfferBanner.bannerKey,
          decoration: const BoxDecoration(color: BlynkColors.noticeTint, borderRadius: BlynkRadius.mdAll),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s12),
            child: Row(
              children: [
                const Icon(BlynkIcons.birthday, size: BlynkIcons.md, color: BlynkColors.notice),
                const SizedBox(width: BlynkSpace.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        offer.bannerText,
                        style: BlynkText.label.copyWith(color: BlynkColors.notice),
                      ),
                      const SizedBox(height: BlynkSpace.s4 / 2),
                      Text(
                        'Taken off at checkout, no code needed.',
                        style: BlynkText.caption.copyWith(color: BlynkColors.notice),
                      ),
                    ],
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
