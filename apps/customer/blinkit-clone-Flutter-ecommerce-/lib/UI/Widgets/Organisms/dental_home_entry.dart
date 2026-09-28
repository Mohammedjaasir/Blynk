import 'package:flutter/material.dart';

import '../../../Services/store_info.dart';
import '../../../design/tokens.dart';

/// Home's always-visible entry point into the dental clinics feature
/// (task F5). Placed right after Categories, so it is reachable without
/// scrolling past every product rail - deliberately NOT tucked away only
/// under Profile (common.md's explicit instruction for this task).
///
/// Styled as one full-width row using the same card affordance
/// `category_widget.dart`'s tiles use (`BlynkColors.well`, the chip radius)
/// rather than a grid tile or a new promotional carousel slide - a small
/// icon/label entry point is enough for a phase-1 feature, per the brief's
/// explicit instruction not to build a hero banner for it.
///
/// W8 re-skin: this was the last file in `lib/UI` still on the legacy
/// `AppSpacing` / `AppRadius` / `AppTextColors` shims, and its trailing
/// chevron was `AppTextColors.muted` - **2.54:1**, a live contrast failure
/// and the app's last `muted` usage. The chevron is now `BlynkColors.ink2`
/// (the muted *text* role, 4.83:1 on paper and comfortably over the 3:1
/// non-text floor on `well`). The token was tuned, not the floor.
class DentalHomeEntry extends StatelessWidget {
  const DentalHomeEntry({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, 0, BlynkSpace.s16, BlynkSpace.s8),
      child: Semantics(
        button: true,
        label: 'Channel doctors in ${StoreInfo.hubName}. Book an appointment with a doctor near you.',
        excludeSemantics: true,
        child: InkWell(
          key: const Key('dental-clinics-entry'),
          borderRadius: BlynkWell.radius,
          onTap: () => Navigator.of(context).pushNamed('/dental/clinics'),
          child: Container(
            constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
            padding: const EdgeInsets.all(BlynkSpace.s12),
            decoration: const BoxDecoration(
              color: BlynkColors.well,
              borderRadius: BlynkWell.radius,
            ),
            child: Row(
              children: [
                const Icon(BlynkIcons.dental, color: BlynkColors.ink2, size: BlynkIcons.lg),
                const SizedBox(width: BlynkSpace.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Channel doctors', style: BlynkText.heading),
                      const SizedBox(height: BlynkSpace.s4),
                      Text(
                        'Book a doctor in ${StoreInfo.hubName}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: BlynkSpace.s8),
                const Icon(BlynkIcons.chevron, color: BlynkColors.ink2),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
