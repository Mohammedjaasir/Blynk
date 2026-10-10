import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../Models/referral_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/rewards.provider.dart';
import '../Services/share_links.dart';
import '../Services/analytics/analytics.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Atoms/snackbar_helper.dart';
import '../app_design.dart' show appCardDecoration;
import '../app_responsive.dart';
import '../design/tokens.dart';

/// Refer a friend (owner, 2026-10-10), from Profile.
///
/// Shows this customer's code with Share and Copy, the reward in words built
/// from `GET /me/referral` (never an amount the server did not send), how
/// many friends joined and were rewarded, the rewards waiting for the next
/// order, and - while the server says this customer may still use one - a
/// field for a friend's code. The share link is `<SHARE_BASE_URL>/app/?ref=`
/// only when that address is configured; otherwise just the code is shared.
class ReferFriendScreen extends StatefulWidget {
  const ReferFriendScreen({super.key});

  static const Key codeKey = Key('referral-code');
  static const Key shareKey = Key('referral-share');
  static const Key applyFieldKey = Key('referral-apply-field');
  static const Key applyButtonKey = Key('referral-apply');

  @override
  State<ReferFriendScreen> createState() => _ReferFriendScreenState();
}

class _ReferFriendScreenState extends State<ReferFriendScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  void _load() {
    if (!mounted) return;
    final signedIn = context.read<AuthProvider?>()?.isAuthenticated ?? false;
    context.read<RewardsProvider?>()?.loadReferral(signedIn: signedIn);
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider?, bool>((a) => a?.isAuthenticated ?? false);
    final rewards = context.watch<RewardsProvider?>();
    final info = rewards?.referral;

    final Widget body;
    if (!signedIn) {
      body = AppStateView.empty(
        title: 'Log in to refer a friend',
        message: 'Your referral code is part of your account.',
        actionLabel: 'Log in',
        onAction: () => Navigator.of(context).pushNamed('/login'),
      );
    } else if (info == null) {
      body = rewards == null || !rewards.isLoadingReferral
          ? AppStateView.error(
              title: "Couldn't load your referral code",
              message: 'Check your connection and try again.',
              onRetry: rewards == null ? null : _load,
            )
          : const AppStateView.loading('Loading your referral code');
    } else if (!info.enabled) {
      body = const AppStateView.empty(
        title: 'Not available right now',
        message: "Refer a friend isn't running at the moment. Check back later.",
      );
    } else {
      body = _ReferralDetails(info: info);
    }

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Refer a friend')),
      body: ContentFrame(maxWidth: 720, gutter: false, child: body),
    );
  }
}

class _ReferralDetails extends StatelessWidget {
  const _ReferralDetails({required this.info});

  final ReferralInfo info;

  @override
  Widget build(BuildContext context) {
    final reward = info.reward;
    final by = info.referredBy;
    return ListView(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s32),
      children: [
        if (reward != null) ...[
          const Text('Give a reward, get a reward', style: BlynkText.title),
          const SizedBox(height: BlynkSpace.s8),
          Text(reward.description, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
          const SizedBox(height: BlynkSpace.s24),
        ],
        if (info.code.isNotEmpty) _CodeCard(code: info.code),
        const SizedBox(height: BlynkSpace.s24),
        Row(
          children: [
            Expanded(child: _Stat(value: info.invitedCount, label: 'Friends joined')),
            const SizedBox(width: BlynkSpace.s12),
            Expanded(child: _Stat(value: info.rewardedCount, label: 'Rewards earned')),
          ],
        ),
        if (info.credits.isNotEmpty) ...[
          const SizedBox(height: BlynkSpace.s24),
          const Text('Waiting for your next order', style: BlynkText.sectionHeader),
          const SizedBox(height: BlynkSpace.s8),
          for (final credit in info.credits)
            Padding(
              padding: const EdgeInsets.only(bottom: BlynkSpace.s4),
              child: Row(
                children: [
                  const Icon(Icons.card_giftcard_outlined, size: BlynkIcons.md, color: BlynkColors.positiveInk),
                  const SizedBox(width: BlynkSpace.s8),
                  Expanded(child: Text(credit.label, style: BlynkText.body)),
                ],
              ),
            ),
          Text(
            'Taken off automatically when it is your biggest saving.',
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
        ],
        if (by != null) ...[
          const SizedBox(height: BlynkSpace.s24),
          Text(
            by.firstName == null ? 'A friend invited you to Blynk.' : '${by.firstName} invited you to Blynk.',
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
        ],
        if (info.canApplyCode) ...[
          const SizedBox(height: BlynkSpace.s24),
          const ReferralApplyField(),
        ],
      ],
    );
  }
}

class _CodeCard extends StatelessWidget {
  const _CodeCard({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Your code', style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
          const SizedBox(height: BlynkSpace.s4),
          SelectableText(code, key: ReferFriendScreen.codeKey, style: BlynkText.headline),
          const SizedBox(height: BlynkSpace.s16),
          BlynkButton.primary(
            key: ReferFriendScreen.shareKey,
            label: 'Share your code',
            leadingIcon: BlynkIcons.share,
            expand: true,
            onPressed: () {
              Analytics.instance.share(contentType: 'referral'); // owner, 2026-10-10; never the code
              Share.share(ShareLinks.referralShareText(code), subject: 'Join me on Blynk');
            },
          ),
          const SizedBox(height: BlynkSpace.s8),
          BlynkButton.tertiary(
            label: 'Copy code',
            expand: true,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: code));
              if (!context.mounted) return;
              showBlynkSnackBar(context: context, message: 'Code copied', tone: SnackTone.success);
            },
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final int value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(BlynkSpace.s12),
      decoration: const BoxDecoration(color: BlynkColors.well, borderRadius: BlynkRadius.mdAll),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$value', style: BlynkText.title),
          Text(label, style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
        ],
      ),
    );
  }
}

/// "Have a friend's code?": applies one via `POST /me/referral/apply`
/// (owner, 2026-10-10). Shown only while the server says this customer can
/// still use one.
class ReferralApplyField extends StatefulWidget {
  const ReferralApplyField({super.key});

  @override
  State<ReferralApplyField> createState() => _ReferralApplyFieldState();
}

class _ReferralApplyFieldState extends State<ReferralApplyField> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final rewards = context.read<RewardsProvider?>();
    if (rewards == null || rewards.isApplyingReferral) return;
    FocusScope.of(context).unfocus();
    setState(() => _error = null);
    final outcome = await rewards.applyReferralCode(_controller.text);
    if (!mounted) return;
    if (outcome.ok) {
      _controller.clear();
      showBlynkSnackBar(context: context, message: outcome.successText, tone: SnackTone.success);
    } else {
      setState(() => _error = outcome.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final applying = context.select<RewardsProvider?, bool>((r) => r?.isApplyingReferral ?? false);
    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text("Have a friend's code?", style: BlynkText.rowLabel),
          const SizedBox(height: BlynkSpace.s8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: BlynkTextField(
                  key: ReferFriendScreen.applyFieldKey,
                  label: 'Referral code',
                  controller: _controller,
                  textCapitalization: TextCapitalization.characters,
                  textInputAction: TextInputAction.done,
                  maxLength: 32,
                  showClear: false,
                  enabled: !applying,
                  errorText: _error,
                  onSubmitted: (_) => _apply(),
                ),
              ),
              const SizedBox(width: BlynkSpace.s8),
              Padding(
                padding: const EdgeInsets.only(top: BlynkSpace.s4),
                child: BlynkButton.secondary(
                  key: ReferFriendScreen.applyButtonKey,
                  label: 'Apply',
                  loading: applying,
                  onPressed: _apply,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
