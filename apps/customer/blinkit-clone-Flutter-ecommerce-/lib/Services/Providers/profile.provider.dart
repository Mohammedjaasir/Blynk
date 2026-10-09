import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/birthday_offer_model.dart' show formatIsoDate;
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Services/app_errors.dart';

/// A request against the profile API. Defaults to the app's ApiService;
/// injectable so tests can answer without a network.
typedef ProfileRequest = Future<dynamic> Function({
  String? methodType,
  String? url,
  dynamic body,
});

/// The signed-in customer's own profile: GET /me and PATCH /me. It carries
/// the SMS preferences (offer language and the offers opt-out) and, since
/// "About you" (owner, 2026-10-09), the optional name, date of birth and
/// favourites.
///
/// Owned by the screen using it (SMS settings, About you, the sign-up
/// birthday prompt) rather than registered app-wide, like
/// FeedbackProvider: nothing else reads these fields, and nothing here is
/// worth keeping once the screen closes.
///
/// Saves are optimistic: the new value shows at once and is put back if the
/// save fails, with the reason left in [failure].
class ProfileProvider extends ChangeNotifier {
  ProfileProvider({ProfileRequest? request})
      : _request = request ?? ApiService.requestMethods;

  final ProfileRequest _request;

  UserModel? _profile;
  bool _isLoading = false;
  CustomerError? _loadFailure;
  CustomerError? _failure;
  bool _savingLanguage = false;
  bool _savingOffers = false;
  bool _disposed = false;

  UserModel? get profile => _profile;
  bool get isLoading => _isLoading;

  /// Why the profile could not be loaded, or null.
  CustomerError? get loadFailure => _loadFailure;

  /// Why the last save failed, or null.
  CustomerError? get failure => _failure;

  bool get isSavingLanguage => _savingLanguage;
  bool get isSavingOffers => _savingOffers;

  /// GET /me -> data.profile.
  Future<void> load() async {
    _isLoading = true;
    _loadFailure = null;
    _notify();
    try {
      final response = await _request(methodType: 'GET', url: '/me');
      final raw = _profileOf(response);
      if (raw == null) throw StateError('GET /me returned no profile');
      _profile = UserModel.fromJson(raw);
    } catch (e) {
      _loadFailure = AppErrors.from(e);
    } finally {
      _isLoading = false;
      _notify();
    }
  }

  /// Saves the offer-SMS language. Returns true once the backend has it.
  Future<bool> setSmsLanguage(SmsLanguage language) async {
    final before = _profile;
    if (before == null || _savingLanguage) return false;
    if (before.smsLanguage == language) return true;
    _savingLanguage = true;
    return _save(
      before: before,
      optimistic: before.copyWithSms(smsLanguage: language),
      body: {'sms_language': language.wire},
      done: () => _savingLanguage = false,
    );
  }

  /// Turns offer SMS on or off. Returns true once the backend has it.
  Future<bool> setSmsOffers(bool on) async {
    final before = _profile;
    if (before == null || _savingOffers) return false;
    if (before.smsOffers == on) return true;
    _savingOffers = true;
    return _save(
      before: before,
      optimistic: before.copyWithSms(smsOffers: on),
      body: {'sms_offers': on},
      done: () => _savingOffers = false,
    );
  }

  bool _savingAboutYou = false;

  /// True while an "About you" save is on the wire.
  bool get isSavingAboutYou => _savingAboutYou;

  /// The PATCH /me body that turns [before] into what the "About you" form
  /// holds (owner, 2026-10-09): only the fields that changed, so an untouched
  /// form sends nothing. An empty [name] is never sent (the account keeps its
  /// name); a cleared [dateOfBirth] is sent as null, and so is an empty
  /// [note]. With no [before] (the sign-up birthday prompt, before any GET),
  /// every given field is sent.
  static Map<String, dynamic> aboutYouChanges({
    UserModel? before,
    String? name,
    DateTime? dateOfBirth,
    bool includeDateOfBirth = true,
    List<String>? favouriteCategoryIds,
    String? note,
  }) {
    final body = <String, dynamic>{};
    final trimmedName = name?.trim() ?? '';
    if (trimmedName.isNotEmpty && trimmedName != (before?.fullName ?? '').trim()) {
      body['full_name'] = trimmedName;
    }
    if (includeDateOfBirth) {
      final wire = dateOfBirth == null ? null : formatIsoDate(dateOfBirth);
      final was = before?.dateOfBirth == null ? null : formatIsoDate(before!.dateOfBirth!);
      if (before == null ? wire != null : wire != was) body['date_of_birth'] = wire;
    }
    if (favouriteCategoryIds != null) {
      final ids = favouriteCategoryIds.toSet().toList();
      final was = (before?.favouriteCategoryIds ?? const <String>[]).toSet();
      if (ids.toSet().length != was.length || !was.containsAll(ids)) {
        body['favourite_category_ids'] = ids;
      }
    }
    if (note != null) {
      final trimmed = note.trim();
      final wire = trimmed.isEmpty ? null : trimmed;
      if (wire != before?.favouritesNote) body['favourites_note'] = wire;
    }
    return body;
  }

  /// Saves "About you" fields (PATCH /me with [changes], usually from
  /// [aboutYouChanges]). Not optimistic: the form keeps what was typed until
  /// the server answers, and then [profile] is the server's own copy (with
  /// its fresh `birthday_offer`). Returns true once saved; on a refusal
  /// [failure] says why. Nothing to change is a save that already happened.
  Future<bool> saveAboutYou(Map<String, dynamic> changes) async {
    if (_savingAboutYou) return false;
    if (changes.isEmpty) return true;
    _savingAboutYou = true;
    _failure = null;
    _notify();
    try {
      final response = await _request(methodType: 'PATCH', url: '/me', body: changes);
      final raw = _profileOf(response);
      if (raw != null) {
        final saved = UserModel.fromJson(raw);
        final before = _profile;
        // GET /me's shape; keep what an older backend may leave out.
        _profile = before == null || raw.containsKey('created_at')
            ? saved
            : UserModel(
                id: saved.id.isEmpty ? before.id : saved.id,
                phone: saved.phone.isEmpty ? before.phone : saved.phone,
                email: saved.email ?? before.email,
                fullName: saved.fullName ?? before.fullName,
                role: saved.role,
                isActive: before.isActive,
                createdAt: before.createdAt,
                smsLanguage: saved.smsLanguage ?? before.smsLanguage,
                smsOffers: saved.smsOffers,
                dateOfBirth: saved.dateOfBirth,
                favouriteCategoryIds: saved.favouriteCategoryIds,
                favouriteCategories: saved.favouriteCategories,
                favouritesNote: saved.favouritesNote,
                birthdayOffer: saved.birthdayOffer ?? before.birthdayOffer,
              );
      }
      return true;
    } catch (e) {
      _failure = AppErrors.from(e);
      return false;
    } finally {
      _savingAboutYou = false;
      _notify();
    }
  }

  Future<bool> _save({
    required UserModel before,
    required UserModel optimistic,
    required Map<String, dynamic> body,
    required VoidCallback done,
  }) async {
    _failure = null;
    _profile = optimistic;
    _notify();
    try {
      final response = await _request(methodType: 'PATCH', url: '/me', body: body);
      final raw = _profileOf(response);
      if (raw != null) {
        // PATCH answers with a shorter profile (no is_active / created_at),
        // so only the SMS fields are taken from it.
        final saved = UserModel.fromJson(raw);
        _profile = (_profile ?? optimistic).copyWithSms(
          smsLanguage: saved.smsLanguage,
          smsOffers: saved.smsOffers,
        );
      }
      return true;
    } catch (e) {
      _failure = AppErrors.from(e);
      // Put back only the field this save changed, so a second save that
      // finished meanwhile is not undone with it.
      final current = _profile ?? optimistic;
      _profile = body.containsKey('sms_language')
          ? current.withSmsLanguage(before.smsLanguage)
          : current.copyWithSms(smsOffers: before.smsOffers);
      return false;
    } finally {
      done();
      _notify();
    }
  }

  static Map<String, dynamic>? _profileOf(dynamic response) {
    final data = response is Map ? response['data'] : null;
    final raw = data is Map ? data['profile'] : null;
    return raw is Map ? raw.cast<String, dynamic>() : null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
