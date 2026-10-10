import 'package:flutter/material.dart';

import '../../../Services/app_errors.dart';
import '../../../design/tokens.dart';
import 'app_state_views.dart';
import 'doctors_sign_in_prompt.dart';
import 'offline_banner.dart';

/// A loading, error or empty state that is still one item of a scrollable, kept
/// tall enough that a downward drag always reaches the pull-to-refresh trigger,
/// so refreshing works from every state and not only when rows are showing.
class PullableState extends StatelessWidget {
  const PullableState({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: MediaQuery.sizeOf(context).height * 0.72),
      child: Center(child: child),
    );
  }
}

/// A failed load, in customer words: the offline state when the connection is
/// gone, otherwise [title] with the mapped sentence. Offers "Try again" only
/// when asking again can help ([CustomerError.retryable]).
class FailureState extends StatelessWidget {
  const FailureState({
    super.key,
    required this.failure,
    required this.title,
    required this.onRetry,
    this.retryKey,
    this.scrollable = true,
  });

  final CustomerError failure;

  /// What could not load ("Couldn't load your orders."). Unused offline, where
  /// the state names the cause instead.
  final String title;
  final VoidCallback onRetry;
  final Key? retryKey;

  /// Wraps the state in [PullableState]; off where the parent already
  /// bounds the height.
  final bool scrollable;

  @override
  Widget build(BuildContext context) {
    final retry = failure.retryable ? onRetry : null;
    final Widget view = failure.isOffline
        ? AppStateView.offline(retry, actionKey: retryKey)
        // A guest refused by the doctors section (owner, 2026-10-10): its
        // own prompt, whose login comes back to this screen.
        : failure.isDoctorsSignIn
            ? const DoctorsSignInPrompt()
        : failure.needsLogin
            // Asking again cannot help; logging in can.
            ? AppStateView.empty(
                title: failure.title,
                message: failure.message,
                actionLabel: 'Log in',
                onAction: () => Navigator.of(context).pushNamed('/login'),
                actionKey: retryKey,
              )
            : AppStateView.error(
                title: title,
                message: failure.message,
                onRetry: retry,
                actionKey: retryKey,
              );
    return scrollable ? PullableState(child: view) : view;
  }
}

/// Shown above content that is already on screen when a refresh failed: quiet,
/// because the content below is still real, and it points at the pull gesture
/// that is already there rather than adding a second retry control.
class RefreshFailedNotice extends StatelessWidget {
  const RefreshFailedNotice({super.key, required this.message, this.offline = false});

  final String message;

  /// Offline shows the offline glyph; any other failure shows a warning.
  final bool offline;

  @override
  Widget build(BuildContext context) {
    return OfflineBanner(
      message: message,
      icon: offline ? BlynkIcons.offline : BlynkIcons.warning,
    );
  }
}
