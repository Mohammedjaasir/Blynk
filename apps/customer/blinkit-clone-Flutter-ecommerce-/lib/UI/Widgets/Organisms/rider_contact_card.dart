import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../Models/order_model.dart';
import '../../../Services/open_link.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../../../design/tokens.dart';
import '../Atoms/blynk_button.dart';
import 'rider_bike_icon.dart';

/// Opens a link outside the app; returns false where it cannot (then the
/// number is copied instead). Injectable so tests never open anything.
typedef ExternalLinkOpener = bool Function(String url);

/// The real opener (lib/Services/open_link.dart).
const ExternalLinkOpener defaultLinkOpener = openExternalLink;

/// "Call rider" (owner, 2026-10-10): the dialler on the web (the customer
/// app is a PWA, where a `tel:` link is handled by the phone), and anywhere
/// that cannot open it the number is copied and shown - the Help screen's
/// rule for the store's own number.
void callRider(BuildContext context, String phone, {ExternalLinkOpener open = openExternalLink}) {
  if (open('tel:$phone')) return;
  Clipboard.setData(ClipboardData(text: phone));
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
    SnackBar(content: Text('Number copied: $phone')),
  );
}

/// The rider card under the tracking map and at the bottom of the
/// full-screen map (owner, 2026-10-10): the bike, "Kamal is on the way",
/// "Arriving in ~6 min" when the backend has a road time, and "Call rider"
/// when the backend sent the rider's phone. Every line is backend data;
/// nothing is shown that was not sent.
class RiderContactCard extends StatelessWidget {
  const RiderContactCard({
    super.key,
    required this.headline,
    this.contact,
    this.eta,
    this.heading,
    this.openLink = openExternalLink,
  });

  /// "Kamal is on the way" / "Your rider has arrived".
  final String headline;
  final RiderContact? contact;

  /// "Arriving in ~6 min", or null to show no time.
  final String? eta;

  /// The bike glyph turns with the rider on the map.
  final double? heading;

  final ExternalLinkOpener openLink;

  /// "Kamal" - or "Your rider" when the backend has no name for them.
  static String riderName(RiderContact? contact) => contact?.firstName ?? 'Your rider';

  static const double _glyph = 40;

  @override
  Widget build(BuildContext context) {
    final phone = contact?.phone;
    return Container(
      key: const Key('rider-contact-card'),
      width: double.infinity,
      padding: const EdgeInsets.all(BlynkSpace.s16),
      decoration: appCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              ExcludeSemantics(child: RiderBikeGlyph(size: _glyph, heading: heading)),
              const SizedBox(width: BlynkSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(headline, style: BlynkText.label.copyWith(color: BlynkColors.ink)),
                    if (eta != null) ...[
                      const SizedBox(height: BlynkSpace.s4),
                      Text(
                        eta!,
                        key: const Key('rider-eta'),
                        style: BlynkText.body.copyWith(color: BlynkColors.positiveInk, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (phone != null) ...[
            const SizedBox(height: BlynkSpace.s12),
            BlynkButton.secondary(
              key: const Key('call-rider'),
              label: 'Call rider',
              leadingIcon: Icons.call_outlined,
              expand: true,
              onPressed: () => callRider(context, phone, open: openLink),
            ),
          ],
        ],
      ),
    );
  }
}
