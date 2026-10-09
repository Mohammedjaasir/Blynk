import 'package:flutter/material.dart';

import '../Atoms/combo_card.dart';
import '../Atoms/entrance_fade.dart';
import '../../../Models/combo_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// Home's "Combo packs" rail (owner, 2026-10-09): the live combos from
/// GET /combos, as [ComboCard]s. Swiped sideways on a phone; on a desktop
/// browser (a mouse wheel cannot scroll sideways) the cards wrap onto as
/// many rows as they need. Draws no header - compose it under a
/// `BlynkSectionHeader`, and only when [combos] is not empty.
class ComboRail extends StatelessWidget {
  const ComboRail({super.key, required this.combos});

  final List<ComboModel> combos;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final available = constraints.hasBoundedWidth ? constraints.maxWidth : MediaQuery.sizeOf(context).width;
        final gutter = BlynkProductGrid.gutterFor(available);
        final cardWidth = ComboCard.widthFor(available, BlynkProductGrid.railCardWidthFor(available));
        final cardHeight = ComboCard.heightFor(context, cardWidth);

        Widget card(int index) => SizedBox(
          width: cardWidth,
          height: cardHeight,
          child: EntranceFade(
            key: ValueKey('combo/${combos[index].id}'),
            delay: BlynkMotion.staggerFor(index),
            child: ComboCard(combo: combos[index]),
          ),
        );

        if (available >= AppBreakpoints.desktop) {
          return Padding(
            padding: EdgeInsets.symmetric(horizontal: gutter),
            child: Wrap(
              spacing: BlynkProductGrid.railGap,
              runSpacing: BlynkProductGrid.railGap,
              children: [for (var i = 0; i < combos.length; i++) card(i)],
            ),
          );
        }

        return SizedBox(
          height: cardHeight,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: gutter),
            physics: const BouncingScrollPhysics(),
            itemCount: combos.length,
            separatorBuilder: (_, __) => const SizedBox(width: BlynkProductGrid.railGap),
            itemBuilder: (context, index) => card(index),
          ),
        );
      },
    );
  }
}
