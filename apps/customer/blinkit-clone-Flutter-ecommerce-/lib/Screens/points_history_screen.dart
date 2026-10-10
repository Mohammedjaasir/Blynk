import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/points_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/rewards.provider.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// Blynk Points (owner, 2026-10-10), from the Profile balance tile: the
/// balance and what it is worth, how the programme works (from the numbers
/// Ops / Admin set), then every earn, use, return, expiry and adjustment
/// from `GET /me/points`, with the expiry date of earned points.
class PointsHistoryScreen extends StatefulWidget {
  const PointsHistoryScreen({super.key});

  static const Key balanceKey = Key('points-balance');

  @override
  State<PointsHistoryScreen> createState() => _PointsHistoryScreenState();
}

class _PointsHistoryScreenState extends State<PointsHistoryScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  void _load() {
    if (!mounted) return;
    final signedIn = context.read<AuthProvider?>()?.isAuthenticated ?? false;
    context.read<RewardsProvider?>()?.loadPoints(signedIn: signedIn);
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false);
    final rewards = context.watch<RewardsProvider?>();
    final points = rewards?.points;

    final Widget body;
    if (!signedIn) {
      body = AppStateView.empty(
        title: 'Log in to see your points',
        actionLabel: 'Log in',
        onAction: () => Navigator.of(context).pushNamed('/login'),
      );
    } else if (points == null) {
      body = rewards == null || rewards.pointsFailed
          ? AppStateView.error(
              title: "Couldn't load your points",
              message: 'Check your connection and try again.',
              onRetry: rewards == null ? null : _load,
            )
          : const AppStateView.loading('Loading your points');
    } else if (!points.enabled) {
      body = const AppStateView.empty(
        title: 'Not available right now',
        message: "Blynk Points aren't running at the moment.",
      );
    } else {
      body = _PointsDetails(points: points);
    }

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Blynk Points')),
      body: ContentFrame(maxWidth: 720, gutter: false, child: body),
    );
  }
}

class _PointsDetails extends StatelessWidget {
  const _PointsDetails({required this.points});

  final PointsInfo points;

  @override
  Widget build(BuildContext context) {
    final how = points.program?.howItWorks ?? const <String>[];
    return ListView(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s32),
      children: [
        Container(
          padding: const EdgeInsets.all(BlynkSpace.s16),
          decoration: const BoxDecoration(color: BlynkColors.well, borderRadius: BlynkRadius.lgAll),
          child: Text(points.balanceText, key: PointsHistoryScreen.balanceKey, style: BlynkText.title),
        ),
        if (how.isNotEmpty) ...[
          const SizedBox(height: BlynkSpace.s24),
          const Text('How it works', style: BlynkText.sectionHeader),
          const SizedBox(height: BlynkSpace.s8),
          for (final line in how)
            Padding(
              padding: const EdgeInsets.only(bottom: BlynkSpace.s4),
              child: Text(line, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
            ),
        ],
        const SizedBox(height: BlynkSpace.s24),
        const Text('History', style: BlynkText.sectionHeader),
        const SizedBox(height: BlynkSpace.s8),
        if (points.history.isEmpty)
          Text(
            'No points yet. You earn them when an order is delivered.',
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          )
        else
          for (final entry in points.history) _EntryRow(entry: entry),
      ],
    );
  }
}

class _EntryRow extends StatelessWidget {
  const _EntryRow({required this.entry});

  final PointsEntry entry;

  @override
  Widget build(BuildContext context) {
    final created = entry.createdAt;
    final expires = entry.expiresAt;
    final details = [
      if (created != null) formatPointsDate(created),
      if (entry.kind == PointsEntryKind.earn && expires != null) 'Expires ${formatPointsDate(expires)}',
    ].join(' · ');
    return Padding(
      key: ValueKey('points-entry/${entry.id}'),
      padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.label, style: BlynkText.rowLabel),
                if (details.isNotEmpty) Text(details, style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
              ],
            ),
          ),
          const SizedBox(width: BlynkSpace.s12),
          Text(
            entry.pointsLabel,
            style: BlynkText.rowLabel.copyWith(color: entry.points > 0 ? BlynkColors.positiveInk : BlynkColors.ink),
          ),
        ],
      ),
    );
  }
}
