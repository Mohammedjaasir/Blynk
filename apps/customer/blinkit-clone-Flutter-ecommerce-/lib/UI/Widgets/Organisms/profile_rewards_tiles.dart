import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/rewards.provider.dart';
import '../Atoms/list_tile.dart';

/// Profile's rewards rows (owner, 2026-10-10): the Blynk Points balance
/// ("120 Blynk Points = LKR 120", opening the history) and "Refer a friend".
/// Each shows only while the server says its programme is on; nothing for a
/// guest, while unknown, or where no [RewardsProvider] is in the tree.
class ProfileRewardsTiles extends StatefulWidget {
  const ProfileRewardsTiles({super.key});

  static const Key pointsKey = Key('profile-points-tile');
  static const Key referKey = Key('profile-refer-tile');

  @override
  State<ProfileRewardsTiles> createState() => _ProfileRewardsTilesState();
}

class _ProfileRewardsTilesState extends State<ProfileRewardsTiles> {
  bool? _askedSignedIn;

  void _askIfNeeded(bool signedIn) {
    if (_askedSignedIn == signedIn) return;
    _askedSignedIn = signedIn;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final rewards = context.read<RewardsProvider?>();
      rewards?.loadPoints(signedIn: signedIn);
      rewards?.loadReferral(signedIn: signedIn);
    });
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false);
    _askIfNeeded(signedIn);
    final rewards = context.watch<RewardsProvider?>();
    final points = rewards?.points;
    final referral = rewards?.referral;
    if (!signedIn) return const SizedBox.shrink();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (points != null && points.enabled)
          KeyedSubtree(
            key: ProfileRewardsTiles.pointsKey,
            child: customListTile(
              icon: Icons.stars_outlined,
              title: points.balanceText,
              callback: () => Navigator.of(context).pushNamed('/points'),
            ),
          ),
        if (referral != null && referral.enabled)
          KeyedSubtree(
            key: ProfileRewardsTiles.referKey,
            child: customListTile(
              icon: Icons.card_giftcard_outlined,
              title: 'Refer a friend',
              callback: () => Navigator.of(context).pushNamed('/refer'),
            ),
          ),
      ],
    );
  }
}
