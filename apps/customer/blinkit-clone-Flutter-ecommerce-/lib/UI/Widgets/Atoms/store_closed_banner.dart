import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/store_info.provider.dart';
import '../../../Services/ordering_hours.dart';
import '../../../design/tokens.dart';

/// The closed banner's words at the app clock's "now": the live status from
/// GET /store ("Closed now — back at 8 AM tomorrow", "Closed — Rain · back
/// Sat 8 AM", "Closed for now"), or the fallback sentence where no
/// [StoreInfoProvider] is in the tree (owner, 2026-10-10).
String watchClosedMessage(BuildContext context) {
  final store = context.watch<StoreInfoProvider?>();
  final now = OrderingHours.now();
  return store?.closedMessage(now) ?? StoreInfoProvider.fallbackClosedMessage();
}

/// "Closed now — back at 8 AM tomorrow" on Home, the cart and checkout while
/// the store is not taking orders; nothing while it is open. Ops/Admin
/// decide the hours and can close the store at any time, so this follows
/// GET /store (and the fallback clock without it). It asks GET /store again
/// when it appears (throttled), so a closure is noticed when the cart or
/// checkout opens (owner, 2026-10-10).
///
/// The notice tone `BirthdayOfferBanner` uses (tint fill, ink-dark words).
class StoreClosedBanner extends StatefulWidget {
  const StoreClosedBanner({super.key, this.padding = EdgeInsets.zero, this.hint});

  /// Space around the banner when it shows (none is taken when it does not).
  final EdgeInsetsGeometry padding;

  /// A second line under the message (e.g. "Pick a delivery time to order
  /// now."); none when null.
  final String? hint;

  static const Key bannerKey = Key('store-closed-banner');

  @override
  State<StoreClosedBanner> createState() => _StoreClosedBannerState();
}

class _StoreClosedBannerState extends State<StoreClosedBanner> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<StoreInfoProvider?>()?.refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return OrderingHoursBuilder(builder: (context, isOpen) {
      if (isOpen) return const SizedBox.shrink();
      final message = watchClosedMessage(context);
      final hint = widget.hint;
      return Padding(
        padding: widget.padding,
        child: Semantics(
          container: true,
          liveRegion: true,
          child: DecoratedBox(
            key: StoreClosedBanner.bannerKey,
            decoration: const BoxDecoration(color: BlynkColors.noticeTint, borderRadius: BlynkRadius.mdAll),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s12),
              child: Row(
                children: [
                  const Icon(BlynkIcons.pending, size: BlynkIcons.md, color: BlynkColors.notice),
                  const SizedBox(width: BlynkSpace.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(message, style: BlynkText.label.copyWith(color: BlynkColors.notice)),
                        if (hint != null) ...[
                          const SizedBox(height: BlynkSpace.s4 / 2),
                          Text(hint, style: BlynkText.caption.copyWith(color: BlynkColors.notice)),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    });
  }
}
