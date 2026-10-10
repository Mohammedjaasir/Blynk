import 'package:flutter/material.dart';

import '../../../Services/post_login_destination.dart';
import '../../../design/tokens.dart';
import 'app_state_views.dart';

/// "Sign in to see doctors" (owner, 2026-10-10: "For the doctor thing, they
/// must add their phone number and get registered. Otherwise it should not
/// show the doctor things. If they want to go to the doctors section, they
/// must log in or create an account; then only they can see.").
///
/// Shown in place of a doctors screen to a guest while Admin/Operations keep
/// "Doctors need sign-in" on, and when the API answers a dental read with
/// 401 SIGN_IN_REQUIRED. "Log in / Sign up" runs the normal phone OTP login
/// (`/login`); a new number creates the account there. The screen the guest
/// was opening ([destination], else the current route) is remembered, so the
/// login ends on it instead of on the shop ([PostLoginDestination]). Backing
/// out of the login forgets it.
class DoctorsSignInPrompt extends StatelessWidget {
  const DoctorsSignInPrompt({super.key, this.destination});

  static const String title = 'Sign in to see doctors';
  static const String message = 'Use your phone number to log in or create an account.';
  static const String actionLabel = 'Log in / Sign up';
  static const Key actionKey = Key('doctors-sign-in-action');

  /// Where to go after the login; the current route when null.
  final RouteSettings? destination;

  Future<void> _logIn(BuildContext context) async {
    final target = destination ?? ModalRoute.of(context)?.settings;
    final name = target?.name;
    if (name != null && name.isNotEmpty) {
      PostLoginDestination.remember(name, arguments: target!.arguments);
    }
    await Navigator.of(context).pushNamed('/login');
    // Still here: the guest came back without logging in (a successful login
    // replaces the whole stack, this screen included).
    if (context.mounted) PostLoginDestination.clear();
  }

  @override
  Widget build(BuildContext context) {
    return AppStateView(
      icon: BlynkIcons.dental,
      title: title,
      message: message,
      actionLabel: actionLabel,
      actionKey: actionKey,
      onAction: () => _logIn(context),
    );
  }
}
