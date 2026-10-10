import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/Auth/birthday_prompt_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/rewards.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/design/tokens.dart';

/// "What's your name?" - shown once, right after the SMS code, to a customer
/// whose account has no name yet (owner, 2026-10-08). The rider sees it on
/// the order and staff in Admin; it is saved to the account (PATCH /me).
class NameCaptureScreen extends StatefulWidget {
  const NameCaptureScreen({super.key});

  static const String route = '/auth/name';
  static const Key fieldKey = Key('name-capture-field');
  static const Key referralFieldKey = Key('name-capture-referral-field');

  @override
  State<NameCaptureScreen> createState() => _NameCaptureScreenState();
}

class _NameCaptureScreenState extends State<NameCaptureScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _saving = false;

  // Optional friend's code at sign-up, while the programme is on and this
  // new customer can still use one (owner, 2026-10-10).
  final _referralController = TextEditingController();
  String? _referralError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<RewardsProvider?>()?.loadReferral(signedIn: true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _referralController.dispose();
    super.dispose();
  }

  bool _offersReferral(RewardsProvider? r) => (r?.referral?.enabled ?? false) && (r?.referral?.canApplyCode ?? false);

  Future<void> _save() async {
    final name = _controller.text.trim();
    if (name.length < AuthProvider.nameMinLength) {
      setState(() => _error = 'Enter your name (at least ${AuthProvider.nameMinLength} letters).');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _referralError = null;
    });
    // The friend's code first, so a refused one keeps the customer here to
    // fix or clear it (owner, 2026-10-10).
    final rewards = context.read<RewardsProvider?>();
    final referralCode = _referralController.text.trim();
    if (rewards != null && referralCode.isNotEmpty && _offersReferral(rewards)) {
      final outcome = await rewards.applyReferralCode(referralCode);
      if (!mounted) return;
      if (!outcome.ok) {
        setState(() {
          _saving = false;
          _referralError = outcome.error;
        });
        return;
      }
    }
    if (!mounted) return;
    try {
      await context.read<AuthProvider>().saveName(name);
      if (!mounted) return;
      // First sign-up only: one skippable birthday prompt, then the shop
      // (owner, 2026-10-09). Nothing else ever leads to it.
      Navigator.of(context).pushNamedAndRemoveUntil(BirthdayPromptScreen.route, (route) => false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = AppErrors.from(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(automaticallyImplyLeading: false, title: const Text('Welcome to Blynk')),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s24, BlynkSpace.s16, BlynkSpace.s32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text("What's your name?", style: BlynkText.title),
                const SizedBox(height: BlynkSpace.s8),
                Text(
                  'So your rider knows who to hand your order to.',
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
                const SizedBox(height: BlynkSpace.s24),
                BlynkTextField(
                  key: NameCaptureScreen.fieldKey,
                  label: 'Your name',
                  hintText: 'e.g. Nimal Perera',
                  controller: _controller,
                  autofocus: true,
                  maxLength: 60,
                  keyboardType: TextInputType.name,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.name],
                  errorText: _error,
                  onSubmitted: (_) => _save(),
                ),
                if (context.select<RewardsProvider?, bool>(_offersReferral)) ...[
                  const SizedBox(height: BlynkSpace.s16),
                  BlynkTextField(
                    key: NameCaptureScreen.referralFieldKey,
                    label: 'Referral code (optional)',
                    helperText: "Got a friend's code? Enter it for a reward on your first order.",
                    controller: _referralController,
                    maxLength: 32,
                    textCapitalization: TextCapitalization.characters,
                    textInputAction: TextInputAction.done,
                    errorText: _referralError,
                    onSubmitted: (_) => _save(),
                  ),
                ],
                const SizedBox(height: BlynkSpace.s24),
                BlynkButton.primary(
                  label: 'Continue',
                  expand: true,
                  loading: _saving,
                  onPressed: _save,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
