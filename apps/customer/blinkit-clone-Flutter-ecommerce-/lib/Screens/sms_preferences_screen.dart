import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_responsive.dart';
import '../design/tokens.dart';
import '../Models/user_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/profile.provider.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_spinner.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/snackbar_helper.dart';

/// Profile -> SMS & offers: the language offer SMS arrive in, and the
/// "Offers by SMS" switch. Every offer SMS ends by pointing here
/// ("Blynk app > Profile > SMS & offers"), so that label is fixed.
///
/// Both settings save the moment they change (PATCH /me). A failed save puts
/// the old value back and says why.
class SmsPreferencesScreen extends StatefulWidget {
  const SmsPreferencesScreen({super.key, this.provider, this.languageChoice = smsLanguageChoiceEnabled});

  /// Whether the "SMS language" choice is offered at all.
  ///
  /// Offers are English only at launch, so this is false and the screen shows
  /// just the "Offers by SMS" switch; the language code and the model fields
  /// stay in place. Set it to true when Sinhala/Tamil offers are switched on
  /// in the backend's SMS_OFFER_LANGUAGES.
  static const bool smsLanguageChoiceEnabled = false;

  /// Injectable for tests; the screen makes its own otherwise.
  final ProfileProvider? provider;

  /// Shows the language section. Defaults to [smsLanguageChoiceEnabled];
  /// passed explicitly only by tests.
  final bool languageChoice;

  /// Opens the screen, or sends a guest to log in first - the settings belong
  /// to the customer's account. [provider] is for tests.
  static void open(BuildContext context, {ProfileProvider? provider}) {
    final navigator = Navigator.of(context);
    if (!context.read<AuthProvider>().isAuthenticated) {
      navigator.pushNamed('/login');
      return;
    }
    navigator.push(MaterialPageRoute(builder: (_) => SmsPreferencesScreen(provider: provider)));
  }

  @override
  State<SmsPreferencesScreen> createState() => _SmsPreferencesScreenState();
}

class _SmsPreferencesScreenState extends State<SmsPreferencesScreen> {
  late final ProfileProvider _profile = widget.provider ?? ProfileProvider();

  @override
  void initState() {
    super.initState();
    _profile.load();
  }

  @override
  void dispose() {
    // Only dispose what this screen made; an injected provider is the caller's.
    if (widget.provider == null) _profile.dispose();
    super.dispose();
  }

  Future<void> _chooseLanguage(SmsLanguage language) async {
    // No language save while the choice is switched off.
    if (!widget.languageChoice) return;
    final saved = await _profile.setSmsLanguage(language);
    if (!saved) _reportFailure();
  }

  Future<void> _setOffers(bool on) async {
    final saved = await _profile.setSmsOffers(on);
    if (!saved) _reportFailure();
  }

  void _reportFailure() {
    if (!mounted) return;
    final failure = _profile.failure;
    if (failure == null) return; // nothing was sent (already saving)
    showBlynkSnackBar(
      context: context,
      message: failure.message,
      tone: SnackTone.error,
      actionLabel: failure.needsLogin ? 'Log in' : null,
      onAction: failure.needsLogin ? () => Navigator.of(context).pushNamed('/login') : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('SMS & offers')),
      body: ContentFrame(
        maxWidth: 720,
        child: ListenableBuilder(
          listenable: _profile,
          builder: (context, _) {
            final profile = _profile.profile;
            if (profile == null) {
              final failure = _profile.loadFailure;
              if (failure != null && !_profile.isLoading) {
                return FailureState(
                  failure: failure,
                  title: "We couldn't load your SMS settings",
                  retryKey: const Key('sms-settings-retry'),
                  scrollable: false,
                  onRetry: _profile.load,
                );
              }
              return const AppStateView.loading('Loading your SMS settings');
            }
            return _Settings(
              profile: profile,
              languageChoice: widget.languageChoice,
              savingLanguage: _profile.isSavingLanguage,
              savingOffers: _profile.isSavingOffers,
              onLanguage: _chooseLanguage,
              onOffers: _setOffers,
            );
          },
        ),
      ),
    );
  }
}

class _Settings extends StatelessWidget {
  const _Settings({
    required this.profile,
    required this.languageChoice,
    required this.savingLanguage,
    required this.savingOffers,
    required this.onLanguage,
    required this.onOffers,
  });

  final UserModel profile;
  final bool languageChoice;
  final bool savingLanguage;
  final bool savingOffers;
  final ValueChanged<SmsLanguage> onLanguage;
  final ValueChanged<bool> onOffers;

  @override
  Widget build(BuildContext context) {
    final chosen = profile.smsLanguage;
    return ListView(
      padding: const EdgeInsets.fromLTRB(0, BlynkSpace.s8, 0, BlynkSpace.s32),
      children: [
        if (languageChoice) ...[
          const Text('SMS language', style: BlynkText.heading),
          const SizedBox(height: BlynkSpace.s4),
          Text('Offer SMS are sent in this language.', style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
          if (chosen == null) ...[const SizedBox(height: BlynkSpace.s8), const _Hint('Pick a language for offer SMS')],
          const SizedBox(height: BlynkSpace.s8),
          for (final language in SmsLanguage.values)
            _LanguageChoice(
              language: language,
              selected: chosen == language,
              saving: savingLanguage && chosen == language,
              onTap: savingLanguage ? null : () => onLanguage(language),
            ),
          const SizedBox(height: BlynkSpace.s24),
          const Divider(height: 1, color: BlynkColors.line),
          const SizedBox(height: BlynkSpace.s16),
        ],
        _OffersSwitch(value: profile.smsOffers, onChanged: savingOffers ? null : onOffers),
      ],
    );
  }
}

/// One of the three languages: the whole row is one 48 dp+ target, and the
/// filled vs outline mark (not a colour) says which one is chosen.
class _LanguageChoice extends StatelessWidget {
  const _LanguageChoice({required this.language, required this.selected, required this.saving, required this.onTap});

  final SmsLanguage language;
  final bool selected;
  final bool saving;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      enabled: onTap != null,
      label: language.label,
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BlynkRadius.lgAll,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
            child: Row(
              children: [
                SizedBox.square(
                  dimension: BlynkIcons.md,
                  child: saving
                      ? const Center(child: BlynkSpinner(size: BlynkIcons.sm))
                      : Icon(
                          selected ? BlynkIcons.choiceOn : BlynkIcons.choiceOff,
                          size: BlynkIcons.md,
                          color: selected ? BlynkColors.ink : BlynkColors.ink3,
                        ),
                ),
                const SizedBox(width: BlynkSpace.s16),
                Expanded(child: Text(language.label, style: BlynkText.body)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// "Offers by SMS" - the label every offer SMS points to.
class _OffersSwitch extends StatelessWidget {
  const _OffersSwitch({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final change = onChanged;
    return MergeSemantics(
      child: InkWell(
        onTap: change == null ? null : () => change(!value),
        borderRadius: BlynkRadius.lgAll,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Offers by SMS', style: BlynkText.heading),
                    const SizedBox(height: BlynkSpace.s4),
                    Text(
                      'Get Blynk offers and discounts by SMS. Order updates still arrive.',
                      style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: BlynkSpace.s16),
              Switch(
                value: value,
                onChanged: change,
                // Ink for "on", like the app's other selected controls;
                // yellow stays reserved for the forward action.
                thumbColor: WidgetStateProperty.resolveWith(
                  (states) => states.contains(WidgetState.selected) ? BlynkColors.paper : BlynkColors.ink3,
                ),
                trackColor: WidgetStateProperty.resolveWith(
                  (states) => states.contains(WidgetState.selected) ? BlynkColors.ink : BlynkColors.well,
                ),
                trackOutlineColor: WidgetStateProperty.resolveWith(
                  (states) => states.contains(WidgetState.selected) ? BlynkColors.ink : BlynkColors.lineStrong,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A quiet nudge, glyph + words, shown while no language is chosen.
class _Hint extends StatelessWidget {
  const _Hint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 2),
          child: Icon(BlynkIcons.info, size: BlynkIcons.xs, color: BlynkColors.ink2),
        ),
        const SizedBox(width: BlynkSpace.s4),
        Expanded(
          child: Text(text, style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
        ),
      ],
    );
  }
}
