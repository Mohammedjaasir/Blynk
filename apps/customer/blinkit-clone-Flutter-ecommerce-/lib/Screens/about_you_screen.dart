import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_responsive.dart';
import '../design/tokens.dart';
import '../Models/category_model.dart';
import '../Models/user_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/product.provider.dart';
import '../Services/Providers/profile.provider.dart';
import '../Services/Providers/store_info.provider.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/snackbar_helper.dart';
import '../UI/Widgets/Organisms/date_of_birth_picker.dart';
import '../UI/Widgets/Organisms/favourite_category_chips.dart';

/// Profile -> About you (owner, 2026-10-09): the customer's name, date of
/// birth and favourite foods and snacks. **Everything here is optional** and
/// always editable; the date of birth is how the birthday gift (a % off one
/// order in the birthday week, applied by the server at checkout) finds them.
///
/// Favourites are chips from Blynk's live category list plus one free-text
/// "Anything else you love?" (<= 200 chars). Save sends only what changed
/// (PATCH /me) and then shows the server's own copy.
class AboutYouScreen extends StatefulWidget {
  const AboutYouScreen({super.key, this.provider, this.today});

  static const String route = '/profile/about-you';

  static const Key nameKey = Key('about-you-name');
  static const Key noteKey = Key('about-you-note');
  static const Key saveKey = Key('about-you-save');

  /// The free text's limit (PATCH /me `favourites_note`).
  static const int noteMaxLength = 200;

  /// Injectable for tests; the screen makes its own otherwise.
  final ProfileProvider? provider;

  /// Injectable for tests (the date-of-birth range).
  final DateTime? today;

  /// Opens the screen, or sends a guest to log in first - the details belong
  /// to the customer's account.
  static void open(BuildContext context) {
    final navigator = Navigator.of(context);
    if (!context.read<AuthProvider>().isAuthenticated) {
      navigator.pushNamed('/login');
      return;
    }
    navigator.pushNamed(AboutYouScreen.route);
  }

  @override
  State<AboutYouScreen> createState() => _AboutYouScreenState();
}

class _AboutYouScreenState extends State<AboutYouScreen> {
  late final ProfileProvider _profile = widget.provider ?? ProfileProvider();
  final _name = TextEditingController();
  final _note = TextEditingController();
  DateTime? _dateOfBirth;
  Set<String> _favourites = {};
  String? _nameError;

  /// The profile the form was last filled from; a new server copy refills it.
  UserModel? _seededFrom;

  @override
  void initState() {
    super.initState();
    _profile.addListener(_onProfile);
    _onProfile();
    _profile.load();
    _name.addListener(_changed);
    _note.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<ProductProvider?>()?.loadCategories();
    });
  }

  @override
  void dispose() {
    _profile.removeListener(_onProfile);
    _name.dispose();
    _note.dispose();
    // Only dispose what this screen made; an injected provider is the caller's.
    if (widget.provider == null) _profile.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  /// A new server copy (the first load, or a save's answer) refills the
  /// form; anything else the provider announces leaves typed edits alone.
  void _onProfile() {
    final profile = _profile.profile;
    if (profile != null && !identical(_seededFrom, profile)) _seed(profile);
  }

  void _seed(UserModel profile) {
    _seededFrom = profile;
    _name.text = profile.fullName ?? '';
    _note.text = profile.favouritesNote ?? '';
    _dateOfBirth = profile.dateOfBirth;
    _favourites = profile.favouriteCategoryIds.toSet();
    _nameError = null;
  }

  Map<String, dynamic> _changes(UserModel profile) => ProfileProvider.aboutYouChanges(
        before: profile,
        name: _name.text,
        dateOfBirth: _dateOfBirth,
        favouriteCategoryIds: _favourites.toList(),
        note: _note.text,
      );

  Future<void> _save() async {
    final before = _profile.profile;
    if (before == null) return;
    final name = _name.text.trim();
    if (name.isNotEmpty && name.length < AuthProvider.nameMinLength) {
      setState(() => _nameError = 'Enter your name (at least ${AuthProvider.nameMinLength} letters).');
      return;
    }
    setState(() => _nameError = null);
    FocusScope.of(context).unfocus();
    final saved = await _profile.saveAboutYou(_changes(before));
    if (!mounted) return;
    if (!saved) {
      final failure = _profile.failure;
      if (failure == null) return; // already saving
      showBlynkSnackBar(
        context: context,
        message: failure.message,
        tone: SnackTone.error,
        actionLabel: failure.needsLogin ? 'Log in' : null,
        onAction: failure.needsLogin ? () => Navigator.of(context).pushNamed('/login') : null,
      );
      return;
    }
    final after = _profile.profile;
    if (after != null) {
      // The Profile header shows the name from the signed-in session.
      final savedName = after.fullName?.trim() ?? '';
      if (savedName.isNotEmpty) await context.read<AuthProvider>().rememberName(savedName);
      if (!mounted) return;
      // A new date of birth can open the gift at once (Home, cart, checkout).
      context.read<StoreInfoProvider?>()?.applyBirthdayOffer(after.birthdayOffer);
    }
    showBlynkSnackBar(context: context, message: 'Saved', tone: SnackTone.success);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('About you')),
      body: ContentFrame(
        maxWidth: BlynkForm.maxWidth,
        child: ListenableBuilder(
          listenable: _profile,
          builder: (context, _) {
            final profile = _profile.profile;
            if (profile == null) {
              final failure = _profile.loadFailure;
              if (failure != null && !_profile.isLoading) {
                return FailureState(
                  failure: failure,
                  title: "We couldn't load your details",
                  retryKey: const Key('about-you-retry'),
                  scrollable: false,
                  onRetry: _profile.load,
                );
              }
              return const AppStateView.loading('Loading your details');
            }
            final saving = _profile.isSavingAboutYou;
            final hasChanges = _changes(profile).isNotEmpty;
            return ListView(
              padding: const EdgeInsets.fromLTRB(0, BlynkSpace.s8, 0, BlynkSpace.s32),
              children: [
                Text(
                  'All optional. Tell us as much or as little as you like.',
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
                const SizedBox(height: BlynkSpace.s24),
                BlynkTextField(
                  key: AboutYouScreen.nameKey,
                  label: 'Your name',
                  hintText: 'e.g. Nimal Perera',
                  controller: _name,
                  maxLength: 60,
                  enabled: !saving,
                  keyboardType: TextInputType.name,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  errorText: _nameError,
                ),
                const SizedBox(height: BlynkSpace.s24),
                DateOfBirthField(
                  value: _dateOfBirth,
                  enabled: !saving,
                  today: widget.today,
                  onChanged: (date) => setState(() => _dateOfBirth = date),
                ),
                const SizedBox(height: BlynkSpace.s8),
                _BirthdayNote(offer: profile.birthdayOffer, hasDate: _dateOfBirth != null),
                const SizedBox(height: BlynkSpace.s32),
                Semantics(header: true, child: const Text('Favourite foods and snacks', style: BlynkText.heading)),
                const SizedBox(height: BlynkSpace.s4),
                Text(
                  'Pick any you love. We use them to show you the right offers.',
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
                const SizedBox(height: BlynkSpace.s12),
                _FavouritesPicker(
                  profile: profile,
                  selected: _favourites,
                  enabled: !saving,
                  onChanged: (next) => setState(() => _favourites = next),
                ),
                const SizedBox(height: BlynkSpace.s24),
                BlynkTextField(
                  key: AboutYouScreen.noteKey,
                  label: 'Anything else you love?',
                  hintText: 'e.g. Spicy murukku, Milo, fresh mangoes',
                  helperText: 'Up to ${AboutYouScreen.noteMaxLength} characters.',
                  controller: _note,
                  maxLength: AboutYouScreen.noteMaxLength,
                  maxLines: 3,
                  enabled: !saving,
                  textCapitalization: TextCapitalization.sentences,
                ),
                const SizedBox(height: BlynkSpace.s32),
                BlynkButton.primary(
                  key: AboutYouScreen.saveKey,
                  label: 'Save',
                  expand: true,
                  loading: saving,
                  onPressed: hasChanges ? _save : null,
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// What the date of birth is for, worded from the server's own
/// `birthday_offer`: the gift when it applies now, its percent while the
/// customer has no date yet, and a plain line otherwise (the gift switched
/// off, or not known).
class _BirthdayNote extends StatelessWidget {
  const _BirthdayNote({required this.offer, required this.hasDate});

  final BirthdayOffer? offer;
  final bool hasDate;

  @override
  Widget build(BuildContext context) {
    final gift = offer;
    final String text;
    if (gift != null && gift.eligible) {
      text = gift.bannerText;
    } else if (gift != null && gift.enabled && gift.percent > 0) {
      text = hasDate
          ? 'You get ${gift.percentLabel} off one order in your birthday week.'
          : 'Add it for ${gift.percentLabel} off one order in your birthday week.';
    } else {
      text = 'For a birthday gift from Blynk. Only you and Blynk see it.';
    }
    return Row(
      key: const Key('about-you-birthday-note'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 2),
          child: Icon(BlynkIcons.birthday, size: BlynkIcons.xs, color: BlynkColors.ink2),
        ),
        const SizedBox(width: BlynkSpace.s4),
        Expanded(child: Text(text, style: BlynkText.caption.copyWith(color: BlynkColors.ink2))),
      ],
    );
  }
}

/// The category chips, from the live list ([ProductProvider.categories],
/// top-level ones), plus any saved favourite the list does not show, so it
/// can still be unticked.
class _FavouritesPicker extends StatelessWidget {
  const _FavouritesPicker({
    required this.profile,
    required this.selected,
    required this.enabled,
    required this.onChanged,
  });

  final UserModel profile;
  final Set<String> selected;
  final bool enabled;
  final ValueChanged<Set<String>> onChanged;

  @override
  Widget build(BuildContext context) {
    final products = context.watch<ProductProvider?>();
    final live = products == null ? const <CategoryModel>[] : products.topLevelCategories;
    final shown = {for (final c in live) c.id};
    final choices = <FavouriteChoice>[
      for (final c in live) (id: c.id, name: c.name),
      for (final f in profile.favouriteCategories)
        if (!shown.contains(f.id) && f.name.isNotEmpty) (id: f.id, name: f.name),
    ];
    if (choices.isEmpty) {
      if (products != null && products.isLoadingCategories) {
        return Text('Loading categories', style: BlynkText.caption.copyWith(color: BlynkColors.ink2));
      }
      return Row(
        children: [
          Expanded(
            child: Text(
              "We couldn't load the categories.",
              style: BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
          ),
          if (products != null)
            BlynkButton.tertiary(
              key: const Key('about-you-categories-retry'),
              label: 'Try again',
              onPressed: () => products.loadCategories(force: true),
            ),
        ],
      );
    }
    return FavouriteCategoryChips(
      choices: choices,
      selected: selected,
      enabled: enabled,
      onChanged: onChanged,
    );
  }
}
