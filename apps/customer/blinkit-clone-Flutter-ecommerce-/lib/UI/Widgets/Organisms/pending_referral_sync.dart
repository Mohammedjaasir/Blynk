import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/rewards.provider.dart';
import '../Atoms/app_toast.dart';
import '../Atoms/snackbar_helper.dart';

/// Watches the session for the rewards (owner, 2026-10-10):
///
/// * when someone signs in, a friend's code kept from a shared link
///   (`ReferralLink`) is applied once and forgotten, with a short toast on
///   success; refusals are quiet;
/// * when they sign out, the previous customer's usuals, referral and points
///   are forgotten.
///
/// Renders [child] unchanged. Does nothing where no [RewardsProvider] or
/// [AuthProvider] is in the tree.
class PendingReferralSync extends StatefulWidget {
  const PendingReferralSync({super.key, required this.child});

  final Widget child;

  @override
  State<PendingReferralSync> createState() => _PendingReferralSyncState();
}

class _PendingReferralSyncState extends State<PendingReferralSync> {
  bool? _signedIn;

  void _onSession(bool signedIn) {
    final before = _signedIn;
    if (before == signedIn) return;
    _signedIn = signedIn;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final rewards = context.read<RewardsProvider?>();
      if (rewards == null) return;
      if (!signedIn) {
        if (before == true) rewards.clear();
        return;
      }
      final text = await rewards.applyPendingReferral();
      if (text != null) showAppToast(msg: text, tone: SnackTone.success);
    });
  }

  @override
  Widget build(BuildContext context) {
    _onSession(context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false));
    return widget.child;
  }
}
