import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/product.provider.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

// Placeholder text is ink2 (4.83:1 on the well), not the retired 2.54:1 muted
// grey.
final TextStyle _placeholder = BlynkText.body.copyWith(color: BlynkColors.ink2);

/// Home's search entry: a full-width field directly under the address block.
///
/// It is a button styled as a field — typing happens on the dedicated search
/// screen, so Home never rebuilds per keystroke. It wears the same recipe as
/// the app's one real text field (`BlynkTextField`): a `well` fill, the `md`
/// radius and a `lineStrong` boundary, so tapping through to Search is
/// visually continuous rather than a jump between two different field looks.
///
/// 2026-09-24 (restored): this field was briefly replaced by a circular search
/// icon in the brand row. The customer asked for the reference's prominent
/// search bar back, and a field that reads as a field is also the larger,
/// more discoverable target. The brand row's circular search button went with
/// this restoration — two search affordances on one screen is duplicate
/// chrome, and the field is the better of the two.
///
/// There is deliberately **no microphone**: the app has no voice search, and a
/// control that does nothing is worse than no control at all.
class HomeScreenSearchBar extends StatelessWidget {
  const HomeScreenSearchBar({super.key});

  /// A search bar stretched across a desktop browser stops reading as a
  /// search field - cap it like a typical desktop search bar.
  static const double desktopMaxWidth = 640;
  static const double tabletMaxWidth = 520;

  /// The placeholder, identical to the Search screen's own hint so the two
  /// surfaces read as one field.
  static const String placeholder = 'Search groceries & essentials';

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final gutter = BlynkSpace.gutterFor(responsive.width);

    return SliverToBoxAdapter(
      child: Container(
        color: BlynkColors.paper,
        width: double.infinity,
        alignment: Alignment.center,
        padding: EdgeInsets.fromLTRB(
          gutter,
          BlynkSpace.s8,
          gutter,
          BlynkSpace.s12,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: responsive.isDesktop
                ? desktopMaxWidth
                : (responsive.isTablet ? tabletMaxWidth : double.infinity),
          ),
          child: Semantics(
            button: true,
            label: 'Search groceries and essentials',
            excludeSemantics: true,
            child: Material(
              color: BlynkColors.well,
              shape: const RoundedRectangleBorder(
                borderRadius: BlynkRadius.mdAll,
                side: BorderSide(color: BlynkColors.lineStrong),
              ),
              child: InkWell(
                borderRadius: BlynkRadius.mdAll,
                onTap: () => Navigator.of(context).pushNamed('/search'),
                child: ConstrainedBox(
                  constraints:
                      const BoxConstraints(minHeight: BlynkControl.minHeight),
                  child: const Row(
                    children: [
                      SizedBox(width: BlynkSpace.s16),
                      Icon(
                        BlynkIcons.search,
                        color: BlynkColors.ink,
                        size: BlynkIcons.md,
                      ),
                      SizedBox(width: BlynkSpace.s12),
                      Expanded(
                        child: Padding(
                          padding: EdgeInsets.symmetric(
                            vertical: BlynkSpace.s12,
                          ),
                          child: _RotatingHint(),
                        ),
                      ),
                      SizedBox(width: BlynkSpace.s16),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The placeholder that changes: `Search "dairy & eggs"`, then the next
/// category, each word sliding up out of the field as the next rises into
/// it (2026-09-26, asked for from the reference app).
///
/// - **Only real words.** The terms are the store's own category names from
///   the backend, so the hint never suggests something Blynk does not sell.
///   It opens on the plain [HomeScreenSearchBar.placeholder] and returns to
///   it every cycle; with no categories loaded it simply stays on it.
/// - **Reduced motion:** no rotation at all - the plain placeholder, still.
/// - It pauses while Home is covered by another route (TickerMode), so a
///   screen underneath is never animating for nobody.
/// - Screen readers hear the field's fixed label, never the rotating word.
class _RotatingHint extends StatefulWidget {
  const _RotatingHint();

  /// How long each word stays.
  static const Duration hold = Duration(seconds: 2);

  @override
  State<_RotatingHint> createState() => _RotatingHintState();
}

class _RotatingHintState extends State<_RotatingHint> {
  Timer? _timer;
  int _index = 0;

  List<String> _hints(BuildContext context) => [
        HomeScreenSearchBar.placeholder,
        for (final c in context.select<ProductProvider, List<String>>(
          (p) => [for (final c in p.categories) c.name.trim()],
        ))
          if (c.isNotEmpty) 'Search "${c.toLowerCase()}"',
      ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _timer?.cancel();
    _timer = BlynkMotion.reduced(context)
        ? null
        : Timer.periodic(_RotatingHint.hold, (_) {
            if (!mounted || !TickerMode.valuesOf(context).enabled) return;
            setState(() => _index++);
          });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hints = _hints(context);
    final text = BlynkMotion.reduced(context)
        ? HomeScreenSearchBar.placeholder
        : hints[_index % hints.length];
    return ClipRect(
      child: AnimatedSwitcher(
        duration: BlynkMotion.resolve(context, BlynkMotion.emphasized),
        switchInCurve: BlynkMotion.easeOut,
        switchOutCurve: BlynkMotion.easeIn,
        layoutBuilder: (current, previous) => Stack(
          alignment: Alignment.centerLeft,
          children: [...previous, if (current != null) current],
        ),
        transitionBuilder: (child, animation) {
          // The incoming word rises from below; the outgoing one (whose
          // animation runs backwards) leaves through the top.
          final incoming = child.key == ValueKey(text);
          final slide = Tween<Offset>(
            begin: incoming ? const Offset(0, 1) : const Offset(0, -1),
            end: Offset.zero,
          ).animate(animation);
          return SlideTransition(
            position: slide,
            child: FadeTransition(opacity: animation, child: child),
          );
        },
        child: Text(
          text,
          key: ValueKey(text),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: _placeholder,
        ),
      ),
    );
  }
}
