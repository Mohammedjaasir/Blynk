import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/connectivity_hint.dart';
import 'offline_banner.dart';
import '../../../design/motion.dart';
import 'blynk_crossfade.dart';

/// The [OfflineBanner] while the last network call failed for lack of a
/// connection and the screen is showing saved content ([hasContent]).
///
/// It listens to the [ConnectivityHint] itself and shows nothing when the app
/// has none in its provider tree, so a screen can carry it without every host
/// having to provide one.
class ConnectivityBanner extends StatefulWidget {
  const ConnectivityBanner({super.key, required this.hasContent, this.onRetry});

  /// True when saved content (products, results, a cart) is on screen. With
  /// nothing to show, the screen's own offline state speaks instead.
  final bool hasContent;
  final VoidCallback? onRetry;

  @override
  State<ConnectivityBanner> createState() => _ConnectivityBannerState();
}

class _ConnectivityBannerState extends State<ConnectivityBanner> {
  ConnectivityHint? _hint;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    ConnectivityHint? next;
    try {
      next = Provider.of<ConnectivityHint>(context, listen: false);
    } on ProviderNotFoundException {
      next = null;
    }
    if (!identical(next, _hint)) {
      _hint?.removeListener(_changed);
      _hint = next;
      next?.addListener(_changed);
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _hint?.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final offline = _hint?.isOffline ?? false;
    final show = offline && widget.hasContent;
    // The banner arrives and leaves over one beat: its height grows from
    // nothing while it fades in, and the reverse on the way out, so the
    // content beneath it moves with it rather than jumping. Nothing here
    // runs while the banner is at rest, shown or hidden.
    final fade = BlynkCrossfade(
      child: show
          ? OfflineBanner(key: const ValueKey('offline-banner-on'), onRetry: widget.onRetry)
          : const SizedBox(key: ValueKey('offline-banner-off'), width: double.infinity, height: 0),
    );
    // Under reduced motion the size step is skipped outright rather than run
    // at zero length: a zero-duration AnimatedSize completes inside its own
    // layout pass and asserts (RenderAnimatedSize mutated in performLayout).
    if (BlynkMotion.reduced(context)) return fade;
    return AnimatedSize(
      duration: BlynkMotion.base,
      curve: BlynkMotion.easeOut,
      alignment: Alignment.topCenter,
      child: fade,
    );
  }
}
