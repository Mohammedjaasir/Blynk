import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/store_info.provider.dart';
import '../../../design/tokens.dart';
import '../Atoms/doctors_sign_in_prompt.dart';

/// Guards every way into the doctors section - Home's "Channel doctors"
/// row, a deep link or push into a clinic, a doctor's profile or booking
/// (owner, 2026-10-10: "If they want to go to the doctors section, they must
/// log in or create an account; then only they can see").
///
/// While "Doctors need sign-in" is on (`doctors_require_sign_in` on
/// GET /store; on when unknown) and nobody is signed in, the screen is the
/// [DoctorsSignInPrompt] instead of [child]; its login comes back to
/// [destination]. Signed in, or with the switch off, [child] shows as before.
/// Rebuilds when either changes, so logging in (or Ops turning the switch
/// off) opens the screen in place. Without an [AuthProvider] in the tree
/// (isolated widget tests) it does not guard.
class DentalSignInGate extends StatelessWidget {
  const DentalSignInGate({super.key, required this.destination, required this.child});

  final RouteSettings destination;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider?>();
    final required = watchDoctorsRequireSignIn(context);
    if (auth == null || auth.isAuthenticated || !required) return child;
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Channel doctors')),
      body: SafeArea(child: Center(child: DoctorsSignInPrompt(destination: destination))),
    );
  }
}
