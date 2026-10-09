import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Providers/profile.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/date_of_birth_picker.dart';
import 'package:ecom/design/tokens.dart';

/// "Tell us your birthday for a gift" - shown ONCE, right after the name
/// step on first sign-up (owner, 2026-10-09), and never again: it is reached
/// only from `NameCaptureScreen`, which only a new account sees. Completely
/// optional: Skip goes straight to the shop, and the date can be added or
/// changed any time in Profile > About you.
///
/// Kept light on purpose - just the date of birth. Favourites live in
/// About you.
class BirthdayPromptScreen extends StatefulWidget {
  const BirthdayPromptScreen({super.key, this.provider, this.today});

  static const String route = '/auth/birthday';
  static const Key skipKey = Key('birthday-prompt-skip');
  static const Key saveKey = Key('birthday-prompt-save');

  /// Injectable for tests; the screen makes its own otherwise.
  final ProfileProvider? provider;

  /// Injectable for tests (the date-of-birth range).
  final DateTime? today;

  @override
  State<BirthdayPromptScreen> createState() => _BirthdayPromptScreenState();
}

class _BirthdayPromptScreenState extends State<BirthdayPromptScreen> {
  late final ProfileProvider _profile = widget.provider ?? ProfileProvider();
  DateTime? _dateOfBirth;
  String? _error;

  @override
  void dispose() {
    if (widget.provider == null) _profile.dispose();
    super.dispose();
  }

  void _home() => Navigator.of(context).pushNamedAndRemoveUntil('/home', (route) => false);

  Future<void> _save() async {
    final date = _dateOfBirth;
    if (date == null) return;
    setState(() => _error = null);
    final saved = await _profile.saveAboutYou(
      ProfileProvider.aboutYouChanges(dateOfBirth: date),
    );
    if (!mounted) return;
    if (!saved) {
      setState(() => _error = _profile.failure?.message);
      return;
    }
    // A birthday this week opens the gift at once (Home's banner).
    context.read<StoreInfoProvider?>()?.applyBirthdayOffer(_profile.profile?.birthdayOffer);
    _home();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(automaticallyImplyLeading: false, title: const Text('Welcome to Blynk')),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: BlynkForm.narrowMaxWidth),
          child: ListenableBuilder(
            listenable: _profile,
            builder: (context, _) {
              final saving = _profile.isSavingAboutYou;
              return SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s24, BlynkSpace.s16, BlynkSpace.s32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(BlynkIcons.birthday, size: BlynkIcons.lg, color: BlynkColors.ink),
                    const SizedBox(height: BlynkSpace.s12),
                    Semantics(
                      header: true,
                      child: const Text('Tell us your birthday for a gift', style: BlynkText.title),
                    ),
                    const SizedBox(height: BlynkSpace.s8),
                    Text(
                      'Get a little something off one order in your birthday week. '
                      "It's optional, and you can change it any time in Profile.",
                      style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                    ),
                    const SizedBox(height: BlynkSpace.s24),
                    DateOfBirthField(
                      value: _dateOfBirth,
                      enabled: !saving,
                      today: widget.today,
                      onChanged: (date) => setState(() {
                        _dateOfBirth = date;
                        _error = null;
                      }),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: BlynkSpace.s8),
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          _error!,
                          key: const Key('birthday-prompt-error'),
                          style: BlynkText.caption.copyWith(color: BlynkColors.problem),
                        ),
                      ),
                    ],
                    const SizedBox(height: BlynkSpace.s24),
                    BlynkButton.primary(
                      key: BirthdayPromptScreen.saveKey,
                      label: 'Save birthday',
                      expand: true,
                      loading: saving,
                      onPressed: _dateOfBirth == null ? null : _save,
                    ),
                    const SizedBox(height: BlynkSpace.s8),
                    BlynkButton.tertiary(
                      key: BirthdayPromptScreen.skipKey,
                      label: 'Skip',
                      semanticLabel: 'Skip, go to the shop',
                      expand: true,
                      onPressed: saving ? null : _home,
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
