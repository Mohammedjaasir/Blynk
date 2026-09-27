import 'package:flutter/material.dart';

import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// One top-level destination of an [AdaptiveScaffold].
class AdaptiveDestination {
  const AdaptiveDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    this.hasBadge = false,
    this.badgeDescription,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;

  /// A small dot on the icon; [badgeDescription] is what a screen reader
  /// adds after the label, since a dot alone says nothing.
  final bool hasBadge;
  final String? badgeDescription;

  String get semanticLabel =>
      hasBadge && badgeDescription != null ? '$label, $badgeDescription' : label;
}

/// The app frame that turns navigation into the right control for the width
/// it is given (the ladder in `app_responsive.dart`):
///
///  * compact (< 600): a 64 dp bottom bar,
///  * medium (600-1023): an 80 dp navigation rail,
///  * expanded (>= 1024): a 240 dp extended rail.
///
/// [body] fills the rest. [cartBar] sits at the bottom of the content area
/// (above the bottom bar when compact) and takes no room while it renders
/// nothing.
class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({
    super.key,
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.body,
    this.cartBar,
  }) : assert(destinations.length >= 2);

  final List<AdaptiveDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final Widget body;
  final Widget? cartBar;

  static const double barHeight = 64;
  static const double railWidth = 80;
  static const double extendedRailWidth = 240;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // The page canvas, not the nav surface (BlynkNav.surface is that).
      backgroundColor: BlynkColors.paper,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final width =
              constraints.hasBoundedWidth ? constraints.maxWidth : MediaQuery.sizeOf(context).width;
          final cls = Responsive.classOf(width);

          if (cls == ResponsiveClass.compact) {
            return Column(
              children: [
                Expanded(
                  // The bar below owns the bottom inset.
                  child: MediaQuery.removePadding(
                    context: context,
                    removeBottom: true,
                    child: body,
                  ),
                ),
                if (cartBar != null) cartBar!,
                _BottomBar(
                  destinations: destinations,
                  selectedIndex: selectedIndex,
                  onSelected: onSelected,
                ),
              ],
            );
          }

          final extended = cls == ResponsiveClass.expanded;
          return Row(
            children: [
              _Rail(
                destinations: destinations,
                selectedIndex: selectedIndex,
                onSelected: onSelected,
                extended: extended,
              ),
              const VerticalDivider(width: 1, thickness: 1, color: BlynkNav.divider),
              Expanded(
                // The rail's own SafeArea covers the left/top; the content
                // column keeps clear of the bottom and right system insets
                // (gesture bar, cutout) and passes the rest down as zero.
                child: SafeArea(
                  left: false,
                  top: false,
                  child: Column(
                    children: [
                      Expanded(child: body),
                      if (cartBar != null) cartBar!,
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The dot on a nav icon: [BlynkNav.badgeDot] with a [BlynkNav.badgeDotBorder]
/// ring. The token is neutral `ink`, not `problem` — see [BlynkNav.badgeDot]
/// for why a normal in-progress delivery must not be red. The dot never
/// carries meaning on its own either: the destination's
/// [AdaptiveDestination.badgeDescription] is spoken with the label (see
/// [AdaptiveDestination.semanticLabel]).
Widget _dot(Widget icon) => Stack(
      clipBehavior: Clip.none,
      children: [
        icon,
        const Positioned(
          key: ValueKey('nav-badge-dot'),
          right: -2,
          top: -2,
          child: SizedBox(
            width: 10,
            height: 10,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: BlynkNav.badgeDot,
                shape: BoxShape.circle,
                border: Border.fromBorderSide(
                  BorderSide(color: BlynkNav.badgeDotBorder, width: 2),
                ),
              ),
            ),
          ),
        ),
      ],
    );

class _BottomBar extends StatelessWidget {
  const _BottomBar({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<AdaptiveDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BlynkNav.surface,
        border: Border(top: BorderSide(color: BlynkNav.divider)),
      ),
      child: SafeArea(
        top: false,
        // 64 dp at the design size; it grows with the text scale so a large
        // system font never clips a label.
        child: ConstrainedBox(
          key: const ValueKey('adaptive-bottom-bar'),
          constraints: const BoxConstraints(minHeight: AdaptiveScaffold.barHeight),
          child: IntrinsicHeight(
            child: FocusTraversalGroup(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < destinations.length; i++)
                    Expanded(
                      child: _BarItem(
                        destination: destinations[i],
                        selected: i == selectedIndex,
                        onTap: () => onSelected(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BarItem extends StatefulWidget {
  const _BarItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final AdaptiveDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_BarItem> createState() => _BarItemState();
}

class _BarItemState extends State<_BarItem> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final d = widget.destination;
    final selected = widget.selected;
    final iconColor = selected ? BlynkNav.selectedIcon : BlynkNav.unselectedIcon;
    final labelColor = selected ? BlynkNav.selectedLabel : BlynkNav.unselectedLabel;

    // One Icon, always: the glyph swaps between its outlined and filled
    // forms while the colour tweens over one fast beat. A null-begin tween
    // starts at rest, so the first build does not fade the icon in.
    final motion = BlynkMotion.resolve(context, BlynkMotion.base);
    Widget icon = TweenAnimationBuilder<Color?>(
      tween: ColorTween(end: iconColor),
      duration: motion,
      curve: BlynkMotion.easeOut,
      builder: (context, color, _) => Icon(
        selected ? d.selectedIcon : d.icon,
        size: BlynkNav.iconSize,
        color: color,
      ),
    );
    if (d.hasBadge) icon = _dot(icon);

    return Semantics(
      button: true,
      selected: selected,
      label: d.semanticLabel,
      onTap: widget.onTap,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.all(BlynkSpace.s4),
        child: DecoratedBox(
          key: ValueKey('nav-focus-${d.label}'),
          // Focus is a 2 dp ink outline, not colour alone.
          position: DecorationPosition.foreground,
          decoration: BoxDecoration(
            borderRadius: BlynkRadius.mdAll,
            border: _focused ? Border.all(color: BlynkColors.ink, width: 2) : null,
          ),
          child: InkWell(
            borderRadius: BlynkRadius.mdAll,
            onTap: widget.onTap,
            onFocusChange: (focused) => setState(() => _focused = focused),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // 2026-09 redesign (spec §3 "Bottom nav"): the selected item
                // sits on a `signal` rounded-square tile behind the icon
                // (was a 3 dp bar above it).
                // The tile's fill moves over one fast beat: the yellow is
                // seen to arrive on the new tab and leave the old one.
                AnimatedContainer(
                  key: ValueKey('nav-indicator-${d.label}'),
                  duration: motion,
                  curve: BlynkMotion.easeOut,
                  padding: BlynkNav.tilePadding,
                  decoration: BoxDecoration(
                    color: selected ? BlynkNav.selectedTile : BlynkNav.unselectedTile,
                    borderRadius: BlynkNav.tileRadius,
                  ),
                  child: icon,
                ),
                const SizedBox(height: 2),
                // The label keeps its own style - tests and screen readers
                // read it - and only its colour rides the tile's beat.
                TweenAnimationBuilder<Color?>(
                  tween: ColorTween(end: labelColor),
                  duration: motion,
                  curve: BlynkMotion.easeOut,
                  builder: (context, color, _) => Text(
                    d.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: BlynkNav.label.copyWith(
                      fontWeight: FontWeight.w700,
                      color: color,
                    ),
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

class _Rail extends StatelessWidget {
  const _Rail({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.extended,
  });

  final List<AdaptiveDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final bool extended;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      right: false,
      child: NavigationRail(
        key: const ValueKey('adaptive-rail'),
        extended: extended,
        minWidth: AdaptiveScaffold.railWidth,
        minExtendedWidth: AdaptiveScaffold.extendedRailWidth,
        selectedIndex: selectedIndex,
        onDestinationSelected: onSelected,
        labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
        backgroundColor: BlynkNav.surface,
        // T2: the rail's selected state is the SAME treatment as the compact
        // bar's — a filled glyph on a `signal` rounded-square tile (plan §9,
        // BlynkNav.selectedTile). A previous pass left the rail on a quiet
        // `well` pill, so one component presented two different selected
        // states depending on the width it was given.
        indicatorColor: BlynkNav.selectedTile,
        indicatorShape: const RoundedRectangleBorder(borderRadius: BlynkNav.tileRadius),
        selectedIconTheme: const IconThemeData(
          color: BlynkNav.selectedIcon,
          size: BlynkNav.iconSize,
        ),
        unselectedIconTheme: const IconThemeData(
          color: BlynkNav.unselectedIcon,
          size: BlynkNav.iconSize,
        ),
        selectedLabelTextStyle: BlynkNav.label.copyWith(
          fontWeight: FontWeight.w700,
          color: BlynkNav.selectedLabel,
        ),
        unselectedLabelTextStyle: BlynkNav.label.copyWith(
          fontWeight: FontWeight.w700,
          color: BlynkNav.unselectedLabel,
        ),
        destinations: [
          for (final d in destinations)
            NavigationRailDestination(
              icon: d.hasBadge ? _dot(Icon(d.icon)) : Icon(d.icon),
              selectedIcon: d.hasBadge ? _dot(Icon(d.selectedIcon)) : Icon(d.selectedIcon),
              label: Text(d.label),
              padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s4),
            ),
        ],
      ),
    );
  }
}
