import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// One choosable favourite: a category id and the name to show.
typedef FavouriteChoice = ({String id, String name});

/// Favourite foods and snacks as multi-select chips built from Blynk's live
/// category list (owner, 2026-10-09). A chosen chip is an ink fill with a
/// check - the app's "on" look (the SMS switch, the language choice); yellow
/// stays reserved for the screen's one forward action. Each chip is a 48 dp
/// target announced as a checkbox-like toggle.
class FavouriteCategoryChips extends StatelessWidget {
  const FavouriteCategoryChips({
    super.key,
    required this.choices,
    required this.selected,
    required this.onChanged,
    this.enabled = true,
    this.maxSelected = maxFavourites,
  });

  /// The backend keeps at most 20 favourites (PATCH /me).
  static const int maxFavourites = 20;

  final List<FavouriteChoice> choices;
  final Set<String> selected;
  final ValueChanged<Set<String>> onChanged;
  final bool enabled;
  final int maxSelected;

  static Key chipKey(String id) => ValueKey('favourite-chip/$id');

  @override
  Widget build(BuildContext context) {
    final full = selected.length >= maxSelected;
    return Wrap(
      spacing: BlynkSpace.s8,
      runSpacing: BlynkSpace.s8,
      children: [
        for (final choice in choices)
          _Chip(
            key: chipKey(choice.id),
            label: choice.name,
            selected: selected.contains(choice.id),
            onTap: !enabled || (full && !selected.contains(choice.id))
                ? null
                : () {
                    final next = {...selected};
                    if (!next.remove(choice.id)) next.add(choice.id);
                    onChanged(next);
                  },
          ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? BlynkColors.onInk : (onTap == null ? BlynkColors.ink3 : BlynkColors.ink);
    return Semantics(
      button: true,
      toggled: selected,
      enabled: onTap != null,
      label: label,
      excludeSemantics: true,
      child: ConstrainedBox(
        // The drawn pill is 40 tall; the target is the 48 dp floor.
        constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
        child: Center(
          widthFactor: 1,
          child: Material(
            color: selected ? BlynkColors.ink : BlynkColors.paper,
            shape: RoundedRectangleBorder(
              borderRadius: BlynkRadius.full,
              side: BorderSide(
                color: selected ? BlynkColors.ink : BlynkColors.lineStrong,
                width: BlynkControl.outlineWidth,
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (selected) ...[
                      const Icon(Icons.check, size: BlynkIcons.xs, color: BlynkColors.onInk),
                      const SizedBox(width: BlynkSpace.s4),
                    ],
                    Flexible(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: BlynkText.label.copyWith(color: fg),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
