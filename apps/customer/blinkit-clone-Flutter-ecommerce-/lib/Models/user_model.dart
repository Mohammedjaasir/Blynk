import 'dart:convert';

import 'birthday_offer_model.dart';

export 'birthday_offer_model.dart' show BirthdayOffer, FavouriteCategory;

/// The language a customer gets offer SMS in (GET/PATCH /me `sms_language`).
/// Each label is the language in its own script, with English alongside.
enum SmsLanguage {
  sinhala('si', 'සිංහල (Sinhala)'),
  tamil('ta', 'தமிழ் (Tamil)'),
  english('en', 'English');

  const SmsLanguage(this.wire, this.label);

  /// What the backend stores and accepts.
  final String wire;

  /// What the choice row says.
  final String label;

  /// The language for a wire value, or null when none was picked (or the
  /// value is one this app does not know).
  static SmsLanguage? fromWire(Object? value) {
    for (final language in values) {
      if (language.wire == value) return language;
    }
    return null;
  }
}

class UserModel {
  final String id;
  final String phone;
  final String? email;
  final String? fullName;
  final String role;
  final bool isActive;
  final String? createdAt;

  /// The language offer SMS are sent in; null until the customer picks one.
  final SmsLanguage? smsLanguage;

  /// True while the customer receives offer SMS (the backend's default).
  /// Order-update SMS are not affected.
  final bool smsOffers;

  // "About you" (owner, 2026-10-09): every field is optional and only ever
  // comes from GET/PATCH /me; GET /auth/me and an older cache carry none.

  /// The customer's date of birth (a calendar day), or null.
  final DateTime? dateOfBirth;

  /// Favourite categories, by id (what PATCH /me takes)...
  final List<String> favouriteCategoryIds;

  /// ...and by name (what GET /me returns alongside).
  final List<FavouriteCategory> favouriteCategories;

  /// "Anything else you love?" (<= 200 chars), or null.
  final String? favouritesNote;

  /// Where the customer stands on the birthday gift, or null when unknown.
  final BirthdayOffer? birthdayOffer;

  UserModel({
    required this.id,
    required this.phone,
    this.email,
    this.fullName,
    required this.role,
    this.isActive = true,
    this.createdAt,
    this.smsLanguage,
    this.smsOffers = true,
    this.dateOfBirth,
    this.favouriteCategoryIds = const [],
    this.favouriteCategories = const [],
    this.favouritesNote,
    this.birthdayOffer,
  });

  static List<String> _ids(Object? raw) =>
      raw is List ? [for (final id in raw) if (id != null) id.toString()] : const [];

  static List<FavouriteCategory> _favourites(Object? raw) => raw is List
      ? [for (final c in raw.map(FavouriteCategory.tryParse)) if (c != null) c]
      : const [];

  static String? _note(Object? raw) {
    final text = raw?.toString().trim();
    return text == null || text.isEmpty ? null : text;
  }

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final favourites = _favourites(json['favourite_categories']);
    final ids = _ids(json['favourite_category_ids']);
    return UserModel(
      id: (json['id'] ?? '').toString(),
      phone: (json['phone'] ?? '').toString(),
      email: json['email']?.toString(),
      fullName: (json['full_name'] ?? json['fullName'])?.toString(),
      role: (json['role'] ?? 'CUSTOMER').toString(),
      isActive: json['is_active'] == true || json['isActive'] == true,
      createdAt: (json['created_at'] ?? json['createdAt'])?.toString(),
      smsLanguage: SmsLanguage.fromWire(json['sms_language']),
      // Only an explicit false is an opt-out: a payload without the field
      // (GET /auth/me, an older saved session) keeps the default.
      smsOffers: json['sms_offers'] != false,
      dateOfBirth: parseIsoDate(json['date_of_birth']),
      // The ids, or (an older cache) the ids of the named favourites.
      favouriteCategoryIds: ids.isNotEmpty ? ids : [for (final c in favourites) c.id],
      favouriteCategories: favourites,
      favouritesNote: _note(json['favourites_note']),
      birthdayOffer: BirthdayOffer.tryParse(json['birthday_offer']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'phone': phone,
      'email': email,
      'full_name': fullName,
      'role': role,
      'is_active': isActive,
      'created_at': createdAt,
      'sms_language': smsLanguage?.wire,
      'sms_offers': smsOffers,
      'date_of_birth': dateOfBirth == null ? null : formatIsoDate(dateOfBirth!),
      'favourite_category_ids': favouriteCategoryIds,
      'favourite_categories': [for (final c in favouriteCategories) c.toJson()],
      'favourites_note': favouritesNote,
      // birthday_offer is not cached: it changes with the calendar.
    };
  }

  String toJsonString() => jsonEncode(toJson());

  factory UserModel.fromJsonString(String source) =>
      UserModel.fromJson(jsonDecode(source) as Map<String, dynamic>);

  /// This profile with the name replaced (the sign-in name step, 2026-10-08).
  UserModel copyWithName(String name) => _copy(fullName: name);

  /// This profile with the SMS preferences replaced. [smsLanguage] is only
  /// replaced when given; the backend has no way to clear it.
  UserModel copyWithSms({SmsLanguage? smsLanguage, bool? smsOffers}) => _copy(
        smsLanguage: smsLanguage ?? this.smsLanguage,
        smsOffers: smsOffers ?? this.smsOffers,
      );

  /// This profile with the SMS language put back to [language], which may be
  /// null (a failed first pick is undone to "none chosen").
  UserModel withSmsLanguage(SmsLanguage? language) => UserModel(
        id: id,
        phone: phone,
        email: email,
        fullName: fullName,
        role: role,
        isActive: isActive,
        createdAt: createdAt,
        smsLanguage: language,
        smsOffers: smsOffers,
        dateOfBirth: dateOfBirth,
        favouriteCategoryIds: favouriteCategoryIds,
        favouriteCategories: favouriteCategories,
        favouritesNote: favouritesNote,
        birthdayOffer: birthdayOffer,
      );

  UserModel _copy({String? fullName, SmsLanguage? smsLanguage, bool? smsOffers}) => UserModel(
        id: id,
        phone: phone,
        email: email,
        fullName: fullName ?? this.fullName,
        role: role,
        isActive: isActive,
        createdAt: createdAt,
        smsLanguage: smsLanguage ?? this.smsLanguage,
        smsOffers: smsOffers ?? this.smsOffers,
        dateOfBirth: dateOfBirth,
        favouriteCategoryIds: favouriteCategoryIds,
        favouriteCategories: favouriteCategories,
        favouritesNote: favouritesNote,
        birthdayOffer: birthdayOffer,
      );

  @override
  String toString() {
    return 'UserModel(id: $id, phone: $phone, fullName: $fullName, role: $role)';
  }
}
